import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isWindows } from './platform';

/**
 * Resolve the C# HotshareHelper.exe path (dev vs packaged).
 */
export function helperPath(): string {
  return process.env.NODE_ENV === 'development'
    ? path.resolve('./csharp/bin/Release/net8.0/HotshareHelper.exe')
    : path.join(process.resourcesPath || '', 'csharp', 'HotshareHelper.exe');
}

/**
 * Run the C# helper. On Windows the helper needs admin for privileged
 * operations (mobile hotspot, MSI install), so it is relaunched elevated via a
 * temp wrapper script + PowerShell Start-Process -Verb RunAs (UAC). Output is
 * captured to temp files and read back. On Linux/macOS it spawns directly.
 */
export function runHelper(args: string[], timeoutMs: number): Promise<string> {
  const helper = helperPath();
  return new Promise((resolve, reject) => {
    if (isWindows) {
      runHelperElevated(helper, args, timeoutMs).then(resolve, reject);
      return;
    }
    const proc = spawn(helper, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Helper exited with code ${code}: ${stderr.trim()}`));
      }
    });
    proc.on('error', (e) => reject(new Error(`Failed to spawn helper: ${e.message}`)));
    setTimeout(() => {
      proc.kill();
      reject(new Error('Helper timeout exceeded'));
    }, timeoutMs);
  });
}

function runHelperElevated(helperPath: string, args: string[], timeoutMs: number): Promise<string> {
  return runElevated(`"${helperPath}"`, args, timeoutMs);
}

/**
 * Run an arbitrary command elevated on Windows via a temp wrapper script +
 * PowerShell Start-Process -Verb RunAs (UAC). Output is captured to temp files
 * and read back. On non-Windows platforms it is not used (the app runs as
 * root / the OS handles elevation natively).
 */
export function runElevated(quotedExecutable: string, args: string[], timeoutMs: number): Promise<string> {
  const outFile = path.join(os.tmpdir(), `hotshare-elevated-${Date.now()}.out`);
  const errFile = path.join(os.tmpdir(), `hotshare-elevated-${Date.now()}.err`);
  const wrapperPath = path.join(os.tmpdir(), `hotshare-elevated-wrapper-${Date.now()}.cmd`);
  const argString = args.map((a) => `"${a}"`).join(' ');
  const wrapperContent =
    `@echo off\r\n` +
    `${quotedExecutable} ${argString} > "${outFile}" 2> "${errFile}"\r\n` +
    `exit /b %errorlevel%\r\n`;
  fs.writeFileSync(wrapperPath, wrapperContent);
  return new Promise((resolve, reject) => {
    const psScript =
      `Start-Process -FilePath "${wrapperPath}" -Verb RunAs -Wait; ` +
      `exit $LASTEXITCODE`;
    const proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, shell: false }
    );
    const timer = setTimeout(() => {
      proc.kill();
      cleanupTemp([wrapperPath, outFile, errFile]);
      reject(new Error('Helper timeout exceeded'));
    }, timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      try {
        let stdout = '';
        let stderr = '';
        if (fs.existsSync(outFile)) stdout = fs.readFileSync(outFile, 'utf8').trim();
        if (fs.existsSync(errFile)) stderr = fs.readFileSync(errFile, 'utf8').trim();
        cleanupTemp([wrapperPath, outFile, errFile]);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Helper exited with code ${code}: ${stderr}`));
        }
      } catch (e) {
        cleanupTemp([wrapperPath, outFile, errFile]);
        reject(new Error(`Failed to read helper output: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      cleanupTemp([wrapperPath, outFile, errFile]);
      reject(new Error(`Failed to spawn PowerShell: ${e.message}`));
    });
  });
}

function cleanupTemp(files: string[]) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/**
 * Serves the SPA renderer over HTTP on 127.0.0.1 only.
 *
 * Loading a history-based router (react-router RouterProvider) via
 * file:// breaks routing ("No routes matched location ..."), which renders
 * a blank/black window. Serving over http://127.0.0.1:PORT/ fixes routing
 * and keeps the dashboard private (not reachable from hotspot clients).
 */
export class RendererServer {
  private server: http.Server | null = null;
  private url = '';
  private proxyTarget = 'http://127.0.0.1:80';

  async start(rootDir: string, proxyTarget = 'http://127.0.0.1:80'): Promise<string> {
    const root = path.resolve(rootDir);
    this.proxyTarget = proxyTarget;
    this.server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

      // Forward API calls to the portal server (same-origin in the SPA)
      if (urlPath.startsWith('/api')) {
        this.proxy(req, res);
        return;
      }

      let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);

      // Prevent path traversal
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      const send = (p: string) => {
        fs.readFile(p, (err, data) => {
          if (err) {
            res.writeHead(404).end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
          res.end(data);
        });
      };

      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          // SPA fallback: serve index.html for any unknown path
          send(path.join(root, 'index.html'));
          return;
        }
        send(filePath);
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number };
        this.url = `http://127.0.0.1:${addr.port}/`;
        resolve(this.url);
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private proxy(req: http.IncomingMessage, res: http.ServerResponse): void {
    const target = new URL(this.proxyTarget);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host };
      delete headers['content-length'];
      const outReq = http.request(
        {
          host: target.hostname,
          port: target.port,
          path: req.url || '/',
          method: req.method,
          headers,
        },
        (outRes) => {
          res.writeHead(outRes.statusCode || 502, outRes.headers);
          outRes.pipe(res);
        }
      );
      outReq.on('error', () => {
        if (!res.headersSent) res.writeHead(502).end('Bad gateway');
        else res.end();
      });
      outReq.end(body);
    });
    req.on('error', () => res.end());
  }
}

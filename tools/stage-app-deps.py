#!/usr/bin/env python3
"""Stage an npm workspace app's production dependencies into its own
node_modules/, so electron-builder skips its destructive `npm install
--production` (which prunes the workspace root; electron-builder #7103) and
only rebuilds native modules. Uses package-lock.json as ground truth.

Usage: stage-app-deps.py <workspace-root> <app-dir>
"""
import json
import os
import shutil
import sys


def resolve(pkgs, name, base):
    nested = f"{base}/node_modules/{name}"
    if nested in pkgs:
        return nested
    hoisted = f"node_modules/{name}"
    if hoisted in pkgs:
        return hoisted
    return None


def main():
    root, app_dir = sys.argv[1], sys.argv[2]
    lock = json.load(open(os.path.join(root, "package-lock.json")))
    pkgs = lock["packages"]
    app_key = os.path.relpath(app_dir, root)
    app = pkgs[app_key]
    queue = [(n, "node_modules") for n in (app.get("dependencies") or {})]
    copied = set()
    while queue:
        name, base = queue.pop()
        resolved = resolve(pkgs, name, base)
        if resolved is None or resolved in copied:
            continue
        copied.add(resolved)
        for dep in (pkgs[resolved].get("dependencies") or {}):
            queue.append((dep, resolved))
    for resolved in sorted(copied):
        src = os.path.join(root, resolved)
        dst = os.path.join(app_dir, resolved)
        if os.path.islink(src):
            src = os.path.realpath(src)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copytree(
            src, dst, dirs_exist_ok=True, symlinks=False,
            ignore=shutil.ignore_patterns("node_modules", ".bin"),
        )
    print(f"staged {len(copied)} production packages into {app_dir}/node_modules")


if __name__ == "__main__":
    main()
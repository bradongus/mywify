#!/usr/bin/env python3
"""
WARP Config Generator for hotshare
Registers a Cloudflare WARP device and generates a WireGuard config.
Requires: pip install warp-cli  OR  manual registration via Cloudflare WARP client.

Usage:
  python3 tools/generate-warp.py [--output path/to/wg0.conf]

NOTE: Cloudflare ToS restricts commercial redistribution of WARP.
This tool is for personal/testing use. For commercial use, owners should
bring their own WireGuard VPN config.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

def check_wgcf_installed():
    """Check if wgcf is installed"""
    try:
        subprocess.run(["wgcf", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False

def install_wgcf():
    """Install wgcf binary"""
    import platform
    import urllib.request

    system = platform.system().lower()
    arch = platform.machine().lower()

    if system == "linux" and arch == "x86_64":
        url = "https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_linux_amd64"
    elif system == "linux" and arch == "aarch64":
        url = "https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_linux_arm64"
    elif system == "darwin":
        url = "https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_darwin_amd64"
    elif system == "windows":
        url = "https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_windows_amd64.exe"
    else:
        print(f"Unsupported platform: {system}/{arch}")
        sys.exit(1)

    print(f"Downloading wgcf from {url}...")
    dest = os.path.join(tempfile.gettempdir(), "wgcf")
    urllib.request.urlretrieve(url, dest)
    os.chmod(dest, 0o755)
    return dest

def generate_warp_config():
    """Generate WARP config using wgcf"""
    if not check_wgcf_installed():
        wgcf_path = install_wgcf()
    else:
        wgcf_path = "wgcf"

    # Register
    print("Registering WARP device...")
    subprocess.run([wgcf_path, "register", "--accept-tos"], check=True)

    # Generate WireGuard profile
    print("Generating WireGuard config...")
    subprocess.run([wgcf_path, "generate"], check=True)

    # Read the generated config
    config_path = "wgcf-profile.conf"
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = f.read()

        # Remove DNS line (resolvconf may not be installed)
        lines = config.split("\n")
        filtered = [l for l in lines if not l.startswith("DNS=")]
        config = "\n".join(filtered)

        print("\n--- WARP Config ---")
        print(config)
        print("--- End Config ---")
        return config

    return None

def write_config(config: str, output_path: str):
    """Write config to file"""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        f.write(config)
    print(f"\nConfig written to: {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate WARP WireGuard config for hotshare")
    parser.add_argument("--output", default=None, help="Output path for WireGuard config")
    args = parser.parse_args()

    config = generate_warp_config()
    if config:
        output = args.output or os.path.join(tempfile.gettempdir(), "hotshare-warp.conf")
        write_config(config, output)
    else:
        print("Failed to generate WARP config")
        sys.exit(1)

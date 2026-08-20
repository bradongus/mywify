import { describe, it, expect } from 'vitest';
import { detectPlatform } from '../platform';

describe('detectPlatform', () => {
  it('returns windows when userAgent contains Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0';
    expect(detectPlatform(ua)).toBe('windows');
  });

  it('returns android when userAgent contains Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0';
    expect(detectPlatform(ua)).toBe('android');
  });

  it('returns linux for Linux desktop (Android checked first)', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0.0.0';
    expect(detectPlatform(ua)).toBe('linux');
  });

  it('returns macos for macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15';
    expect(detectPlatform(ua)).toBe('macos');
  });

  it('returns other for iOS iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
    expect(detectPlatform(ua)).toBe('other');
  });

  it('returns other for empty string', () => {
    expect(detectPlatform('')).toBe('other');
  });
});

import { describe, it, expect } from '@jest/globals';
import { generateCode, signCode, validateCodeFormat, verifyCodeIntegrity } from '../voucher.js';

describe('voucher', () => {
  it('generates valid HS-XXXXXXXX format', () => {
    const code = generateCode();
    expect(code).toMatch(/^HS-[A-Z0-9]{8}$/);
  });

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateCode()));
    expect(codes.size).toBe(100);
  });

  it('validates correct format', () => {
    expect(validateCodeFormat('HS-ABCDEFGH')).toBe(true);
    expect(validateCodeFormat('HS-12345678')).toBe(true);
    expect(validateCodeFormat('hs-abcdefgh')).toBe(false);
    expect(validateCodeFormat('HS-ABCDEFG')).toBe(false);
    expect(validateCodeFormat('HS-ABCDEFGHI')).toBe(false);
    expect(validateCodeFormat('invalid')).toBe(false);
  });

  it('signs and verifies codes', () => {
    const code = generateCode();
    const sig = signCode(code);
    expect(sig).toHaveLength(16);
    expect(verifyCodeIntegrity(code, sig)).toBe(true);
    expect(verifyCodeIntegrity(code, 'wrong')).toBe(false);
    expect(verifyCodeIntegrity('HS-WRONGCD', sig)).toBe(false);
  });

  it('uses HMAC (constant signature for same code)', () => {
    const code = 'HS-TESTCODE';
    expect(signCode(code)).toBe(signCode(code));
  });
});

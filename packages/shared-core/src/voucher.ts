import { randomBytes, createHmac } from 'node:crypto';

const SECRET = process.env.HOTSHARE_VOUCHER_SECRET || 'hotshare-dev-secret-change-in-prod';
const CODE_LENGTH = 8;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `HS-${code}`;
}

export function signCode(code: string): string {
  return createHmac('sha256', SECRET).update(code).digest('hex').slice(0, 16);
}

export function validateCodeFormat(code: string): boolean {
  return /^HS-[A-Z0-9]{8}$/.test(code);
}

export function verifyCodeIntegrity(code: string, signature: string): boolean {
  return signCode(code) === signature;
}

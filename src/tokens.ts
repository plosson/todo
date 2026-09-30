import { randomBytes, createHash } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export function generateUserCode(): string {
  const characters = Array.from(randomBytes(8)).map(
    (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length] ?? 'X',
  );
  return `${characters.slice(0, 4).join('')}-${characters.slice(4).join('')}`;
}

export function normaliseUserCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (stripped.length !== 8) return stripped;
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

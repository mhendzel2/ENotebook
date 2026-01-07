import crypto from 'crypto';
import bcrypt from 'bcrypt';

const PBKDF2_ITERATIONS = 10000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('hex');
  return { hash, salt: useSalt };
}

function isBcryptHash(storedHash: string): boolean {
  // bcrypt hashes typically start with $2a$, $2b$, or $2y$
  return typeof storedHash === 'string' && storedHash.startsWith('$2');
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;

  // Backward-compatibility: some code paths previously stored bcrypt hashes.
  if (isBcryptHash(storedHash)) {
    try {
      return await bcrypt.compare(password, storedHash);
    } catch {
      return false;
    }
  }

  // PBKDF2 format: salt:hash
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  const { hash: computedHash } = hashPassword(password, salt);
  return computedHash === hash;
}

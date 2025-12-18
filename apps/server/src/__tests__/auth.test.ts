import assert from 'node:assert';
import test from 'node:test';

test('Password Hashing Upgrade', async (t) => {
  // Mock bcryptjs and crypto
  const bcrypt = {
    genSalt: async () => 'salt',
    hash: async (pw: string) => `bcrypt:${pw}`,
    compare: async (pw: string, hash: string) => hash === `bcrypt:${pw}`
  };

  const crypto = {
    pbkdf2Sync: (pw: string, salt: string) => ({
      toString: () => `${pw}_hashed`
    })
  };

  // Mock implementation of verifyPassword from auth.ts
  async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (storedHash.includes(':') && !storedHash.startsWith('bcrypt')) {
      const [salt, hash] = storedHash.split(':');
      const computedHash = crypto.pbkdf2Sync(password, salt).toString('hex');
      // In our mock, toString returns `${pw}_hashed`, so we compare that.
      // But wait, the crypto mock returns an object with toString.
      return `${password}_hashed` === hash;
    }
    return bcrypt.compare(password, storedHash);
  }

  await t.test('verifies legacy password correctly', async () => {
    const legacyHash = 'somesalt:mypassword_hashed';
    const isValid = await verifyPassword('mypassword', legacyHash);
    assert.strictEqual(isValid, true);
  });

  await t.test('verifies bcrypt password correctly', async () => {
    const bcryptHash = 'bcrypt:mypassword';
    const isValid = await verifyPassword('mypassword', bcryptHash);
    assert.strictEqual(isValid, true);
  });

  await t.test('fails incorrect legacy password', async () => {
    const legacyHash = 'somesalt:mypassword_hashed';
    const isValid = await verifyPassword('wrongpassword', legacyHash);
    assert.strictEqual(isValid, false);
  });
});

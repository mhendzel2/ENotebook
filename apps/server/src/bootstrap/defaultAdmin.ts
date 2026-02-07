import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function ensureDefaultAdminUser(prisma: PrismaClient): Promise<void> {
  const shouldSeed = parseBoolean(process.env.SEED_DEFAULT_ADMIN, process.env.NODE_ENV !== 'production');
  if (!shouldSeed) return;

  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  const defaultAdminName = (process.env.DEFAULT_ADMIN_USERNAME || 'Admin').trim();
  const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'D_Admin';
  const defaultAdminEmailRaw = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@local').trim();
  const defaultAdminEmail = defaultAdminEmailRaw.length > 0 ? defaultAdminEmailRaw : null;

  const passwordHash = await bcrypt.hash(defaultAdminPassword, 12);
  await prisma.user.create({
    data: {
      name: defaultAdminName,
      email: defaultAdminEmail,
      role: 'admin',
      passwordHash,
      active: true,
      passwordHint: 'Default local admin account',
    },
  });

  // eslint-disable-next-line no-console
  console.log(`[auth] Seeded default admin user '${defaultAdminName}'.`);
}

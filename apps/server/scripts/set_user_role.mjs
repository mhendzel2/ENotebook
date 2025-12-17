import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const [identifier, roleRaw] = process.argv.slice(2);

const allowedRoles = new Set(['admin', 'manager', 'member']);
const role = String(roleRaw || '').toLowerCase();

if (!identifier || !role) {
  console.error('Usage: node scripts/set_user_role.mjs <email-or-user-id> <admin|manager|member>');
  process.exit(2);
}

if (!allowedRoles.has(role)) {
  console.error(`Invalid role: ${roleRaw}. Allowed: admin, manager, member`);
  process.exit(2);
}

try {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: identifier }, { email: identifier }]
    },
    select: { id: true, name: true, email: true, role: true }
  });

  if (!user) {
    console.error('User not found for identifier:', identifier);
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role },
    select: { id: true, name: true, email: true, role: true }
  });

  console.log('Updated user role:', updated);
} finally {
  await prisma.$disconnect();
}

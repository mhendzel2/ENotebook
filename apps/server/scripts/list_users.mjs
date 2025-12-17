import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(JSON.stringify(users, null, 2));
} finally {
  await prisma.$disconnect();
}

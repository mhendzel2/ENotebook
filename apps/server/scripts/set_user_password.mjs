import crypto from 'crypto';
import readline from 'readline';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hashPasswordPBKDF2(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, 10000, 64, 'sha512').toString('hex');
  return { salt: useSalt, hash };
}

function makeTempPassword() {
  // 12-ish chars, URL-safe
  return crypto.randomBytes(9).toString('base64url');
}

function printUsage() {
  console.error('Usage: node scripts/set_user_password.mjs <email-or-user-id> [--temp]');
  console.error('  --temp  Generate a temporary password and print it');
}

async function promptHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  // Hide user input (basic masking). Works well enough for local admin ops.
  rl.stdoutMuted = true;
  const originalWrite = rl._writeToOutput;
  rl._writeToOutput = function (stringToWrite) {
    if (rl.stdoutMuted) {
      // Don't echo typed chars; keep prompts readable.
      return;
    }
    return originalWrite.call(this, stringToWrite);
  };

  return await new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const args = process.argv.slice(2);
const identifier = args.find((a) => !a.startsWith('-'));
const isTemp = args.includes('--temp');

if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

if (!identifier) {
  printUsage();
  process.exit(2);
}

try {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: identifier }, { email: identifier }],
    },
    select: { id: true, name: true, email: true, role: true, active: true },
  });

  if (!user) {
    console.error('User not found for identifier:', identifier);
    process.exit(1);
  }

  let newPassword;

  if (isTemp) {
    newPassword = makeTempPassword();
  } else {
    const p1 = await promptHidden('New password: ');
    process.stdout.write('\n');
    const p2 = await promptHidden('Confirm new password: ');
    process.stdout.write('\n');

    if (!p1 || p1.length < 8) {
      console.error('Password must be at least 8 characters.');
      process.exit(2);
    }

    if (p1 !== p2) {
      console.error('Passwords do not match.');
      process.exit(2);
    }

    newPassword = p1;
  }

  const { salt, hash } = hashPasswordPBKDF2(newPassword);
  const passwordHash = `${salt}:${hash}`;

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log('Password updated for:', { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });

  if (isTemp) {
    console.log('Temporary password:', newPassword);
    console.log('Note: securely communicate this and change it after login.');
  }
} finally {
  await prisma.$disconnect();
}

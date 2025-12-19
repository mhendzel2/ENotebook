/*
 * One-off helper to ensure the Postgres schema contains the Report table.
 *
 * This is intentionally minimal and avoids Prisma db push/migrate because the
 * database may contain legacy tbl* tables that Prisma would attempt to drop.
 */

import { Client } from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:justdoit@localhost:5432/eln';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS "Report" (
      "id" text PRIMARY KEY,
      "reportType" text NOT NULL,
      "filename" text NOT NULL,
      "originalFilename" text,
      "mime" text,
      "size" integer,
      "blobPath" text,
      "notes" text,
      "metadata" jsonb,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "experimentId" text NOT NULL REFERENCES "Experiment"("id") ON DELETE CASCADE
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS "Report_experimentId_idx" ON "Report"("experimentId");
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS "Report_reportType_idx" ON "Report"("reportType");
  `);

  console.log('OK: Report table exists');
  await client.end();
}

main().catch((err) => {
  console.error('FAILED: could not ensure Report table', err);
  process.exit(1);
});

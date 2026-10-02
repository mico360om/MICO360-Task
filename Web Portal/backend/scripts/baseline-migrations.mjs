// Prints the committed migrations that the target database already contains but has not
// recorded in _prisma_migrations, one name per line, so deploy.sh can mark them applied
// (`prisma migrate resolve --applied`) before `prisma migrate deploy`.
//
// Needed for databases first created with `prisma db push` (no migration history at all) and for
// databases where a column was added by hand. A fresh, empty database prints nothing.
//
// Usage (from the backend app root, after `prisma generate`): node scripts/baseline-migrations.mjs
import { PrismaClient } from '@prisma/client';

/** Each migration and an object that exists only once that migration's changes are present. */
const MARKERS = [
  ['0_init', { table: 'users' }],
  ['20260911120000_add_chat_tables', { table: 'conversations' }],
  ['20260912130000_add_user_last_active', { column: ['users', 'lastActiveAt'] }],
  ['20260912140000_add_meetings_module', { table: 'meetings' }],
  ['20260915120000_add_meeting_invite_tracking', { column: ['meetings', 'invitesSentAt'] }],
  ['20260926120000_add_project_owner_image', { column: ['projects', 'ownerId'] }],
  ['20260926120100_auth_hardening_idempotency', { table: 'idempotency_keys' }],
  ['20260929120000_meeting_note_soft_delete', { column: ['meeting_notes', 'deletedAt'] }],
  ['20261001120000_task_recurrence_source', { column: ['tasks', 'recurrenceSourceId'] }],
];

const prisma = new PrismaClient();
try {
  const tableRows = await prisma.$queryRawUnsafe(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
  );
  const tables = new Set(tableRows.map((r) => String(r.t)));

  const hasColumn = async (table, column) => {
    if (!tables.has(table)) return false;
    const rows = await prisma.$queryRawUnsafe(
      'SELECT 1 AS present FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      table,
      column,
    );
    return rows.length > 0;
  };

  let recorded = new Set();
  if (tables.has('_prisma_migrations')) {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT migration_name AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    recorded = new Set(rows.map((r) => String(r.m)));
  }

  for (const [name, marker] of MARKERS) {
    if (recorded.has(name)) continue;
    const present = marker.table ? tables.has(marker.table) : await hasColumn(marker.column[0], marker.column[1]);
    if (present) console.log(name);
  }
} finally {
  await prisma.$disconnect();
}

import { openDb } from '../src/db.ts';

const db = await openDb();
console.log(`✓ migrated (${db.type})`);
if (db.type === 'mysql') {
  console.log(`  host: ${process.env.MYSQL_HOST ?? 'db'}:${process.env.MYSQL_PORT ?? 3306}/${process.env.MYSQL_DATABASE ?? 'kanban'}`);
} else {
  console.log(`  sqlite: ${process.env.KANBAN_DB ?? 'data/kanban.db'}`);
}
await db.close();

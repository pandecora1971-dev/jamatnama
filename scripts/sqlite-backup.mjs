import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
const source = path.resolve(process.env.DATA_DIR || './data', 'jamatnama.sqlite');
const destination = process.argv[2];
if (!destination) throw Error('Usage: npm run db:backup -- /private/backup/report.sqlite');
const target = path.resolve(destination);
if (source === target) throw Error('Backup must differ from source');
try { await stat(target); throw Error('Destination already exists; choose a new file'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
process.umask(0o077);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  await chmod(target, 0o600);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    const rows = copy.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw Error('Backup integrity check failed');
  } finally { copy.close(); }
  console.log('Consistent SQLite backup created and integrity verified. Keep it encrypted and access restricted.');
} catch (error) { await unlink(target).catch(() => {}); throw error; }
finally { db.close(); }

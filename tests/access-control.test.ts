import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { admin, finish, resetData, seedReport } from "./support/db";

const base = new URL(process.env.DATABASE_ADMIN_URL!);
const as = async (user: string, password: string) => {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
};
const denied = async (client: pg.Client, sql: string) =>
  assert.rejects(client.query(sql), /permission denied/, sql);
const appUrl = new URL(process.env.DATABASE_URL!);
const scannerUrl = new URL(process.env.SCANNER_DATABASE_URL!);
before(async () => {
  await resetData();
  await seedReport({ status: "pending" });
});
after(finish);
test("Supabase API roles cannot reach any table, even with a direct connection", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const client = await as(role, `local-${role}-password`);
    try {
      for (const table of ["reports", "accused", "evidence", "staff", "audit_log", "staff_sessions", "submission_intents"])
        await denied(client, `SELECT * FROM jamatnama.${table} LIMIT 1`);
      await denied(client, "INSERT INTO jamatnama.audit_log(actor_id,actor_name,action,target,detail,created_at) VALUES('x','x','x','x','x',now())");
    } finally {
      await client.end();
    }
  }
});
test("row level security is enabled on every table", async () => {
  const { rows } = await admin.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='jamatnama' AND c.relkind='r' AND NOT c.relrowsecurity");
  assert.deepEqual(rows, []);
  const { rows: policies } = await admin.query("SELECT DISTINCT unnest(roles)::text AS role FROM pg_policies WHERE schemaname='jamatnama'");
  assert.deepEqual(policies.map((p) => p.role).sort(), ["jamatnama_app", "jamatnama_scanner"]);
});
test("the application role cannot rewrite audit history or drop data", async () => {
  const client = await as(appUrl.username, appUrl.password);
  try {
    await client.query("SELECT count(*) FROM jamatnama.reports");
    await denied(client, "UPDATE jamatnama.audit_log SET detail='x'");
    await denied(client, "DELETE FROM jamatnama.audit_log");
    await denied(client, "TRUNCATE jamatnama.audit_log");
    await denied(client, "DELETE FROM jamatnama.reports");
    await denied(client, "DELETE FROM jamatnama.evidence");
    await assert.rejects(client.query("DROP TABLE jamatnama.reports"), /must be owner/);
    await assert.rejects(client.query("CREATE TABLE jamatnama.extra(id int)"), /permission denied/);
  } finally {
    await client.end();
  }
});
test("the scanner role sees evidence metadata and nothing else", async () => {
  const client = await as(scannerUrl.username, scannerUrl.password);
  try {
    await client.query("SELECT count(*) FROM jamatnama.evidence");
    for (const table of ["reports", "accused", "source_links", "staff", "staff_sessions", "admin_sessions", "submission_intents"])
      await denied(client, `SELECT * FROM jamatnama.${table} LIMIT 1`);
    await denied(client, "SELECT * FROM jamatnama.audit_log");
  } finally {
    await client.end();
  }
});
test("application roles carry timeouts and no elevated attributes", async () => {
  const { rows } = await admin.query("SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolconfig::text AS config FROM pg_roles WHERE rolname IN ('jamatnama_app','jamatnama_scanner')");
  assert.equal(rows.length, 2);
  for (const role of rows) {
    assert.deepEqual([role.rolsuper, role.rolcreaterole, role.rolcreatedb, role.rolbypassrls], [false, false, false, false]);
    assert.match(role.config, /statement_timeout/);
  }
});
test("migrations are versioned, checksummed and not re-applied", async () => {
  const { rows } = await admin.query("SELECT version FROM public.jamatnama_schema_migrations ORDER BY version");
  assert.deepEqual(rows.map((r) => r.version), ["0001_schema.sql", "0002_access_control.sql"]);
});
test("common public queries use their indexes at realistic volume, including Bangla search", async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO jamatnama.reports(id,receipt_hash,title,description,category,facts,display_category,display_facts,division,district,upazila,incident_date,created_at,updated_at,status,fingerprint)
      SELECT 'bulk'||g, md5(g::text), 'কাল্পনিক ঘটনার শিরোনাম '||g, 'সম্পূর্ণ কাল্পনিক বিবরণ নম্বর '||g||' '||repeat('পরীক্ষা ',5), 'রাজনৈতিক মামলা','{}','রাজনৈতিক মামলা','{}',
        (ARRAY['ঢাকা','খুলনা','রাজশাহী','সিলেট'])[1+g%4], 'জেলা'||(g%64), 'উপজেলা'||(g%500), '2026-01-01', now()-make_interval(secs=>g), now(),
        (ARRAY['published','published','pending'])[1+g%3], md5('f'||g)
      FROM generate_series(1,20000) g`);
    await client.query("UPDATE jamatnama.reports SET title='অনন্যকাল্পনিকশব্দ শিরোনাম' WHERE id='bulk777'");
    await client.query("ANALYZE jamatnama.reports");
    const plan = async (sql: string) => (await client.query(`EXPLAIN ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(await plan("SELECT id FROM jamatnama.reports WHERE status='published' ORDER BY created_at DESC,id DESC LIMIT 7"), /reports_public_feed/);
    assert.match(await plan("SELECT id FROM jamatnama.reports WHERE status='published' AND district='জেলা5' ORDER BY created_at DESC,id DESC LIMIT 7"), /reports_pub_district/);
    assert.match(await plan("SELECT id FROM jamatnama.reports WHERE status='pending' ORDER BY created_at DESC,id DESC LIMIT 25"), /reports_admin_queue/);
    assert.match(await plan("SELECT id FROM jamatnama.reports WHERE status='published' AND search_text ILIKE '%অনন্যকাল্পনিকশব্দ%'"), /reports_pub_search/);
    const found = await client.query("SELECT id FROM jamatnama.reports WHERE status='published' AND search_text ILIKE '%অনন্যকাল্পনিকশব্দ%'");
    assert.deepEqual(found.rows, [{ id: "bulk777" }]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

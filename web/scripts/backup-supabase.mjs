#!/usr/bin/env node
// A backup of the Supabase project, made from this computer.
//
//   npm run backup:supabase                 -> D:\JSCI\supabase-backups\<date>_<time>\
//   npm run backup:supabase -- <folder>     -> <folder>\<date>_<time>\
//
// What it saves, with the service-role key already in .env.local (nothing to
// install, no database password):
//
//   tables\<table>.json   every row of every table and view the API can see
//                         (the public schema: users, events, news, ...)
//   auth-users.json       the Supabase sign-in accounts (Google sign-in)
//   storage\<bucket>\...  every file in Supabase Storage (profile pictures,
//                         signatures, payment logos ...)
//   database.dump         ONLY if pg_dump is installed and SUPABASE_DB_URL is
//                         set in .env.local: the public schema's tables,
//                         functions and policies as well as its rows, in a form
//                         pg_restore puts back in one go
//   manifest.json         what was saved, and anything that could not be
//
// Pictures kept in Cloudinary (news, posters, covers) are not in Supabase and
// are not part of this backup.
//
// The backup holds people's personal details and password hashes: keep it
// private, and never put it in the git repository (it is written outside it).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const env = { ...readEnvFile(path.join(webRoot, '.env.local')), ...process.env };
const BASE = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in web/.env.local.');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
const outRoot = path.resolve(process.argv[2] || env.SUPABASE_BACKUP_DIR || path.resolve(webRoot, '..', '..', 'supabase-backups'));
const outDir = path.join(outRoot, stamp);

const repoRoot = path.resolve(webRoot, '..');
if ((outDir + path.sep).startsWith(repoRoot + path.sep)) {
  console.error(`Refusing to write the backup inside the git repository (${repoRoot}). Choose a folder outside it.`);
  process.exit(1);
}

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const PAGE = 1000;
const manifest = { made_at: now.toISOString(), project: new URL(BASE).host, tables: {}, auth_users: null, storage: {}, database_dump: null, problems: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(url, opts = {}, tries = 3) {
  for (let i = 1; ; i += 1) {
    try {
      const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      if (i < tries && res.status >= 500) { await sleep(800 * i); continue; }
      throw new Error(`${res.status} ${body.slice(0, 200)}`);
    } catch (err) {
      if (i >= tries || /^\d{3} /.test(err.message)) throw err;
      await sleep(800 * i);
    }
  }
}
const getJson = async (url, opts) => (await request(url, opts)).json();

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
// One row per line: easy to read, and to compare with another backup.
const jsonRows = (rows) => (rows.length ? `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n` : '[]\n');
const safeName = (s) => String(s).replace(/[<>:"\\|?*\x00-\x1f]/g, '_');
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
let bytes = 0;

// ---- Tables ----
async function backupTables() {
  const spec = await getJson(`${BASE}/rest/v1/`, { headers: { Accept: 'application/openapi+json' } });
  const defs = spec.definitions || {};
  const names = Object.keys(defs).sort();
  console.log(`Tables and views: ${names.length}`);
  for (const name of names) {
    // The primary key, to page through the rows in a steady order.
    const pk = Object.entries(defs[name].properties || {})
      .filter(([, p]) => /<pk\/>/.test(p.description || ''))
      .map(([col]) => col);
    const order = pk.length ? `&order=${pk.map((c) => `${encodeURIComponent(c)}.asc`).join(',')}` : '';
    const rows = [];
    try {
      for (let offset = 0; ; offset += PAGE) {
        const batch = await getJson(`${BASE}/rest/v1/${encodeURIComponent(name)}?select=*&limit=${PAGE}&offset=${offset}${order}`);
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      const text = jsonRows(rows);
      write(path.join(outDir, 'tables', `${safeName(name)}.json`), text);
      bytes += Buffer.byteLength(text);
      manifest.tables[name] = rows.length;
      console.log(`  ${name.padEnd(42)} ${String(rows.length).padStart(7)} rows`);
    } catch (err) {
      manifest.problems.push(`table ${name}: ${err.message}`);
      console.log(`  ${name.padEnd(42)}  could not be read: ${err.message.slice(0, 90)}`);
    }
  }
}

// ---- Supabase sign-in accounts ----
async function backupAuthUsers() {
  try {
    const users = [];
    for (let page = 1; ; page += 1) {
      const json = await getJson(`${BASE}/auth/v1/admin/users?page=${page}&per_page=${PAGE}`);
      const batch = json.users || [];
      users.push(...batch);
      if (batch.length < PAGE) break;
    }
    const text = jsonRows(users);
    write(path.join(outDir, 'auth-users.json'), text);
    bytes += Buffer.byteLength(text);
    manifest.auth_users = users.length;
    console.log(`Sign-in accounts (auth): ${users.length}`);
  } catch (err) {
    manifest.problems.push(`auth users: ${err.message}`);
    console.log(`Sign-in accounts could not be read: ${err.message.slice(0, 90)}`);
  }
}

// ---- Storage files ----
async function listFolder(bucket, prefix) {
  const files = [];
  for (let offset = 0; ; offset += PAGE) {
    const items = await getJson(`${BASE}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id == null) files.push(...await listFolder(bucket, full)); // a folder
      else files.push({ path: full, size: it.metadata?.size || 0 });
    }
    if (items.length < PAGE) break;
  }
  return files;
}

async function backupStorage() {
  let buckets = [];
  try {
    buckets = await getJson(`${BASE}/storage/v1/bucket`);
  } catch (err) {
    manifest.problems.push(`storage buckets: ${err.message}`);
    console.log(`Storage could not be read: ${err.message.slice(0, 90)}`);
    return;
  }
  console.log(`Storage buckets: ${buckets.length}`);
  for (const b of buckets) {
    let files = [];
    try {
      files = await listFolder(b.id, '');
    } catch (err) {
      manifest.problems.push(`bucket ${b.id}: ${err.message}`);
      console.log(`  ${b.id}: could not be listed`);
      continue;
    }
    let saved = 0;
    for (const f of files) {
      try {
        const encoded = f.path.split('/').map(encodeURIComponent).join('/');
        const res = await request(`${BASE}/storage/v1/object/${encodeURIComponent(b.id)}/${encoded}`);
        const buf = Buffer.from(await res.arrayBuffer());
        write(path.join(outDir, 'storage', safeName(b.id), ...f.path.split('/').map(safeName)), buf);
        bytes += buf.length;
        saved += 1;
      } catch (err) {
        manifest.problems.push(`file ${b.id}/${f.path}: ${err.message}`);
      }
    }
    manifest.storage[b.id] = { public: !!b.public, files: files.length, saved };
    console.log(`  ${b.id.padEnd(42)} ${String(saved).padStart(7)} of ${files.length} files`);
  }
}

// ---- The whole public schema, restorable, when pg_dump is here ----
function backupDatabaseDump() {
  const dbUrl = env.SUPABASE_DB_URL;
  const has = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
  if (has.error || has.status !== 0 || !dbUrl) {
    manifest.database_dump = 'skipped (needs pg_dump installed and SUPABASE_DB_URL in .env.local)';
    console.log('Full database dump: skipped (needs pg_dump and SUPABASE_DB_URL - see the notes at the end).');
    return;
  }
  const file = path.join(outDir, 'database.dump');
  const run = spawnSync('pg_dump', ['--dbname', dbUrl, '--schema=public', '--format=custom', '--no-owner', '--no-privileges', '--file', file], { encoding: 'utf8' });
  if (run.status === 0) {
    bytes += fs.statSync(file).size;
    manifest.database_dump = `database.dump (${has.stdout.trim()})`;
    console.log(`Full database dump: saved (${kb(fs.statSync(file).size)}).`);
  } else {
    manifest.database_dump = 'failed';
    manifest.problems.push(`pg_dump: ${(run.stderr || '').trim().slice(0, 300)}`);
    console.log(`Full database dump failed: ${(run.stderr || '').trim().slice(0, 200)}`);
  }
}

const README = `Supabase backup of ${manifest.project}, made ${now.toString()}.

tables\\<table>.json   every row of each table (one row per line)
auth-users.json       the Supabase sign-in accounts
storage\\<bucket>\\     the files in Supabase Storage
database.dump         (when present) the public schema, restorable with pg_restore
manifest.json         counts, and anything that could not be saved

PRIVATE: this holds people's personal details and password hashes.
Keep it on your own drive or a private cloud folder. Never share it or put it in git.
`;

console.log(`Backing up ${manifest.project} to ${outDir}\n`);
fs.mkdirSync(outDir, { recursive: true });
await backupTables();
await backupAuthUsers();
await backupStorage();
backupDatabaseDump();
write(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
write(path.join(outDir, 'README.txt'), README);

const rowTotal = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
console.log(`\nDone: ${Object.keys(manifest.tables).length} tables (${rowTotal} rows), ${manifest.auth_users ?? 0} sign-in accounts, ${Object.values(manifest.storage).reduce((a, b) => a + b.saved, 0)} files - ${kb(bytes)} in all.`);
console.log(`Saved in: ${outDir}`);
if (manifest.problems.length) {
  console.log(`\n${manifest.problems.length} thing(s) could not be saved (listed in manifest.json):`);
  manifest.problems.slice(0, 10).forEach((p) => console.log(`  - ${p.slice(0, 160)}`));
}

#!/usr/bin/env node
// ============================================================
// Build the JSCI Ministry web app into the website.
//
//   npm run build:web
//
// The same app as the Android one, built for the browser, goes to
// web/public/ministrysystem and is served at
// sanctuaryhub.vercel.app/ministrysystem (web/next.config.mjs sends every
// /ministrysystem address to its index.html). On iPhone: open it in Safari,
// Share > Add to Home Screen, and it opens full screen like an app.
//
// After building, commit web/public/ministrysystem and push: Vercel deploys it.
// Build it again after any change to the app, so the web app matches.
// ============================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-web');
const SITE = path.resolve(ROOT, '..', 'web', 'public', 'ministrysystem');

const fail = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
const step = (m) => console.log(`\n▸ ${m}`);

step('Building the web app');
fs.rmSync(OUT, { recursive: true, force: true });
const res = spawnSync('npx expo export --platform web --output-dir dist-web --clear', { cwd: ROOT, shell: true, stdio: 'inherit' });
if (res.status !== 0) fail('The web build stopped. See the errors above.');

// Git skips every folder named node_modules, so the fonts and images that
// came from packages would never reach the website. They move to assets/nm,
// and every address to them is changed to match.
step('Moving package assets out of a node_modules folder');
const from = path.join(OUT, 'assets', 'node_modules');
if (fs.existsSync(from)) fs.renameSync(from, path.join(OUT, 'assets', 'nm'));
const TEXT = /\.(js|html|css|json|map)$/i;
let changed = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (TEXT.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      const next = text.split('/assets/node_modules/').join('/assets/nm/');
      if (next !== text) { fs.writeFileSync(file, next); changed++; }
    }
  }
};
walk(OUT);
console.log(`  ${changed} file(s) updated`);

step(`Copying to ${path.relative(path.resolve(ROOT, '..'), SITE)}`);
fs.rmSync(SITE, { recursive: true, force: true });
fs.cpSync(OUT, SITE, { recursive: true });

let bytes = 0;
let count = 0;
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
  const f = path.join(dir, e.name);
  if (e.isDirectory()) size(f); else { bytes += fs.statSync(f).size; count++; }
});
size(SITE);
console.log(`  ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log('\n✔ Web app built. Commit web/public/ministrysystem and push to publish it at /ministrysystem.\n');

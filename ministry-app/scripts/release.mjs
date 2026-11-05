#!/usr/bin/env node
// ============================================================
// Publish a new JSCI Ministry version to the download page.
//
//   npm run release                 build the Android app on EAS, then publish it
//   npm run release -- --publish    publish the newest finished build of this version
//                                   (when the build is already done)
//
// Publishing = a GitHub Release "ministry-app-v<version>" in this repository
// with the APK attached as "jsci-ministry-app-<version>.apk", and the notes
// from CHANGELOG.md. sanctuaryhub.vercel.app/ministrymobileapp reads the
// releases, so the new version shows there within a few minutes - and the
// app tells everyone on an older version that an update is out.
//
// Before: set "version" in app.json (and bump android.versionCode), and add
// a "## <version>" section to CHANGELOG.md.
// GitHub sign-in: GITHUB_TOKEN, or the GitHub login saved in git on this PC.
// ============================================================
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.MINISTRY_APP_REPO || 'Frankshamida/jsci';
const SITE = 'https://sanctuaryhub.vercel.app';
const PAGE = `${SITE}/ministrymobileapp`;
const publishOnly = process.argv.includes('--publish');

const fail = (message) => { console.error(`\n✖ ${message}\n`); process.exit(1); };
const step = (message) => console.log(`\n▸ ${message}`);

// ---- What is being released ----
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
const version = app.version;
const tag = `ministry-app-v${version}`;
const fileName = `jsci-ministry-app-${version}.apk`;
const notes = changelogFor(version);
if (!notes) fail(`CHANGELOG.md has no "## ${version}" section. Add what is new in ${version} first.`);
console.log(`JSCI Ministry ${version} (Android versionCode ${app.android?.versionCode})`);

// ---- The APK ----
const apkUrl = publishOnly ? findFinishedBuild() : buildNow();
step(`Downloading the APK`);
const apkPath = path.join(os.tmpdir(), fileName);
const download = await fetch(apkUrl);
if (!download.ok) fail(`Could not download the build (${download.status}).`);
fs.writeFileSync(apkPath, Buffer.from(await download.arrayBuffer()));
const size = fs.statSync(apkPath).size;
console.log(`  ${fileName} - ${(size / 1024 / 1024).toFixed(1)} MB`);

// ---- GitHub Release ----
const token = githubToken();
const gh = async (url, init = {}) => {
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${REPO}${url}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'jsci-ministry-release', ...(init.headers || {}) },
  });
  if (!res.ok && res.status !== 404) fail(`GitHub said ${res.status}: ${await res.text()}`);
  return res.status === 404 ? null : (res.status === 204 ? {} : res.json());
};

step(`Publishing ${tag} on github.com/${REPO}`);
let release = await gh(`/releases/tags/${tag}`);
const fields = { name: `JSCI Ministry ${version}`, body: notes };
if (release) {
  release = await gh(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
} else {
  release = await gh('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: 'main', make_latest: 'true', ...fields }) });
}
for (const old of (release.assets || []).filter((a) => a.name === fileName)) {
  await gh(`/releases/assets/${old.id}`, { method: 'DELETE' });
}
const uploadUrl = release.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(fileName)}`;
const asset = await gh(uploadUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': String(size) },
  body: fs.readFileSync(apkPath),
});
fs.rmSync(apkPath, { force: true });

// The download page shows it now, not in 5 minutes.
step('Refreshing the download page');
const refreshed = await fetch(`${SITE}/api/ministry/app-release`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json()).catch(() => null);
console.log(refreshed?.success ? `  ${refreshed.message}` : `  Not refreshed (${refreshed?.message || 'no answer'}) - it updates by itself within 5 minutes.`);

console.log(`\n✔ JSCI Ministry ${version} is published.`);
console.log(`  Download page: ${PAGE}`);
console.log(`  Always-latest link: ${PAGE}/download`);
console.log(`  This file: ${asset.browser_download_url}\n`);

// ============================================================

function changelogFor(v) {
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const start = text.search(new RegExp(`^## ${v.replace(/\./g, '\\.')}\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = text.slice(start).split(/\r?\n/).slice(1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

function eas(args, { quiet = false } = {}) {
  // One command line (the arguments are fixed words), run through the shell so
  // Windows finds eas.cmd.
  const res = spawnSync(['eas', ...args].join(' '), {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'],
    env: { ...process.env, EAS_NO_VCS: '1' }, // upload this folder as it is
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) fail(`Could not run EAS (${res.error.message}). Install it with: npm i -g eas-cli`);
  if (res.status !== 0) fail(`EAS stopped (exit ${res.status}). ${res.stderr || ''}`);
  return res.stdout;
}

function parseJson(out) {
  const at = out.search(/[[{]/);
  try { return JSON.parse(out.slice(at)); } catch { fail('Could not read EAS output.'); }
}

function buildNow() {
  step('Building the Android app on EAS (about 10-20 minutes)');
  const builds = parseJson(eas(['build', '-p', 'android', '--profile', 'preview', '--non-interactive', '--wait', '--json']));
  const build = Array.isArray(builds) ? builds[0] : builds;
  if (build?.status !== 'FINISHED' || !build.artifacts?.buildUrl) fail(`The build did not finish (${build?.status}).`);
  return build.artifacts.buildUrl;
}

function findFinishedBuild() {
  step(`Finding the finished build of ${version}`);
  const builds = parseJson(eas(['build:list', '--platform', 'android', '--status', 'finished', '--limit', '15', '--json', '--non-interactive'], { quiet: true }));
  const build = builds.find((b) => b.appVersion === version && b.artifacts?.buildUrl);
  if (!build) fail(`No finished Android build of ${version}. Run "npm run release" to build it.`);
  console.log(`  build ${build.id} from ${new Date(build.completedAt || build.createdAt).toLocaleString()}`);
  return build.artifacts.buildUrl;
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const password = out.match(/^password=(.+)$/m)?.[1];
    if (password) return password.trim();
  } catch { /* no saved login */ }
  return fail('No GitHub sign-in. Set GITHUB_TOKEN, or push to GitHub once from this PC so git saves the login.');
}

// patch.js - install the WAProto build result to node_modules/<TARGET>/WAProto
// Use:  curl -fsSL <url-raw-patch.js> | TARGET="baileys" node -
// Env:    TARGET   package name in node_modules (default: baileys)
//         SOURCE   raw folder that contains index.js, index.d.ts, WAProto.proto
//         DRY_RUN  set to 1 to download and validate only, without writing anything
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const fail = (msg) => { console.error('!! ' + msg); process.exit(1); };
const warn = (msg) => console.warn('?? ' + msg);

if (Number(process.versions.node.split('.')[0]) < 18) {
  fail(`Node.js 18 or newer is required (current: ${process.versions.node})`);
}

const TARGET = (process.env.TARGET || 'baileys').trim();
if (!TARGET || TARGET.includes('..') || path.isAbsolute(TARGET) || TARGET.includes('\\')) {
  fail(`invalid TARGET: "${TARGET}"`);
}

const SOURCE = (process.env.SOURCE ||
  'https://raw.githubusercontent.com/andhikagg/waproto/main/WAProto').trim().replace(/\/+$/, '');
if (!/^https:\/\//i.test(SOURCE) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(SOURCE)) {
  fail(`SOURCE must be https:// (or http://localhost for testing): ${SOURCE}`);
}
const DRY_RUN = process.env.DRY_RUN === '1';

const FILES = [
  { name: 'index.js', required: true, minBytes: 1000 },
  { name: 'index.d.ts', required: false, minBytes: 100 },
  { name: 'WAProto.proto', required: false, minBytes: 100 },
];

const isEsm = (code) => /^\s*(import|export)\s/m.test(code);

function findPkgDir() {
  const tried = [];
  let dir = process.cwd();
  for (;;) {
    const c = path.join(dir, 'node_modules', TARGET);
    tried.push(c);
    if (fs.existsSync(c)) return c;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const direct = path.resolve(TARGET);
  tried.push(direct);
  if (fs.existsSync(direct)) return direct;
  return fail(`package "${TARGET}" not found. Checked:\n   ` + tried.join('\n   '));
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function checkSyntax(code) {
  const ext = isEsm(code) ? '.mjs' : '.cjs';
  const tmp = path.join(os.tmpdir(), `waproto-check-${process.pid}${ext}`);
  fs.writeFileSync(tmp, code);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) fail('invalid syntax in index.js:\n' + (r.stderr || ''));
}

// Node ESM rejects "protobufjs/minimal" without an extension when protobufjs has no "exports" map.
// Add ".js" only in that case.
function fixProtobufImport(code, pkgDir) {
  if (!isEsm(code)) return code;
  const re = /(from\s+["'])protobufjs\/minimal(["'])/;
  if (!re.test(code)) return code;
  let metaPath;
  try {
    metaPath = require.resolve('protobufjs/package.json', { paths: [pkgDir] });
  } catch (e) {
    return code; // not found, or controlled by an exports map: leave as is
  }
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) { return code; }
  if (meta.exports) return code;
  console.log(`==> import "protobufjs/minimal" -> "protobufjs/minimal.js" (protobufjs ${meta.version} has no exports map)`);
  return code.replace(re, '$1protobufjs/minimal.js$2');
}

async function main() {
  const pkgDir = findPkgDir();
  const dest = path.join(pkgDir, 'WAProto');
  if (!fs.existsSync(dest)) fail(`folder not found: ${dest}`);
  console.log(`==> Target : ${dest}`);
  console.log(`==> Source : ${SOURCE}`);

  // 1. download everything into memory first, without touching the existing files
  const fresh = {};
  for (const f of FILES) {
    const url = `${SOURCE}/${f.name}`;
    let text;
    try {
      text = await download(url);
    } catch (e) {
      if (f.required) fail(`failed to download ${url} (${e.message})`);
      warn(`skipping ${f.name}: ${e.message}`);
      continue;
    }
    if (text.length < f.minBytes) {
      if (f.required) fail(`${f.name} is too small (${text.length} bytes), probably empty or corrupt`);
      warn(`skipping ${f.name}: too small (${text.length} bytes)`);
      continue;
    }
    fresh[f.name] = text;
    console.log(`    ok ${f.name} (${text.length} bytes)`);
  }

  // 2. validate + normalize
  if (!/\$root/.test(fresh['index.js'])) fail('index.js does not look like protobufjs output');
  fresh['index.js'] = fixProtobufImport(fresh['index.js'], pkgDir);
  checkSyntax(fresh['index.js']);
  console.log('==> Syntax OK');

  if (fresh['index.d.ts'] && /\bwaproto\b/.test(fresh['index.d.ts'])) {
    warn('index.d.ts still uses the "waproto" namespace; renaming it to "proto" to match index.js');
    fresh['index.d.ts'] = fresh['index.d.ts'].replace(/\bwaproto\b/g, 'proto');
  }

  // 3. compare per file, only write the ones that changed
  const changes = [];
  let oldJs = null;
  for (const name of Object.keys(fresh)) {
    const p = path.join(dest, name);
    let old = null;
    try { old = fs.readFileSync(p, 'utf8'); } catch (e) { /* does not exist yet */ }
    if (name === 'index.js') oldJs = old;
    if (old === fresh[name]) continue;
    changes.push({ name, p, hadOld: old !== null });
  }
  if (!changes.length) { console.log('==> Already up to date, nothing changed.'); return; }

  if (oldJs && isEsm(oldJs) !== isEsm(fresh['index.js'])) {
    warn(`Module format differs: old=${isEsm(oldJs) ? 'ESM' : 'CommonJS'}, new=${isEsm(fresh['index.js']) ? 'ESM' : 'CommonJS'}. ` +
      'If imports fail, rebuild with the matching -w option.');
  }

  if (DRY_RUN) {
    console.log('==> DRY_RUN=1, nothing written. Would change: ' + changes.map((c) => c.name).join(', '));
    return;
  }

  // 4. back up, write through a temp file then rename, roll back if anything fails
  const done = [];
  try {
    for (const c of changes) {
      if (c.hadOld) fs.copyFileSync(c.p, c.p + '.bak');
      fs.writeFileSync(c.p + '.tmp', fresh[c.name]);
      fs.renameSync(c.p + '.tmp', c.p);
      done.push(c);
    }
  } catch (e) {
    console.error('!! write failed, rolling back: ' + e.message);
    for (const c of done) {
      try {
        if (c.hadOld) fs.copyFileSync(c.p + '.bak', c.p);
        else fs.rmSync(c.p, { force: true });
      } catch (e2) { console.error(`!! rollback of ${c.name} failed: ${e2.message}`); }
    }
    for (const c of changes) {
      try { fs.rmSync(c.p + '.tmp', { force: true }); } catch (e3) { /* ignore */ }
    }
    process.exit(1);
  }

  console.log('==> Done. Updated: ' + changes.map((c) => c.name).join(', '));
  console.log('    Previous versions saved as *.bak in the same folder.');
  console.log('    If WhatsApp errors after this, try deleting the auth/session folder and pairing again.');
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));

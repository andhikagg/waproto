// patch.js - install the WAProto build result to node_modules/<TARGET>/WAProto
// Use:  curl -fsSL <url-raw-patch.js> | TARGET="baileys" node -
// Env:    TARGET  package name in node_modules (default: baileys)
//         SOURCE  raw folder contains index.js, index.d.ts, WAProto.proto
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TARGET = process.env.TARGET || 'baileys';
const SOURCE = (process.env.SOURCE ||
  'https://raw.githubusercontent.com/andhikagg/waproto/main/WAProto').replace(/\/+$/, '');
const FILES = [
  { name: 'index.js', required: true },
  { name: 'index.d.ts', required: false },
  { name: 'WAProto.proto', required: false },
];

const fail = (msg) => { console.error('!! ' + msg); process.exit(1); };
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
  fail(`paket "${TARGET}" tidak ketemu. Sudah dicek:\n   ` + tried.join('\n   '));
}

function checkSyntax(code) {
  const ext = isEsm(code) ? '.mjs' : '.cjs';
  const tmp = path.join(os.tmpdir(), `waproto-check-${process.pid}${ext}`);
  fs.writeFileSync(tmp, code);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) fail('syntax index.js tidak valid:\n' + (r.stderr || ''));
}

(async () => {
  const pkgDir = findPkgDir();
  const dest = path.join(pkgDir, 'WAProto');
  if (!fs.existsSync(dest)) fail(`folder tidak ada: ${dest}`);
  console.log(`==> Target : ${dest}`);
  console.log(`==> Sumber : ${SOURCE}`);

  // 1. download semua ke memori dulu, belum menyentuh file lama
  const fresh = {};
  for (const f of FILES) {
    const url = `${SOURCE}/${f.name}`;
    let res;
    try { res = await fetch(url); } catch (e) { res = { ok: false, status: e.message }; }
    if (!res.ok) {
      if (f.required) fail(`gagal download ${url} (${res.status})`);
      console.warn(`   (lewati ${f.name}: ${res.status})`);
      continue;
    }
    fresh[f.name] = await res.text();
    console.log(`    ok ${f.name} (${fresh[f.name].length} bytes)`);
  }

  // 2. validasi
  const js = fresh['index.js'];
  if (!/\$root/.test(js)) fail('index.js tidak terlihat seperti output protobufjs');
  checkSyntax(js);
  console.log('==> Syntax OK');

  const oldJsPath = path.join(dest, 'index.js');
  if (fs.existsSync(oldJsPath)) {
    const old = fs.readFileSync(oldJsPath, 'utf8');
    if (old === js) { console.log('==> Sudah versi terbaru, tidak ada yang diubah.'); return; }
    if (isEsm(old) !== isEsm(js)) {
      console.warn(`!! Format modul beda: lama=${isEsm(old) ? 'ESM' : 'CommonJS'}, baru=${isEsm(js) ? 'ESM' : 'CommonJS'}. ` +
        'Kalau import error, build ulang dengan -w yang sesuai.');
    }
  }

  // 3. backup lalu tulis, rollback kalau gagal
  const written = [];
  try {
    for (const name of Object.keys(fresh)) {
      const p = path.join(dest, name);
      if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
      fs.writeFileSync(p, fresh[name]);
      written.push(name);
    }
  } catch (e) {
    console.error('!! gagal menulis, rollback: ' + e.message);
    for (const name of written) {
      const p = path.join(dest, name);
      if (fs.existsSync(p + '.bak')) fs.copyFileSync(p + '.bak', p);
    }
    process.exit(1);
  }

  console.log('==> Selesai. Backup lama: *.bak di folder yang sama.');
  console.log('    Hapus folder auth/session Baileys lalu pair ulang (scan QR lagi).');
})();

// fix-protobuf.js - samakan protobufjs di dalam module <TARGET> dengan versi terbaru
// Pakai:  curl -fsSL <url-raw> | TARGET="baileys" node -
// Env:    TARGET        nama paket di node_modules (default: baileys)
//         SKIP_INSTALL  isi 1 untuk melewati npm install (kalau sudah terpasang)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TARGET = process.env.TARGET || 'baileys';
const root = process.cwd();
const fail = (m) => { console.error('!! ' + m); process.exit(1); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const targetDir = path.join(root, 'node_modules', TARGET);
if (!fs.existsSync(targetDir)) fail(`"${TARGET}" tidak ada di ${path.join(root, 'node_modules')}. Jalankan dari root proyek.`);

// 1. hapus package-lock.json
const lock = path.join(root, 'package-lock.json');
if (fs.existsSync(lock)) { fs.rmSync(lock); console.log('1. package-lock.json dihapus'); }
else console.log('1. package-lock.json tidak ada, lewati');

// 2. rewrite package.json milik module target
const pkgPath = path.join(targetDir, 'package.json');
const pkg = readJson(pkgPath);
let changed = false;
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  if (pkg[field] && pkg[field].protobufjs && pkg[field].protobufjs !== 'latest') {
    console.log(`2. ${TARGET}/package.json ${field}.protobufjs: ${pkg[field].protobufjs} -> latest`);
    pkg[field].protobufjs = 'latest';
    changed = true;
  }
}
if (!changed) {
  pkg.dependencies = pkg.dependencies || {};
  if (pkg.dependencies.protobufjs !== 'latest') {
    pkg.dependencies.protobufjs = 'latest';
    console.log(`2. ${TARGET}/package.json dependencies.protobufjs ditambahkan: latest`);
  } else console.log('2. package.json sudah "latest", lewati');
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 3. install lokal di root proyek
if (process.env.SKIP_INSTALL === '1') console.log('3. SKIP_INSTALL=1, npm install dilewati');
else {
  console.log('3. npm install protobufjs@latest ...');
  const r = spawnSync('npm', ['install', 'protobufjs@latest'],
    { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
  if (r.status !== 0) fail('npm install gagal');
}

// 4. salin protobufjs root -> dalam module target
const src = path.join(root, 'node_modules', 'protobufjs');
if (!fs.existsSync(src)) fail('node_modules/protobufjs tidak ada di root. Install dulu.');
const dest = path.join(targetDir, 'node_modules', 'protobufjs');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
const v = readJson(path.join(dest, 'package.json')).version;
console.log(`4. protobufjs ${v} disalin ke ${path.relative(root, dest)}`);
console.log('Selesai.');

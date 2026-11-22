// fix.js - make the protobufjs inside node_modules/<TARGET> match the latest version
// Use:  curl -fsSL <url-raw> | TARGET="baileys" node -
// Env:    TARGET               package name in node_modules (default: baileys)
//         SKIP_INSTALL         set to 1 to skip npm install (if already installed)
//         PROTOBUFJS_VERSION   protobufjs version or range (default: latest), e.g. ^7
//         RESET_LOCK           set to 1 to delete package-lock.json (default: keep it)
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const fail = (m) => { console.error('!! ' + m); process.exit(1); };
const warn = (m) => console.warn('?? ' + m);
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fail(`failed to read ${p}: ${e.message}`); }
};

// Node 18+ (fs.cpSync, fs.rmSync)
if (Number(process.versions.node.split('.')[0]) < 18) {
  fail(`Node.js 18 or newer is required (current: ${process.versions.node})`);
}

const TARGET = (process.env.TARGET || 'baileys').trim();
const VERSION = (process.env.PROTOBUFJS_VERSION || 'latest').trim();
const root = process.cwd();

// a package name only (scoped names like @whiskeysockets/baileys are fine), not a path
if (!TARGET || TARGET.includes('..') || path.isAbsolute(TARGET) || TARGET.includes('\\')) {
  fail(`invalid TARGET: "${TARGET}"`);
}

const nodeModules = path.join(root, 'node_modules');
const targetDir = path.join(nodeModules, TARGET);
if (!fs.existsSync(targetDir)) {
  fail(`"${TARGET}" not found in ${nodeModules}. Run from the project root and check the TARGET name.`);
}

// 1. package-lock.json (optional, kept by default)
const lock = path.join(root, 'package-lock.json');
if (process.env.RESET_LOCK === '1') {
  if (fs.existsSync(lock)) { fs.rmSync(lock); console.log('1. package-lock.json removed (RESET_LOCK=1)'); }
  else console.log('1. package-lock.json not found, skipping');
} else {
  console.log('1. package-lock.json kept (use RESET_LOCK=1 to delete it)');
}

// 2. rewrite package.json of the target module
const pkgPath = path.join(targetDir, 'package.json');
if (!fs.existsSync(pkgPath)) fail(`${path.relative(root, pkgPath)} not found`);
const pkg = readJson(pkgPath);

let found = false;
let changed = false;
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = pkg[field];
  if (deps && deps.protobufjs !== undefined) {
    found = true;
    if (deps.protobufjs !== VERSION) {
      console.log(`2. ${TARGET}/package.json ${field}.protobufjs: ${deps.protobufjs} -> ${VERSION}`);
      deps.protobufjs = VERSION;
      changed = true;
    }
  }
}
if (!found) {
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies.protobufjs = VERSION;
  console.log(`2. ${TARGET}/package.json dependencies.protobufjs added: ${VERSION}`);
  changed = true;
}
if (changed) {
  const bak = pkgPath + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(pkgPath, bak); // back up once, keep the original
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
} else {
  console.log(`2. package.json already uses "${VERSION}", skipping`);
}

// 3. install in the project root
if (process.env.SKIP_INSTALL === '1') {
  console.log('3. SKIP_INSTALL=1, npm install skipped');
} else {
  console.log(`3. npm install protobufjs@${VERSION} ...`);
  const r = spawnSync('npm', ['install', `protobufjs@${VERSION}`],
    { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
  if (r.error) fail(`cannot run npm: ${r.error.message}`);
  if (r.status !== 0) fail('npm install failed');
}

// 4. copy protobufjs from the root into the target module
const src = path.join(nodeModules, 'protobufjs');
const srcPkgPath = path.join(src, 'package.json');
if (!fs.existsSync(srcPkgPath)) fail('node_modules/protobufjs not found in the project root. Install it first (do not use SKIP_INSTALL=1).');
const srcPkg = readJson(srcPkgPath);

const dest = path.join(targetDir, 'node_modules', 'protobufjs');
const destPkgPath = path.join(dest, 'package.json');
const destVersion = fs.existsSync(destPkgPath) ? readJson(destPkgPath).version : null;

if (destVersion === srcPkg.version) {
  console.log(`4. protobufjs ${destVersion} is already in ${path.relative(root, dest)}, skipping`);
} else {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  const v = readJson(destPkgPath).version;
  console.log(`4. protobufjs ${destVersion ? destVersion + ' -> ' : ''}${v} copied to ${path.relative(root, dest)}`);
}

// 5. check that protobufjs dependencies can be resolved from the copy
const resolvable = (dep, from) => {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', dep))) return true;
    if (path.dirname(dir) === dir) return false;
  }
};
const missing = Object.keys(srcPkg.dependencies || {}).filter((d) => !resolvable(d, path.dirname(dest)));
if (missing.length) {
  warn(`protobufjs dependencies not found: ${missing.join(', ')}. Run "npm install" and run this script again.`);
}

console.log('Done. Check the version with: npm ls protobufjs');

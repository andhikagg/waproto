#!/usr/bin/env bash
#
# update.sh
# Fetch the latest WAProto.proto from wa-proto, compile it with pbjs/pbts,
# patch it for Baileys (namespace waproto -> proto + known quirks) and write
# the result (index.js, index.d.ts, WAProto.proto + a zip) to OUT_DIR.
#
# Usage:
#   OUT_DIR=WAProto ZIP_NAME=waproto-build.zip bash update.sh
#
# Env (all optional):
#   PROTO_URL          source .proto (default: wppconnect-team/wa-proto, branch main; file:// also works)
#   MODULE_FORMAT      pbjs wrapper: es6 (default) or commonjs
#   OUT_DIR            output folder (default: ./)
#   ZIP_NAME           zip file name (default: waproto-build.zip)
#   BAILEYS_PROTO_DIR  only used for the copy hint printed at the end

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
PROTO_URL="${PROTO_URL:-https://raw.githubusercontent.com/wppconnect-team/wa-proto/refs/heads/main/WAProto.proto}"
MODULE_FORMAT="${MODULE_FORMAT:-es6}"
BAILEYS_PROTO_DIR="${BAILEYS_PROTO_DIR:-node_modules/baileys/WAProto}"
OUT_DIR="${OUT_DIR:-./}"
ZIP_NAME="${ZIP_NAME:-waproto-build.zip}"

WORK_DIR="$(mktemp -d)"
echo "==> Work dir: $WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

die() { echo "!! $*" >&2; exit 1; }

# ── 1. Sanity checks ──────────────────────────────────────────────────────
command -v node >/dev/null || die "node not found in PATH"
command -v npm  >/dev/null || die "npm not found in PATH"
command -v curl >/dev/null || die "curl not found in PATH"

# ── 2. Fetch latest proto ─────────────────────────────────────────────────
echo "==> Downloading WAProto.proto..."
curl -fsSL --retry 3 --max-time 120 "$PROTO_URL" -o "$WORK_DIR/WAProto.proto"
if [ ! -s "$WORK_DIR/WAProto.proto" ] || ! grep -Eq '^[[:space:]]*message[[:space:]]+[A-Za-z_]' "$WORK_DIR/WAProto.proto"; then
  die "downloaded file does not look like a .proto (empty or no 'message' definitions)"
fi

# ── 3. Fix proto3-illegal 'required' keyword (known upstream quirk) ───────
# Only field declarations (a line starting with 'required') are rewritten, so
# comments and string values that merely contain the word are left alone.
echo "==> Patching 'required' -> 'optional' (proto3 compat)..."
REQUIRED_COUNT=$(grep -cE '^[[:space:]]*required[[:space:]]+' "$WORK_DIR/WAProto.proto" || true)
if [ "$REQUIRED_COUNT" -gt 0 ]; then
  sed -E 's/^([[:space:]]*)required[[:space:]]+/\1optional /' "$WORK_DIR/WAProto.proto" > "$WORK_DIR/WAProto.proto.tmp"
  mv "$WORK_DIR/WAProto.proto.tmp" "$WORK_DIR/WAProto.proto"
  echo "    patched $REQUIRED_COUNT occurrence(s)"
else
  echo "    none found, skipping"
fi

# ── 4. Make sure pbjs/pbts are available ──────────────────────────────────
# Prefer a copy already installed in the project (CI does this). Otherwise
# install into the work dir, so the project's package.json and node_modules
# are never touched.
PBJS="./node_modules/.bin/pbjs"
PBTS="./node_modules/.bin/pbts"
if [ ! -x "$PBJS" ] || [ ! -x "$PBTS" ]; then
  echo "==> protobufjs-cli not found locally, installing into the work dir..."
  npm install --prefix "$WORK_DIR/tools" --no-audit --no-fund protobufjs-cli@latest
  PBJS="$WORK_DIR/tools/node_modules/.bin/pbjs"
  PBTS="$WORK_DIR/tools/node_modules/.bin/pbts"
fi
[ -x "$PBJS" ] && [ -x "$PBTS" ] || die "pbjs/pbts not available after install"

# The runtime is only needed by whoever uses the generated file, so a missing
# copy here is a warning, not an error.
if node -e "require.resolve('protobufjs/package.json')" >/dev/null 2>&1; then
  RUNTIME_VERSION=$(node -e "console.log(require('protobufjs/package.json').version)")
  echo "==> protobufjs runtime version in use: $RUNTIME_VERSION"
else
  echo "?? protobufjs runtime not found in this project's node_modules (only matters when installing the result)."
fi

# ── 5. Compile ────────────────────────────────────────────────────────────
echo "==> Compiling with pbjs (-w $MODULE_FORMAT)..."
"$PBJS" -t static-module -w "$MODULE_FORMAT" -o "$WORK_DIR/WAProto.raw.js" "$WORK_DIR/WAProto.proto"

echo "==> Generating TypeScript typings..."
"$PBTS" -o "$WORK_DIR/WAProto.raw.d.ts" "$WORK_DIR/WAProto.raw.js"

# ── 6. Patch namespace + known Baileys quirks (JS *and* typings) ──────────
echo "==> Patching namespace (waproto -> proto) and known quirks..."
node - "$WORK_DIR/WAProto.raw.js" "$WORK_DIR/WAProto.raw.d.ts" "$WORK_DIR/WAProto.js" "$WORK_DIR/WAProto.d.ts" <<'NODE_EOF'
const fs = require('fs');
const [, , rawJs, rawDts, outJs, outDts] = process.argv;
const ns = /\bwaproto\b/g;

let js = fs.readFileSync(rawJs, 'utf8');
let dts = fs.readFileSync(rawDts, 'utf8');

const hits = (js.match(ns) || []).length;
if (!hits) {
  console.error('!! no "waproto" namespace found in the generated JS; upstream package name or pbjs output changed.');
  process.exit(1);
}
js = js.replace(ns, 'proto');
dts = dts.replace(ns, 'proto');
console.log(`    namespace: ${hits} occurrence(s) renamed in JS, ${(fs.readFileSync(rawDts, 'utf8').match(ns) || []).length} in typings`);

const quirk = /(Message\.HistorySyncType) = /;
if (quirk.test(js)) {
  js = js.replace(quirk, '$1 = Message.HistorySyncNotification.HistorySyncType = ');
  console.log('    quirk HistorySyncType applied');
} else {
  console.warn('?? quirk HistorySyncType did not match; skipped (check upstream if Baileys breaks)');
}

if (!/\bexport\s+const\s+proto\b|\bexports\.proto\b|\$root\.proto\b/.test(js)) {
  console.warn('?? no "proto" export found in the generated JS; Baileys expects one');
}

fs.writeFileSync(outJs, js);
fs.writeFileSync(outDts, dts);
console.log('    written ->', outJs, 'and', outDts);
NODE_EOF

# ── 7. Validate syntax before anything is copied out ──────────────────────
echo "==> Validating generated file syntax..."
if [ "$MODULE_FORMAT" = "es6" ]; then CHECK_EXT="mjs"; else CHECK_EXT="cjs"; fi
cp "$WORK_DIR/WAProto.js" "$WORK_DIR/check.$CHECK_EXT"
node --check "$WORK_DIR/check.$CHECK_EXT"
echo "    OK"

# ── 8. Copy build output to OUT_DIR (for manual review/copy) ──────────────
mkdir -p "$OUT_DIR"
cp "$WORK_DIR/WAProto.js"    "$OUT_DIR/index.js"
cp "$WORK_DIR/WAProto.d.ts"  "$OUT_DIR/index.d.ts"
cp "$WORK_DIR/WAProto.proto" "$OUT_DIR/WAProto.proto"

# ── 9. Zip the build output ───────────────────────────────────────────────
echo "==> Zipping build output -> $OUT_DIR/$ZIP_NAME"
if command -v zip >/dev/null; then
  ( cd "$OUT_DIR" && rm -f "$ZIP_NAME" && zip -q "$ZIP_NAME" index.js index.d.ts WAProto.proto )
elif command -v python3 >/dev/null; then
  ( cd "$OUT_DIR" && rm -f "$ZIP_NAME" && python3 - "$ZIP_NAME" <<'PY_EOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for f in ("index.js", "index.d.ts", "WAProto.proto"):
        z.write(f)
PY_EOF
  )
else
  echo "?? neither zip nor python3 found, skipping zip step"
fi

echo "==> Done. Build output ready at: $OUT_DIR"
echo "    - $OUT_DIR/index.js"
echo "    - $OUT_DIR/index.d.ts"
echo "    - $OUT_DIR/WAProto.proto"
echo "    - $OUT_DIR/$ZIP_NAME"
echo ""
echo "Copy manually when ready, e.g.:"
echo "  cp $OUT_DIR/index.js $OUT_DIR/index.d.ts $OUT_DIR/WAProto.proto $BAILEYS_PROTO_DIR/"
echo ""
echo "Tip: if WhatsApp errors after replacing, try deleting your Baileys auth/session folder and pairing again."

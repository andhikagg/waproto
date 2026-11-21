#!/usr/bin/env bash
#
# update-waproto.sh
# Fetch the latest WAProto.proto from wa-proto, compile it, patch it for
# Baileys, and install it into node_modules/baileys/WAProto — with a
# backup + rollback safety net.
#
# Usage:
#   ./update-waproto.sh
#
# Configure the paths below to match your project.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
PROTO_URL="https://raw.githubusercontent.com/wppconnect-team/wa-proto/refs/heads/main/WAProto.proto"
BAILEYS_PROTO_DIR="node_modules/baileys/WAProto"   # <-- adjust if your path differs
WORK_DIR="$(mktemp -d)"

echo "==> Work dir: $WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── 0. Sanity checks ─────────────────────────────────────────────────────
# if [ ! -d "$BAILEYS_PROTO_DIR" ]; then
  # echo "!! Baileys proto dir not found at: $BAILEYS_PROTO_DIR"
  # echo "   Edit BAILEYS_PROTO_DIR in this script to point at the right path."
  # exit 1
# fi

command -v node >/dev/null || { echo "!! node not found in PATH"; exit 1; }
command -v npx  >/dev/null || { echo "!! npx not found in PATH";  exit 1; }

# ── 1. Fetch latest proto ─────────────────────────────────────────────────
echo "==> Downloading WAProto.proto..."
curl -fsSL "$PROTO_URL" -o "$WORK_DIR/WAProto.proto"

# ── 3. Fix proto3-illegal 'required' keyword (known upstream quirk) ─────
echo "==> Patching 'required' -> 'optional' (proto3 compat)..."
REQUIRED_COUNT=$(grep -c '\brequired ' "$WORK_DIR/WAProto.proto" || true)
if [ "$REQUIRED_COUNT" -gt 0 ]; then
  sed -i 's/\brequired /optional /g' "$WORK_DIR/WAProto.proto"
  echo "    patched $REQUIRED_COUNT occurrence(s)"
else
  echo "    none found, skipping"
fi

# ── 4. Detect module format Baileys currently uses (esm vs commonjs) ────
# EXISTING_JS="$BAILEYS_PROTO_DIR/index.js"
# MODULE_FORMAT="commonjs"
# if [ -f "$EXISTING_JS" ] && grep -q '^import ' "$EXISTING_JS"; then
  MODULE_FORMAT="es6"
# fi
# echo "==> Detected module format: $MODULE_FORMAT"

# ── 5. Ensure a matching protobufjs-cli is available locally ────────────
# protobufjs-cli and the protobufjs runtime are released from the same
# monorepo but versioned independently — what matters is that BOTH exist
# as real installed packages (not stale global/npx caches).
if ! node -e "require.resolve('protobufjs-cli/bin/pbjs')" >/dev/null 2>&1; then
  echo "==> protobufjs-cli not found locally, installing as devDependency..."
  npm install --save-dev protobufjs-cli@latest
fi

if ! node -e "require.resolve('protobufjs')" >/dev/null 2>&1; then
  echo "!! protobufjs runtime not found in this project's node_modules."
  echo "   Baileys needs its own copy resolvable — check node_modules/baileys/node_modules/protobufjs"
  echo "   or install it at the project root: npm install protobufjs"
  exit 1
fi

RUNTIME_VERSION=$(node -e "console.log(require('protobufjs/package.json').version)")
echo "==> protobufjs runtime version in use: $RUNTIME_VERSION"

# ── 6. Compile ────────────────────────────────────────────────────────────
echo "==> Compiling with pbjs (-w $MODULE_FORMAT)..."
npx pbjs -t static-module -w "$MODULE_FORMAT" -o "$WORK_DIR/WAProto.raw.js" "$WORK_DIR/WAProto.proto"

echo "==> Generating TypeScript typings..."
npx pbts -o "$WORK_DIR/WAProto.d.ts" "$WORK_DIR/WAProto.raw.js"

# ── 7. Patch namespace + known Baileys quirks ────────────────────────────
echo "==> Patching namespace (waproto -> proto) and known quirks..."
node - "$WORK_DIR/WAProto.raw.js" "$WORK_DIR/WAProto.js" <<'NODE_EOF'
const fs = require('fs'); const [, , inPath, outPath] = process.argv; let js = fs.readFileSync(inPath, 'utf8'); js = js.replaceAll('waproto', 'proto').replace(/(Message\.HistorySyncType) = /, '$1 = Message.HistorySyncNotification.HistorySyncType = '); fs.writeFileSync(outPath, js); console.log('    namespace + quirks patched ->', outPath);
NODE_EOF

# ── 8. Validate syntax before touching production files ─────────────────
echo "==> Validating generated file syntax..."
node --check "$WORK_DIR/WAProto.js"
echo "    OK"

# ── 9. Diff summary vs previous version (informational only) ────────────
# if [ -f "$EXISTING_JS" ]; then
  # echo "==> Quick diff summary vs current installed version:"
  # OLD_TYPES=$(grep -oP '^\s*proto\.\K\w+(?=\s*=\s*\(function)' "$EXISTING_JS" 2>/dev/null | sort -u || true)
  # NEW_TYPES=$(grep -oP '^\s*proto\.\K\w+(?=\s*=\s*\(function)' "$WORK_DIR/WAProto.js" 2>/dev/null | sort -u || true)
  # ADDED=$(comm -13 <(echo "$OLD_TYPES") <(echo "$NEW_TYPES"))
  # REMOVED=$(comm -23 <(echo "$OLD_TYPES") <(echo "$NEW_TYPES"))
  # echo "    Added types:   $(echo "$ADDED" | grep -c . || echo 0)"
  # echo "    Removed types: $(echo "$REMOVED" | grep -c . || echo 0)"
  # if [ -n "$REMOVED" ]; then
    # echo "    !! Removed: $REMOVED"
    # echo "       Double-check your code doesn't reference these before deploying."
  # fi
# fi

# ── 10. Copy build output to OUT_DIR (for manual review/copy) ───────────
# OUT_DIR and ZIP_NAME can be overridden from the environment, e.g.:
#   OUT_DIR=WAProto ZIP_NAME=waproto.zip ./update-waproto.sh
OUT_DIR="${OUT_DIR:-./}"
ZIP_NAME="${ZIP_NAME:-waproto-build.zip}"
mkdir -p "$OUT_DIR"
cp "$WORK_DIR/WAProto.js" "$OUT_DIR/index.js"
cp "$WORK_DIR/WAProto.d.ts" "$OUT_DIR/index.d.ts"
cp "$WORK_DIR/WAProto.proto" "$OUT_DIR/WAProto.proto"

# ── 11. Zip the build output ────────────────────────────────────────────
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
  echo "!! neither zip nor python3 found, skipping zip step"
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
echo "After replacing: delete your Baileys auth/session folder and re-pair (scan QR again)."

# waproto

Automatically builds the latest WhatsApp protobuf definitions from
[wppconnect-team/wa-proto](https://github.com/wppconnect-team/wa-proto) in a
format compatible with [Baileys](https://github.com/WhiskeySockets/Baileys),
and provides one-line patchers to install them into your project.

> Unofficial. Not affiliated with or endorsed by WhatsApp or Meta.

## How it works

1. A GitHub Actions workflow checks the upstream repo every hour.
2. If there is a new upstream commit, it runs `update-waproto.sh`, which:
   - downloads `WAProto.proto`
   - replaces proto3-illegal `required` with `optional`
   - compiles it with `pbjs` (ES module output) and generates typings with `pbts`
   - renames the `waproto` namespace to `proto` and applies known Baileys quirks
   - validates the generated syntax
   - zips the output
3. The result is committed to `WAProto/` and the zip is uploaded as a workflow artifact.
4. On your machine, two small scripts install everything into `node_modules`:
   - `fix-protobuf.js` updates the `protobufjs` runtime inside the Baileys module
   - `patch.js` installs the built `WAProto` files

## Quick start

Run both commands in your Baileys project root, **in this order**.

**1. Update protobufjs** (required, see [below](#requirement-use-the-latest-protobufjs)):

```bash
curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/fix.js | TARGET="baileys" node -
```

**2. Patch WAProto:**

```bash
curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/patch.js | TARGET="baileys" node -
```

`TARGET` is the package folder name inside `node_modules`, for example:

```bash
TARGET="baileys"
TARGET="@whiskeysockets/baileys"
```

After patching, **delete your Baileys auth/session folder and pair again**
(scan the QR code), as the protocol definitions have changed.

## Requirement: use the latest protobufjs

The generated `index.js` is compiled with the latest `protobufjs-cli` and imports
`protobufjs/minimal`. The `protobufjs` runtime that Baileys resolves must be the
latest version too. An old runtime can cause missing methods, decode failures,
or import errors.

`fix-protobuf.js` does this for you in four steps:

1. Deletes `package-lock.json` in the project root.
2. Rewrites `node_modules/<TARGET>/package.json` so `protobufjs` is `"latest"`.
3. Runs `npm install protobufjs@latest` in the project root.
4. Copies `node_modules/protobufjs` into `node_modules/<TARGET>/node_modules/protobufjs`.

Only the `protobufjs` folder is copied. Its own dependencies (`long`, `@protobufjs/*`)
are resolved from the project root, where step 3 installs them.

| Variable | Default | Description |
| --- | --- | --- |
| `TARGET` | `baileys` | Package name in `node_modules`. Run from the project root. |
| `SKIP_INSTALL` | unset | Set to `1` to skip `npm install` (use if protobufjs is already up to date). |

Check which version is actually resolved:

```bash
npm ls protobufjs
node -e "console.log(require('protobufjs/package.json').version)"
```

Running `npm install` or `npm ci` rebuilds `node_modules` and removes the copied
module. Run `fix-protobuf.js` again afterwards, or add it to the `postinstall`
script of your own `package.json`:

```json
{
  "scripts": {
    "postinstall": "curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/fix.js | TARGET=baileys SKIP_INSTALL=1 node - && curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/patch.js | TARGET=baileys node -"
  }
}
```

`SKIP_INSTALL=1` is used there so the script does not call `npm install` from inside
an install. Make sure `protobufjs@latest` is listed in your own dependencies.

## Patcher options (`patch.js`)

| Variable | Default | Description |
| --- | --- | --- |
| `TARGET` | `baileys` | Package name in `node_modules` (searched upward from the current directory). |
| `SOURCE` | `https://raw.githubusercontent.com/andhikagg/waproto/main/WAProto` | Base URL that serves `index.js`, `index.d.ts` and `WAProto.proto`. |

What it does:

- Downloads everything into memory first and syntax-checks `index.js` before touching `node_modules`.
- Backs up existing files as `*.bak` in the same folder.
- Rolls back automatically if writing fails.
- Does nothing if the installed `index.js` is already identical.
- Warns if the module format differs (ESM vs CommonJS) between the installed and new file.

Requires Node.js 18 or newer.

## Repository layout

```
.
├── .github/workflows/update-waproto.yml   # hourly upstream check + build
├── update-waproto.sh                      # fetch, patch, compile, zip
├── fix.js                        # updates protobufjs inside node_modules/<TARGET>
├── patch.js                               # installs built files into node_modules
├── WAProto/
│   ├── index.js
│   ├── index.d.ts
│   └── WAProto.proto
└── .waproto-sha                           # last upstream commit that was built
```

## Setting up the workflow

1. Put `update-waproto.sh` in the repo root and the workflow file at
   `.github/workflows/update-waproto.yml` on the default branch.
2. Go to **Settings → Actions → General → Workflow permissions** and select
   **Read and write permissions**. Without this, the commit step fails.
3. Open the **Actions** tab, select **update-waproto**, and press **Run workflow**
   (enable `force` for the first run) instead of waiting for the schedule.

Scheduled workflows can start a few minutes late, and GitHub disables them after
60 days of repository inactivity. The workflow commits regularly, so this
normally does not happen.

## Building manually

```bash
npm install --no-save protobufjs protobufjs-cli
OUT_DIR=WAProto ZIP_NAME=waproto-build.zip bash update-waproto.sh
```

| Variable | Default | Description |
| --- | --- | --- |
| `OUT_DIR` | `./` | Where `index.js`, `index.d.ts`, `WAProto.proto` and the zip are written. |
| `ZIP_NAME` | `waproto-build.zip` | Name of the generated zip. |

The script uses `zip` if available and falls back to `python3`.

## Notes

- The build uses ES module output (`pbjs -w es6`). Your target Baileys version
  must use ES modules as well, otherwise adjust the `-w` flag in `update-waproto.sh`.
- Upstream changes can remove or rename message types. Review the diff before
  deploying to production.
- To roll back WAProto, copy the `*.bak` files over their originals in
  `node_modules/<package>/WAProto`, or reinstall the package.
- Piping a script from `curl` into `node` runs it with your permissions. Only use
  URLs from a repository you control or have reviewed.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Workflow does not appear in the Actions tab | Check the path is exactly `.github/workflows/update-waproto.yml`, it is on the default branch, and the YAML indentation is valid. |
| `git push` is denied in the workflow | Enable **Read and write permissions** (see above). |
| `package "x" not found` or `"x" tidak ada` | Run the command from your project root and check the `TARGET` name. |
| Decode errors or `protobufjs/minimal` import errors | Run `fix.js`, then check `npm ls protobufjs` for older nested copies. |
| Import errors after patching | Module format mismatch. Rebuild with the matching `-w` option. |
| Fix disappears after `npm install` | `node_modules` was rebuilt. Run `fix.js` and `patch.js` again, or use the `postinstall` example. |
| WhatsApp disconnects or errors after patching | Delete the auth/session folder and pair again. |

# waproto

🇬🇧 English · [🇮🇩 Bahasa Indonesia](README-id.md)

Automatically builds the latest WhatsApp protobuf definitions from
[wppconnect-team/wa-proto](https://github.com/wppconnect-team/wa-proto) in a
format compatible with [Baileys](https://github.com/WhiskeySockets/Baileys),
and provides one-line patchers to install them into your project.

> Unofficial. Not affiliated with or endorsed by WhatsApp or Meta.

## How it works

1. A GitHub Actions workflow checks the upstream repo every hour.
2. If there is a new upstream commit, it runs `update.sh` on the `WAProto.proto`
   from exactly that commit. The script:
   - downloads `WAProto.proto` and checks that it really is a `.proto` file
   - replaces proto3-illegal `required` with `optional` (field declarations only)
   - compiles it with `pbjs` (ES module output) and generates typings with `pbts`
   - renames the `waproto` namespace to `proto` in **both** `index.js` and
     `index.d.ts`, and applies known Baileys quirks
   - validates the generated syntax
   - zips the output
3. The result is committed to `WAProto/` and the zip is uploaded as a workflow artifact.
4. On your machine, two small scripts install everything into `node_modules`:
   - `fix.js` updates the `protobufjs` runtime inside the Baileys module
   - `patch.js` installs the built `WAProto` files

## Quick start

Run both commands in your Baileys project root, **in this order**.

**1. Update protobufjs** (required, see [below](#requirement-use-the-latest-protobufjs)):

```bash
curl -fsSL https://andhikagg.github.io/waproto/fix.js | TARGET="baileys" node -
```

**2. Patch WAProto:**

```bash
curl -fsSL https://andhikagg.github.io/waproto/patch.js | TARGET="baileys" node -
```

`TARGET` is the package folder name inside `node_modules`, for example:

```bash
TARGET="baileys"
TARGET="@whiskeysockets/baileys"
```

Pairing again is usually not required. If you get connection or decryption errors
after patching, delete your Baileys auth/session folder and pair again (scan the QR code).

## Requirement: use the latest protobufjs

The generated `index.js` is compiled with the latest `protobufjs-cli` and imports
`protobufjs/minimal`. The `protobufjs` runtime that Baileys resolves must be recent
too. An old runtime can cause missing methods, decode failures, or import errors.

`fix.js` does this for you in a few steps:

1. Leaves `package-lock.json` alone (set `RESET_LOCK=1` to delete it).
2. Rewrites `node_modules/<TARGET>/package.json` so `protobufjs` uses the wanted
   version (`latest` by default). The original is saved once as `package.json.bak`.
3. Runs `npm install protobufjs@<version>` in the project root.
4. Copies `node_modules/protobufjs` into `node_modules/<TARGET>/node_modules/protobufjs`
   (skipped if that copy already has the same version).
5. If the version was `latest`, replaces it in `package.json` with a real range such as
   `^8.8.1`, so `npm ls` does not report the copy as `invalid`.

Only the `protobufjs` folder is copied. Its own dependencies (`long`, `@protobufjs/*`)
are resolved from the project root, where step 3 installs them. The script warns if
any of them cannot be found.

| Variable | Default | Description |
| --- | --- | --- |
| `TARGET` | `baileys` | Package name in `node_modules`. Run from the project root. |
| `SKIP_INSTALL` | unset | Set to `1` to skip `npm install` (use if protobufjs is already installed in the project root). |
| `PROTOBUFJS_VERSION` | `latest` | protobufjs version or range, for example `^7`. Use it to avoid surprises from new major releases. |
| `RESET_LOCK` | unset | Set to `1` to delete `package-lock.json` in the project root. |

Check which version is actually resolved:

```bash
npm ls protobufjs
node -e "console.log(require('protobufjs/package.json').version)"
```

Running `npm install` or `npm ci` rebuilds `node_modules` and removes the copied
module. Run `fix.js` again afterwards, or add both scripts to the `postinstall`
script of your own `package.json`:

```json
{
  "scripts": {
    "postinstall": "curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/fix.js | TARGET=baileys SKIP_INSTALL=1 node - && curl -fsSL https://raw.githubusercontent.com/andhikagg/waproto/main/patch.js | TARGET=baileys node -"
  }
}
```

`SKIP_INSTALL=1` is used there so the script does not call `npm install` from inside
an install. Make sure `protobufjs` is listed in your own dependencies. Both scripts
are safe to run repeatedly.

## Patcher options (`patch.js`)

| Variable | Default | Description |
| --- | --- | --- |
| `TARGET` | `baileys` | Package name in `node_modules` (searched upward from the current directory). |
| `SOURCE` | `https://raw.githubusercontent.com/andhikagg/waproto/main/WAProto` | Base URL that serves `index.js`, `index.d.ts` and `WAProto.proto`. Must be `https://`. |
| `DRY_RUN` | unset | Set to `1` to download and validate only, without writing anything. |
| `FORCE` | unset | Set to `1` to install even if the protobufjs runtime check fails. |

What it does:

- Downloads everything into memory first. Empty or tiny files are rejected, and
  `index.js` is syntax-checked before `node_modules` is touched.
- If your `protobufjs` has no `exports` map, adds `.js` to the `protobufjs/minimal`
  import so Node ESM can resolve it.
- Checks that the protobufjs runtime used by your package has what the new `index.js`
  needs (for example `Reader.size()`), and stops before writing anything if it does not.
- If `index.d.ts` still uses the `waproto` namespace, renames it to `proto`.
- Only writes files that actually changed, and backs up each replaced file as `*.bak`
  in the same folder.
- Writes through a temporary file, and rolls back automatically if any write fails.
- Does nothing if everything is already identical.
- Warns if the module format differs (ESM vs CommonJS) between the installed and new file.

Requires Node.js 18 or newer.

## Repository layout

```
.
├── .github/workflows/update-waproto.yml   # hourly upstream check + build
├── update.sh                              # fetch, compile, patch, zip
├── fix.js                                 # updates protobufjs inside node_modules/<TARGET>
├── patch.js                               # installs built files into node_modules
├── WAProto/
│   ├── index.js
│   ├── index.d.ts
│   └── WAProto.proto
├── .waproto-sha                           # last upstream commit that was built
├── README.md
└── README-id.md
```

## Setting up the workflow

1. Put `update.sh` in the repo root and the workflow file at
   `.github/workflows/update-waproto.yml` on the default branch.
2. Go to **Settings → Actions → General → Workflow permissions** and select
   **Read and write permissions**. Without this, the commit step fails.
3. Open the **Actions** tab, select **update-waproto**, and press **Run workflow**
   (enable `force` for the first run) instead of waiting for the schedule.

Scheduled workflows can start a few minutes late. GitHub may also disable them after
60 days without repository activity, and this workflow only commits when upstream
changes, so do not rely on it to keep itself alive. If it gets disabled, re-enable it
from the Actions tab.

## Building manually

```bash
OUT_DIR=WAProto ZIP_NAME=waproto-build.zip bash update.sh
```

If `pbjs` and `pbts` are not installed in `./node_modules/.bin`, the script installs
`protobufjs-cli` into a temporary folder, so your own `package.json` and
`node_modules` are left untouched.

| Variable | Default | Description |
| --- | --- | --- |
| `OUT_DIR` | `./` | Where `index.js`, `index.d.ts`, `WAProto.proto` and the zip are written. |
| `ZIP_NAME` | `waproto-build.zip` | Name of the generated zip. |
| `PROTO_URL` | wa-proto `main` | Source `.proto`. Can be pinned to a commit, or a `file://` path. |
| `MODULE_FORMAT` | `es6` | `pbjs` wrapper: `es6` or `commonjs`. |

The script uses `zip` if available and falls back to `python3`.

## Notes

- The build uses ES module output (`pbjs -w es6`). Your target Baileys version
  must use ES modules as well, otherwise build with `MODULE_FORMAT=commonjs`.
- Upstream changes can remove or rename message types. Review the diff before
  deploying to production.
- To roll back WAProto, copy the `*.bak` files over their originals in
  `node_modules/<package>/WAProto`, or reinstall the package.
- The workflow installs `protobufjs` and `protobufjs-cli` without pinning a version,
  so a new release can change the build output.
- Piping a script from `curl` into `node` runs it with your permissions. Only use
  URLs from a repository you control or have reviewed. To avoid surprises from new
  commits, replace `main` in the URLs (and in `SOURCE`) with a specific commit hash.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Workflow does not appear in the Actions tab | Check the path is exactly `.github/workflows/update-waproto.yml`, it is on the default branch, and the YAML indentation is valid. |
| `git push` is denied in the workflow | Enable **Read and write permissions** (see above). |
| Workflow fails with `Invalid upstream SHA` | The GitHub API returned an error or hit a rate limit. Run the workflow again later. |
| `"x" not found in .../node_modules` or `package "x" not found` | Run the command from your project root and check the `TARGET` name. |
| `SOURCE must be https://` | Use an `https://` URL. `http://localhost` is only allowed for testing. |
| Decode errors or `protobufjs/minimal` import errors | Run `fix.js`, then check `npm ls protobufjs` for older nested copies. |
| `TypeError: reader.size is not a function` | The protobufjs runtime is older than the one the build was compiled for. Run `fix.js` to update it, then run `patch.js` again. This is not a session problem, so do not delete your auth/session folder. |
| `npm ls` says `invalid` for protobufjs | An older `fix.js` wrote `"latest"` into the package's `package.json`. Run the current `fix.js` again; it replaces it with a real version range. |
| Import errors after patching | Module format mismatch. Rebuild with the matching `MODULE_FORMAT`. |
| Type errors about `proto` or `waproto` | Run `patch.js` again; it renames `waproto` to `proto` in `index.d.ts`. |
| Fix disappears after `npm install` | `node_modules` was rebuilt. Run `fix.js` and `patch.js` again, or use the `postinstall` example. |
| WhatsApp disconnects or errors after patching | Delete the auth/session folder and pair again. |

## Reporting problems

If a build fails, the generated `WAProto/` looks broken, or `fix.js` / `patch.js`
errors out and the table above does not help, please
[open an issue](https://github.com/andhikagg/waproto/issues).

If a workflow build fails, `WAProto/` keeps the last successful build and the
workflow tries again on its next run, so your existing install is not affected.

Please include:

- the command you ran (with `TARGET`) and the full output
- your Node.js version (`node -v`) and the output of `npm ls protobufjs`
- your Baileys version, and whether it uses ESM or CommonJS
- for a failed build: the link to the run in the **Actions** tab

Do not paste auth/session files, tokens, or other secrets.

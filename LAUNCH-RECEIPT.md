# Grok Bot 0.18 reconstructed launch receipt

- Status: verified
- Date: 2026-08-26
- App path: `/Applications/Grok Bot 0.18 Reconstructed.app`
- Version: `CFBundleShortVersionString` `0.18.0`
- Display name: `Grok Bot 0.18 Reconstructed`
- Official install left untouched: `/Applications/Grok Bot.app` remains `0.27.0`
- Runtime source: local `~/Downloads/Grok_Bot_0.18.0.dmg` (155793020 bytes, sha256 `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb`)
- Node: `mise exec node@26.7.0`
- Package: `node scripts/package-macos.mjs` after `npm ci` and `npm run bootstrap`
- Install: `ditto` from `dist/Grok Bot 0.18 Reconstructed.app` to `/Applications`; launch proof did not use `dist/`
- `codesign --verify --deep --strict`: exit 0
- Native E2E: `node scripts/native-e2e-check.mjs --app "/Applications/Grok Bot 0.18 Reconstructed.app"`
  - status: `pass`
  - observationClass: `admissible-production-startup-observation`
  - generatedAt: `2026-08-26T15:25:22.093Z`
  - `entrypoint:renderer`: checksum-pinned `dist/renderer/assets/index-UbX-y3il.js` (131 inventory files)
  - `runtime:startup`: pass
  - `runtime:renderer`: pass
  - `runtime:fatal-logs`: pass
  - `runtime:opaque-fallback`: pass

## Routing on main

- `7ab9729` Default reconstructed Grok Bot to ROX without Cursor login
- `f9bed06` Route Grok Bot computer to m4697 and default T6 Luna
- `2066499` Fix Luna chat path and honor isolated user-data-dir
- Default inference: `rox` / `https://api.rox.one/v1` / `gpt-5.6-luna` / reasoning `medium`
- Default box: `m4697` gateway `http://100.89.19.82:1340`
- Official `/Applications/Grok Bot.app` 0.27.0 is not overwritten
- Do not commit LFS archive DMG/EXE blobs

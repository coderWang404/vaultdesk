# VaultDesk 1.0 release

Status: 1.0.0 was built and verified locally on 2026-10-27. Nothing was
published: no git tag, GitHub release, npm package, Homebrew cask, or
notarization submission exists for this version. Each publication step below
requires explicit approval.

## Artifact

| Field | Value |
| --- | --- |
| File | `release/VaultDesk-1.0.0-arm64.dmg` |
| Platform | macOS, Apple Silicon (`arm64`) |
| Size | 126,494,974 bytes (120.6 MiB) |
| SHA-256 | `294f341d10a17727eb41f4e2970cd1189f3e9ec52b4e083a6627b37c3d419cea` |
| DMG checksum | `hdiutil verify` VALID, CRC32 `$2856C478` |
| Bundle ID | `com.coderwang404.vaultdesk` |
| Bundle version | `1.0.0` |
| Signing | Ad-hoc (`identity: null` in `apps/desktop/electron-builder.yml`) |
| Notarization | None |

The hash identifies this local build only. electron-builder output includes
timestamps, so a rebuild is expected to produce a different digest.

## What was verified

- `pnpm -r typecheck` passes.
- `pnpm test` passes: 55 vitest tests across 13 files.
- CLI E2E and desktop E2E suites pass, including axe accessibility scans
  with zero violations.
- `pnpm exec tsx tests/e2e/dmg.e2e.mts` mounts the DMG, checks the bundle
  identifier, version, architecture, `app.asar`, and the packaged
  `Contents/Resources/agent-skill/vaultdesk/SKILL.md`, then launches the
  installed app, opens a v2 fixture vault, runs `vault validate`, edits a
  skill, and confirms the edit survives app exit.
- The DMG carries no quarantine flag after a local build.

Scenario coverage and deliberate limits are listed in
[tests/e2e/README.md](../tests/e2e/README.md).

## First launch

The app is ad-hoc signed and not notarized. On a Mac with default Gatekeeper
settings, open the DMG, drag VaultDesk to Applications, then right-click the
app and choose Open, or allow it in System Settings → Privacy & Security.
Double-clicking alone may be blocked.

The `spctl` result on the build machine is not evidence for other Macs: that
machine has Gatekeeper assessment disabled, so the check exits 0 without
proving a default system accepts the app.

## Notarization assessment

Not done. Notarization needs credentials the project does not have:

1. Apple Developer Program membership.
2. A Developer ID Application certificate installed in the build keychain.
3. Hardened runtime enabled and the identity set in `electron-builder.yml`
   (`identity` currently `null`).
4. `notarytool` submission with an app-specific password or API key, followed
   by `xcrun stapler staple`.

electron-builder can automate steps 3 and 4 once the credentials exist. The
verification commands are:

```bash
codesign --verify --deep --strict --verbose=2 VaultDesk.app
spctl --assess --type execute --verbose=4 VaultDesk.app
xcrun stapler validate VaultDesk.app
```

Until then, the README first-launch instructions are the supported path. A
notarized build does not change the app's behavior, only the Gatekeeper
experience.

## Homebrew cask assessment

Not published. A cask needs a public download URL and a stable checksum, so it
can only be written after a GitHub release exists. Homebrew also does not
bypass Gatekeeper: installing an unsigned, unnotarized app with `brew` still
requires the same first-launch approval.

Draft for a personal tap, to be finalized only after the release asset URL is
live:

```ruby
cask "vaultdesk" do
  version "1.0.0"
  sha256 "294f341d10a17727eb41f4e2970cd1189f3e9ec52b4e083a6627b37c3d419cea"

  url "https://github.com/coderWang404/vaultdesk/releases/download/v#{version}/VaultDesk-#{version}-arm64.dmg"
  name "VaultDesk"
  desc "Local-first skill and plugin vault manager"
  homepage "https://github.com/coderWang404/vaultdesk"

  depends_on arch: :arm64
  app "VaultDesk.app"

  zap trash: [
    "~/Library/Application Support/VaultDesk",
    "~/Library/Caches/VaultDesk",
    "~/Library/Preferences/com.coderwang404.vaultdesk.plist",
  ]
end
```

Publication path, in order and each gated on approval:

1. Create the `v1.0.0` tag and GitHub release; upload the DMG and its SHA-256.
2. Verify the release URL downloads to the same checksum.
3. Add the cask to a tap, run `brew audit --cask vaultdesk`, then
   `brew install --cask vaultdesk` and launch once.
4. Optionally submit to `homebrew/cask`; acceptance is not guaranteed and
   generally expects a signed, notarized app. A personal tap is the fallback.

There is no auto-update channel. Users update by downloading a newer DMG.

## Release checklist

Run from the repository root on macOS:

```bash
pnpm -r typecheck
pnpm test
pnpm test:e2e:cli
pnpm test:e2e:desktop
pnpm package:mac
pnpm exec tsx tests/e2e/dmg.e2e.mts
shasum -a 256 release/VaultDesk-1.0.0-arm64.dmg
```

Version files must all read `1.0.0`: root `package.json`,
`packages/schema/package.json`, `packages/core/package.json`,
`packages/cli/package.json`, and `apps/desktop/package.json`. The CLI and
preload version fallbacks must match.

Then, with approval: commit, tag `v1.0.0`, push the tag, create the GitHub
release, upload the DMG, and update the cask. Without approval the release
stays local.

## Known limits at 1.0

- Ad-hoc signed and not notarized.
- The verified artifact is Apple Silicon only. An Intel build can be produced
  from the same source with `electron-builder --mac dmg --x64`, but it is not
  part of this release verification.
- No Windows or Linux desktop build, no auto-update, no npm publication.
- Plugin installation is delegated to the agent by design; VaultDesk stores,
  validates, and displays plugin roots only.

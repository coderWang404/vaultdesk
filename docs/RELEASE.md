# VaultDesk v1.2.0 release

Status: locally verified on 2026-10-30; publication and installed-app verification
are recorded separately in [QA-CURRENT.md](QA-CURRENT.md).

## v1.2.0 artifact

| Field | Value |
| --- | --- |
| File | `release/VaultDesk-1.2.0-arm64.dmg` |
| Platform | macOS, Apple Silicon (`arm64`) |
| Size | 124,599,623 bytes (118.8 MiB) |
| SHA-256 | `793ac2aa0ceee3f2b8b4ee4445a64de55cf487174533715fd013f3ef7603ed81` |
| Bundle ID | `com.coderwang404.vaultdesk` |
| Bundle version | `1.2.0` |
| Signing | Ad-hoc; strict `codesign --verify --deep --strict` passed |
| Notarization | None |

## v1.2.0 release notes

- Adds a macOS login-session worker that checks all registered vaults after login,
  after observed network recovery, and hourly, even with the app window closed.
- Applies remote Git updates per source across the vault, `~/.agents/skills`, and
  registered targets, with rollback on conflict, limited backups, explicit-path
  commits, normal push, and a clear push-failure state.
- Adds per-source auto/review/pause controls, activity history, and a pending-skill
  adoption flow in the app and CLI. Plugin distribution requires an explicitly
  registered target.
- Preserves local edits and unknown directory ownership. New upstream skills
  await adoption; removed upstream skills remain locally until reviewed.
- Packages from the installed Electron runtime so the macOS build does not
  depend on a second Electron download. The DMG remains ad-hoc signed and
  unnotarized; application updates still require a manual replacement.

## v1.2.0 local verification

`pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm test` passed
(25 files, 130 tests). CLI and desktop E2E passed separately; the desktop suite
covered 17 scenarios, including the headless worker, two-vault sync, pending
adoption, and accessibility. `pnpm test:e2e:dmg` passed mounted-DMG
verification, strict signature validation, launch, and persisted editing.

# VaultDesk v1.1.0 release

Status: published on 2026-10-29. The macOS arm64 artifact passed local
verification, was installed in /Applications, and matched the downloaded
GitHub Release asset. See [QA-CURRENT.md](QA-CURRENT.md) for the evidence.

## v1.1.0 artifact

| Field | Value |
| --- | --- |
| File | `release/VaultDesk-1.1.0-arm64.dmg` |
| Platform | macOS, Apple Silicon (`arm64`) |
| Size | 125,215,804 bytes (119.4 MiB) |
| SHA-256 | `e2e8dc508723bb8ccb449f691062e26b51f5f09f4ec3e21854a73b5fa044ca34` |
| Bundle ID | `com.coderwang404.vaultdesk` |
| Bundle version | `1.1.0` |
| Signing | Ad-hoc; strict `codesign --verify --deep --strict` passed |
| Notarization | None |
| GitHub release | `https://github.com/coderWang404/vaultdesk/releases/tag/v1.1.0` |

The DMG checksum is specific to the exact uploaded file. Do not reuse either
v1.0.0 checksum below or the earlier untagged build checksum in
[QA-CURRENT.md](QA-CURRENT.md).

## v1.1.0 release notes

- Refreshed the desktop interface with a warmer, clearer layout, responsive
  navigation and details, and light/dark appearance controls.
- Improved task-first overview, action labels, empty states, keyboard behavior,
  accessibility, and reduced-motion handling.
- Hardened source updates, backup ownership checks, URL validation, and error
  reporting while preserving vault data and CLI contracts.
- The desktop app remains macOS-only. The DMG is ad-hoc signed and not
  notarized. The CLI is built from source; there is no npm or Homebrew release.

These notes match the locally verified v1.1.0 source and DMG.
Users of an unnotarized DMG may need to right-click **VaultDesk.app** and
choose **Open**, or allow it in **System Settings → Privacy & Security**.

## v1.1.0 release verification

From the repository root on macOS:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:e2e:dmg
shasum -a 256 release/VaultDesk-1.1.0-arm64.dmg
```

Confirm the five package versions and the CLI/preload fallbacks are `1.1.0`;
check the mounted bundle version and signature, then verify the downloaded
GitHub asset matches the local SHA-256. Record final results in
[QA-CURRENT.md](QA-CURRENT.md). There is no auto-update channel; users replace
their installed app with the new DMG.

## Historical v1.0.0 local verification (2026-10-27)

The remainder of this document is an archival snapshot for the older local
build. Its artifact, checksum, cask draft, and release checklist do **not**
describe v1.1.0.

Status: 1.0.0 was built and verified locally on 2026-10-27. Nothing was
published from this workspace: no tag was created, nothing was pushed, and no
npm package, Homebrew cask, or notarization submission exists. Each publication
step below requires explicit approval.

### Artifact

| Field | Value |
| --- | --- |
| File | `release/VaultDesk-1.0.0-arm64.dmg` |
| Platform | macOS, Apple Silicon (`arm64`) |
| Size | 125,189,367 bytes (119.4 MiB) |
| SHA-256 | `d1b76e4f4c7ce31617240b103aea843093f09718ffca956626d643271bfa47c6` |
| DMG checksum | `hdiutil verify` VALID, CRC32 `$519342E4` |
| Bundle ID | `com.coderwang404.vaultdesk` |
| Bundle version | `1.0.0` |
| Signing | Ad-hoc bundle signature (`identity: "-"`, hardened runtime off); strict `codesign --verify` passes |
| Notarization | None |

The hash identifies this local build only. electron-builder output includes
timestamps, so a rebuild is expected to produce a different digest.

### What was verified

- `pnpm -r typecheck` passes.
- `pnpm test` passes: 55 vitest tests across 13 files.
- CLI E2E and desktop E2E suites pass, including axe accessibility scans
  with zero violations.
- `pnpm exec tsx tests/e2e/dmg.e2e.mts` mounts the DMG, checks the bundle
  identifier, version, architecture, `app.asar`, and the packaged
  `Contents/Resources/agent-skill/vaultdesk/SKILL.md`, requires a valid
  `codesign --verify --deep --strict` signature with the VaultDesk identifier,
  then launches the installed app, opens a v2 fixture vault, runs
  `vault validate`, edits a skill, and confirms the edit survives app exit.
- The DMG carries no quarantine flag after a local build.

Scenario coverage and deliberate limits are listed in
[tests/e2e/README.md](../tests/e2e/README.md).

### First launch

The app is ad-hoc signed and not notarized. On a Mac with default Gatekeeper
settings, open the DMG, drag VaultDesk to Applications, then right-click the
app and choose Open, or allow it in System Settings → Privacy & Security.
Double-clicking alone may be blocked.

The `spctl` result on the build machine is not evidence for other Macs: that
machine has Gatekeeper assessment disabled, so the check exits 0 without
proving a default system accepts the app.

### Notarization assessment

Not done. Notarization needs credentials the project does not have:

1. Apple Developer Program membership.
2. A Developer ID Application certificate installed in the build keychain.
3. Replace the ad-hoc identity with the certificate name and enable the
   hardened runtime in `electron-builder.yml` (`identity` is currently `"-"`
   and `hardenedRuntime` is `false` for the unsigned build).
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

### Homebrew cask assessment

Not published. A cask needs a public download URL and a stable checksum, so it
can only be written after a GitHub release exists. Homebrew also does not
bypass Gatekeeper: installing an unsigned, unnotarized app with `brew` still
requires the same first-launch approval.

Draft for a personal tap, to be finalized only after the release asset URL is
live:

```ruby
cask "vaultdesk" do
  version "1.0.0"
  sha256 "d1b76e4f4c7ce31617240b103aea843093f09718ffca956626d643271bfa47c6"

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

### Release checklist

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

### Known limits at 1.0

- Ad-hoc signed (valid bundle signature) and not notarized.
- The verified artifact is Apple Silicon only. An Intel build can be produced
  from the same source with `electron-builder --mac dmg --x64`, but it is not
  part of this release verification.
- No Windows or Linux desktop build, no auto-update, no npm publication.
- Plugin installation is delegated to the agent by design; VaultDesk stores,
  validates, and displays plugin roots only.

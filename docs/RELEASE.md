# VaultDesk v1.2.8 release

Status: local verification in progress on 2026-10-31.

Reinstalling a registered target now keeps its destination, ID and registered skills fixed. A separate Add skills action selects only new entries, while installation from skill/source details keeps that context. Search remains available for general and additional-skill selection. A single confirmation action follows preview.

Desktop selections persist as exact skills with `skills_only: true`; CLI agents can request the same behavior with `--skills-only`. Legacy source selectors remain compatible. Exact targets do not expand a same-named source during reload, distribution or later reinstallation. Existing paused synchronization is preserved, and a target ID/destination mismatch is rejected before any file is replaced.

Type checking and all 188 tests in 30 files passed. Contextual installation E2E and light/dark modal accessibility passed; the remaining release acceptance is recorded in QA-CURRENT.md.

# VaultDesk v1.2.7 release

Status: published and installed on 2026-10-31. Tag v1.2.7 points to cff404d81f6cf6875df9e56bb998cc70fb6b260a. CI 41183040004 passed all three jobs, and the public DMG download matched the locally tested artifact byte for byte. This patch adds a standalone CLI/MCP bundle to the DMG and a guarded Settings installer for `~/.local/bin/vaultdesk`; it does not change Vault ownership or agent activation boundaries.

The packaged `Resources/cli/vaultdesk.cjs` contains the CLI's workspace dependencies and runs through Electron's bundled Node runtime with `ELECTRON_RUN_AS_NODE=1`. The installer refuses unknown, symlinked, or edited launchers and clears common Node/dynamic-library injection variables. Settings can copy an absolute-path MCP configuration for the selected Vault; the agent still registers and verifies that configuration itself.

Local validation: typecheck, 179 tests in 29 files, CLI E2E, 20 desktop scenarios with 20 zero-violation axe scans, and the final mounted-DMG CLI/MCP smoke passed. The DMG test runs without the source checkout, `node_modules`, or a system Node path. First-launch Settings works without a Vault, while MCP configuration copying requires a selected Vault.

The installed app's Settings button created the launcher and copied the selected Vault's MCP configuration. The actual launcher reports 1.2.7 and exposes all five read-only MCP tools with only `/usr/bin:/bin` on PATH. The installed app and LaunchAgent both report 1.2.7, with one GUI and one headless worker. Startup synchronization updated the VaultDesk source and pushed 475a2d8 in the private Vault, leaving a clean worktree. Its 38 master skills and 20 registered target-skill entries are current. The previous installed app was moved to Trash and the source-dependent CLI wrapper was preserved in a local backup.

| Field | Value |
| --- | --- |
| Tag | v1.2.7 |
| Platform | macOS Apple Silicon |
| File | release/VaultDesk-1.2.7-arm64.dmg |
| Size | 124,915,789 bytes |
| SHA-256 | 9e1622bbac902d36bde9720092024526806a5065118fc3f55c537b9597235acd |
| app.asar SHA-256 | e5eaf0e7bf930b66b101fc390dfcf0ecc1abeafb51de48aa222f4024f8311b29 |
| CLI SHA-256 | 708cab69ee4309d8b66ab5183cd2ede573d714298a931535915204f8ac1266b6 |
| Signing | Ad-hoc, not notarized |

# VaultDesk v1.2.6 release

Status: published and installed on 2026-10-31. Release tag v1.2.6 points to 4515ca5093ffd92769063a35a0f4d12b3f1e4ad8. CI 41173511182 passed all three jobs; the public DMG download matched the locally tested artifact byte for byte.

Fixes shared-master and legacy-marker catalog false positives, distinguishes outdated distributions from intact current ones, and validates recorded symlink slot identity. Automatic sync now refreshes outdated skills and plugin targets after a manual Vault-only update, while preserving paused targets, review/frozen sources and manual edits. Agent guidance consistently separates managed file distribution, tool-owned installations, runtime prerequisites and agent activation. The previous user-specific automatic scan bypass was removed; prior explicitly authorized private uploads remain intact.

Validation: type checking, 174 tests in 28 files, CLI and 19 desktop E2E scenarios, 20 zero-violation axe scans, mounted-DMG launch/edit/persistence checks, and a real MCP stdio client query against the registered Vault. The live catalog verified 38 managed masters and 20 target-skill entries. See [the audit](AGENT-MANAGEMENT-AUDIT.md) for capability boundaries.

The installed app and bundled skill hashes match the final DMG. LaunchAgent reports version 1.2.6; repeated opens retain one GUI and one headless worker. The startup sync updated and distributed the VaultDesk skill, committed/pushed f421cb1 in the private Vault, and left a clean worktree with no ahead/behind commits. Its other sources reported seven current and nine skipped, with no errors. Only the latest app remains in /Applications; previous rollback copies were moved to Trash.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.6-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,633,938 bytes |
| SHA-256 | b3c20a0a0a563d177dddebe075aa0e02a90d50515e3c0207dcc9b6a43efaea19 |
| app.asar SHA-256 | f3d1f125d621b346046d54a57cbfcd2431b85a08def9759601f7413acd2c261a |
| Signing | Ad-hoc, strict verification passed; not notarized |

# VaultDesk v1.2.5 release

Status: published and installed on 2026-10-31. CI 41168361045 passed all three jobs and the downloaded DMG matched the local artifact. Live catalog validation then found shared-master/legacy-marker false positives, addressed by v1.2.6.

## v1.2.5 artifact

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.5-arm64.dmg |
| Platform | macOS, Apple Silicon (arm64) |
| Size | 124,630,440 bytes (118.9 MiB) |
| SHA-256 | 7744a3ef79a30bb79a969cbfbed3eb3923b0155177c4afa916922c47eb5d25df |
| app.asar SHA-256 | a973d5d8520c0c8efe9885834d2ca13c1328832a6391d1066b2db7a0b86df202 |
| Bundle ID | com.coderwang404.vaultdesk |
| Bundle version | 1.2.5 |
| Signing | Ad-hoc; strict signature verification passed |
| Notarization | None |

## v1.2.5 changes and verification

Agents gain a structured catalog of registered Vaults, ownership and update policies, skill master/target state, plugin targets, tool cards, and external skill ownership. A read-only MCP server exposes list/search/catalog/tool queries to agents that explicitly register it. Unknown runtime states remain unknown without agent-specific probes. Automatic updates now report plugin target drift even when the upstream is unchanged; sensitive paths and credential-like content are blocked from automatic commits.

`pnpm typecheck`, all 169 tests in 28 files, CLI and desktop E2E, and the mounted-DMG launch/edit/persistence test passed. The desktop suite covered 19 scenarios with 20 axe scans reporting zero violations. The installed 1.2.5 app matched the tested app.asar and ran one GUI plus one headless worker.

# VaultDesk v1.2.4 release

Status: published and installed on 2026-10-31. GitHub CI run 41156645007 passed all three jobs; the downloaded public DMG matches the locally tested artifact.

## v1.2.4 artifact

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.4-arm64.dmg |
| Platform | macOS, Apple Silicon (arm64) |
| Size | 124,621,660 bytes (118.8 MiB) |
| SHA-256 | 78c1791b5e3a7ff415d4ad915a4c98d8551a4925bea21ea5d3d9e098cdfa4e33 |
| Bundle ID | com.coderwang404.vaultdesk |
| Bundle version | 1.2.4 |
| Signing | Ad-hoc; strict signature verification passed |
| Notarization | None |

## v1.2.4 changes and verification

Python readiness checks prefer the user's Miniconda base interpreter in ~/miniconda3/bin, even when Finder supplies a system-only PATH. Explicit Python paths still override this default. The desktop hint and agent skill explain the choice; checks do not change the agent's PATH or replace Apple's Command Line Tools Python.

Type checking and all 154 tests in 26 files passed. CLI and all 19 desktop end-to-end scenarios passed, including accessibility. Regression coverage verifies a PATH without Conda and an explicit system-Python override. The mounted-DMG test passed signature, launch, edit, and persistence checks. The installed app is 1.2.4 with one GUI and one headless worker; its app.asar and bundled skill hashes match the tested bundle. The public release is https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.4.

# VaultDesk v1.2.3 release

Status: published and installed on 2026-10-30. GitHub CI run 41077448416 passed all three jobs; the downloaded public DMG and checksum matched the locally tested artifact.

## v1.2.3 artifact

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.3-arm64.dmg |
| Platform | macOS, Apple Silicon (arm64) |
| Size | 124,621,883 bytes (118.8 MiB) |
| SHA-256 | a590e36fe4b4303041316999d345b1a250086ec4b39a304686077826839ebda9 |
| Bundle ID | com.coderwang404.vaultdesk |
| Bundle version | 1.2.3 |
| Signing | Ad-hoc; strict signature verification passed |
| Notarization | None |

## v1.2.3 changes

- Tool cards gain explicit, profile-aware checks for Python, Python packages, Node.js, PATH executables, paths, environment presence, and reviewed file hashes. Runtime checks do not install or execute recorded tool commands.
- The desktop separates managed skill distribution from declared runtime readiness and agent-side integration. It now discovers MCP-capable plugin cards, opens external skill details correctly, and stores interpreter choices locally per vault.
- Fixed-argument, bounded asynchronous probes prevent tool cards from supplying arbitrary executable paths. Symlink-safe hash checks and regression tests cover the verification boundary.

## v1.2.3 local verification

Type checking and 154 unit tests in 26 files passed. CLI and all 19 desktop end-to-end scenarios passed, including both themes and accessibility. The mounted-DMG test passed signature, launch, edit, and persistence checks. The installed app has matching app.asar SHA-256 of 572efa81414b15f9fe882f9fbd07ddc3529fab3bd3544da6471ea8ed560e8248 and bundled agent skill SHA-256 of 43530813cd54b63d24897bd53624897171bc78120539adcfdddbc38b90f5a475. The LaunchAgent reports 1.2.3, with one GUI and one headless worker after repeated opens.

The release tag points to f58ebc47d87236f069c4eeb7bed51ad647c0455d. The published DMG was downloaded again and matched SHA-256 a590e36fe4b4303041316999d345b1a250086ec4b39a304686077826839ebda9. The Personal Skills Vault auto-sync then imported the new bundled VaultDesk skill, distributed it to the registered shared target, committed and pushed 7f4c459, and verified the target.

# VaultDesk v1.2.2 release

Status: published and installed on 2026-10-30. All three CI jobs passed;
the public release DMG and checksum were downloaded and verified.

## v1.2.2 artifact

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.2-arm64.dmg |
| Platform | macOS, Apple Silicon (arm64) |
| Size | 124,602,082 bytes (118.8 MiB) |
| SHA-256 | c53bf4e2a3b4369645c834e553f1ef7396956ef7053539e53d9f3de840f81351 |
| Bundle ID | com.coderwang404.vaultdesk |
| Bundle version | 1.2.2 |
| Signing | Ad-hoc; strict signature verification passed |
| Notarization | None |

## v1.2.2 changes

- When the macOS LaunchAgent is the only VaultDesk process, a standard Finder
  or Dock reopen launches a separate GUI instance. The worker stays active.
- A second-instance request recreates a closed GUI window, or focuses the
  existing one, with no duplicate window on repeated opens.
- Includes the v1.2.1 GitHub HTTPS-to-SSH transport fallback and the v1.2.0
  transactional skill synchronization features.

## v1.2.2 local verification

Type checking and 141 unit tests in 26 files passed. CLI and all 18 desktop
end-to-end scenarios passed; the new scenario covers reopening a closed GUI
window. The mounted-DMG test passed signature, launch, edit, and persistence.
The installed 1.2.2 app has a matching app.asar SHA-256 of
2fbe9bf38625978602372488549eaf90710d0fad6a2298cb38c41dbdc2527de1.
Its LaunchAgent ran independently after the GUI exited; ordinary open
restored exactly one GUI process, and repeated open did not create another.

# VaultDesk v1.2.1 release

Status: published on 2026-10-30. GitHub CI and downloaded DMG verification
passed. The installed worker worked, but a normal reopen routed to the worker
instead of a GUI; v1.2.2 fixes that issue.

## v1.2.1 artifact

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.1-arm64.dmg |
| Platform | macOS, Apple Silicon (arm64) |
| Size | 124,601,920 bytes (118.8 MiB) |
| SHA-256 | e63079c64d1a01ee8b8048f58a4c047b7dc67d574ce0211900d002eaa86528ca |
| Bundle ID | com.coderwang404.vaultdesk |
| Bundle version | 1.2.1 |
| Signing | Ad-hoc; strict signature verification passed |
| Notarization | None |

## v1.2.1 changes

- When a standard, credential-free GitHub HTTPS URL fails due to a network
  error, source checks and clones retry over GitHub SSH on port 443. A short
  cache avoids waiting on the same HTTPS outage for every source.
- Authentication failures and URLs containing credentials do not switch
  transport. Git error output redacts URL credentials.
- This patch preserves v1.2.0 source policies, transaction boundaries, and
  managed distribution behavior.

## v1.2.1 local verification

Type checking and 141 unit tests in 26 files passed. CLI and all 17 desktop
end-to-end scenarios passed, including headless sync and accessibility. The
mounted-DMG test passed signature, launch, vault edit, and persistence checks.
A real private Vault check and clone succeeded with an intentionally invalid
HTTPS proxy, proving the SSH 443 fallback. The previous live sync updated
and pushed four remote sources; all 15 registered targets verified afterward.

# VaultDesk v1.2.0 release

Status: published on 2026-10-30. GitHub CI and the downloaded release asset
were verified; the formal installed-app LaunchAgent check is deferred to v1.2.1.

## v1.2.0 artifact

| Field | Value |
| --- | --- |
| File | `release/VaultDesk-1.2.0-arm64.dmg` |
| Platform | macOS, Apple Silicon (`arm64`) |
| Size | 124,602,245 bytes (118.8 MiB) |
| SHA-256 | `ac1b8f1aa5adcf05ad9c65c34673eab67f3f494e9c77c28db87d61b5fabf9d57` |
| Bundle ID | `com.coderwang404.vaultdesk` |
| Bundle version | `1.2.0` |
| Signing | Ad-hoc; strict `codesign --verify --deep --strict` passed |
| Notarization | None |

## v1.2.0 release notes

- Adds a macOS login-session worker that checks all registered vaults after login,
  after observed network recovery, and hourly, even with the app window closed.
- Applies remote Git updates per source across the vault, `~/.agents/skills`, and
  registered targets, with rollback on conflict, limited backups, explicit-path
  commits, normal push, and guarded retry of a failed push.
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
(25 files, 139 tests). CLI and desktop E2E passed separately; the desktop suite
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

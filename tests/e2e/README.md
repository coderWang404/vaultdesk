# End-to-end coverage

These suites drive the built CLI, the real Electron app, and the packaged DMG.
They use real Git, a real filesystem, and the real desktop binary. Only the
environment seams listed below are substituted.

## Running

```bash
pnpm test:e2e                 # build, then CLI and desktop suites
pnpm test:e2e:cli             # build, then CLI suite
pnpm test:e2e:desktop         # build, then desktop suite
pnpm test:e2e:dmg             # package, mount, install and launch the DMG
```

Environment variables:

| Variable | Effect |
| --- | --- |
| `E2E_ONLY=<substring>` | Desktop suite only; runs scenarios whose name contains the substring. |
| `KEEP_E2E=1` | Keep temporary workspaces and print their paths, including on success. |
| `E2E_REAL_GITHUB=1` | Adds the public GitHub scenario to the CLI suite. |
| `E2E_REAL_GITHUB_REPO` / `E2E_REAL_GITHUB_PATH` | Override the public repository and skill path used by that scenario. |
| `ELECTRON_MIRROR` | Electron binary download mirror for packaging when GitHub releases are unreachable. |

Failed scenarios save a screenshot under `tests/e2e/artifacts/` and keep their
workspace. Successful scenarios delete their workspace. The suites require a
macOS desktop session; the default suites need no network.

## CLI scenarios

| Scenario | Coverage |
| --- | --- |
| Help, version, JSON envelope and usage errors | Human and JSON output, envelope shape, usage exit code, built-in presets, bundled agent skill, preset verify preview and confirmed run. |
| Init, status, validate, imports and build | Init preview/apply, status, validation, standalone/collection/package imports, generated build output. |
| Target install, verify, remove, restore | Preview plan, unmanaged backup, symlink replacement, marker files, drift verification, reinstall, unregister, re-register, backup restore. |
| Git status, explicit-path commit and push | Status, staged-file preservation, commit limited to named paths, preview gate, push to a real bare remote. |
| GitHub add, check, diff, update, fork, remove | Pinned commit, sparse checkout, upstream check, zero/real diffs, dirty-working-copy guard, review-before-apply update, commit, fork, source removal. |
| v1 read-only guards and migration | v1 reads, write refusal, recents, migration preview/apply on a branch, clean/dirty gates, commit contents. |
| Network and auth exit codes | Offline exit code, missing and wrong Basic credentials, token-authenticated private flow, update plus target install, credential hygiene, SSH URL rewrite. |
| Locks, stale reclaim and journal recovery state | Live cross-process lock, dead-PID/corrupt/aged lock reclaim, journal exposure in status, non-blocking reads, journal retention. |
| SIGKILL mid-import leaves journal and stale lock | Sends SIGKILL to a real CLI process while the import journal has a running step; verifies the surviving journal, running step, lock PID, human/JSON status warning, and that read-only status does not clear it. |
| Unicode paths, symlinks and 120-skill scale | Vault, source, target and skill names with spaces and Chinese characters; symlinked inputs; import, install, verify, build and validate at 120 skills. |
| Vault on an external APFS volume | Init, import, explicit-path commit and managed install on a mounted APFS disk image. |
| Real public GitHub clone, check and diff (opt-in) | HTTPS clone of a public repository and subdirectory, pinned lock commit, check, zero diff, validation. |

## Desktop scenarios

| Scenario | Coverage |
| --- | --- |
| v1 read-only open, validation, guard, recents | Opens a v1 fixture, shows read-only state, validates, blocks writes, records recent vaults. |
| Migration blocked when dirty, then applied | Dirty-tree refusal, migration dialog, preview, apply, resulting v2 files. |
| Create vault, local imports, edit, explicit commit and push | New vault, three import shapes, editor save, explicit commit path list, push. |
| GitHub import, check, diff, guarded update, fork | Import dialog, source row state, diff view, update confirmation, install refresh, fork into a local skill. |
| Install, backup, verify, restore, remove and re-register target | Full target lifecycle through the UI, including unmanaged and symlink slots, backups, drift, restore and orphaned backups. |
| Cross-vault search, settings validation and persistence | `Cmd+K` palette across two vaults, keyboard selection, jump to skill, settings validation and restart persistence. |
| Boot auto-check honors the 24h interval | Recent timestamp skips the boot check; a 25-hour-old timestamp triggers it and refreshes state. |
| Auto-check runs once per vault per session | Two authenticated remotes: boot vault A, first activation of B, no repeat when switching back, manual check still reaches the server, roving tab keyboard navigation, titlebar close. |
| Slow check, offline warning and journal recovery | Slow authenticated check, offline failure message, persisted source error, recovery banner lifecycle, no rollback of working files. |
| Custom tool preset under a sandboxed HOME | Custom preset file, verification badge, bundled agent skill panel, verify-command preview and confirmed run with output, preset chip destination, install into a sandboxed `~`. |
| 120-skill vault renders and searches | 120 rows render under 20 seconds, local filter narrows and clears, palette search selects a skill. |
| axe accessibility, focus trap and focus restore | Six views scanned with axe-core, palette and modal Tab traps, Escape close, focus restoration. |

## DMG scenario

The packaged-app scenario:

1. Verifies the DMG with `hdiutil verify`, mounts it read-only, checks
   `VaultDesk.app` and the `Applications` link, copies the app out with `ditto`,
   and detaches the image.
2. Checks bundle identifier, version, architecture, `app.asar`, the packaged
   `agent-skill/vaultdesk/SKILL.md`, signature state, notarization state,
   Gatekeeper assessment and absence of a quarantine flag on the locally built
   artifact.
3. Launches the copied binary with Playwright, opens a v2 fixture, checks source,
   skill and target counts, validates the vault, checks the Settings agent-skill
   panel path, edits a skill, confirms the file on disk and in `git status`,
   exits, and confirms the edit persists.

If the app carries a Developer ID signature, the scenario requires strict
`codesign` verification and a stapled notarization ticket. An ad-hoc build logs a
warning instead of pretending to be a signed release.

## Real and simulated inputs

- **Real:** Electron binary, CLI build, Git CLI, bare repositories, filesystem,
  APFS disk image, DMG tooling, packaged `.app`.
- **Local smart HTTP:** a Node server authenticates Basic credentials and serves
  repositories through `git http-backend`; it also injects delay and simulates an
  offline upstream. Credentials are supplied through the remote URL and are
  checked to stay out of vault metadata and reports.
- **SSH:** `GIT_SSH_COMMAND` and URL rewriting route an `ssh://git@...` URL to a
  local upload-pack invocation. This covers URL and transport plumbing, not a
  real SSH daemon.
- **Desktop dialog seam:** `VAULTDESK_TEST_DIRECTORY_FILE` supplies the path that
  would come from the native directory picker. The vault operation after the
  picker is the real one.
- **Journal and lock fixtures:** recovery banners and stale-lock variants are
  seeded directly so each state is deterministic.

## Deliberate limits

| Limit | Why it is not exercised here |
| --- | --- |
| Real private GitHub repositories, PATs, 2FA or OAuth | No credentials are stored in the repository. Local smart HTTP exercises the same Basic auth header, 401 handling and token hygiene; GitHub-side 2FA and OAuth flows are not implemented by the app. |
| Developer ID signing and notarization | No Apple Developer identity or notary credentials are available. The build is ad-hoc signed; the DMG test enforces the stricter checks when a Developer ID signature is present. |
| Browser quarantine and `/Applications` install | A locally built DMG has no quarantine xattr. The test copies into a temporary install directory rather than `/Applications`, so the first-launch Gatekeeper prompt for a downloaded DMG is not reproduced. |
| iCloud Drive, SMB/NFS or other network filesystems | No reproducible share is available. An external APFS disk image covers a non-home mount, but not iCloud eviction or network latency/failure semantics. |
| macOS version and CPU matrix | Verified on the host macOS arm64 version only. No Intel build and no macOS 13/14/15 matrix are run. |
| Wall-clock 24-hour checks, sleep/wake and periodic scheduling | The product checks once per vault per app session, with a 24-hour boot gate; there is no periodic timer or sleep/wake handler. The gate is tested by rewriting persisted timestamps, not by waiting 24 hours. |
| Automatic recovery from a crash | No automatic rollback exists by design. The SIGKILL scenario proves journal and lock survival plus status reporting, but not resuming the interrupted import or reconciling partial files; that remains an operator decision. |
| Real SSH daemon, proxy, custom CA or TLS interception | Transport tests use loopback HTTP and a rewritten SSH command. Enterprise proxy and certificate behavior is not covered. |
| VoiceOver and manual accessibility | Coverage is axe-core WCAG A/AA checks plus keyboard focus tests. No human screen-reader session is recorded. |
| Very large repositories | Scale coverage stops at 120 skills. Multi-thousand-skill vaults, large binaries and multi-gigabyte histories are not benchmarked. |
| Native file picker UI | The dialog choice is injected. The AppKit panel itself is not automated. |
| Auto-update channel | Not implemented in this release. |

## Last verified

2026-10-27, macOS arm64 host:

- `pnpm test`: 13 files, 55 tests passed.
- `pnpm -r typecheck`: 4 workspace projects passed.
- CLI suite: 12/12 default scenarios passed. The opt-in real public GitHub
  scenario was last verified on 2026-10-26 at commit `dbd4588f9e10`.
- Desktop suite: 13/13 scenarios passed; axe reported 0 violations across seven
  views; 120-skill rendering completed in 731 ms.
- DMG suite: passed for `VaultDesk-1.0.0-arm64.dmg` (120.6 MB); bundle version
  1.0.0, packaged agent skill present, ad-hoc signature and missing
  notarization reported as warnings, Gatekeeper accepted the app with the host's
  security assessment disabled, and the edited skill persisted after exit.

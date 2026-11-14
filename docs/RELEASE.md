# VaultDesk v1.2.18 release

Local acceptance and installation completed on 2026-11-14. Release artifacts: [v1.2.18](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.18).

The Tools and MCP pages now organize records into a readable inventory. A summary strip shows totals and capability counts; type filters narrow the list; groups separate CLI, MCP, plugin and other records. When a Vault contains more than three cards, each card keeps its title, summary, readiness state and primary run command visible while installation details, checks, requirements, related skills and links stay collapsed until requested. “Expand current results” and “Collapse current results” work with the active filters, and each Vault/mode remembers its card expansion state.

The installed app, CLI and LaunchAgent report 1.2.18 with one GUI and one worker; the previous 1.2.17 app was moved to Trash.

The change is presentation-only: tool cards remain record-only, readiness checks remain explicit, related-skill navigation remains available, and MCP-capable plugins continue to explain that agent registration must be verified in the corresponding agent. The compact layout was checked with a real five-card Vault screenshot and both theme/accessibility regressions.

Validation: workspace typecheck, production build, 12 CLI E2E scenarios, all 25 desktop E2E scenarios, 20 axe scans with zero violations, and mounted-DMG app/CLI/MCP acceptance passed. The Apple Silicon DMG is ad-hoc signed and not notarized.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.18-arm64.dmg |
| Size | 124,953,902 bytes |
| SHA-256 | 5e5102358542a53ac3881b492a3d2f6b8b6b9b71100d4b6df371e7044f9f334e |
| app.asar SHA-256 | b4afd48b2dcaca84d98b57e9087a9e052dc40d37c95cd61ec5d8dbec2dc9c5e0 |
| CLI SHA-256 | e7088772d5d4e3a36dddf6db225a738c8ac048c6ca3158b997318a649e8bde4d |
| Signing | Ad-hoc, not notarized |

# VaultDesk v1.2.17 local build

Built, accepted and installed locally on 2026-11-11. The source is pushed to main; it is not tagged or published, so the latest public release is still [v1.2.16](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.16).

This is a reliability release. Reinstalling over a managed copy that was edited in place now saves that copy first, and only the newest saved copy of each skill is kept. A source whose shared master was edited can be distributed again with `source distribute <name> --force --yes` (or the confirm-and-retry prompt in the desktop app), which saves the edited copy before replacing it. Removing a source also removes the files this Vault distributed for it, unless `--keep-distributed` is passed; paths the Vault cannot prove it owns stay in place.

Locks left by a crashed process are reclaimed as soon as their owner is gone, including when the operating system has reused the process ID. Relative symlinks inside skills survive build, install, distribution and update unchanged, and imports reject symlinks that are broken or point outside the skill. Crashed builds no longer leave staging directories behind. Upstream checks retry once on a network failure and the background worker re-runs about five minutes later, up to three times in a row. The activity log is capped at its newest 1000 lines, background runs no longer record sources that have nothing to do by design, and a Vault with unpushed commits now says why automatic updates are paused and how to resume. `vault status` reports the correct format for v2 vaults.

Validation: workspace typecheck, 220 tests in 33 files, 12 CLI E2E scenarios, all 25 desktop E2E scenarios, 20 axe scans with zero violations, and mounted-DMG app/CLI/MCP acceptance passed. Unit tests now redirect every default VaultDesk directory to a temporary root.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.17-arm64.dmg |
| Size | 124,937,632 bytes |
| SHA-256 | 0f7d11e706674e0e8bcf6744e492ce514d04647cfa8e4a9e25194d6f6a6f50d8 |
| app.asar SHA-256 | c7eaad236c059b475499081b88a4c10c54779e1b6913cba1284ec5066feee3d7 |
| CLI SHA-256 | 6548f3a624e9161baa0a0f00681918d6b51f468b637e8fa696b6e238bdb20cff |
| Signing | Ad-hoc, not notarized |

The installed app, CLI and LaunchAgent report 1.2.17 with one GUI and one worker. The previous app was moved to Trash. The real private Vault validated with zero errors or warnings and all 34 registered targets verified with nothing missing or modified.

# VaultDesk v1.2.16 release

Local acceptance and installation completed on 2026-11-09. Release artifacts: [v1.2.16](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.16).

VaultDesk paints usable controls immediately and loads optional startup metadata independently. Vault opening, reloading, validation and search run on a lazily started worker thread, with bounded waits and recovery after errors. Loading completion preserves navigation to Settings. Request ordering protects the active opening and recent list.

Directory hashes are reused within each read snapshot using canonical paths and exclusion policies. Shared target directories and symlink aliases are hashed once per snapshot. Later reads and mutation validation remain fresh; no persistent cache or mtime shortcuts are used. A real local Vault reduced reads from 135,014 / 552 MB to 27,706 / 109 MB, with core load time falling from about 2.6 s to 0.8 s. During desktop reload, app.info responded in under 1 ms compared with 2,492 ms before. Cold complete loading can still take seconds; the window is usable while it runs. Detailed observations are in docs/QA-CURRENT.md.

Validation: workspace typecheck, 200 tests in 32 files, 12 CLI E2E scenarios, all 25 desktop E2E scenarios, 20 axe scans with zero violations, and mounted-DMG app/CLI/MCP acceptance passed. The large-directory regression checks responsiveness during hashing, startup navigation and fresh external edits. Tests used isolated Vaults and hidden windows.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.16-arm64.dmg |
| Size | 124,925,230 bytes |
| SHA-256 | 9622fdfa8a5dde9375b957fd86a496891eeac454ebbd8a537e9d00f53fed15e9 |
| app.asar SHA-256 | 9a87a2ffaec257546e22d6d4d3d28c1e12533ae8afb736d76d016aa1bee8eae1 |
| CLI SHA-256 | f009b080476317848b13e1d3dffa76897d123a9d443f07b3d4c411820dab2b73 |
| Signing | Ad-hoc, not notarized |

The installed app, CLI and LaunchAgent report 1.2.16 with one GUI and one worker. The previous app was moved to Trash.

# VaultDesk v1.2.15 release

Local acceptance and installation completed on 2026-11-05. Release artifacts: [v1.2.15](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.15).

Skill-library suite and collection headers now expand/collapse with click, Enter or Space, with expand/collapse-all controls. Fold preferences persist on this computer per Vault. Search and filters reveal matching groups while retaining the saved unfiltered preference; global search reveals its selected skill, including a previously selected hidden member. Folding preserves checked skills and their header counts, and filtered bulk distribution keeps its exact scope. Removed redundant checkbox-label text that wrapped vertically at narrow widths.

Validation: workspace typecheck, all 24 desktop E2E scenarios, final folding regression, narrow light/dark expanded/collapsed axe scans, screenshots, and mounted-DMG app/CLI/MCP acceptance passed. Tests used isolated Vaults and hidden windows.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.15-arm64.dmg |
| Size | 124,943,410 bytes |
| SHA-256 | c2926694f970ddb4829b13de0603ee8ec08b18006faf6ec1d9fe9a2e362e0540 |
| app.asar SHA-256 | b146ae43f909acd7edf18556b4754d1add6df0b2ac295deb651b140fc2cda5da |
| CLI SHA-256 | 7006fec08593dae6982491a78085065ec64bae542ced1fdefcc904cc51d5265c |
| Signing | Ad-hoc, not notarized |

The installed app, CLI and LaunchAgent report 1.2.15 with one GUI and one worker. The previous app was moved to Trash.

# VaultDesk v1.2.14 release

Local acceptance and installation completed on 2026-11-05. Release artifacts: [v1.2.14](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.14).

The update dialog now gives the file list and patch independent, bounded scroll areas, keeping update options below them. Patch scrolling supports the keyboard; line numbers and dark-theme notifications have readable contrast. Commit-message input appears only when committing, and copy distinguishes a local commit from a push.

Sources and Settings explain automatic, review and paused modes. Bulk preview/apply excludes paused sources; an explicitly named manual update remains available without changing the source mode. Overview counts follow the same pause policy. Automatic commit scanning checks complete credential values rather than prefixes of credential-reading expressions, while keeping literal/private-key/generated-file protection.

Validation: workspace typecheck, 195 tests in 30 files, 12 CLI E2E scenarios, all 23 desktop E2E scenarios, dual-theme axe checks, and mounted-DMG app/CLI/MCP acceptance passed. A plugin-adoption unit fixture now isolates its backup/lock/pending directories from the user's background worker. Desktop windows stayed hidden.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.14-arm64.dmg |
| Size | 124,947,662 bytes |
| SHA-256 | 2dfb87e54bd7b3a4d2b6251e006285b1985b90cbb2add725aa727d5ded5137e7 |
| app.asar SHA-256 | 884ecad2aa9161dc198448830d772e932a6b2da915deb145ad47e1833f7d97eb |
| CLI SHA-256 | c6a008052d1f0185ba20424b5ef840a450ee1079a56f19b8743c7f6802f91c38 |
| Signing | Ad-hoc, not notarized |

The installed app, CLI and LaunchAgent report 1.2.14, with one GUI and one worker. The previous application was moved to Trash. The real private Vault validated with zero errors/warnings; intended frozen/uninstalled skills stayed paused, and the previously blocked PPT Master automatic update completed and pushed successfully.

# VaultDesk v1.2.13 release

Status: published and installed on 2026-11-02. Commit `14232f34507a62f493ebedead35004dff93b66a9` is tagged `v1.2.13`; GitHub CI run `41421794367` passed all three jobs. The public DMG and SHA-256 file are available from the [GitHub Release](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.13); the DMG was downloaded again and matched the tested artifact byte-for-byte.

The global “Distribution management” destination has been removed. Registered target verification, backup, sync and removal now live inside the Skills section under “Distribution targets”. Selecting a skill through global search from that area returns to the skill library before opening its details. Target records and distribution behavior are unchanged.

Validation: workspace typecheck, 188 tests across 30 files, CLI E2E, all 22 desktop E2E scenarios, 300-skill batch selection, zero axe violations, and mounted-DMG app/CLI/MCP acceptance passed. E2E windows remained hidden.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.13-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,948,435 bytes |
| SHA-256 | 7eaa3d1f2f4932cfbbfbb9cbd2d7aa356849d97c73e41b137b3f0aa6d05cb7ee |
| app.asar SHA-256 | 4f2dd05f73ef4cd18bfb0a8771a458e5dce4fef2b790a85548277163017a1971 |
| CLI SHA-256 | 4af16ad911f2519071eb81f9be30dfa341b4e219aef8de2e5ba154fa7b41bcbd |
| Signing | Ad-hoc, not notarized |

The installed `/Applications/VaultDesk.app`, bundled CLI and LaunchAgent report v1.2.13. Installed `app.asar` matches the tested DMG hash; exactly one GUI process and one background worker are running. The previous app was moved to Trash.

# VaultDesk v1.2.12 release

Status: published and installed on 2026-11-02. Tag `v1.2.12` points to `d025affbc91df1a74167ae7deb8f0c45d97d56c9`. GitHub CI run `41400137641` passed all three jobs; the public DMG and SHA-256 asset were uploaded to the [GitHub Release](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.12), downloaded again and matched the tested package byte-for-byte.

The Skills page is now the primary distribution entry point: select one skill, several skills, or the current filtered results, then choose an existing target or create a new one. Source groups remain visible and externally managed skills stay read-only. “Distribution management” is dedicated to registered-target verification, backups, sync state and removal; its empty state links directly to skill selection. Overview and inspector actions now lead into the same workflow.

Validation: 30 test files / 188 tests, workspace typecheck, all 22 desktop E2E scenarios, batch selection with 300 skills, zero axe violations, and mounted-DMG app/CLI/MCP acceptance passed. Desktop test windows stay hidden so the user's desktop remains available.

The installed `/Applications/VaultDesk.app`, bundled CLI and LaunchAgent report v1.2.12. Installed `app.asar` matches the tested DMG hash; exactly one GUI process and one background worker are running. The previous app was moved to Trash.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.12-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,943,513 bytes |
| SHA-256 | f10cc24807a0426240ab29b27f6aa50fc6ff17cee6a19af42ee070974cc99a0d |
| app.asar SHA-256 | 1ec4798b849a3228ad97cddf85d6fe0e5d3d3eb845e271b715328dbfcee8412c |
| CLI SHA-256 | d51cd59e72f1e0cc39824aca3a6ad46e44ab72dc080c12416d8816ba528bb563 |
| Signing | Ad-hoc, not notarized |

# VaultDesk v1.2.11 release

Status: published and installed on 2026-11-01. Commit `a8f4733` adds bounded batch skill rendering, O(1) selection/index lookups, renderer error recovery, and hidden-window E2E execution.

Validation: 30 test files / 188 tests, desktop typecheck, full desktop E2E with 300-skill batch selection and zero axe violations, mounted DMG launch/edit/persistence, and bundled CLI/MCP stdio acceptance passed. GitHub CI run `41268633957` passed all three jobs.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.11-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,927,595 bytes |
| SHA-256 | fcf75ce4eb70cc9deb64a0f6b75371f62924a0af048a2826fc776c8a54341ef0 |
| app.asar SHA-256 | c45c8630d19d696e076474560a68c152df892ccb3357d57ca0d958260890044b |
| CLI SHA-256 | 890ef91f6104d42a3c16741898e7917eef5f18f2c65d70234077a6355bb5080a |
| Signing | Ad-hoc, not notarized |

# VaultDesk v1.2.10 release

Status: published and installed on 2026-11-01. Tag v1.2.10 points to 4f858aa27abd2adb1cacbea6f32197d16e729f93. GitHub CI 41262440911 passed all three jobs. This patch clarifies the boundary between external tool cards and VaultDesk-managed plugin sources. REA remains a `tools/rea.yml` tool card: `kind: plugin` means its upstream agent-plugin distribution form, while `cli` and `mcp` tags expose its capabilities. The desktop UI now calls it “Tool suite”, shows those capabilities, and states that VaultDesk records official setup without installing or enabling the tool.

Validation: 188 tests in 30 files, desktop typecheck, production build, desktop E2E with zero axe violations, mounted DMG launch/edit/persistence, and bundled CLI/MCP stdio acceptance passed.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.10-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,919,328 bytes |
| SHA-256 | bf764c069654adf6e7868b9b1f99df2bb52255d61f2ed2fc67a7c44b4d5fd22d |
| app.asar SHA-256 | 54204ff94976e96d7f16a2b1a7353b816c3b42e107f9c76885c406b356b10ac9 |
| CLI SHA-256 | 26ac6288d2d042c26a3770826d5ec12c45ce5ec0cf351192f96b655e46b26e94 |
| Signing | Ad-hoc, not notarized |

# VaultDesk v1.2.9 release

Status: published and installed on 2026-10-31. Tag v1.2.9 points to f34851dadc6e3f8ee537e756c520a9d523c76e1d. CI 41203860175 passed all three jobs, and the public DMG download matched the tested artifact byte for byte.

Installation targets are grouped by their canonical destination directory. Group headers show agent/preset names, one shared path, unique skill counts and rule status; compact rows preserve independent target identity and installation actions. Other managed directory entries appear once per group. Search covers agents, skills, sources, rule IDs and paths, with separate attention/paused filters and keyboard-accessible group collapse. Search and filter changes reveal matching rules. File verification results are bound to the snapshot checked so they cannot survive a stale refresh or vault switch.

Validation: type checking, 188 tests in 30 files, CLI E2E, 22 desktop scenarios, 24 zero-violation axe scans and mounted-DMG launch/edit/CLI/MCP acceptance passed. A regression also covers repairing a modified file outside the app: verification refreshes the snapshot and removes its stale attention state. Home abbreviation uses the actual home path rather than assuming every /Users directory belongs to the current user.

The installed app, CLI and LaunchAgent report 1.2.9, with one GUI and one worker. Installed app.asar/CLI hashes match the tested DMG; the previous app was moved to Trash. The live Personal Skills page shows four destination groups, 17 independent rules and 11 unique registered skills, with Qoder expanded. Its 38 master skills and 20 target-skill entries are current; REA ownership remains external. Startup synchronization pushed e397b7e in the private Vault, leaving it clean and synchronized.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.9-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,918,885 bytes |
| SHA-256 | 0b04a6440b61d591aee125f85cdd494eef8ef83858d5ab555684461b1be3a559 |
| app.asar SHA-256 | 8f6d0b05d89a4aced0db5b551c772be83106b04de7b90609af7044d0a8af7b01 |
| CLI SHA-256 | cb02f66053c056765884aa783ed5692ddc7c302eeaeb357b7db1853fbfd2b93b |
| Signing | Ad-hoc, not notarized |

# VaultDesk v1.2.8 release

Status: published and installed on 2026-10-31. Tag v1.2.8 points to 5454d03ed510bb85460b5b81acf36db1a888410e. CI 41185992856 passed all three jobs, and the public DMG download matched the locally tested artifact byte for byte.

Reinstalling a registered target now keeps its destination, ID and registered skills fixed. A separate Add skills action selects only new entries, while installation from skill/source details keeps that context. Search remains available for general and additional-skill selection. A single confirmation action follows preview.

Desktop selections persist as exact skills with `skills_only: true`; CLI agents can request the same behavior with `--skills-only`. Legacy source selectors remain compatible. Exact targets do not expand a same-named source during reload, distribution or later reinstallation. Existing paused synchronization is preserved, and a target ID/destination mismatch is rejected before any file is replaced.

Type checking, all 188 tests in 30 files, CLI E2E, 21 desktop scenarios, 22 zero-violation axe scans, and the mounted-DMG launch/edit/CLI/MCP acceptance passed. The actual qoder:paper-reading target was opened in the installed app: its compact reinstall dialog and preview contain only paper-reading, with the original path fixed. The preview was cancelled without reinstalling the skill.

The app, bundled CLI and LaunchAgent report 1.2.8, with one GUI and one headless worker. Installed app.asar and CLI hashes match the tested DMG; the previous app was moved to Trash. Startup sync updated the managed VaultDesk skill and pushed c551fb0 in the private Vault, leaving a clean worktree with no ahead/behind commits. Its 38 master skills and 20 target-skill entries are current; REA ownership remains external.

| Field | Value |
| --- | --- |
| File | release/VaultDesk-1.2.8-arm64.dmg |
| Platform | macOS Apple Silicon |
| Size | 124,916,056 bytes |
| SHA-256 | f8c540a6abc587c5ad1449acb16e3833233afba62eb4ba9f2baf563fd3a69f61 |
| app.asar SHA-256 | dc09e6e65e3b7d4d8980b2825e9a31aa4be78f1bc9508612251545df2d782022 |
| CLI SHA-256 | 87b6aed000c62a96cf1961ae831b9379fd1e72c10fbd7e094fd7b9d1c9629bd6 |
| Signing | Ad-hoc, not notarized |

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

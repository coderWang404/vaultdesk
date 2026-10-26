# VaultDesk

A local-first manager for agent skills and plugins, built for macOS.

VaultDesk treats a Git repository as the source of truth for your skills, and
turns install destinations into rebuildable artifacts. It shows what you have,
where it came from, which commit it tracks, and where it is installed. Updates
are reviewed as diffs before anything is written.

The desktop app and the CLI share one TypeScript core, so both report the same
facts and apply the same rules.

## Status

0.6.0 is a developer preview of the 0.x line. The desktop app and CLI support:

- opening v1 and v2 vaults in parallel tabs, with validation and status
- checking upstream commits and reviewing per-file diffs
- review-before-apply updates for local and GitHub sources
- migrating a v1 vault to v2 on a separate branch, with a deterministic preview
- installing skills into explicit target directories, with slot classification,
  timestamped backups, verification, and restore
- editing local skills and forking GitHub skills into local copies
- importing standalone skills and multi-skill packages from disk or GitHub
- metadata search across all open vaults
- explicit Git commit and push limited to the paths VaultDesk changed

Builds are unsigned and not notarized. All write operations preview first: the
app requires an explicit confirmation, and the CLI requires `--yes`.

## Safety model

- The vault is the source of truth; install destinations are disposable copies.
- Network fetches happen in a cache outside the vault. Nothing is written until
  the preview is confirmed.
- GitHub-origin skills are read-only until forked.
- Unmanaged directories are never overwritten. They are moved to a timestamped
  backup first, and VaultDesk keeps the ten most recent snapshots per target.
- Git commits include only the paths VaultDesk changed. It never runs
  `git add -A`, and it refuses paths outside the vault or under `.git`.
- The Electron renderer has no Node access. Filesystem, Git, and network work
  happens in the main process behind zod-validated IPC. There is no local HTTP
  server.
- Update checks are throttled to once every 24 hours on startup.

## Requirements

- macOS 13 or newer (Apple Silicon or Intel)
- Node.js 22+ and pnpm 11 to build from source
- Git on `PATH` for GitHub-backed sources

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev            # Electron app
pnpm cli -- --help  # CLI from source
```

Build the workspace packages and run the CLI:

```bash
pnpm build:packages
node packages/cli/dist/index.js vault status --vault /path/to/vault
```

Run the Electron smoke test (builds the app, opens a temporary copy of the v2
fixture, and writes `apps/desktop/smoke.png`):

```bash
pnpm --filter @vaultdesk/desktop smoke
```

Build the unsigned DMG into `release/`:

```bash
pnpm package:mac
```

On first launch, right-click the app and choose Open, or allow it in
System Settings → Privacy & Security. The build is ad-hoc signed but not
notarized.

## CLI

Read commands never write. Write commands print a preview unless `--yes` is
passed. Every command supports `--json`, which returns one envelope with
`schema`, `command`, `data`, `warnings`, and `errors`; exit codes are `0`
success, `1` operation failed, `2` usage or validation, `3` network or auth.

```bash
vaultdesk vault status --vault ~/skills
vaultdesk vault validate --vault ~/skills
vaultdesk vault migrate --vault ~/skills            # preview only
vaultdesk source check --vault ~/skills             # read-only upstream check
vaultdesk source update --vault ~/skills some-source
vaultdesk target install local-notes --vault ~/skills --dest ~/.claude/skills
vaultdesk target verify my-agents --vault ~/skills
vaultdesk git commit --vault ~/skills --path vault.lock --message "update lock"
```

## Vault layout (v2)

```text
vault.yml
vault.lock
sources/<name>.yml
skills/<name>/
packages/<pkg>/skills/<skill>/
third_party/
build/skills/<name>/
.vault/state.json
```

`.vault/state.json` is local machine state and is gitignored. Installation
targets live in `vault.yml`; VaultDesk writes a `.vault-managed` marker into
every managed slot so it can distinguish its own copies from unmanaged files.

See [docs/DESIGN.md](docs/DESIGN.md) for the data model, safety rules, CLI
contract, and release plan.

## Known limits

- macOS only; no Windows or Linux desktop build.
- No signed or notarized release, no auto-update channel.
- SkillDeck lockfile interoperability, custom verification commands, and a
  packaged agent skill are not implemented yet.
- The CLI is built from this repository; it is not published to npm at 0.6.0.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

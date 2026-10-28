---
name: vaultdesk
description: Manage a VaultDesk vault and its skills, plugins, external tool cards, and tool-managed skill records through the `vaultdesk` CLI. Use when the user asks to inspect vault status, import or update skills, install skills into agent directories, review plugin contents, look up a recorded tool's official install method, decide whether a skill belongs to the vault or to its tool, validate a vault, or recover an interrupted operation.
---

# VaultDesk

VaultDesk stores skills, plugin roots, external tool records, and tool-managed skill observations in a Git-backed vault. The CLI and the desktop app share one core, so `--json` output is the stable contract. Inspect first, preview writes, and apply only after the user approves the change.

## Inspect first

- `vaultdesk --vault <path> vault status --json`
- `vaultdesk --vault <path> source list --json`
- `vaultdesk --vault <path> plugin list --json`
- `vaultdesk --vault <path> tool list --json`
- `vaultdesk --vault <path> tool list --kind mcp --json`
- `vaultdesk --vault <path> external list --json`

Omit `--vault` when the current directory is the vault.

## Boundaries

- VaultDesk stores and validates plugins; it does not install, enable, or adapt them. If the user wants a plugin active, follow that agent's current plugin rules yourself. Never run plugin hooks.
- A plugin does not need a manifest. VaultDesk also recognizes `skills/<name>/SKILL.md` plus MCP, commands, agents, hooks, rules, or workflows. When `manifests` is empty, plan the install from `assets` and `containedSkills` in the agent's own configuration.
- Tool cards are records, not installations. VaultDesk never downloads, installs, or runs them. Follow the card's `homepage` and `docs`, then use the agent's own rules; never claim VaultDesk installed, enabled, or registered anything.
- MCP servers are tool cards with `kind: mcp`. VaultDesk does not register, start, or health-check them and does not write agent MCP configuration; registering the server is your job when the user asks.
- External skills are owned by their tool. VaultDesk records the path and observes hash/status; it never installs, updates, runs, or writes the owning tool or that path. Never claim VaultDesk synced their content.
- One owner per path. A path with a `.vault-managed` marker belongs to a vault install; never add it as external, and never adopt a path whose marker belongs to another vault.
- Never put tokens, API keys, private URLs, or other secrets in a tool card, an external skill card, or any vault file.
- Never edit `third_party/<name>/`; it is the pristine upstream copy. Edit `plugins/<name>/` only when the user explicitly asks, and expect update conflicts until the change is forked or discarded.
- GitHub-origin skills are read-only until forked with `source fork`. Do not hand-edit their working copies.
- Do not pass `--yes` without the user's explicit approval of the preview or diff. Show them what will change.
- Do not commit or push unless asked. Commit explicit paths only; never `git add -A`.
- Plugin content cannot be installed with `target install`; install skills only.
- `target verify` proves expected files exist and hashes match. It does not prove an agent loaded a skill.

## Common tasks

### Update sources

1. Run `source check --json`.
2. For each source with updates, run `source diff <name>` and summarize the files.
3. After approval, apply with `source update <name> --yes`; add `--commit` only when asked.
4. For plugins, tell the user the agent-side copy was not touched and must be reinstalled through the agent.

### Install skills

1. Run `target list --json` or read the targets in `vault.yml`.
2. Preview with `target install <skill...> --dest <dir> --id <id>`.
3. After approval, repeat with `--yes`.
4. Verify with `target verify <id>`.

### Import

Before importing anything, decide who owns the path:

- **The tool ships the skill and rewrites or validates it.** Do not import it as a source. Record an external card instead. REA's bundled skill is this case.
- **VaultDesk should own editing and installs.** Import it as a normal source.
- **The user needs an independent copy.** Fork it to a new path and name; leave the tool's copy alone.
- **The path already has a `.vault-managed` marker.** Another owner exists. Stop and report it; do not import over it.

Steps:

- `source add <path>` previews a local folder; `source add --repo owner/name` previews a GitHub repository.
- Review the detected shape (standalone, package, plugin) and target paths before applying with `--yes`.
- `--plugin` forces plugin registration; `--no-plugin` stores the folder as a skill or package. They are mutually exclusive.
- Plugin roots are stored under `plugins/<name>/` and are never written to an agent directory.

### Work with external skills

1. Run `external list --json`, then `external show <name> --json` for owner, path, pinned hash, observed hash/version, and status.
2. Statuses: `ok` (pinned hash matches), `observed` (readable, no pin), `drift`, `missing`, `invalid`, `conflict` (a `.vault-managed` marker claims the path). Report them; do not repair the external directory.
3. Record one with `external add <name> --owner <tool> --path <path> [--related-tool <card>] [--pin]`. Preview first, apply with `--yes` after approval.
4. After the owning tool upgrades its skill, re-pin only with approval: `external add <name> --force --pin --yes`.
5. `external remove` deletes only the card. It never deletes or edits the external path.
6. If a managed skill is actually owned by a tool, use `external adopt <name> --owner <tool> --path <path>`. Show the preview first: adopt removes the source metadata, lock entry, target references, managed content, and this vault's marker.

`build/external-skills.json` carries the same records for agents that read files instead of running the CLI.

### Use a tool card

1. Run `tool list --json` or `tool list --kind mcp --json`; use `tool show <name> --json` for the full card. After `build`, the same records are in `build/tools.json`.
2. Read `homepage`, `docs`, `install`, `run`, `requirements`, and `related_skills`. Prefer the official page and the agent's current rules over the recorded command.
3. Check requirements first. Ask before running any install or run command; do not assume the recorded version is still current.
4. Do not write the tool's config, credentials, or installed state back into the vault.

### Record a tool card

- `tool add <name> --kind plugin|mcp|cli|app --title <text> --summary <text> --homepage <url> --install-command <label=command>`
- Repeat `--install-command`, `--requirement`, `--related-skill`, and `--tag` as needed. Add `--docs`, `--recorded-version`, `--run`, and `--notes` when known.
- The command previews first; apply with `--yes` after approval. Use `--force` only to replace an existing card.
- `tools/<name>.yml` is the source of truth. The desktop tools page is read-only.

### Validate and recover

- `vault validate --json` reports metadata and working-copy errors.
- `vault status --json` shows unfinished operations and recovery state.
- If a vault lock or journal blocks writes, report it. Do not delete lock files.

## Output

Prefer `--json` and parse the envelope: `schema`, `command`, `data`, `warnings`, `errors`. Exit codes: 0 success, 1 operation failed, 2 usage or validation, 3 network or authentication.

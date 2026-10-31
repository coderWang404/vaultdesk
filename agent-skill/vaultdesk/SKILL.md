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
- Tool cards are records, not installations. VaultDesk never downloads, installs, or runs the recorded tool. A card may declare bounded runtime checks; `tool verify` performs them only when explicitly requested and may start a Python interpreter or query a trusted Node executable for its version. Follow the card's `homepage` and `docs` for setup, and never claim a successful check installed or enabled the tool.
- Standalone MCP servers use `kind: mcp`; a plugin or CLI that also exposes MCP keeps its distribution kind and adds the `mcp` tag. VaultDesk does not register, start, or health-check these services and does not write agent MCP configuration; registering the server is your job when the user asks.
- External skills are owned by their tool. VaultDesk records the path and observes hash/status; it never installs, updates, runs, or writes the owning tool or that path. Never claim VaultDesk synced their content.
- One owner per path. A path with a `.vault-managed` marker belongs to a vault install; never add it as external, and never adopt a path whose marker belongs to another vault.
- Never put tokens, API keys, private URLs, or other secrets in a tool card, an external skill card, or any vault file.
- Never edit `third_party/<name>/`; it is the pristine upstream copy. Edit `plugins/<name>/` only when the user explicitly asks, and expect update conflicts until the change is forked or discarded.
- GitHub-origin skills are read-only until forked with `source fork`. Do not hand-edit their working copies.
- Do not pass `--yes` without the user's explicit approval of the preview or diff. Show them what will change.
- Do not commit or push unless asked. Commit explicit paths only; never `git add -A`.
- Plugin content cannot be installed with `target install`; install skills only.
- `target verify` proves expected files exist and hashes match. It does not prove an agent loaded a skill or that its Python packages, external programs, or credentials are available. Keep file distribution and runtime readiness separate.

## Common tasks

### Update sources

1. Run `source check --json`. It updates ignored local check state in `.vault/state.json`, but not tracked vault content.
2. For each source with updates, run `source diff <name>` and summarize the files.
3. After approval, apply with `source update <name> --yes`; add `--commit` only when asked.
4. For plugins, tell the user the agent-side copy was not touched and must be reinstalled through the agent.

### Review plugins

1. Run `plugin list --json` and `plugin show <name> --json` to inspect `rootPath`, `manifests`, `assets`, `containedSkills`, and `hasHooks`. Use `rootPath` as the agent-side installation source, never `third_party/`.
2. Before installing through an agent, show the asset list and any hooks to the user. Follow that agent's current plugin rules; do not run hooks or write adapter files back into the vault.
3. Keep GitHub-origin `plugins/<name>/` read-only. If customization is needed, copy the plugin to an agent-owned location first. After a VaultDesk source update, reinstall or refresh the agent-side copy; VaultDesk does not track its installed version.

### Install skills

1. Run `target list --json` or read the targets in `vault.yml`.
2. Preview with `target install <skill...> --dest <dir> --id <id>`.
3. After approval, repeat with `--yes`.
4. Verify with `target verify <id>`.

### Import

Before importing anything, inspect the skill and its tool, form a default recommendation, and ask the user to confirm it. Do not write before confirmation, and do not ask with no opinion.

Recommend:

- **The tool manages itself** (its installer or updater owns and rewrites the skill path): record an external card. REA's bundled skill is the default here. A read-only attribution or integrity check alone does not make a skill externally owned.
- **VaultDesk should manage it** (a normal standalone, package, or collection skill): import it as a source.
- **Another manager owns it** (another lock file, registry, or tool owns the path): leave it there; if the user wants state tracked, record an external card with that manager as owner.
- **The user needs a separate copy**: fork to a new path and name, and leave the original owner's copy alone.

Say what you found and why you recommend one option, then ask the user to confirm or choose another. If the user already stated the owner, follow that and skip the question. Path traits, `.vault-managed` markers, and setup behavior support the recommendation; they do not replace the user's decision. One path has one owner.

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
2. Read `homepage`, `docs`, `install`, `run`, `requirements`, `related_skills`, and declared `checks`. Prefer the official page and the agent's current rules over the recorded command.
3. Use `tool verify <name> [--profile <workflow>] --json` when the user wants a runtime readiness check. It checks only the declared environment and does not install dependencies, configure an agent, or prove an end-to-end workflow. No `checks` means unconfigured, not ready.
   For an isolated Python environment, pass `--python <absolute-path>` and make the actual skill commands use that same interpreter or its `bin` directory on `PATH`; a successful override does not change the agent environment.
   When no override is supplied, VaultDesk prefers the user's `~/miniconda3/bin` base interpreter before system Python, Homebrew Python, other Conda installs, or pyenv. The report always includes the exact interpreter path and version that was checked.
   For a Node tool, pass `--node <absolute-path>` only when the trusted default search does not match the agent's Node. A passing version check does not prove the tool's CLI, MCP service, or agent registration is present.
4. Check requirements first. Ask before running any install or run command; do not assume the recorded version is still current.
5. Do not write the tool's config, credentials, or installed state back into the vault.

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

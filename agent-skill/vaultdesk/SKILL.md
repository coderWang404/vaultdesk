---
name: vaultdesk
description: Manage a VaultDesk vault and its skills and plugins through the `vaultdesk` CLI. Use when the user asks to inspect vault status, import or update skills, install skills into agent directories, review plugin contents, validate a vault, or recover an interrupted operation.
---

# VaultDesk

VaultDesk stores skills and plugin roots in a Git-backed vault. The CLI and the desktop app share one core, so `--json` output is the stable contract. Inspect first, preview writes, and apply only after the user approves the change.

## Inspect first

- `vaultdesk --vault <path> vault status --json`
- `vaultdesk --vault <path> source list --json`
- `vaultdesk --vault <path> plugin list --json`

Omit `--vault` when the current directory is the vault.

## Boundaries

- VaultDesk stores and validates plugins; it does not install, enable, or adapt them. If the user wants a plugin active, follow that agent's current plugin rules yourself. Never run plugin hooks.
- A plugin does not need a manifest. VaultDesk also recognizes `skills/<name>/SKILL.md` plus MCP, commands, agents, hooks, rules, or workflows. When `manifests` is empty, plan the install from `assets` and `containedSkills` in the agent's own configuration.
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

- `source add <path>` previews a local folder; `source add --repo owner/name` previews a GitHub repository.
- Review the detected shape (standalone, package, plugin) and target paths before applying with `--yes`.
- `--plugin` forces plugin registration; `--no-plugin` stores the folder as a skill or package. They are mutually exclusive.
- Plugin roots are stored under `plugins/<name>/` and are never written to an agent directory.

### Validate and recover

- `vault validate --json` reports metadata and working-copy errors.
- `vault status --json` shows unfinished operations and recovery state.
- If a vault lock or journal blocks writes, report it. Do not delete lock files.

## Output

Prefer `--json` and parse the envelope: `schema`, `command`, `data`, `warnings`, `errors`. Exit codes: 0 success, 1 operation failed, 2 usage or validation, 3 network or authentication.

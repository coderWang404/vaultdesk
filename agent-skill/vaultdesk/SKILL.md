---
name: vaultdesk
description: Manage a VaultDesk vault and its skills, plugins, external tool cards, and tool-managed skill records through the `vaultdesk` CLI. Use when the user asks to inspect vault status, import or update skills, install skills into agent directories, review plugin contents, look up a recorded tool's official install method, decide whether a skill belongs to the vault or to its tool, validate a vault, or recover an interrupted operation.
---

# VaultDesk

VaultDesk stores skills, plugin roots, external tool records, and tool-managed skill observations in a Git-backed vault. The CLI and the desktop app share one core, so `--json` output is the stable contract. Inspect first and preview writes. Apply within the user's requested scope and existing authorization; do not ask again for an already approved installation, update, commit, or push.

## Inspect first

- `vaultdesk vault list --json` (when the current directory is not a Vault)
- `vaultdesk agent catalog --json` (all explicitly registered Vaults)
- `vaultdesk --vault <path> agent catalog --json` (one Vault, with source ownership, tool cards, target file state, and explicit integration unknowns)
- `vaultdesk mcp serve` (read-only MCP tools for an MCP-capable agent; the client must register this command)
- `vaultdesk --vault <path> vault status --json`
- `vaultdesk --vault <path> source list --json`
- `vaultdesk --vault <path> plugin list --json`
- `vaultdesk --vault <path> tool list --json`
- `vaultdesk --vault <path> tool list --kind mcp --json`
- `vaultdesk --vault <path> external list --json`

Omit `--vault` when the current directory is the vault.

`agent catalog` is the agent-facing discovery contract. It reports the Vault path,
skill/source ownership, remote update mode, tool kind/capabilities and install
instructions, external owners, plugin targets, and fresh marker/hash state for
managed files. `agentLoaded`, `enabledState`, and `connectedState` stay
`unknown` unless an agent-specific probe supplies evidence; file presence is not
the same as an agent loading or enabling an asset. The command reads only Vaults
explicitly registered by VaultDesk when no `--vault` is supplied; it does not
scan the home directory.

For direct MCP discovery, register `vaultdesk mcp serve` in the agent client's
MCP settings. If multiple Vaults are registered, pass one explicitly with
`vaultdesk mcp serve --vault <path>`. The server exposes catalog/list/search/tool
guidance tools only; it never installs or launches the recorded commands and
does not edit the client's MCP settings. MCP responses redact common credential
patterns, but Vault contents should still never be used as secret storage.

## Boundaries

- VaultDesk stores and validates plugin roots and distributes their files to explicitly registered `plugin_targets`. Agent registration, activation, and runtime dependencies are separate steps governed by that agent's plugin rules. VaultDesk does not execute plugin hooks or create adapters.
- A plugin does not need a manifest. VaultDesk also recognizes `skills/<name>/SKILL.md` plus MCP, commands, agents, hooks, rules, or workflows. When `manifests` is empty, plan the install from `assets` and `containedSkills` in the agent's own configuration.
- Tool cards are records, not installations. VaultDesk never downloads, installs, or runs the recorded tool. A card may declare bounded runtime checks; `tool verify` performs them only when explicitly requested and may start a Python interpreter or query a trusted Node executable for its version. Follow the card's `homepage` and `docs` for setup, and never claim a successful check installed or enabled the tool.
- Standalone MCP servers use `kind: mcp`; a plugin or CLI that also exposes MCP keeps its distribution kind and adds the `mcp` tag. VaultDesk's own read-only MCP server exposes the catalog, but it does not register third-party services, start them, health-check them, or edit agent MCP configuration.
- External skills are owned by their tool. VaultDesk records the path and observes hash/status; it never installs, updates, runs, or writes the owning tool or that path. Never claim VaultDesk synced their content.
- One owner per path. A path with a `.vault-managed` marker belongs to a vault install; never add it as external, and never adopt a path whose marker belongs to another vault.
- Never put tokens, API keys, private URLs, or other secrets in a tool card, an external skill card, or any vault file.
- Never edit `third_party/<name>/`; it is the pristine upstream copy. Edit `plugins/<name>/` only when the user explicitly asks, and expect update conflicts until the change is forked or discarded.
- GitHub-origin skills are read-only until forked with `source fork`. Do not hand-edit their working copies.
- Review the preview or diff before `--yes`. Ask only if the action exceeds the user's request or existing authorization.
- Commit and push only within the user's authorization, including an already approved automatic-sync policy. Commit explicit paths only; never `git add -A`.
- Plugin content cannot be installed with `target install`; install skills only.
- `target verify` proves expected files exist and hashes match. It does not prove an agent loaded a skill or that its Python packages, external programs, or credentials are available. Keep file distribution and runtime readiness separate.
- Automatic source updates scan this update's commit paths before commit/push. Credential-like files, private keys, Python caches, and high-confidence token patterns pause the source with a path-only warning. This check reduces accidental disclosure; it is not a complete secret-detection guarantee.

## Common tasks

### Update sources

1. Read `source list --json` for origin and mode. Remote `auto` sources use `source auto-sync --yes` or the installed app's background worker: update, managed distribution, commit, and push run as one source transaction. This command can process every auto source, so use it only within that scope.
2. For manual review, run `source check --json` and `source diff <name>`, then `source update <name> --yes`. Checking writes ignored local state only. A manual update refreshes Vault content; it is not the automatic distribution transaction.
3. After a manual update, run `source distribute <source> --yes` to refresh the shared skill master and active registered skill targets, or the registered plugin file targets. This also handles local sources after an intentional Vault edit. Respect `install_after_update=false`; unknown ownership or manual target edits require review, never forced replacement.
4. Verify target files with `target verify <id>` for skills and `agent catalog --json` for plugin targets. Confirm runtime prerequisites and any agent reload/activation separately. Commit and push only when authorized, or report the remaining Vault changes.

### Review plugins

1. Run `plugin list --json` and `plugin show <name> --json` to inspect `rootPath`, `manifests`, `assets`, `containedSkills`, and `hasHooks`. Use `rootPath` as the agent-side installation source, never `third_party/`.
2. Determine whether the agent can use a stable directory whose files VaultDesk owns. If so, preview `plugin target add <plugin> --id <id> --dest <parent-dir>`, apply with `--yes`, then `source distribute <plugin> --yes`. Files go to `<parent-dir>/<plugin>`; use `plugin target list` and `agent catalog --json` to verify the managed copy. Do not use `target install` for a plugin root.
3. Register or enable that distributed root through the agent's current supported mechanism, within the user's request, and verify it with the agent itself. If the agent's installer owns a cache or rewrites the directory, leave that directory under the agent's control; do not also register it as a VaultDesk target. Use a tool card for its official installation/update method and state that the agent-owned installation updates separately.
4. Keep GitHub-origin `plugins/<name>/` read-only. VaultDesk syncs active registered plugin file targets during automatic updates; it does not detect or activate the plugin in the agent, run hooks, or write adapter files into the vault.

### Install skills

1. Run `target list --json` or read the targets in `vault.yml`.
2. Preview with `target install <skill...> --skills-only --dest <dir> --id <id>`. `--skills-only` keeps each selected skill exact, including when its name also names a collection; omit it only when intentionally installing a whole source.
3. Within the authorized scope, repeat with `--yes`. This registers the target and copies files. Run `source distribute <source> --yes` for each affected source to establish the shared `~/.agents/skills` master and per-skill links, with tracked copies if links are unavailable.
4. Verify with `target verify <id>` and `agent catalog --json`. For related tool cards, check the intended runtime/profile as well, then verify the agent can discover the skill. File verification alone does not establish that last step.

### Import

Before importing, inspect the skill and its tool and determine the owner from the user's request and existing registration. If ownership is unresolved, give a recommendation and ask for that decision; otherwise proceed within the existing authorization.

Recommend:

- **The tool manages itself** (its installer or updater owns and rewrites the skill path): record an external card. REA's bundled skill is the default here. A read-only attribution or integrity check alone does not make a skill externally owned.
- **VaultDesk should manage it** (a normal standalone, package, or collection skill): import it as a source.
- **Another manager owns it** (another lock file, registry, or tool owns the path): leave it there; if the user wants state tracked, record an external card with that manager as owner.
- **The user needs a separate copy**: fork to a new path and name, and leave the original owner's copy alone.

State the ownership evidence and use the user's existing decision when available. Path traits, `.vault-managed` markers, and setup behavior support the recommendation; they do not replace the user's decision. One path has one owner.

Steps:

- `source add <path>` previews a local folder; `source add --repo owner/name` previews a GitHub repository.
- Review the detected shape (standalone, package, plugin) and target paths before applying with `--yes`.
- `--plugin` forces plugin registration; `--no-plugin` stores the folder as a skill or package. They are mutually exclusive.
- Plugin roots are stored under `plugins/<name>/`; they reach agent-side directories only through explicitly registered plugin targets. Import alone does not distribute or activate them.

### Work with external skills

1. Run `external list --json`, then `external show <name> --json` for owner, path, pinned hash, observed hash/version, and status.
2. Statuses: `ok` (pinned hash matches), `observed` (readable, no pin), `drift`, `missing`, `invalid`, `conflict` (a `.vault-managed` marker claims the path). Report them; do not repair the external directory.
3. Record one with `external add <name> --owner <tool> --path <path> [--related-tool <card>] [--pin]`. Preview first, then apply with `--yes` within the user's authorization.
4. Use the owning tool's official installer/updater for its files and agent integration. After an authorized upgrade, inspect the new state before re-pinning: `external add <name> --force --pin --yes`. Never also install that skill through `target install`.
5. `external remove` deletes only the card. It never deletes or edits the external path.
6. If a managed skill is actually owned by a tool, use `external adopt <name> --owner <tool> --path <path>`. Show the preview first: adopt removes the source metadata, lock entry, target references, managed content, and this vault's marker.

`build/external-skills.json` carries the same records for agents that read files instead of running the CLI.

### Use a tool card

1. Run `agent catalog --json` or `tool list --json`, then `tool show <name> --json` for the full card. For all MCP-capable tools use catalog `capabilities`; `tool list --kind mcp` lists only standalone MCP cards and excludes plugins/CLIs tagged `mcp`. After `build`, card records are also in `build/tools.json`.
2. Read `homepage`, `docs`, `install`, `run`, `requirements`, `related_skills`, and declared `checks`. Prefer the official page and the agent's current rules over the recorded command.
3. Use `tool verify <name> [--profile <workflow>] --json` when the user wants a runtime readiness check. It checks only the declared environment and does not install dependencies, configure an agent, or prove an end-to-end workflow. No `checks` means unconfigured, not ready.
   For an isolated Python environment, pass `--python <absolute-path>` and make the actual skill commands use that same interpreter or its `bin` directory on `PATH`; a successful override does not change the agent environment.
   When no override is supplied, VaultDesk prefers the user's `~/miniconda3/bin` base interpreter before system Python, Homebrew Python, other Conda installs, or pyenv. The report always includes the exact interpreter path and version that was checked.
   For a Node tool, pass `--node <absolute-path>` only when the trusted default search does not match the agent's Node. A passing version check does not prove the tool's CLI, MCP service, or agent registration is present.
4. Within the user's requested installation scope, follow the current official install method and agent registration rules; ask only for missing scope or decisions. Re-run the relevant checks and use the agent's own list/status or a small end-to-end task to verify registration and actual use. Do not assume the recorded version is still current.
5. Keep config and credentials at the owning tool/agent's documented location. A tool card neither installs the tool nor makes its binaries auto-update; use the official updater for that part. Do not mark an unknown activation state as ready merely because prerequisite checks passed.

### Record a tool card

- `tool add <name> --kind plugin|mcp|cli|app --title <text> --summary <text> --homepage <url> --install-command <label=command>`
- Repeat `--install-command`, `--requirement`, `--related-skill`, and `--tag` as needed. Add `--docs`, `--recorded-version`, `--run`, and `--notes` when known.
- The command previews first; apply with `--yes` within the authorized scope. Use `--force` only to replace an existing card.
- `tools/<name>.yml` is the source of truth. The desktop tools page is read-only.

### Validate and recover

- `vault validate --json` reports metadata and working-copy errors.
- `vault status --json` shows unfinished operations and recovery state.
- If a vault lock or journal blocks writes, report it. Do not delete lock files.

## Output

Prefer `--json` and parse the envelope: `schema`, `command`, `data`, `warnings`, `errors`. Exit codes: 0 success, 1 operation failed, 2 usage or validation, 3 network or authentication.

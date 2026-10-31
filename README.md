<p align="center">
  <img src="docs/assets/icon.png" alt="VaultDesk" width="96" height="96">
</p>

<h1 align="center">VaultDesk</h1>

<p align="center">
  <strong>A local-first desktop app and CLI for Git-backed agent skill vaults.</strong><br>
  Browse skills, review upstream diffs, install rebuildable copies, and record plugins, MCP servers, and tool-managed skills without running them.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/coderWang404/vaultdesk/actions/workflows/ci.yml"><img src="https://github.com/coderWang404/vaultdesk/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey.svg" alt="Platform: macOS 13+">
  <img src="https://img.shields.io/badge/node-22%2B-339933.svg" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/version-1.2.9-brightgreen.svg" alt="Version 1.2.9">
</p>

<p align="center">
  <img src="docs/assets/desktop-overview.png" alt="VaultDesk desktop app showing a vault overview" width="100%">
</p>

> [!NOTE]
> VaultDesk 1.2.9 is available as an Apple Silicon DMG from [GitHub Releases](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.9). The build is ad-hoc signed and is not notarized. The CLI is bundled with the app and does not depend on a source checkout or a separate Node.js installation.

## Contents

- [Why VaultDesk](#why-vaultdesk)
- [What it manages](#what-it-manages)
- [Desktop app](#desktop-app)
- [Screenshots](#screenshots)
- [Install](#install)
- [Quick start](#quick-start)
- [Reviewing updates](#reviewing-updates)
- [CLI](#cli)
- [Tool cards and MCP](#tool-cards-and-mcp)
- [External skills](#external-skills)
- [Vault layout](#vault-layout)
- [Architecture](#architecture)
- [Safety model](#safety-model)
- [Testing](#testing)
- [Status](#status)
- [Contributing](#contributing)
- [License](#license)

## Why VaultDesk

Agent skills are easy to write and hard to keep track of. They get copied into several agent directories, edited in place, and slowly drift away from the repository they came from. VaultDesk gives the repository back control: the vault is the source of truth, and every install destination is a disposable copy that can be verified or rebuilt.

The project is built on four rules:

1. **The repository is the source of truth.** Install destinations are artifacts, not the primary copy.
2. **Review before changing managed content.** Network fetches happen outside the vault; changes to skills, plugins, and targets have previews. Source checks record local state separately.
3. **Each path has one owner.** VaultDesk manages imported skills and plugin roots, including explicitly registered file targets. External tools and tool-managed skills stay with their own installer or updater; VaultDesk records or observes them without rewriting their paths. Agent registration, activation, and runtime dependencies are separate from file distribution.
4. **One core, two surfaces.** The desktop app and CLI share the same TypeScript core, rules, and JSON contract.

VaultDesk is for people who run more than one coding agent and maintain their own skill library. It manages files and records; agent-specific plugin installation and activation remain with the agent.

## What it manages

| Layer | Stored as | VaultDesk does | VaultDesk never does |
| --- | --- | --- | --- |
| Skills | `skills/`, `packages/` | Build, install, verify, restore, edit local skills, fork GitHub skills | Edit GitHub originals before a fork |
| Plugins | `plugins/`, `third_party/`, `plugin_targets` | Register whole roots, validate assets, show diffs, update, distribute files to explicitly registered targets | Register or enable plugins in an agent, adapt manifests, or execute hooks, scripts, or MCP servers |
| Tool cards | `tools/<name>.yml` | Record official links, install methods, run entry points, and optional runtime readiness checks | Download, install, or run the recorded tool commands; write agent configuration |
| External skills | `external-skills/<name>.yml`, the tool's own path | Record the owning tool and path, pin an optional hash, observe status read-only, adopt a skill out of the vault | Install, update, run, or write the external path; write agent configuration |
| Install targets | `vault.yml`, `.vault-managed` markers | Classify slots, back up, copy, verify, restore | Delete unmanaged content |

The four asset types have deliberately different boundaries:

- **Skills** are managed by VaultDesk. Builds go to `build/skills/`; managed distribution projects them into `~/.agents/skills` and uses per-skill links to registered agent targets, with tracked copies when links are unavailable.
- **Plugins** are registered as `shape: plugin` sources. VaultDesk stores, validates, and updates the whole root and can distribute it to registered plugin file targets. The agent still registers, enables, and loads that root through its supported plugin mechanism.
- **Tool cards** are records for things VaultDesk does not host at all: MCP servers, CLIs, desktop tools, and multi-tool suites such as REA. Agents read the card and install the tool from the official source.
- **External skills** are owned by a tool or another manager that installs or rewrites their files. VaultDesk records the path, pins an optional hash, and reports drift or conflicts, but never writes the path. A read-only attribution or integrity check alone does not establish external ownership.

One product can provide a skill, CLI, MCP server, and plugin. Related tool cards describe the runtime and installation method without changing ownership. File distribution, runtime readiness, and agent registration are separate results; the presence of files or a passing version check does not prove that the agent has loaded the tool.

### Completing an agent installation

Read `agent catalog --json` first and reuse the user's existing ownership and installation authorization. Ask only when the destination, owner, or scope is unresolved.

| Asset | Files and installation | Completion check and updates |
| --- | --- | --- |
| Managed skill | Preview and apply `target install <skill> --dest <dir> --id <id>`, then run `source distribute <source> --yes` to establish the shared master and managed links. | `target verify <id>` checks files; check related tool prerequisites and the agent's skill discovery separately. Remote auto sources keep active registered targets synchronized. |
| Managed plugin root | Inspect `plugin show <name> --json`; register a stable parent directory with `plugin target add <name> --id <id> --dest <parent>`, then `source distribute <name> --yes`. The copy is `<parent>/<name>`. | Inspect `agent catalog --json` for file state, then register/enable that root through the agent and verify it there. Remote auto sources update registered file targets. Do not register an installer-owned plugin cache as a VaultDesk target. |
| Tool card: MCP, CLI, app, or external plugin | Read `tool show <name> --json`, follow the current official install method, and configure the intended agent within the user's request. | Run relevant `tool verify` checks and an agent status check or small end-to-end task. Use the official tool updater; the card itself does not install or update binaries. |
| Tool-managed external skill | Read `external show <name> --json`; use its owner's installer/updater. Do not also use `target install` on the same path. | Observe hash/status after the owner's update and verify agent discovery. Re-pin an accepted version when authorized. |

## Desktop app

The desktop app is an Electron + React shell around the shared core. It provides:

- Multiple vaults in tabs, each with its own lock and state
- Overview, sources, skills, plugins, MCP, tools, targets, Git, and settings pages
- `Cmd+K` metadata search across open vaults
- Upstream checks, per-file diffs, and review-before-apply updates
- Import flows for local folders, GitHub repositories, skills, packages, and plugin roots
- Installation previews, slot classification, timestamped backups, verification, and restore
- Explicit Git commit and push limited to the paths VaultDesk changed
- Plugin import and update review pages, plus read-only record pages for tool cards and MCP servers
- Tool-managed skills grouped by owner, with an external filter and an observation-only inspector

The desktop UI copy is currently Chinese. CLI output and JSON envelopes are English. Documentation is bilingual: this README has a Simplified Chinese edition, and the design notes under `docs/` are a mix of Chinese and English.

## Screenshots

| MCP records | External tool cards |
| --- | --- |
| ![MCP page showing a recorded MCP server](docs/assets/desktop-mcp.png) | ![Tools page showing two recorded external tools](docs/assets/desktop-tools.png) |

Both screenshots use a demo vault built from the public fixtures. No personal skill content is included.

## Install

### Requirements

- **Desktop:** macOS 13 or newer, Apple Silicon or Intel
- **Build:** Node.js 22+, pnpm 11.5.2, Git on `PATH`
- **Source-built CLI:** Node.js 22+; CI also builds and tests on Ubuntu

Download the Apple Silicon desktop DMG from [GitHub Releases](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.9), drag **VaultDesk.app** to **Applications**, and open that installed copy. Use **Settings → Command line and MCP → Install command-line tool**, even before opening a Vault. The bundled CLI is installed safely at `~/.local/bin/vaultdesk`; it does not require the source repository or a separate Node.js runtime. If your terminal cannot find `vaultdesk`, use `~/.local/bin/vaultdesk` or add `~/.local/bin` to PATH. For MCP clients, copy the absolute-path configuration from Settings after selecting a Vault. Intel users can build the desktop app from source.

### Desktop from source

```bash
git clone https://github.com/coderWang404/vaultdesk.git
cd vaultdesk
corepack enable
pnpm install
pnpm dev
```

To package an ad-hoc signed DMG:

```bash
pnpm package:mac
# release/VaultDesk-1.2.9-<arch>.dmg
```

The build is ad-hoc signed and not notarized. On first launch, right-click the app and choose **Open**, or allow it in **System Settings → Privacy & Security**.

### CLI from source

```bash
pnpm build:packages
node packages/cli/dist/index.js --help
```

Source mode requires Node.js 22+. The released DMG uses Electron's bundled Node runtime; install its launcher from the app settings instead of linking into a source checkout.

## Quick start

Create a vault, import a local skill, build it, and install it into an agent directory:

```bash
export VAULT=~/Vaults/skills

vaultdesk vault init "$VAULT" --git --name skills --yes
vaultdesk source add ~/src/my-skill --vault "$VAULT" --yes
vaultdesk vault validate --vault "$VAULT"
vaultdesk build --vault "$VAULT" --yes
vaultdesk target install my-skill --skills-only --vault "$VAULT" \
  --dest ~/.claude/skills --id claude-code --yes
vaultdesk target verify claude-code --vault "$VAULT"
```

`~/src/my-skill` is a directory containing a `SKILL.md`. The `target install` command creates or reuses the target registered as `claude-code`; adjust the destination to the directory your agent reads.

The desktop groups installation rules by their actual destination directory, showing one agent/preset name and path with unique skill counts. Search agents, skills, sources, rule IDs or paths, filter rules that need attention or are paused, and collapse individual or all groups. **Reinstall** keeps a target's registered skills and destination fixed; **More → Add skills** selects only new skills for that target. Installing from a skill's details keeps that skill selected. These selections are stored as exact skill names, so a same-named collection cannot silently expand them. In the CLI, use `--skills-only` for the same behavior; omit it when intentionally installing a complete source. Reinstalling or adding skills preserves a target's paused automatic-sync setting.

Open the desktop app and add the same vault with the `+` button. The app and CLI can work on the same vault, but only one desktop instance should hold a vault open at a time.

## Reviewing updates

```bash
vaultdesk source check --vault "$VAULT"
vaultdesk source diff some-source --vault "$VAULT"
vaultdesk source update some-source --vault "$VAULT" --yes
```

`source check` queries upstream commits and writes its results to the Git-ignored `.vault/state.json`; it does not change tracked vault content. `source diff` caches upstream content outside the vault and shows a per-file unified diff. `source update` previews first and applies only with `--yes`; the desktop app shows the same preview behind a confirmation dialog.

`source update` refreshes Vault content and defaults to no distribution. Run `source distribute <source> --yes` afterward to refresh the shared skill master and active registered skill targets, or the registered plugin file targets. This also distributes intentional changes to local sources. Automatic sync performs remote updates and managed distribution as a source transaction. Neither path takes over an agent-owned plugin installation or enables a plugin in the agent.

## Automatic sync

The macOS app installed at `/Applications/VaultDesk.app` registers a per-user background worker by default. It checks every registered vault at login, after network recovery, and hourly, even while the app window is closed. Settings let you pause it, run a check manually, inspect activity, and change the interval and backup retention. Development builds and apps launched from a mounted DMG do not register this worker.

Remote Git sources default to `auto`, with per-source review and pause modes. For each successful skill update, VaultDesk syncs the vault, the `~/.agents/skills` master, and registered destinations together; plugin updates sync the plugin root and explicitly registered plugin file targets. Individual skill symlinks are preferred, with tracked copies where links are unavailable. Targets with `install_after_update=false` remain paused. Local edits, unknown ownership, and name collisions block the affected source without overwriting files. VaultDesk commits only files from that update and pushes normally; a failed push keeps the local commit and reports the problem. New upstream skills await adoption, while upstream deletions never automatically remove local copies.

Use `source pending <source>` to list skills awaiting adoption, `source adopt <source> --path <upstream-relative-path> --yes` to accept a selected skill, and `source distribute <source> --yes` to initialize or refresh managed destinations. Register plugin destinations through `plugin target add|list|remove`.

When a manual update has already brought an `auto` source current, the next automatic check also refreshes missing or outdated managed copies if they have no manual edits. This distribution-only repair does not commit unrelated Vault changes. Review/frozen sources and paused targets remain excluded.

## CLI

```text
vaultdesk <group> <action> [arguments] [options]
```

| Group | Actions |
| --- | --- |
| `vault` | `list`, `status`, `validate`, `init`, `migrate` |
| `source` | `list`, `show`, `check`, `diff`, `update`, `auto-sync`, `mode`, `pending`, `adopt`, `distribute`, `add`, `remove`, `fork` |
| `plugin` | `list`, `show`, `target add/list/remove` |
| `tool` | `list`, `show`, `verify`, `add` |
| `external` | `list`, `show`, `add`, `remove`, `adopt` |
| `target` | `list`, `install`, `remove`, `verify`, `restore` |
| `build` | Rebuild `build/skills/`, `build/tools.json`, and `build/external-skills.json` |
| `presets` | `list`, `verify` |
| `agent` | `skill`, `catalog` |
| `mcp` | `serve` (read-only stdio server) |
| `git` | `status`, `commit`, `push` |

Pure query commands do not write to disk. `source check` does not change managed content, but it records local check state; commands that change managed content print a preview unless `--yes` is passed. Global options are `--vault <path>`, `--json`, `--yes`, `--help`, and `--version`.

CLI commands support `--json`, which returns one envelope on stdout. `mcp serve` instead reserves stdout for MCP JSON-RPC:

```json
{
  "schema": 1,
  "command": "tool.list",
  "data": [],
  "warnings": [],
  "errors": []
}
```

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Operation failed |
| `2` | Usage or validation error |
| `3` | Network or authentication error |

Interactive prompts go to stderr, so stdout remains parseable. GitHub operations use `GIT_TERMINAL_PROMPT=0` and fail instead of hanging on credentials.

## Tool cards and MCP

A tool card records an external tool. It is not a source and is not installed by VaultDesk.

```yaml
schema: 1
name: fetch-mcp
kind: mcp
title: Fetch MCP
summary: A recorded Python MCP server that fetches and converts web pages.
homepage: https://github.com/modelcontextprotocol/servers
docs: https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
install:
  - label: Install
    command: uvx mcp-server-fetch
run: uvx mcp-server-fetch
requirements:
  - uv
tags: [mcp, fetch]
notes: Recorded for display only; VaultDesk never installs, starts, or registers this MCP server.
```

`kind` describes the distribution form. Protocol information belongs in `tags`.

| `kind` | Use for | Example |
| --- | --- | --- |
| `plugin` | Multi-tool suites distributed as agent plugins | REA |
| `mcp` | MCP servers | Filesystem, fetch |
| `cli` | Standalone command-line tools | A build helper |
| `app` | Desktop or GUI tools | A local editor |

Cards live in `tools/<name>.yml`. The desktop **Tools** page shows all cards; **MCP** includes `kind: mcp` and cards tagged `mcp`, including plugin and CLI forms. `tool list --kind mcp` filters only standalone MCP cards; use catalog `capabilities` or all tool cards to include other MCP-capable tools:

```bash
vaultdesk tool list --vault "$VAULT" --json
vaultdesk tool list --vault "$VAULT" --kind mcp --json
vaultdesk tool show fetch-mcp --vault "$VAULT"
```

Record a card with the CLI. The command previews first and writes only with `--yes`:

```bash
vaultdesk tool add fetch-mcp --vault "$VAULT" --kind mcp \
  --title "Fetch MCP" \
  --summary "A recorded Python MCP server that fetches and converts web pages." \
  --homepage https://github.com/modelcontextprotocol/servers \
  --docs https://github.com/modelcontextprotocol/servers/tree/main/src/fetch \
  --install-command "install=uvx mcp-server-fetch" \
  --run "uvx mcp-server-fetch" --requirement uv --tag mcp --tag fetch --yes
```

`vaultdesk build` writes `build/tools.json`, a deterministic index of all cards without timestamps. Agents read either the YAML, the JSON index, or `tool show --json`, then use their own installation and registration rules.

### Runtime readiness is separate from file distribution

`target verify` only checks the managed skill files. A related tool card can declare read-only prerequisite checks, including a Python interpreter/version, an installed Python distribution with a PEP 440 version specifier, Node.js version intervals, a PATH executable, a path, an environment-variable presence, or a SHA-256 baseline for a file inside the vault. Put a check under `profiles` when it is needed only for a particular workflow; `optional: true` makes a missing check visible without blocking readiness.

`tool verify <name> [--profile <name>] [--python /absolute/path/to/python] [--node /absolute/path/to/node] --json` runs these checks only when requested. Python and Node overrides apply only to that verification, so a card can use portable defaults while a user explicitly selects an isolated runtime; the report includes the path actually used. A card without checks is `unconfigured`, not `ready`. A `file-hash` check on a skill's requirements file becomes `drift` after an upstream change, so previously reviewed package checks cannot falsely report that an updated skill is ready. The CLI accepts repeated `--check '<JSON object>'` arguments when creating a card; the same declarations may be written in `tools/<name>.yml`. For example:

```yaml
related_skills: [ppt-master]
checks:
  - id: python
    kind: python
    label: Supported Python
    executable: python3
    min_version: "3.10"
    max_version_exclusive: "3.15"
  - id: svg-package
    kind: python-package
    label: SVG shape package
    interpreter: python3
    requirement: skia-pathops>=0.9.2
    profiles: [svg]
  - id: node-runtime
    kind: node
    label: REA Node.js compatibility
    ranges:
      - { min_version: "22.23.4", max_version_exclusive: "23.0.0" }
      - { min_version: "24.22.1", max_version_exclusive: "25.0.0" }
      - { min_version: "26.12.1" }
```

Verification never executes `install` or `run` entries. A tool card can name `python3` or a versioned Python command; it cannot supply an executable path. Those names search approved locations in a deterministic order: the user's `~/miniconda3/bin` base environment first, then `~/anaconda3/bin`, then other trusted directories in PATH order, followed by system-directory fallbacks. Arbitrary project directories are ignored. Only an explicit `--python` or app selection accepts an absolute native Python path. A Node.js check supplies version intervals, not a command; it checks a native `node` from system/Homebrew or scans installed standard nvm versions for the highest compatible one, even when Finder launches the app without an nvm PATH. An explicit `--node` override covers other installations. Python and Node checks use fixed arguments, a minimal environment without preload variables, asynchronous subprocesses, a three-check concurrency limit, a whole-verification timeout, and bounded output; scripts and arbitrary interpreter commands are rejected. Path checks require an absolute path or `~/`, while file-hash checks reject symlinks and stay inside the vault. Environment-variable checks report existence only, never the value. VaultDesk still does not install dependencies, register MCP servers, or prove that an agent can complete a workflow; run an end-to-end task for that final claim.

VaultDesk provides a read-only MCP server through `vaultdesk mcp serve`, optionally pinned with `--vault <path>`. Register that command in the agent client to expose Vault listing, catalog, asset search, and tool-card queries. The server redacts common credential patterns but never runs recorded commands, checks third-party upstream versions, starts or health-checks third-party MCP servers, or writes agent configuration. Never put tokens, keys, or private URLs in a card.

## External skills

Some tools ship a skill directory and rewrite it during setup or upgrades. If the vault also managed that path, the two writers could overwrite each other. An external skill card records the owner and path and reports state without writing the content. A read-only check does not by itself make the tool the owner.

```yaml
schema: 1
name: reverse-engineer-anything
owner: rea-agents
path: ~/.agents/skills/reverse-engineer-anything
version: "49"
expected_hash: sha256:...
related_tool: rea
description: Reverse engineering workflows bundled with the REA tool.
notes: Owned by rea-agents; re-pin after a tool update.
```

`path` is absolute or starts with `~/` and must be outside the vault. `name` must not collide with a managed skill. One path has one owner: VaultDesk rejects a path that already carries a `.vault-managed` marker. `expected_hash` is optional and pins the content snapshot. The card's `version` is recorded by the user; VaultDesk only reads an observed version from the skill's `SKILL.md` `metadata.version` and does not query the installed tool's version. `related_tool` points at a tool card name.

| Status | Meaning |
| --- | --- |
| `ok` | A pinned hash is present and matches the directory |
| `observed` | The skill is readable and no hash is pinned |
| `drift` | The pinned hash no longer matches |
| `missing` | The path does not exist |
| `invalid` | The path exists but has no `SKILL.md` |
| `conflict` | A `.vault-managed` marker is present, so another owner claims the path |

VaultDesk hashes the directory while ignoring VaultDesk metadata, `.vault-managed`, `.DS_Store`, `.git`, `node_modules`, and `.vault`. It reads the description and `metadata.version` for display. `vault validate` reports a path inside the vault, an install target that references an external skill, an invalid card, a name/file mismatch, or a duplicate name as an error. Drift, a missing path, and a stale marker are warnings.

```bash
vaultdesk external list --vault "$VAULT"
vaultdesk external show reverse-engineer-anything --vault "$VAULT"

vaultdesk external add reverse-engineer-anything --vault "$VAULT" \
  --owner rea-agents --path ~/.agents/skills/reverse-engineer-anything \
  --related-tool rea --pin --yes

vaultdesk external remove reverse-engineer-anything --vault "$VAULT" --yes
```

`add` previews first and writes only with `--yes`. It refuses a managed skill name or a path inside the vault, and warns when the path does not exist yet (a missing path plus `--pin` is an error). After the owning tool updates its skill, re-run `add <name> --force --pin` to accept the new snapshot.

`adopt` transfers a vault-managed skill to the tool that already owns its path:

```bash
vaultdesk external adopt reverse-engineer-anything --vault "$VAULT" \
  --owner rea-agents --path ~/.agents/skills/reverse-engineer-anything \
  --related-tool rea --pin --yes
```

It accepts only a standalone source with exactly one skill, outside the vault, with no marker or a marker owned by this vault. It removes the source metadata, lock entry, target references, managed content, vendor copy, and this vault's marker, then writes the external card. A marker owned by another vault blocks the adopt. `external remove` deletes only the card and never touches the external path.

### Recommending ownership when a tool arrives

Before importing a new tool or its skills, inspect the path and its tool and apply the user's existing ownership decision. If ownership is unresolved, give a recommendation and ask for that decision. Existing authorization for the same action does not require another confirmation.

- **The tool manages itself** (its installer or updater owns and rewrites the skill path): recommend an external card. REA is the default example. A read-only attribution or integrity check alone does not imply this ownership.
- **VaultDesk should manage it**: recommend a normal source.
- **Another manager owns it**: recommend leaving it in place; optionally record an external card with that manager as owner.
- **A separate copy is needed**: recommend a fork to a new path and name.

State the evidence and recommendation, for example: "REA's setup rewrites this skill, so I recommend an external card owned by rea-agents." Follow an owner already chosen by the user. One path has one owner.

`vaultdesk build` writes `build/external-skills.json` with `observed_hash`, `observed_version`, and `status` for each card. Agents read the card, the index, or `external show --json`, then install and update the tool themselves.

`vaultdesk vault list --json` lists explicitly registered Vaults without scanning the home directory. `agent catalog --json` and the read-only MCP server report ownership, update modes, fresh master/target marker and hash checks, plugin targets, tool installation guidance, and external owners. Without agent-specific probes, `installState`, `enabledState`, `connectedState`, and `agentLoaded` remain `unknown`. Registered files do not prove that an agent loaded a skill or connected to MCP.

## Vault layout

VaultDesk supports the v2 layout and can open, validate, and migrate v1 vaults.

```text
vault.yml                  # vault metadata, defaults, install targets
vault.lock                 # upstream commits and content hashes
sources/<name>.yml         # source metadata: origin, ref, update mode
skills/<name>/SKILL.md     # local skills
packages/<pkg>/skills/...  # imported multi-skill packages
plugins/<name>/            # whole plugin roots
tools/<name>.yml           # record-only external tool cards
external-skills/<name>.yml # record-only cards for tool-managed skills
third_party/<name>/        # pristine copy of GitHub plugin roots
build/skills/<name>/       # generated skill output
build/tools.json           # generated tool index
build/external-skills.json # generated external observation index
.vault/state.json          # local machine state, gitignored
```

VaultDesk uses `.vault-managed` for managed skill copies/master directories and `.vaultdesk-plugin-managed` for plugin file targets. Per-skill links are recorded in the master marker. Manual skill installation can back up an explicitly selected unmanaged slot; automatic distribution stops on unknown ownership or manual edits instead of overwriting them.

## Architecture

```text
┌──────────────────────────────┐
│ Desktop renderer (React)     │  no Node integration
└──────────────┬───────────────┘
               │ typed IPC, validated with zod
┌──────────────▼───────────────┐
│ Electron main process        │  filesystem, Git, network
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ packages/core                │  vault model, import, plugins,
│                              │  tool cards, external skills,
│                              │  search, build, install
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ packages/schema              │  zod schemas and IPC contracts
└──────────────────────────────┘
               ▲
               │
┌──────────────┴───────────────┐
│ packages/cli                 │  vaultdesk CLI, JSON envelopes
└──────────────────────────────┘
```

Repository layout:

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Electron app, React renderer, preload bridge |
| `packages/cli/` | `vaultdesk` command-line interface |
| `packages/core/` | Vault model, import, plugins, tool cards, external skills, build, install, Git |
| `packages/schema/` | Zod schemas and shared IPC types |
| `agent-skill/vaultdesk/` | Agent skill bundled with the app and CLI |
| `fixtures/` | Public v1 and v2 test vaults |
| `tests/` | Vitest integration tests and Playwright Electron E2E |
| `docs/` | Design, plugin rules, release notes, and interop notes |

The renderer has no Node access. The main process owns all filesystem, Git, and network work behind zod-validated IPC. VaultDesk does not start a local HTTP server. External links open in the system browser.

## Safety model

- **Preview manual writes.** The CLI requires `--yes`, and the app requires confirmation. Only remote sources set to `auto` sync to registered destinations without another prompt.
- **Fetch outside the vault.** Upstream content lands in the cache first. `source check` may update ignored local state; tracked vault content is written only after the preview is accepted.
- **GitHub content is read-only until forked.** GitHub-origin skills cannot be edited in place.
- **Plugin files can be distributed; plugin code is not executed.** Only explicitly registered file targets are managed. Hooks, scripts, commands, and MCP servers inside a plugin root are never run by VaultDesk, and it does not generate marketplace or adapter manifests.
- **Tool cards are records.** No download, installation, tool-command execution, upstream version check, or agent registration; explicit runtime checks are limited to declared read-only probes.
- **External skills belong to their tool.** VaultDesk reads and hashes the path, reports drift, and never writes it. `adopt` removes only vault-owned content and a marker owned by this vault.
- **One owner per path.** A managed skill and an external skill cannot share a path; a marker from another owner blocks `adopt`.
- **Automatic sync protects unmanaged directories.** Explicit manual installs can back up an old directory; automatic sync pauses the affected source on unknown ownership or local edits. Automatic distribution keeps at most three completed backups or seven days of history.
- **Automatic commits check for sensitive content.** High-confidence credential paths, private keys, Python caches, and token patterns pause the source before commit/push, reporting only paths and risk types. This reduces accidental disclosure; it is not a complete secret-detection guarantee.
- **Git staging is explicit.** VaultDesk commits only the paths it changed. It never runs `git add -A` and refuses paths outside the vault or under `.git`.
- **Verification has a defined scope.** `target verify` proves that expected files exist and hashes match. It does not prove that an agent loaded a skill.
- **Secrets stay out.** Do not store tokens, keys, or private URLs in a vault, a plugin record, or a tool card.

## Testing

```bash
pnpm typecheck
pnpm test             # unit and integration tests
pnpm test:e2e         # CLI + desktop Playwright suites
pnpm test:e2e:cli
pnpm test:e2e:desktop
pnpm test:e2e:dmg     # package the DMG, mount it, and verify the app
```

The E2E suites launch the real Electron app and the built CLI against isolated temporary vaults, local bare Git remotes, and a local HTTP server for auth and network exit codes. They never touch a real vault. The accessibility scenarios scan each view with axe-core, including the external-skill inspector. Failed runs keep their workspace under `$TMPDIR` and print the path.

CI runs typecheck, unit and integration tests, and builds on macOS and Ubuntu. The macOS job also runs the Electron smoke test, uploads a screenshot, packages the DMG, and uploads it as a build artifact.

See [tests/e2e/README.md](tests/e2e/README.md) for the scenario matrix and deliberate coverage limits.
Release QA results are recorded in [docs/QA-CURRENT.md](docs/QA-CURRENT.md); [docs/RELEASE.md](docs/RELEASE.md) keeps the current and historical release records.

## Status

| Area | State |
| --- | --- |
| Desktop app and CLI | 1.2.9; Apple Silicon DMG published, CLI bundled and installable from Settings |
| Tool cards and MCP view | Runtime checks and cross-category MCP discovery in v1.2.3; Miniconda base is the preferred Python in v1.2.4; agent catalog and read-only MCP discovery in v1.2.5 |
| External skill records | Included in v1.2.0 |
| DMG | Apple Silicon release; ad-hoc signed, not notarized |
| GitHub Release / Homebrew / npm | GitHub Release published; Homebrew and npm not published |
| Automatic source sync | Available in the installed macOS app; per-source auto/review/pause controls |
| Windows and Linux desktop | Not included in v1.2.9 |

The desktop app is macOS-only at 1.2.9. The source CLI is tested on macOS and Ubuntu; the DMG CLI uses Electron's bundled Node runtime.

## Contributing

Issues and pull requests are welcome. Before changing behavior, read:

- [docs/DESIGN.md](docs/DESIGN.md) for the data model, CLI contract, and safety rules
- [docs/PLUGINS.md](docs/PLUGINS.md) for plugin detection, validation, and update rules
- [agent-skill/vaultdesk/SKILL.md](agent-skill/vaultdesk/SKILL.md) for the agent-facing contract

Keep ownership boundaries intact. VaultDesk stores, validates, and distributes managed skill/plugin files to registered targets. Agent activation, external tool installation, and tool-owned paths remain with their owner; VaultDesk does not execute plugin/tool commands, generate marketplace or adapter manifests, or write agent configuration. For a new asset type, determine the owner from the user's request and existing authorization; clarify only unresolved ownership or scope.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e
```

Small, focused pull requests with a test that covers the change are easiest to review. When behavior changes, update [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md) together.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This repository contains the tool, tests, fixtures, and public documentation. It does not contain the maintainer's personal vault or third-party skill content.

<p align="center"><sub>Copyright © 2026 coderWang404</sub></p>

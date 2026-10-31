# Agent tool management audit

Date: 2026-10-31. Scope: agent discovery, installation guidance, source ownership, managed distribution, automatic updates, and truthful status reporting.

## Capability contract

| Asset | Discovery and installation | Update owner | Verification |
| --- | --- | --- | --- |
| Managed skill | CLI catalog or read-only MCP, `target install`, then `source distribute` | VaultDesk remote source policy; local edits require intentional distribution | Ownership marker, installed hash, current Vault hash, agent-side discovery separately |
| Managed plugin root | Plugin inventory and assets; explicit plugin target, followed by agent registration | VaultDesk updates registered file targets; agent-owned caches retain their owner | Plugin target marker/hash and current Vault hash; activation is checked in the agent |
| MCP, CLI, app, or external plugin tool card | Official installation/run instructions, capabilities, related skills, declared runtime profiles | Official package manager or tool updater | `tool verify` checks declared prerequisites; registration, connection and end-to-end use need agent evidence |
| Tool-owned external skill | Owner/path/tool association and read-only observation | Owning tool | Pinned or observed hash; VaultDesk does not write its files |

The catalog is a registry view, not a scan of every tool installed on the computer. MCP clients must explicitly register `vaultdesk mcp serve`; CLI-based agents can use the bundled VaultDesk skill and `agent catalog --json`. The desktop DMG does not independently install a global CLI command; the documented source-built CLI remains necessary for that command.

## Defects addressed

- Added a unified agent catalog and five read-only MCP queries instead of requiring agents to infer the inventory from unrelated pages.
- Added explicit plugin target controls and clearer separation of file distribution, runtime prerequisites, and agent activation.
- Detect modified plugin targets even when upstream has no new commit.
- Refresh intact but outdated managed masters and active targets after an update that changed only Vault contents. Respect review/frozen source modes and paused targets, and preserve manual edits.
- Accept this Vault's valid legacy master markers; recognize target roots equal to the shared master; validate the recorded symlink slot without resolving away its path identity.
- Report `outdated` when a valid installed hash differs from current Vault content. A valid marker alone no longer implies the newest version.
- Correct contradictory plugin installation instructions and include all MCP-capable cards, including plugin/CLI cards tagged `mcp`, in agent guidance.
- Redact common credential patterns from MCP output and inspect automatic commit paths for sensitive/generated files. This is a heuristic check, not a comprehensive secret scanner. One user's previous upload authorization is not a global permanent bypass.

## Verification and limits

Tests exercise real local Git remotes, updates, distribution, rollback, unrelated staged changes, push failures, new/deleted upstream skills, unknown ownership, frozen targets, and MCP JSON-RPC over a real CLI subprocess. Desktop E2E covers all registered Vaults, the headless worker, pending adoption, plugin/tool pages, keyboard access, and both themes. Release-specific test totals and artifact evidence are recorded in `QA-CURRENT.md`.

The local acceptance check found 38 managed master skills and 20 registered target-skill entries matching the Vault; the external REA skill retained its owner and matched its pin. The installed background worker also updated the VaultDesk skill and committed/pushed its managed changes. The PPT Master SVG-to-PPTX profile passed seven prerequisite checks in its isolated Python environment. Other optional workflows were not thereby certified.

`agentLoaded`, `enabledState`, and `connectedState` remain unknown without an agent-specific probe. Reading a tool card does not install its dependencies, run an installer, register MCP, or upgrade an externally owned binary. Agents must complete these steps under the user's installation request and verify actual use before reporting a tool ready. No universal installer or automatic activation across arbitrary agents is claimed.

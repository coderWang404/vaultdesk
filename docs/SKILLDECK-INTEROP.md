# SkillDeck interoperability

Status: decision record for 1.0. No adapter or shared-lock integration ships in 1.0.

## Why this document exists

SkillDeck is a macOS GUI for installing agent skills into `~/.agents/skills` and
symlinking them into agent-specific directories. VaultDesk also installs skills,
so users reasonably ask whether the two tools can share one registry or one
lock file. This note records what SkillDeck actually does, what VaultDesk does,
and why 1.0 keeps them independent.

## Sources

All SkillDeck facts below were checked against the upstream repository, not
against third-party summaries:

- Repository: <https://github.com/crossoverJie/SkillDeck> (MIT)
- Clone HEAD: `238b2d06a24e7d29911b90bea7513c2095babe3e` (2026-10-26)
- Latest release at review time: `v0.1.2` (2026-10-26)
- Relevant files:
  - `Sources/SkillDeck/Utilities/Constants.swift` — shared path and lock path
  - `Sources/SkillDeck/Models/LockEntry.swift` — lock fields and version
  - `Sources/SkillDeck/Services/LockFileManager.swift` — read/write behavior
  - `Sources/SkillDeck/Services/SymlinkManager.swift` — symlink model
  - `Sources/SkillDeck/Models/AgentType.swift` — per-agent directories
  - `Sources/SkillDeck/Models/SkillScope.swift` — global vs project scope
  - `Sources/SkillDeck/Services/CommitHashCache.swift` — explicit decision not
    to change the lock format because it is shared with `npx skills`

## What SkillDeck owns

- Canonical storage: `~/.agents/skills/<name>/`.
- Agent exposure: symlinks from each agent's skill directory to the canonical
  directory. The canonical copy is the real copy; agent directories are links.
- Global lock: `~/.agents/.skill-lock.json`, `version: 3`, with a `skills` map
  keyed by skill name. Each entry carries `source`, `sourceType`, `sourceUrl`,
  `skillPath`, `skillFolderHash`, `installedAt`, and `updatedAt`; the file also
  carries optional `dismissed` and `lastSelectedAgents` fields.
- Writes are atomic and serialized as pretty-printed JSON with sorted keys.
- The lock is shared with the `npx skills` ecosystem. SkillDeck deliberately
  avoids changing its shape for that reason.
- Scope: the global lock describes global installs. Project-level
  `skills-lock.json` files are not managed by this lock.

## What VaultDesk owns

- A Git-backed vault is the source of truth: `sources/<name>.yml`, `vault.lock`,
  `skills/`, `plugins/`, and `third_party/`.
- Installation is an explicit copy step from `build/skills/<name>/` into a
  user-registered destination, recorded in the vault's `vault.yml`.
- Managed copies carry a `.vault-managed` marker. The vault lock records hashes;
  `target verify` is a path-level check that files are in place and unmodified.
- VaultDesk never claims an installed skill was loaded by an agent.
- GitHub-origin content is read-only until forked; plugins are stored and
  displayed but never installed or executed.

## Decision for 1.0

VaultDesk does not read, write, mirror, or migrate `.skill-lock.json`.

Reasons:

1. **Different semantics.** SkillDeck's lock describes installed copies and
   update provenance; VaultDesk's `vault.lock` describes source snapshots and
   per-target install hashes. Treating one as the other would produce false
   "up to date" and false "modified" states.
2. **No stable public contract.** The file is a version-3 format kept compatible
   with `npx skills`, and SkillDeck explicitly avoids changing it. That is a
   compatibility promise, not a published API with a versioning policy.
3. **Write risk.** An integration would make both tools rewrite the same global
   file. A field-preserving merge is possible in theory, but a single missed
   field or a concurrent write can corrupt state for tools the user did not
   involve in the operation.
4. **Scope.** Reading the lock would still not prove that an agent loaded a
   skill, which is exactly the claim VaultDesk refuses to make. The lock adds
   coupling without adding trustworthy evidence.

There is no hidden compatibility mode: `VAULTDESK_PRESETS_FILE` only changes
the list of candidate destinations, and no code path touches
`~/.agents/.skill-lock.json`.

## Coexistence behavior

- `~/.agents/skills` remains a candidate preset for installs. The preset is
  labeled unverified, and the user must confirm the destination.
- If a destination slot is a symlink, the install plan reports
  `replace-symlink` and shows the link target before confirmation. Applying the
  plan removes only the link; the canonical target directory is not touched.
  The link stays gone until the user or SkillDeck recreates it.
- If a destination slot is an unmanaged real directory, VaultDesk moves it to
  its backup root before writing. Unmanaged content is never deleted silently.
- If a slot is a VaultDesk-managed copy (`.vault-managed` present), VaultDesk
  replaces it during reinstall or update.
- Plugin roots under `plugins/` and `third_party/` are inside the vault and are
  not visible to SkillDeck's scanner.

Users who want zero interaction between the tools should register a VaultDesk
target outside `~/.agents/skills` and leave SkillDeck's canonical tree alone.

## What would change this decision

A future integration needs, at minimum:

- a documented, versioned lock schema with change policy, and
- an explicit opt-in that names the shared file and previews every write, or
- a one-way export with no writes to the shared file.

Until then, "works next to SkillDeck without touching its files" is the
supported behavior. VaultDesk does not claim SkillDeck compatibility beyond
that.

## Verification

- `tests/presets.test.ts` covers preset parsing and verify-command execution.
- `tests/e2e/desktop.e2e.mts` installs a custom preset under a sandboxed `HOME`
  and verifies that no write escapes the sandbox.
- There is no test that reads or writes `.skill-lock.json`, by design.

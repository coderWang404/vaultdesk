import YAML from "yaml";
import { presetsFileSchema, type ToolPreset } from "@vaultdesk/schema";
import { isFile, readText } from "./fsx.js";

// Candidate discovery locations only. None of these are treated as verified by
// VaultDesk; the desktop UI labels them as unverified until a user checks the
// tool's current documentation and records it.
const CANDIDATES: ToolPreset[] = [
  {
    id: "shared-agents",
    label: "Shared agent skills",
    dest: "~/.agents/skills",
    verified_at: null,
    verified_version: null,
    docs_url: null,
    verification_required: true,
    notes: "Convention used by several agent tools. Confirm your tools read this directory before installing.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    dest: "~/.claude/skills",
    verified_at: null,
    verified_version: null,
    docs_url: "https://docs.anthropic.com/en/docs/claude-code/skills",
    verification_required: true,
    notes: "Confirm the current skill discovery rules in the Claude Code documentation.",
  },
  {
    id: "codex",
    label: "Codex",
    dest: "~/.codex/skills",
    verified_at: null,
    verified_version: null,
    docs_url: null,
    verification_required: true,
    notes: "Candidate location. Verify against the installed Codex version before installing.",
  },
  {
    id: "qoder",
    label: "Qoder",
    dest: "~/.qoder/skills",
    verified_at: null,
    verified_version: null,
    docs_url: null,
    verification_required: true,
    notes: "Candidate location. Verify against the installed Qoder version before installing.",
  },
];

export function listPresets(): ToolPreset[] {
  const file = process.env.VAULTDESK_PRESETS_FILE;
  if (!file || !isFile(file)) return CANDIDATES.map((preset) => ({ ...preset }));
  try {
    const parsed = presetsFileSchema.safeParse(YAML.parse(readText(file)));
    if (parsed.success) return parsed.data.tools;
  } catch {
    // fall through to candidates
  }
  return CANDIDATES.map((preset) => ({ ...preset }));
}

export function presetById(id: string): ToolPreset | undefined {
  return listPresets().find((preset) => preset.id === id);
}

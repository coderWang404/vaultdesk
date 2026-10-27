import path from "node:path";
import { VaultDeskError } from "./errors.js";
import { frontmatterDescription, frontmatterName, parseFrontmatter } from "./frontmatter.js";
import { isFile, readText } from "./fsx.js";

export interface BundledAgentSkill {
  name: string;
  description: string;
  path: string;
  content: string;
}

export function readBundledAgentSkill(dir: string): BundledAgentSkill {
  const file = path.join(dir, "SKILL.md");
  if (!isFile(file)) {
    throw new VaultDeskError("operation-failed", `Bundled agent skill not found: ${file}`);
  }
  const content = readText(file);
  const parsed = parseFrontmatter(content);
  const name = frontmatterName(parsed.data);
  const description = frontmatterDescription(parsed.data);
  if (parsed.error || !name?.trim() || !description) {
    throw new VaultDeskError("operation-failed", `Bundled agent skill is invalid: ${file}`, {
      details: { error: parsed.error ?? "missing name or description" },
    });
  }
  return {
    name: name.trim(),
    description,
    path: file,
    content,
  };
}

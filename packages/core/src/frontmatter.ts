import YAML from "yaml";

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
  error?: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { data: {}, body: normalized, error: "missing YAML frontmatter" };
  }
  try {
    const parsed = YAML.parse(match[1] ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: {}, body: normalized.slice(match[0].length), error: "frontmatter must be a YAML mapping" };
    }
    return { data: parsed as Record<string, unknown>, body: normalized.slice(match[0].length) };
  } catch (error) {
    return {
      data: {},
      body: normalized.slice(match[0].length),
      error: `invalid frontmatter: ${(error as Error).message}`,
    };
  }
}

export function frontmatterName(data: Record<string, unknown>): string | undefined {
  return typeof data.name === "string" ? data.name : undefined;
}

export function frontmatterDescription(data: Record<string, unknown>): string | undefined {
  const value = data.description;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

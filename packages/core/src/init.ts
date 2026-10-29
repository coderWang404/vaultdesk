import path from "node:path";
import YAML from "yaml";
import { ensureDir, exists, isDirectory, listDirectory, writeTextAtomic } from "./fsx.js";
import { VaultDeskError } from "./errors.js";
import { git } from "./git.js";

export interface InitOptions {
  name?: string;
  git?: boolean;
}

export interface InitResult {
  path: string;
  name: string;
  files: string[];
  gitInitialized: boolean;
  warnings: string[];
}

function vaultReadme(name: string): string {
  return `# ${name}

This is a VaultDesk vault. Git is the source of truth; install directories are
rebuildable artifacts.

- \`vault.yml\` holds the vault name and install targets.
- \`sources/<name>.yml\` describes each source. Local skills get their content in
  \`skills/\` or \`packages/<name>/skills/\`.
- \`vault.lock\` pins upstream commits and content hashes.
- \`.vault/\` holds local state and is not committed.
- \`build/\` is generated and ignored.

Open this directory with VaultDesk or run \`vaultdesk vault status\`.
`;
}

export async function initVault(inputPath: string, options: InitOptions = {}): Promise<InitResult> {
  const vaultPath = path.resolve(inputPath);
  if (exists(vaultPath)) {
    if (!isDirectory(vaultPath)) {
      throw new VaultDeskError("invalid-input", `Path is not a directory: ${vaultPath}`);
    }
    const entries = listDirectory(vaultPath).filter((entry) => entry.name !== ".DS_Store");
    if (entries.length > 0) {
      throw new VaultDeskError("path-conflict", `Directory is not empty: ${vaultPath}`);
    }
  } else {
    ensureDir(vaultPath);
  }

  const name = options.name?.trim() || path.basename(vaultPath);
  const files: string[] = [];
  const write = (relative: string, content: string): void => {
    writeTextAtomic(path.join(vaultPath, relative), content);
    files.push(relative);
  };

  write(
    "vault.yml",
    YAML.stringify(
      {
        schema: 1,
        name,
        defaults: { ref: "main", update_mode: "auto" },
        targets: [],
      },
      { lineWidth: 0 },
    ),
  );
  write("vault.lock", YAML.stringify({ schema: 1, sources: {} }, { lineWidth: 0 }));
  write(".vault/.gitignore", "state.json\noperation.json\n");
  write(".gitignore", "build/\n.DS_Store\n");
  write("sources/.gitkeep", "");
  write("README.md", vaultReadme(name));

  const warnings: string[] = [];
  let gitInitialized = false;
  if (options.git) {
    const result = await git(["init", "-b", "main"], vaultPath, { allowFailure: true, timeoutMs: 15_000 });
    if (result.code === 0) {
      gitInitialized = true;
    } else {
      const fallback = await git(["init"], vaultPath, { allowFailure: true, timeoutMs: 15_000 });
      if (fallback.code === 0) {
        gitInitialized = true;
      } else {
        warnings.push(`git init failed: ${result.stderr || fallback.stderr}`);
      }
    }
  }

  return { path: vaultPath, name, files, gitInitialized, warnings };
}

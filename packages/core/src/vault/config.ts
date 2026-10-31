import path from "node:path";
import YAML from "yaml";
import { vaultFileSchema, type VaultFile } from "@vaultdesk/schema";
import { isFile, readText, writeTextAtomic } from "../fsx.js";
import { VaultDeskError } from "../errors.js";

export function readVaultFile(vaultPath: string): VaultFile {
  const file = path.join(vaultPath, "vault.yml");
  if (!isFile(file)) {
    throw new VaultDeskError("not-a-vault", `vault.yml is missing at ${vaultPath}`);
  }
  let raw: unknown;
  try {
    raw = YAML.parse(readText(file));
  } catch (error) {
    throw new VaultDeskError("unsupported-schema", `vault.yml is invalid: ${(error as Error).message}`);
  }
  const parsed = vaultFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VaultDeskError(
      "unsupported-schema",
      `vault.yml is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export function writeVaultFile(vaultPath: string, file: VaultFile): void {
  const ordered = {
    schema: 1,
    name: file.name,
    defaults: {
      ref: file.defaults.ref,
      update_mode: file.defaults.update_mode,
    },
    targets: [...file.targets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((target) => ({
        id: target.id,
        dest: target.dest,
        names: [...target.names],
        ...(target.skills_only ? { skills_only: true } : {}),
        install_after_update: target.install_after_update,
      })),
    ...(file.plugin_targets && file.plugin_targets.length > 0
      ? {
          plugin_targets: [...file.plugin_targets]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((target) => ({
              id: target.id,
              dest: target.dest,
              names: [...target.names],
              install_after_update: target.install_after_update,
            })),
        }
      : {}),
  };
  writeTextAtomic(path.join(vaultPath, "vault.yml"), YAML.stringify(ordered, { lineWidth: 0 }));
}

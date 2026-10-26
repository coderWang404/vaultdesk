import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import {
  addGithubSource,
  applyImport,
  applyMigration,
  buildVault,
  checkSources,
  commitPaths,
  forkSkill,
  getGitSummary,
  initVault,
  installSkills,
  listBackups,
  listPresets,
  openVault,
  planMigration,
  previewAddGithub,
  previewFork,
  previewImport,
  previewUpdate,
  push,
  readSettings,
  readSkillContent,
  removeSource,
  resolveCommitPaths,
  removeTarget,
  restoreBackup,
  searchVaults,
  sourceDiff,
  updateSources,
  validateVault,
  verifyTarget,
  writeSkillContent,
  writeSettings,
  type BackupEntry,
} from "@vaultdesk/core";
import { ipcCommands, type IpcCommand, type IpcPayload } from "@vaultdesk/schema";
import { addRecent, readRecents, removeRecent } from "./recents.js";

export interface CommandContext {
  version: string;
}

type Handler<K extends IpcCommand> = (payload: IpcPayload<K>, context: CommandContext) => unknown;

const handlers: { [K in IpcCommand]: Handler<K> } = {
  "vault.open": async ({ path: vaultPath }) => {
    const snapshot = await openVault(vaultPath);
    addRecent(snapshot.path, snapshot.name);
    return snapshot;
  },
  "vault.reload": ({ vaultPath }) => openVault(vaultPath),
  "vault.close": async ({ path: vaultPath }) => ({ closed: vaultPath }),
  "vault.create": async ({ path: vaultPath, name, git }) => {
    const result = await initVault(vaultPath, { name, git });
    const snapshot = await openVault(result.path);
    addRecent(snapshot.path, snapshot.name);
    return { init: result, snapshot };
  },
  "vault.validate": ({ vaultPath }) => validateVault(vaultPath),
  "vault.migrationPreview": ({ vaultPath }) => planMigration(vaultPath),
  "vault.migrationApply": ({ vaultPath }) => applyMigration(vaultPath),

  "source.check": async ({ vaultPath, names }) => {
    const report = await checkSources(vaultPath, { names, persist: true });
    return report;
  },
  "source.diff": ({ vaultPath, name }) => sourceDiff(vaultPath, name),
  "source.updatePreview": ({ vaultPath, names }) => previewUpdate(vaultPath, names),
  "source.update": async ({ vaultPath, names, commit, install, force, message }) => {
    const settings = readSettings();
    return updateSources(vaultPath, {
      names,
      commit,
      install,
      force,
      commitMessage: message,
      backupRoot: settings.backupRoot,
      retention: settings.backupRetention,
    });
  },
  "source.forkPreview": ({ vaultPath, skill, as }) => previewFork(vaultPath, skill, as),
  "source.fork": ({ vaultPath, skill, as }) => forkSkill(vaultPath, skill, as),
  "source.addLocal": async ({ vaultPath, path: inputPath, name, kind, entrypoint, confirm }) => {
    if (!confirm) return previewImport(inputPath, vaultPath, name, { kind, entrypoint });
    return applyImport(inputPath, vaultPath, { name, kind, entrypoint });
  },
  "source.addGithub": async ({ vaultPath, repo, ref, path: contentPath, name, kind, entrypoint, confirm }) => {
    if (!confirm) return previewAddGithub(vaultPath, { repo, ref, path: contentPath, name, kind, entrypoint });
    return addGithubSource(vaultPath, { repo, ref, path: contentPath, name, kind, entrypoint });
  },
  "source.remove": ({ vaultPath, name, deleteFiles }) =>
    removeSource(vaultPath, name, { deleteFiles }),

  "build.run": ({ vaultPath }) => buildVault(vaultPath),
  "target.list": async ({ vaultPath }) => (await openVault(vaultPath)).targets,
  "target.install": async ({ vaultPath, names, dest, id, dryRun, confirm }) => {
    const settings = readSettings();
    return installSkills(vaultPath, {
      names,
      dest,
      id,
      dryRun: dryRun || !confirm,
      backupRoot: settings.backupRoot,
      retention: settings.backupRetention,
    });
  },
  "target.remove": ({ vaultPath, id, deleteFiles }) => {
    const settings = readSettings();
    return removeTarget(vaultPath, id, {
      deleteFiles,
      backupRoot: settings.backupRoot,
      retention: settings.backupRetention,
    });
  },
  "target.verify": ({ vaultPath, id }) => verifyTarget(vaultPath, id),
  "target.backups": async ({ vaultPath, targetId }): Promise<{ backups: BackupEntry[] }> => {
    const settings = readSettings();
    return { backups: await listBackups(targetId, settings.backupRoot) };
  },
  "target.restore": ({ vaultPath, id, backupPath, name }) => {
    const settings = readSettings();
    return restoreBackup(vaultPath, {
      targetId: id,
      backupPath,
      name,
      backupRoot: settings.backupRoot,
      retention: settings.backupRetention,
    });
  },

  "skill.read": ({ vaultPath, skill }) => readSkillContent(vaultPath, skill),
  "skill.write": ({ vaultPath, skill, content }) => writeSkillContent(vaultPath, skill, content),

  "import.preview": ({ vaultPath, path: inputPath, name }) => previewImport(inputPath, vaultPath, name),
  "import.apply": ({ vaultPath, path: inputPath, name, kind, entrypoint }) =>
    applyImport(inputPath, vaultPath, { name, kind, entrypoint }),

  "git.status": ({ vaultPath }) => getGitSummary(vaultPath),
  "git.commit": async ({ vaultPath, paths, message }) => {
    const summary = await getGitSummary(vaultPath);
    const commit = await commitPaths(vaultPath, resolveCommitPaths(summary, paths), message);
    return { commit, summary: await getGitSummary(vaultPath) };
  },
  "git.push": async ({ vaultPath }) => {
    const result = await push(vaultPath);
    return { ...result, summary: await getGitSummary(vaultPath) };
  },

  "search.query": ({ vaults, query, limit }) => searchVaults({ query, vaults, limit }),
  "presets.list": () => listPresets(),

  "app.info": async (_payload, context) => ({
    version: context.version,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  "app.settings": () => readSettings(),
  "app.setSettings": ({ settings }) => writeSettings(settings),
  "app.recents": () =>
    readRecents().map((entry) => ({ ...entry, exists: fs.existsSync(entry.path) })),
  "app.addRecent": ({ path: vaultPath }) => addRecent(vaultPath, path.basename(vaultPath)),
  "app.removeRecent": ({ path: vaultPath }) => removeRecent(vaultPath),
  "app.reveal": async ({ path: target }) => {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      await shell.openPath(target);
    } else {
      shell.showItemInFolder(target);
    }
    return { revealed: target };
  },
  "app.openExternal": async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Refusing to open non-web URL: ${url}`);
    }
    await shell.openExternal(parsed.toString());
    return { opened: parsed.toString() };
  },
};

export const knownCommands = Object.keys(ipcCommands) as IpcCommand[];

export async function runCommand(
  command: IpcCommand,
  payload: unknown,
  context: CommandContext,
): Promise<unknown> {
  const schema = ipcCommands[command];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Invalid payload for ${command}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const handler = handlers[command] as Handler<IpcCommand>;
  return handler(parsed.data as never, context);
}

export function warningsOf(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const value = (data as { warnings?: unknown }).warnings;
  if (!Array.isArray(value)) return [];
  return value
    .map((warning) => {
      if (typeof warning === "string") return warning;
      if (warning && typeof warning === "object" && "message" in warning) {
        return String((warning as { message: unknown }).message);
      }
      return "";
    })
    .filter(Boolean);
}

import fs from "node:fs";
import path from "node:path";
import { clipboard, shell } from "electron";
import {
  addGithubPlugin,
  addGithubSource,
  adoptPendingSkills,
  applyImport,
  applyMigration,
  applyPluginImport,
  buildVault,
  checkSources,
  commitPaths,
  detectLocalPlugin,
  forkSkill,
  getGitSummary,
  initVault,
  installSkills,
  listBackups,
  listPendingSkills,
  listPresets,
  openVault,
  planMigration,
  previewAddGithub,
  previewFork,
  previewGithubPlugin,
  previewImport,
  previewPluginImport,
  previewPresetVerify,
  previewUpdate,
  push,
  readBundledAgentSkill,
  readSettings,
  readSkillContent,
  removeSource,
  resolveCommitPaths,
  removeTarget,
  restoreBackup,
  runPresetVerifyCommand,
  searchVaults,
  setSourceUpdateMode,
  sourceDiff,
  updateSources,
  validateVault,
  verifyTarget,
  verifyToolReadiness,
  writeSkillContent,
  writeSettings,
  VaultDeskError,
  type BackupEntry,
} from "@vaultdesk/core";
import { ipcCommands, type IpcCommand, type IpcPayload } from "@vaultdesk/schema";
import { addRecent, readRecents, removeRecent } from "./recents.js";
import { readAutoSyncActivity, runAutoSyncAll } from "./background-sync.js";
import { backgroundStatus, configureLaunchAgent } from "./launch-agent.js";

export interface CommandContext {
  version: string;
  agentSkillDir: string;
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
  "source.autoSync": ({ vaultPath }) => runAutoSyncAll(vaultPath, "manual"),
  "source.setUpdateMode": async ({ vaultPath, name, mode }) => {
    await setSourceUpdateMode(vaultPath, name, mode);
    return { name, mode };
  },
  "source.pending": ({ vaultPath, name }) => listPendingSkills(vaultPath, name),
  "source.adopt": ({ vaultPath, name, paths }) => {
    const settings = readSettings();
    return adoptPendingSkills(vaultPath, name, paths, {
      backupRoot: settings.backupRoot,
      retention: settings.backupRetention,
      retentionDays: settings.backupRetentionDays,
    });
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
  "source.addLocal": async ({ vaultPath, path: inputPath, name, kind, entrypoint, plugin, noPlugin, confirm }) => {
    if (!noPlugin && detectLocalPlugin(inputPath, { force: plugin })) {
      if (!confirm) return previewPluginImport(inputPath, vaultPath, { name, force: plugin });
      return applyPluginImport(inputPath, vaultPath, { name, force: plugin });
    }
    if (!confirm) return previewImport(inputPath, vaultPath, name, { kind, entrypoint });
    return applyImport(inputPath, vaultPath, { name, kind, entrypoint });
  },
  "source.addGithub": async ({ vaultPath, repo, ref, path: contentPath, name, kind, entrypoint, plugin, noPlugin, confirm }) => {
    const pluginInput = { repo, ref, path: contentPath, name, force: plugin };
    let pluginPreview: Awaited<ReturnType<typeof previewGithubPlugin>> | null = null;
    if (!noPlugin) {
      try {
        pluginPreview = await previewGithubPlugin(vaultPath, pluginInput);
      } catch (error) {
        if (!(error instanceof VaultDeskError) || error.code !== "not-a-plugin") throw error;
      }
    }
    if (pluginPreview) {
      if (!confirm) return pluginPreview;
      return addGithubPlugin(vaultPath, pluginInput);
    }
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
  "tool.verify": ({ vaultPath, name, profile, pythonPath, nodePath }) =>
    verifyToolReadiness(vaultPath, name, { profile, pythonPath, nodePath }),
  "target.backups": async ({ vaultPath, targetId }): Promise<{ backups: BackupEntry[] }> => {
    const settings = readSettings();
    const backups = await listBackups(targetId, settings.backupRoot);
    if (targetId) return { backups };

    // Keep orphaned snapshots visible, but resolve registered targets from
    // their current and legacy backup roots before displaying or restoring.
    const snapshot = await openVault(vaultPath);
    const owners = new Map<string, string | null>();
    for (const target of snapshot.targets) {
      for (const entry of await listBackups(target.id, settings.backupRoot)) {
        if (!owners.has(entry.path)) owners.set(entry.path, target.id);
        else if (owners.get(entry.path) !== target.id) owners.set(entry.path, null);
      }
    }
    return { backups: backups.map((entry) => ({ ...entry, targetId: owners.get(entry.path) ?? entry.targetId })) };
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

  "import.preview": ({ vaultPath, path: inputPath, name }) =>
    detectLocalPlugin(inputPath)
      ? previewPluginImport(inputPath, vaultPath, { name })
      : previewImport(inputPath, vaultPath, name),
  "import.apply": ({ vaultPath, path: inputPath, name, kind, entrypoint }) =>
    detectLocalPlugin(inputPath)
      ? applyPluginImport(inputPath, vaultPath, { name })
      : applyImport(inputPath, vaultPath, { name, kind, entrypoint }),

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
  "presets.verifyCommand": async ({ id, confirm }) => {
    if (!confirm) return previewPresetVerify(id);
    return runPresetVerifyCommand(id, { confirm: true });
  },
  "agentSkill.show": (_payload, context) => readBundledAgentSkill(context.agentSkillDir),

  "app.info": async (_payload, context) => ({
    version: context.version,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  "app.settings": () => readSettings(),
  "app.setSettings": ({ settings }) => {
    const saved = writeSettings(settings);
    configureLaunchAgent(saved.autoSyncEnabled && saved.checkIntervalHours > 0);
    return saved;
  },
  "app.autoSyncNow": ({ vaultPath }) => runAutoSyncAll(vaultPath, "manual"),
  "app.autoSyncActivity": ({ limit }) => readAutoSyncActivity(limit),
  "app.backgroundStatus": () => backgroundStatus(),
  "app.recents": () =>
    readRecents().map((entry) => ({ ...entry, exists: fs.existsSync(entry.path) })),
  "app.addRecent": ({ path: vaultPath }) => addRecent(vaultPath, path.basename(vaultPath)),
  "app.removeRecent": ({ path: vaultPath }) => removeRecent(vaultPath),
  "app.reveal": async ({ path: target }) => {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const error = await shell.openPath(target);
      if (error) throw new VaultDeskError("operation-failed", `无法打开目录 ${target}：${error}`);
    } else {
      if (!fs.existsSync(path.dirname(target))) {
        throw new VaultDeskError("operation-failed", `无法在 Finder 中显示：父目录不存在（${target}）`);
      }
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
  "app.copyText": ({ text }) => {
    clipboard.writeText(text);
    return { copied: text.length };
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
    throw new VaultDeskError(
      "invalid-input",
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

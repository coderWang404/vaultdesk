import { z } from "zod";
import { packageKindSchema, slugSchema } from "./vault.js";

const vaultPath = z.string().min(1);
const names = z.array(slugSchema).min(1).optional();

export const ipcCommands = {
  "vault.open": z.object({ path: vaultPath }),
  "vault.reload": z.object({ vaultPath }),
  "vault.close": z.object({ path: vaultPath }),
  "vault.create": z.object({
    path: vaultPath,
    name: z.string().min(1).optional(),
    git: z.boolean().default(false),
  }),
  "vault.validate": z.object({ vaultPath }),
  "vault.migrationPreview": z.object({ vaultPath }),
  "vault.migrationApply": z.object({ vaultPath, confirm: z.literal(true) }),
  "source.check": z.object({ vaultPath, names }),
  "source.diff": z.object({ vaultPath, name: slugSchema }),
  "source.updatePreview": z.object({ vaultPath, names }),
  "source.update": z.object({
    vaultPath,
    names,
    commit: z.boolean().default(false),
    install: z.boolean().default(false),
    force: z.boolean().default(false),
    message: z.string().trim().min(1).optional(),
    confirm: z.literal(true),
  }),
  "source.forkPreview": z.object({
    vaultPath,
    skill: slugSchema,
    as: slugSchema.optional(),
  }),
  "source.fork": z.object({
    vaultPath,
    skill: slugSchema,
    as: slugSchema.optional(),
    confirm: z.literal(true),
  }),
  "source.addLocal": z.object({
    vaultPath,
    path: vaultPath,
    name: slugSchema.optional(),
    kind: packageKindSchema.optional(),
    entrypoint: slugSchema.optional(),
    confirm: z.boolean().default(false),
  }),
  "source.addGithub": z.object({
    vaultPath,
    repo: z.string().min(3),
    ref: z.string().default("main"),
    path: z.string().optional(),
    name: slugSchema.optional(),
    kind: packageKindSchema.optional(),
    entrypoint: slugSchema.optional(),
    confirm: z.boolean().default(false),
  }),
  "source.remove": z.object({
    vaultPath,
    name: slugSchema,
    deleteFiles: z.boolean().default(false),
    confirm: z.literal(true),
  }),
  "build.run": z.object({ vaultPath }),
  "target.list": z.object({ vaultPath }),
  "target.install": z.object({
    vaultPath,
    names: z.array(slugSchema).min(1),
    dest: vaultPath,
    id: z.string().min(1).optional(),
    dryRun: z.boolean().default(false),
    confirm: z.boolean().default(false),
  }),
  "target.remove": z.object({
    vaultPath,
    id: z.string().min(1),
    deleteFiles: z.boolean().default(false),
    confirm: z.literal(true),
  }),
  "target.verify": z.object({ vaultPath, id: z.string().min(1) }),
  "target.backups": z.object({ vaultPath, targetId: z.string().min(1).optional() }),
  "target.restore": z.object({
    vaultPath,
    id: z.string().min(1),
    backupPath: vaultPath,
    name: slugSchema,
    confirm: z.literal(true),
  }),
  "skill.read": z.object({ vaultPath, skill: slugSchema }),
  "skill.write": z.object({ vaultPath, skill: slugSchema, content: z.string() }),
  "import.preview": z.object({ vaultPath, path: vaultPath, name: slugSchema.optional() }),
  "import.apply": z.object({
    vaultPath,
    path: vaultPath,
    name: slugSchema.optional(),
    kind: packageKindSchema.optional(),
    entrypoint: slugSchema.optional(),
    confirm: z.literal(true),
  }),
  "git.status": z.object({ vaultPath }),
  "git.commit": z.object({
    vaultPath,
    paths: z.array(z.string().min(1)).min(1),
    message: z.string().trim().min(1),
    confirm: z.literal(true),
  }),
  "git.push": z.object({ vaultPath, confirm: z.literal(true) }),
  "search.query": z.object({
    vaults: z.array(z.object({ path: vaultPath, label: z.string().optional() })).min(1),
    query: z.string(),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  "presets.list": z.object({}),
  "app.info": z.object({}),
  "app.settings": z.object({}),
  "app.setSettings": z.object({
    settings: z.object({
      checkIntervalHours: z.number().int().min(0).max(720).default(24),
      backupRetention: z.number().int().min(1).max(100).default(10),
      backupRoot: z.string().optional(),
    }),
  }),
  "app.recents": z.object({}),
  "app.addRecent": z.object({ path: vaultPath }),
  "app.removeRecent": z.object({ path: vaultPath }),
  "app.reveal": z.object({ path: vaultPath }),
  "app.openExternal": z.object({ url: z.string().url() }),
} as const;

export type IpcCommands = typeof ipcCommands;
export type IpcCommand = keyof IpcCommands;
export type IpcPayload<K extends IpcCommand> = z.infer<IpcCommands[K]>;

export const ipcRequestSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  payload: z.unknown(),
});

export interface IpcErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export type IpcResponse<T = unknown> =
  | { ok: true; data: T; warnings: string[] }
  | { ok: false; error: IpcErrorShape };

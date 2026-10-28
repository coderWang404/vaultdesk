import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits, and hyphens");

const optionalPath = z.string().min(1).optional();

export const originSchema = z.enum(["github", "local"]);
export const shapeSchema = z.enum(["standalone", "package", "plugin"]);
export const packageKindSchema = z.enum(["suite", "collection"]);
export const updateModeSchema = z.enum(["review-before-apply", "auto"]);

export const skillEntrySchema = z.object({
  name: slugSchema,
  source_path: optionalPath,
  vendor_path: optionalPath,
  target_path: optionalPath,
  user_invocable: z.boolean().optional(),
  description: z.string().optional(),
});

export const forkedFromSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1),
  source_path: z.string().min(1),
  commit: z.string().min(1).optional(),
});

export const sourceFileSchema = z
  .object({
    schema: z.literal(1).default(1),
    name: slugSchema,
    shape: shapeSchema,
    kind: packageKindSchema.optional(),
    entrypoint: slugSchema.optional(),
    origin: originSchema,
    repo: z.string().min(1).optional(),
    remote_url: z.string().min(1).optional(),
    ref: z.string().min(1).default("main"),
    content_path: optionalPath,
    version: z.string().optional(),
    description: z.string().optional(),
    update_mode: updateModeSchema.default("review-before-apply"),
    skills: z.array(skillEntrySchema).default([]),
    script_deps: z.record(z.array(z.string())).optional(),
    forked_from: forkedFromSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (source.shape === "package" && !source.kind) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "package sources require kind" });
    }
    if (source.shape === "package" && source.skills.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills"], message: "package sources require at least one skill" });
    }
    if (source.shape === "plugin") {
      if (source.kind) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "plugin sources must not set kind" });
      }
      if (source.entrypoint) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entrypoint"], message: "plugin sources must not set entrypoint" });
      }
      if (source.skills.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["skills"],
          message: "plugin sources must not declare skills; members are discovered from the plugin root",
        });
      }
      if (source.forked_from) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["forked_from"], message: "plugin sources must not set forked_from" });
      }
    }
    if (source.shape === "standalone" && source.kind) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "standalone sources must not set kind" });
    }
    if (source.kind === "suite") {
      if (!source.entrypoint) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entrypoint"], message: "suite requires entrypoint" });
      } else if (!source.skills.some((skill) => skill.name === source.entrypoint)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entrypoint"],
          message: "entrypoint must name a declared skill",
        });
      }
    }
    if (source.kind === "collection" && source.entrypoint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entrypoint"], message: "collection must not set entrypoint" });
    }
    if (source.shape === "standalone" && source.skills.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills"], message: "standalone sources declare exactly one skill" });
    }
    if (source.origin === "github") {
      if (!source.repo) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["repo"], message: "github sources require repo" });
      }
      if (source.shape !== "plugin") {
        for (const [index, skill] of source.skills.entries()) {
          if (!skill.source_path) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills", index, "source_path"], message: "github skills require source_path" });
          }
          if (!skill.vendor_path) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills", index, "vendor_path"], message: "github skills require vendor_path" });
          }
        }
      }
    }
    if (source.origin === "local") {
      for (const key of ["repo", "ref", "remote_url"] as const) {
        if (key === "ref" ? source.ref !== "main" : Boolean(source[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "local sources must not track an upstream",
          });
        }
      }
    }
    const names = source.skills.map((skill) => skill.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills"], message: "duplicate skill names" });
    }
  });

export const targetSchema = z.object({
  id: z.string().min(1),
  dest: z.string().min(1).refine((value) => value.startsWith("/") || value === "~" || value.startsWith("~/"), {
    message: "dest must be absolute or start with ~/",
  }),
  names: z.array(slugSchema).min(1),
  install_after_update: z.boolean().default(true),
});

export const vaultFileSchema = z.object({
  schema: z.literal(1).default(1),
  name: z.string().min(1),
  defaults: z
    .object({
      ref: z.string().min(1).default("main"),
      update_mode: updateModeSchema.default("review-before-apply"),
    })
    .default({ ref: "main", update_mode: "review-before-apply" }),
  targets: z.array(targetSchema).default([]),
});

export const lockSchema = z.object({
  schema: z.literal(1).default(1),
  sources: z
    .record(
      z.object({
        commit: z.string().min(1).optional(),
        hash: z.string().min(1).optional(),
        skills: z.record(z.string()).optional(),
      }),
    )
    .default({}),
});

export const vaultStateSchema = z.object({
  schema: z.literal(1).default(1),
  last_checked_at: z.string().optional(),
  last_applied_at: z.string().optional(),
  sources: z
    .record(
      z.object({
        checked_at: z.string().optional(),
        remote_commit: z.string().optional(),
        applied_at: z.string().optional(),
        status: z
          .enum(["current", "update-available", "not-downloaded", "auth-failed", "error", "unknown"])
          .optional(),
        error: z.string().optional(),
      }),
    )
    .default({}),
  targets: z
    .record(
      z.object({
        last_installed_at: z.string().optional(),
        installed_hash: z.string().optional(),
        backup_path: z.string().optional(),
      }),
    )
    .default({}),
});

export const operationStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  detail: z.string().optional(),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
});

export const operationSchema = z.object({
  schema: z.literal(1).default(1),
  kind: z.enum(["migrate", "update", "install", "fork", "import", "remove", "restore", "adopt"]),
  started_at: z.string(),
  vault: z.string(),
  steps: z.array(operationStepSchema),
  error: z.string().optional(),
});

export const presetSchema = z.object({
  id: z.string(),
  label: z.string(),
  dest: z.string(),
  verified_at: z.string().nullable(),
  verified_version: z.string().nullable(),
  docs_url: z.string().nullable(),
  verification_required: z.boolean().default(true),
  verify_command: z.string().trim().min(1).nullable().default(null),
  notes: z.string().optional(),
});

export const presetsFileSchema = z.object({
  schema: z.literal(1).default(1),
  tools: z.array(presetSchema),
});

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), { message: "must be an http or https URL" });

export const toolKindSchema = z.enum(["plugin", "mcp", "cli", "app"]);
export const toolInstallSchema = z.object({
  label: z.string().trim().min(1),
  command: z.string().trim().min(1),
});

export const toolCardSchema = z.object({
  schema: z.literal(1).default(1),
  name: slugSchema,
  kind: toolKindSchema,
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  homepage: httpUrlSchema,
  docs: httpUrlSchema.optional(),
  recorded_version: z.string().trim().min(1).optional(),
  install: z.array(toolInstallSchema).min(1),
  run: z.string().trim().min(1).optional(),
  requirements: z.array(z.string().trim().min(1)).default([]),
  related_skills: z.array(slugSchema).default([]),
  tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase tags")).default([]),
  notes: z.string().trim().min(1).optional(),
});

export const externalSkillCardSchema = z.object({
  schema: z.literal(1).default(1),
  name: slugSchema,
  owner: z.string().trim().min(1),
  path: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/") || value === "~" || value.startsWith("~/"), {
      message: "path must be absolute or start with ~/",
    }),
  title: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  expected_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/, "must be a sha256 hash").optional(),
  related_tool: slugSchema.optional(),
  description: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
});

export type Origin = z.infer<typeof originSchema>;
export type Shape = z.infer<typeof shapeSchema>;
export type PackageKind = z.infer<typeof packageKindSchema>;
export type UpdateMode = z.infer<typeof updateModeSchema>;
export type SkillEntry = z.infer<typeof skillEntrySchema>;
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type Target = z.infer<typeof targetSchema>;
export type VaultFile = z.infer<typeof vaultFileSchema>;
export type LockFile = z.infer<typeof lockSchema>;
export type VaultState = z.infer<typeof vaultStateSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type OperationStep = z.infer<typeof operationStepSchema>;
export type ToolPreset = z.infer<typeof presetSchema>;
export type ToolKind = z.infer<typeof toolKindSchema>;
export type ToolInstall = z.infer<typeof toolInstallSchema>;
export type ToolCard = z.infer<typeof toolCardSchema>;
export type ExternalSkillCard = z.infer<typeof externalSkillCardSchema>;

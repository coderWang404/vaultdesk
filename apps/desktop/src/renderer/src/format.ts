import type {
  CheckStatus,
  ExternalSkillStatus,
  PluginAgent,
  PluginAssetKind,
  PluginRecord,
  SkillRecord,
  SourceRecord,
  TargetRecord,
  ToolRecord,
  ValidationIssue,
  VaultSnapshot,
} from "@vaultdesk/core";

export function shortSha(value: string | undefined, length = 7): string {
  return value ? value.slice(0, length) : "—";
}

export function formatDate(value: string | undefined): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value: string | undefined): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

export function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "current":
      return "已是最新";
    case "update-available":
      return "有更新";
    case "not-downloaded":
      return "未拉取";
    case "auth-failed":
      return "认证失败";
    case "error":
      return "检查失败";
    case "local":
      return "本地";
    default:
      return "未检查";
  }
}

export function statusTone(status: CheckStatus): "ok" | "warn" | "danger" | "muted" | "neutral" {
  switch (status) {
    case "current":
      return "ok";
    case "update-available":
      return "warn";
    case "auth-failed":
    case "error":
      return "danger";
    case "local":
      return "muted";
    default:
      return "neutral";
  }
}

export function originLabel(origin: SkillRecord["origin"] | "external"): string {
  if (origin === "github") return "GitHub";
  return origin === "external" ? "外部托管" : "本地";
}

export function externalStatusLabel(status: ExternalSkillStatus): string {
  switch (status) {
    case "ok":
      return "已同步";
    case "observed":
      return "观察中";
    case "drift":
      return "内容漂移";
    case "missing":
      return "路径缺失";
    case "invalid":
      return "不是技能";
    case "conflict":
      return "归属冲突";
  }
}

export function externalStatusTone(
  status: ExternalSkillStatus,
): "ok" | "warn" | "danger" | "muted" | "neutral" {
  switch (status) {
    case "ok":
      return "ok";
    case "drift":
    case "missing":
      return "warn";
    case "invalid":
    case "conflict":
      return "danger";
    default:
      return "muted";
  }
}

export function sourceShapeLabel(source: SourceRecord): string {
  if (source.shape === "standalone") return "独立技能";
  return source.kind === "suite" ? "套件" : "合集";
}

export function toolKindLabel(kind: ToolRecord["kind"]): string {
  switch (kind) {
    case "plugin":
      return "插件分发";
    case "mcp":
      return "MCP 服务";
    case "cli":
      return "命令行";
    case "app":
      return "桌面应用";
  }
}

export function skillCountLabel(target: TargetRecord): string {
  return `${target.installed.length}/${target.skills.length}`;
}

export function hashLabel(hash: string | undefined): string {
  if (!hash) return "—";
  return hash.replace(/^sha256:/, "").slice(0, 10);
}

export function plural(count: number, unit: string): string {
  return `${count} ${unit}`;
}

export function installedFor(skill: SkillRecord): string {
  return skill.installed.length > 0 ? skill.installed.map((entry) => entry.targetId).join("、") : "未安装";
}

export function issuesForPlugin(vault: VaultSnapshot, plugin: PluginRecord): ValidationIssue[] {
  const roots = [
    plugin.workingPath,
    plugin.metadataPath,
    ...plugin.skills.flatMap((skill) => [skill.workingPath, skill.relativePath]),
  ];
  return vault.issues.filter((issue) => {
    if (!issue.path) return false;
    return roots.some((root) => issue.path === root || issue.path?.startsWith(`${root}/`));
  });
}

export function pluginAgentLabel(agent: PluginAgent): string {
  switch (agent) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "qoder":
      return "Qoder";
    default:
      return "通用";
  }
}

export function assetKindLabel(kind: PluginAssetKind): string {
  switch (kind) {
    case "skills":
      return "技能";
    case "commands":
      return "命令";
    case "agents":
      return "子代理";
    case "hooks":
      return "hooks";
    case "mcp":
      return "MCP";
    case "rules":
      return "规则";
    case "workflows":
      return "工作流";
    default:
      return "其他";
  }
}

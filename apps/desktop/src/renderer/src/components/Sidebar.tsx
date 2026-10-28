import type { VaultSnapshot } from "@vaultdesk/core";
import type { Section } from "../types";
import { shortSha, relativeTime } from "../format";
import { Icon, type IconName } from "./icons";
import { Button, StatusPill } from "./ui";

const NAV: { id: Section; label: string; icon: IconName }[] = [
  { id: "overview", label: "总览", icon: "overview" },
  { id: "sources", label: "来源", icon: "source" },
  { id: "skills", label: "技能", icon: "skill" },
  { id: "plugins", label: "插件", icon: "sparkle" },
  { id: "mcp", label: "MCP", icon: "server" },
  { id: "tools", label: "工具", icon: "terminal" },
  { id: "targets", label: "安装目标", icon: "target" },
  { id: "git", label: "Git", icon: "git" },
  { id: "settings", label: "设置", icon: "settings" },
];

export function Sidebar({
  vault,
  section,
  checking,
  onSection,
  onCheck,
  onReveal,
  onMigration,
}: {
  vault: VaultSnapshot;
  section: Section;
  checking: boolean;
  onSection: (section: Section) => void;
  onCheck: () => void;
  onReveal: () => void;
  onMigration: () => void;
}) {
  const updates = vault.sources.filter((source) => source.status === "update-available").length;
  const errorCount = vault.issues.filter((issue) => issue.severity === "error").length;
  const mcpCount = vault.tools.filter((tool) => tool.kind === "mcp").length;
  const counts: Record<Section, number | string | undefined> = {
    overview: undefined,
    sources: vault.counts.sources,
    skills:
      vault.counts.externalSkills > 0
        ? `${vault.counts.skills}+${vault.counts.externalSkills}`
        : vault.counts.skills,
    plugins: vault.counts.plugins,
    mcp: mcpCount,
    tools: vault.counts.tools,
    targets: vault.counts.targets,
    git: vault.git.changes.length || undefined,
    settings: undefined,
  };

  return (
    <aside className="sidebar">
      <div className="vault-identity">
        <div className="vault-identity-top">
          <span className="vault-glyph">
            <Icon name="vault" size={19} />
          </span>
          <div className="vault-identity-copy">
            <h2>{vault.name}</h2>
            <button className="vault-path" onClick={onReveal} title="在 Finder 中显示">
              <Icon name="folder" size={12} />
              <span>{vault.path.replace(/^\/Users\/[^/]+/, "~")}</span>
            </button>
          </div>
        </div>
        <div className="vault-tags">
          <StatusPill tone={vault.format === "v1" ? "warn" : "accent"}>
            {vault.format === "v1" ? "v1 · 只读" : "v2"}
          </StatusPill>
          {vault.git.isRepo ? (
            <StatusPill tone={vault.git.dirty ? "warn" : "muted"}>
              <Icon name="branch" size={11} /> {vault.git.branch ?? "detached"}
            </StatusPill>
          ) : (
            <StatusPill tone="muted">无 Git</StatusPill>
          )}
          {errorCount > 0 ? <StatusPill tone="danger">{errorCount} 错误</StatusPill> : null}
        </div>
      </div>

      <nav className="nav">
        <span className="nav-label">仓库</span>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${section === item.id ? "is-active" : ""}`}
            onClick={() => onSection(item.id)}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
            {counts[item.id] !== undefined ? <em>{counts[item.id]}</em> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      {vault.format === "v1" ? (
        <div className="sidebar-note">
          <span className="sidebar-note-title">
            <Icon name="info" size={14} /> 旧版仓库
          </span>
          <p>当前以只读方式打开 v1 元数据。迁移预览不会写盘。</p>
          <Button size="sm" variant="quiet" onClick={onMigration}>
            预览迁移
          </Button>
        </div>
      ) : null}

      <div className="source-health">
        <div className="source-health-head">
          <span>上游状态</span>
          <span className={`health-dot ${updates > 0 ? "has-updates" : ""}`} />
        </div>
        <p>
          {updates > 0 ? `${updates} 个来源有更新` : "所有已检查来源均为最新"}
        </p>
        <div className="health-meta">
          <Icon name="clock" size={12} />
          <span>上次检查 {relativeTime(vault.state?.last_checked_at)}</span>
        </div>
        <Button size="sm" variant="ghost" icon="refresh" onClick={onCheck} loading={checking}>
          立即检查
        </Button>
      </div>

      <div className="sidebar-footer">
        <span className="commit-dot" />
        <span>
          {vault.git.isRepo ? `HEAD ${shortSha(vault.git.head)}` : "未纳入版本控制"}
        </span>
      </div>
    </aside>
  );
}

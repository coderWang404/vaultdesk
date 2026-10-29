import type { VaultSnapshot } from "@vaultdesk/core";
import type { Section } from "../types";
import { shortSha, relativeTime } from "../format";
import { Icon, type IconName } from "./icons";
import { Button, StatusMark, StatusPill } from "./ui";

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
  drawerOpen,
  section,
  checking,
  collapsed,
  onToggle,
  onSection,
  onCheck,
  onReveal,
  onMigration,
}: {
  vault: VaultSnapshot;
  drawerOpen: boolean;
  section: Section;
  checking: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSection: (section: Section) => void;
  onCheck: () => void;
  onReveal: () => void;
  onMigration: () => void;
}) {
  const updates = vault.sources.filter((source) => source.status === "update-available").length;
  const checkFailures = vault.sources.filter(
    (source) => source.status === "error" || source.status === "auth-failed",
  ).length;
  const githubCount = vault.sources.filter((source) => source.origin === "github").length;
  const lastChecked = vault.state?.last_checked_at;
  const healthText = checkFailures > 0
    ? `${checkFailures} 个检查失败${updates > 0 ? ` · ${updates} 个待更新` : ""}`
    : updates > 0
      ? `${updates} 个待更新`
      : githubCount === 0
        ? "没有 GitHub 来源"
        : lastChecked
          ? "已检查来源无更新"
          : "尚未检查";
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
    <aside className="sidebar" aria-label="仓库导航" inert={drawerOpen}>
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
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            <Icon name="source" size={16} />
          </button>
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

      <nav className="nav" aria-label="页面">
        <span className="nav-label">仓库</span>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${section === item.id ? "is-active" : ""}`}
            aria-current={section === item.id ? "page" : undefined}
            aria-label={collapsed ? item.label + (counts[item.id] !== undefined ? " " + counts[item.id] : "") : undefined}
            title={collapsed ? item.label : undefined}
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
            <Icon name="info" size={14} /> v1 只读
          </span>
          <Button size="sm" variant="quiet" onClick={onMigration}>
            预览迁移
          </Button>
        </div>
      ) : null}

      <div className="source-health">
        <div className="source-health-head">
          <span>上游</span>
          <StatusMark
            tone={checkFailures > 0 ? "danger" : updates > 0 ? "warn" : lastChecked && githubCount > 0 ? "ok" : "muted"}
            label={healthText}
            size={13}
          />
        </div>
        <p>{healthText}</p>
        <div className="health-meta" title="上次检查">
          <Icon name="clock" size={12} />
          <span>{relativeTime(vault.state?.last_checked_at)}</span>
        </div>
        <div className="source-health-actions">
          <Button size="sm" variant="ghost" icon="refresh" onClick={onCheck} loading={checking}>
            立即检查
          </Button>
          {checkFailures > 0 ? (
            <Button size="sm" variant="quiet" onClick={() => onSection("sources")}>
              查看来源
            </Button>
          ) : null}
        </div>
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

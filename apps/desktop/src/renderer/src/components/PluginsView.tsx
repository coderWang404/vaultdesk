import { useMemo, useState } from "react";
import type { PluginRecord, VaultSnapshot } from "@vaultdesk/core";
import {
  issuesForPlugin,
  originLabel,
  pluginAgentLabel,
  relativeTime,
  shortSha,
  statusLabel,
  statusTone,
} from "../format";
import { Icon } from "./icons";
import { Button, EmptyState, SectionHeader, StatusPill } from "./ui";

type Filter = "all" | "github" | "local";

export function PluginsView({
  vault,
  selected,
  onSelect,
  onImport,
}: {
  vault: VaultSnapshot;
  selected: string | null;
  onSelect: (plugin: PluginRecord) => void;
  onImport: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const plugins = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vault.plugins
      .filter((plugin) => filter === "all" || plugin.origin === filter)
      .filter((plugin) => {
        if (!needle) return true;
        return (
          plugin.name.toLowerCase().includes(needle) ||
          plugin.description?.toLowerCase().includes(needle) ||
          plugin.repo?.toLowerCase().includes(needle) ||
          plugin.version?.toLowerCase().includes(needle) ||
          plugin.manifests.some((manifest) => manifest.agent.includes(needle)) ||
          plugin.skills.some((skill) => skill.name.toLowerCase().includes(needle))
        );
      });
  }, [vault.plugins, filter, query]);

  return (
    <div className="view plugins-view">
      <SectionHeader
        eyebrow="插件"
        title="登记在仓库里的插件"
        description="VaultDesk 只保存、校验和展示插件。安装、启用与适配由你的 agent 读取插件根后自行完成，这里不会写入任何 agent 目录。"
        actions={
          <Button variant="primary" icon="plus" onClick={onImport}>
            导入插件
          </Button>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选插件、manifest、描述或插件内技能…"
            aria-label="筛选插件"
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery("")} aria-label="清除筛选">
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        <div className="segmented" role="group" aria-label="插件来源">
          {([
            ["all", "全部"],
            ["github", "GitHub"],
            ["local", "本地"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="toolbar-count">{plugins.length} 个插件</span>
      </div>

      {plugins.length === 0 ? (
        <EmptyState icon="sparkle" title={vault.plugins.length === 0 ? "这个仓库还没有插件" : "没有匹配的插件"}>
          {vault.plugins.length === 0
            ? "导入带 manifest 的插件目录；VaultDesk 只写入仓库，不会安装到 agent。"
            : "换一个关键词，或切换来源筛选。"}
          {vault.plugins.length === 0 ? (
            <div className="empty-action">
              <Button size="sm" onClick={onImport}>
                导入插件
              </Button>
            </div>
          ) : null}
        </EmptyState>
      ) : (
        <div className="source-list">
          {plugins.map((plugin) => {
            const issues = issuesForPlugin(vault, plugin);
            return (
              <article
                key={plugin.name}
                className={`source-row plugin-row ${selected === plugin.name ? "is-selected" : ""}`}
                onClick={() => onSelect(plugin)}
              >
                <div className={`source-glyph origin-${plugin.origin}`}>
                  <Icon name="sparkle" size={18} />
                </div>
                <div className="source-row-main">
                  <div className="source-row-title">
                    <h3>{plugin.name}</h3>
                    {plugin.version ? <StatusPill tone="muted">v{plugin.version}</StatusPill> : null}
                    {plugin.manifests.map((manifest) => (
                      <StatusPill
                        key={manifest.relativePath}
                        tone={manifest.parseError ? "danger" : "neutral"}
                        title={manifest.parseError ?? manifest.relativePath}
                      >
                        {pluginAgentLabel(manifest.agent)}
                      </StatusPill>
                    ))}
                    <StatusPill tone={statusTone(plugin.status)} title={plugin.lastError}>
                      {statusLabel(plugin.status)}
                    </StatusPill>
                    {plugin.hasHooks ? <StatusPill tone="warn">含 hooks</StatusPill> : null}
                  </div>
                  <p className="source-row-repo">
                    {plugin.origin === "github" ? (
                      <>
                        <span>{plugin.repo ?? "未填写 repo"}</span>
                        <span className="repo-ref">{plugin.ref}</span>
                      </>
                    ) : (
                      <span>本地目录 · 不参与上游更新</span>
                    )}
                  </p>
                  {plugin.description ? <p className="plugin-row-copy">{plugin.description}</p> : null}
                  {plugin.lastError ? (
                    <p className="source-row-error" title={plugin.lastError}>
                      {plugin.lastError}
                    </p>
                  ) : null}
                  <div className="source-row-stats">
                    <span>
                      <Icon name="skill" size={12} /> {plugin.skills.length} 个插件内技能
                    </span>
                    <span>
                      <Icon name="file" size={12} /> {plugin.assets.length} 项资产
                    </span>
                    <span>
                      <Icon name="clock" size={12} /> 检查 {relativeTime(plugin.lastCheckedAt)}
                    </span>
                    {plugin.origin === "github" ? (
                      <span className="mono">
                        <Icon name="branch" size={12} /> {shortSha(plugin.locked?.commit)}
                      </span>
                    ) : null}
                    {issues.length > 0 ? (
                      <span className="plugin-issue-count">
                        <Icon name="alert" size={12} /> {issues.length} 条校验问题
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="source-row-actions">
                  <span className="muted-small">{originLabel(plugin.origin)}</span>
                  <Icon name="chevron-right" size={14} className="row-chevron" />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

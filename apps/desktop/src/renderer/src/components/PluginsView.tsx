import { useMemo, useState } from "react";
import type { PluginRecord, VaultSnapshot } from "@vaultdesk/core";
import {
  issuesForPlugin,
  pluginAgentLabel,
  relativeTime,
  shortSha,
  statusLabel,
  statusTone,
} from "../format";
import { Icon } from "./icons";
import { Button, EmptyState, SectionHeader, StatusMark, StatusPill } from "./ui";

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
        title="插件"
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
            placeholder="筛选插件"
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
        vault.plugins.length === 0 ? (
          <EmptyState
            icon="sparkle"
            title="还没有插件"
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={onImport}>
                导入插件
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="search"
            title="没有匹配的插件"
            action={
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                清除筛选
              </Button>
            }
          />
        )
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
                    {plugin.version ? <span className="type-chip">v{plugin.version}</span> : null}
                    {plugin.manifests.length === 0 ? (
                      <span className="type-chip" title="按 skills 与工具资产组合识别">
                        无 manifest
                      </span>
                    ) : null}
                    {plugin.manifests.map((manifest) => (
                      <span
                        className="type-chip"
                        key={manifest.relativePath}
                        title={manifest.parseError ?? manifest.relativePath}
                      >
                        {pluginAgentLabel(manifest.agent)}
                      </span>
                    ))}
                    {plugin.status === "current" || plugin.status === "local" ? (
                      <StatusMark
                        tone={plugin.status === "current" ? "ok" : "muted"}
                        label={statusLabel(plugin.status)}
                      />
                    ) : (
                      <StatusPill tone={statusTone(plugin.status)} title={plugin.lastError}>
                        {statusLabel(plugin.status)}
                      </StatusPill>
                    )}
                    {plugin.hasHooks ? <StatusPill tone="warn">含 hooks</StatusPill> : null}
                  </div>
                  <p className="source-row-repo">
                    {plugin.origin === "github" ? (
                      <>
                        <span>{plugin.repo ?? "未填写 repo"}</span>
                        <span className="repo-ref">{plugin.ref}</span>
                      </>
                    ) : (
                      <span>本地目录</span>
                    )}
                  </p>
                  {plugin.description ? (
                    <p className="plugin-row-copy clamp-1" title={plugin.description}>
                      {plugin.description}
                    </p>
                  ) : null}
                  {plugin.lastError ? (
                    <p className="source-row-error" title={plugin.lastError}>
                      {plugin.lastError}
                    </p>
                  ) : null}
                  <div className="source-row-stats">
                    <span title="插件内技能">
                      <Icon name="skill" size={12} /> {plugin.skills.length}
                    </span>
                    <span title="资产条目">
                      <Icon name="file" size={12} /> {plugin.assets.length}
                    </span>
                    <span title={`上次检查 ${relativeTime(plugin.lastCheckedAt)}`}>
                      <Icon name="clock" size={12} /> {relativeTime(plugin.lastCheckedAt)}
                    </span>
                    {plugin.origin === "github" ? (
                      <span className="mono" title="锁定 commit">
                        <Icon name="branch" size={12} /> {shortSha(plugin.locked?.commit)}
                      </span>
                    ) : null}
                    {issues.length > 0 ? (
                      <span className="plugin-issue-count" title="校验问题">
                        <Icon name="alert" size={12} /> {issues.length}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="row-actions">
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

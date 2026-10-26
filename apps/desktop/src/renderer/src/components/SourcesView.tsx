import { useMemo, useState } from "react";
import type { SourceRecord, VaultSnapshot } from "@vaultdesk/core";
import {
  relativeTime,
  shortSha,
  sourceShapeLabel,
  statusLabel,
  statusTone,
} from "../format";
import { Icon } from "./icons";
import { Button, Callout, EmptyState, SectionHeader, StatusPill } from "./ui";

type Filter = "all" | "github" | "local";

export function SourcesView({
  vault,
  selected,
  checking,
  onSelect,
  onCheck,
  onDiff,
  onUpdate,
  onImport,
  onRemove,
}: {
  vault: VaultSnapshot;
  selected: string | null;
  checking: boolean;
  onSelect: (source: SourceRecord) => void;
  onCheck: () => void;
  onDiff: (source: string) => void;
  onUpdate: (source: string) => void;
  onImport: () => void;
  onRemove: (source: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const sources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vault.sources
      .filter((source) => filter === "all" || source.origin === filter)
      .filter((source) => {
        if (!needle) return true;
        return (
          source.name.toLowerCase().includes(needle) ||
          source.repo?.toLowerCase().includes(needle) ||
          source.description?.toLowerCase().includes(needle) ||
          source.skills.some((skill) => skill.name.toLowerCase().includes(needle))
        );
      });
  }, [vault.sources, filter, query]);

  return (
    <div className="view sources-view">
      <SectionHeader
        eyebrow="来源"
        title="所有上游与本地目录"
        description="每一个来源都有独立的元数据文件。GitHub 来源可以检查更新，并在写入前查看逐文件差异。"
        actions={
          <>
            <Button icon="refresh" onClick={onCheck} loading={checking}>
              检查
            </Button>
            <Button variant="primary" icon="plus" onClick={onImport}>
              添加来源
            </Button>
          </>
        }
      />

      {vault.format === "v1" ? (
        <Callout tone="warn" title="v1 仓库以只读方式打开">
          <p>来源信息读取自 sources.yml 与 package.yml。迁移到 v2 后才能添加、更新或移除来源。</p>
        </Callout>
      ) : null}

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选来源、仓库或技能…"
            aria-label="筛选来源"
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery("")} aria-label="清除筛选">
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        <div className="segmented" role="group" aria-label="来源类型">
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
        <span className="toolbar-count">{sources.length} 个来源</span>
      </div>

      {sources.length === 0 ? (
        <EmptyState icon="source" title="没有匹配的来源">
          换一个关键词，或添加本地目录与 GitHub 仓库。
        </EmptyState>
      ) : (
        <div className="source-list">
          {sources.map((source) => (
            <article
              key={source.name}
              className={`source-row ${selected === source.name ? "is-selected" : ""}`}
              onClick={() => onSelect(source)}
            >
              <div className={`source-glyph origin-${source.origin}`}>
                <Icon name={source.origin === "github" ? "git" : "folder"} size={18} />
              </div>
              <div className="source-row-main">
                <div className="source-row-title">
                  <h3>{source.name}</h3>
                  <StatusPill tone="muted">{sourceShapeLabel(source)}</StatusPill>
                  <StatusPill tone={statusTone(source.status)} title={source.lastError}>
                    {statusLabel(source.status)}
                  </StatusPill>
                </div>
                <p className="source-row-repo">
                  {source.origin === "github" ? (
                    <>
                      <span>{source.repo ?? "未填写 repo"}</span>
                      <span className="repo-ref">{source.ref}</span>
                    </>
                  ) : (
                    <span>本地目录 · 不参与上游更新</span>
                  )}
                </p>
                {source.lastError ? (
                  <p className="source-row-error" title={source.lastError}>
                    {source.lastError}
                  </p>
                ) : null}
                <div className="source-row-stats">
                  <span>
                    <Icon name="skill" size={12} /> {source.skills.length} 个技能
                  </span>
                  <span>
                    <Icon name="clock" size={12} /> 检查 {relativeTime(source.lastCheckedAt)}
                  </span>
                  {source.origin === "github" ? (
                    <span className="mono">
                      <Icon name="branch" size={12} /> {shortSha(source.locked?.commit)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="source-row-actions" onClick={(event) => event.stopPropagation()}>
                {source.origin === "github" ? (
                  <>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => onDiff(source.name)}
                      disabled={!source.locked?.commit && source.status !== "update-available"}
                    >
                      差异
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onUpdate(source.name)}
                      disabled={vault.format === "v1" || source.status !== "update-available"}
                    >
                      更新
                    </Button>
                  </>
                ) : null}
                <button
                  className="row-more"
                  title="移除来源"
                  aria-label={`移除来源 ${source.name}`}
                  onClick={() => onRemove(source.name)}
                  disabled={vault.format === "v1"}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

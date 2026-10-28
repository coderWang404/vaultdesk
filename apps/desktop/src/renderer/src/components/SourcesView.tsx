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
import { Button, Callout, EmptyState, IconButton, SectionHeader, StatusMark, StatusPill } from "./ui";

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
        title="来源"
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
        <Callout tone="warn" title="v1 仓库只读">
          <p>迁移到 v2 后才能添加、更新或移除来源。</p>
        </Callout>
      ) : null}

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选来源"
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
        vault.sources.length === 0 ? (
          <EmptyState
            icon="source"
            title="还没有来源"
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={onImport}>
                添加来源
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="search"
            title="没有匹配的来源"
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
                  {source.origin === "github" ? (
                    source.status === "current" ? (
                      <StatusMark tone="ok" label={statusLabel(source.status)} />
                    ) : (
                      <StatusPill tone={statusTone(source.status)} title={source.lastError}>
                        {statusLabel(source.status)}
                      </StatusPill>
                    )
                  ) : null}
                </div>
                <p className="source-row-repo">
                  {source.origin === "github" ? (
                    <>
                      <span>{source.repo ?? "未填写 repo"}</span>
                      <span className="repo-ref">{source.ref}</span>
                    </>
                  ) : (
                    <span>本地目录</span>
                  )}
                </p>
                {source.lastError ? (
                  <p className="source-row-error" title={source.lastError}>
                    {source.lastError}
                  </p>
                ) : null}
                <div className="source-row-stats">
                  <span title="技能数量">
                    <Icon name="skill" size={12} />{" "}
                    {source.shape === "plugin"
                      ? (vault.plugins.find((plugin) => plugin.name === source.name)?.skills.length ?? 0)
                      : source.skills.length}
                  </span>
                  <span title={`上次检查 ${relativeTime(source.lastCheckedAt)}`}>
                    <Icon name="clock" size={12} /> {relativeTime(source.lastCheckedAt)}
                  </span>
                  {source.origin === "github" ? (
                    <span className="mono" title="锁定 commit">
                      <Icon name="branch" size={12} /> {shortSha(source.locked?.commit)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                {source.origin === "github" ? (
                  <>
                    <IconButton
                      icon="file"
                      label="查看上游差异"
                      onClick={() => onDiff(source.name)}
                      disabled={!source.locked?.commit && source.status !== "update-available"}
                    />
                    <IconButton
                      icon="download"
                      label="应用更新"
                      onClick={() => onUpdate(source.name)}
                      disabled={vault.format === "v1" || source.status !== "update-available"}
                    />
                  </>
                ) : null}
                <IconButton
                  icon="trash"
                  label={`移除来源 ${source.name}`}
                  className="is-danger"
                  onClick={() => onRemove(source.name)}
                  disabled={vault.format === "v1"}
                />
                <Icon name="chevron-right" size={14} className="row-chevron" />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

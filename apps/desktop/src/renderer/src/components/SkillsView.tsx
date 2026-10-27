import { useMemo, useState } from "react";
import type { SkillRecord, VaultSnapshot } from "@vaultdesk/core";
import { installedFor, originLabel } from "../format";
import { Icon } from "./icons";
import { Button, EmptyState, SectionHeader, StatusPill } from "./ui";

type TypeFilter = "all" | "standalone" | "suite" | "collection";

const TYPE_LABELS: Record<Exclude<TypeFilter, "all">, string> = {
  standalone: "单技能",
  suite: "套件",
  collection: "合集",
};

function skillType(skill: SkillRecord): Exclude<TypeFilter, "all"> {
  return skill.packageKind ?? "standalone";
}

function roleLabel(skill: SkillRecord): string {
  if (!skill.packageKind) return "单技能";
  if (skill.packageKind === "suite") return skill.isEntrypoint ? "入口" : "成员";
  return "成员";
}

export function SkillsView({
  vault,
  selected,
  onSelect,
  onImport,
  onEditor,
  onFork,
}: {
  vault: VaultSnapshot;
  selected: string | null;
  onSelect: (skill: SkillRecord) => void;
  onImport: () => void;
  onEditor: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [onlyInstalled, setOnlyInstalled] = useState(false);

  const skills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vault.skills
      .filter((skill) => {
        if (onlyInstalled && skill.installed.length === 0) return false;
        if (typeFilter !== "all" && skillType(skill) !== typeFilter) return false;
        return true;
      })
      .filter((skill) => {
        if (!needle) return true;
        return (
          skill.name.toLowerCase().includes(needle) ||
          skill.description?.toLowerCase().includes(needle) ||
          skill.sourceName.toLowerCase().includes(needle)
        );
      });
  }, [vault.skills, typeFilter, onlyInstalled, query]);

  const groups = useMemo(() => {
    const bySource = new Map<string, SkillRecord[]>();
    for (const skill of skills) {
      const list = bySource.get(skill.sourceName) ?? [];
      list.push(skill);
      bySource.set(skill.sourceName, list);
    }
    return [...bySource.entries()]
      .map(([sourceName, members]) => ({
        sourceName,
        source: vault.sources.find((entry) => entry.name === sourceName),
        skills: [...members].sort((a, b) => {
          if (a.isEntrypoint !== b.isEntrypoint) return a.isEntrypoint ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  }, [skills, vault.sources]);

  return (
    <div className="view skills-view">
      <SectionHeader
        eyebrow="技能"
        title="仓库里的全部技能"
        description="按来源分组展示单技能、套件与合集。GitHub 来源只读；编辑前需要 fork 成本地来源。"
        actions={
          <Button variant="primary" icon="plus" onClick={onImport}>
            导入技能
          </Button>
        }
      />

      <div className="toolbar skills-toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索技能名称、描述或来源…"
            aria-label="搜索技能"
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery("")} aria-label="清除筛选">
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        <div className="segmented" role="group" aria-label="技能类型筛选">
          {([
            ["all", "全部"],
            ["standalone", "单技能"],
            ["suite", "套件"],
            ["collection", "合集"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={typeFilter === value ? "is-active" : ""}
              onClick={() => setTypeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`filter-chip ${onlyInstalled ? "is-active" : ""}`}
          aria-pressed={onlyInstalled}
          onClick={() => setOnlyInstalled((value) => !value)}
        >
          只看已安装
        </button>
        <span className="toolbar-count">
          {skills.length} 个技能 · {groups.length} 个来源
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon="skill" title="没有匹配的技能">
          换一个关键词，或导入新的技能目录。
        </EmptyState>
      ) : (
        <div className="skill-groups">
          {groups.map((group) => (
            <SourceGroup
              key={group.sourceName}
              group={group}
              issues={vault.issues.filter((issue) => {
                if (!issue.path) return false;
                if (issue.path === group.source?.metadataPath) return true;
                return group.skills.some(
                  (skill) => issue.path === skill.relativePath || issue.path?.startsWith(`${skill.relativePath}/`),
                );
              }).length}
              selection={{ selected, onSelect, onEditor, onFork }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceGroup({
  group,
  issues,
  selection,
}: {
  group: {
    sourceName: string;
    source: VaultSnapshot["sources"][number] | undefined;
    skills: SkillRecord[];
  };
  issues: number;
  selection: {
    selected: string | null;
    onSelect: (skill: SkillRecord) => void;
    onEditor: (skill: SkillRecord) => void;
    onFork: (skill: SkillRecord) => void;
  };
}) {
  const type = group.source?.kind ?? (group.skills.length === 1 ? "standalone" : "collection");
  const origin = group.source?.origin ?? group.skills[0]?.origin ?? "local";

  return (
    <section className="skill-group">
      <header className="skill-group-header">
        <span className={`origin-glyph small origin-${origin}`}>
          <Icon name={origin === "github" ? "git" : "folder"} size={13} />
        </span>
        <strong className="skill-group-name">{group.sourceName}</strong>
        <StatusPill tone="neutral">{TYPE_LABELS[type]}</StatusPill>
        {group.source?.kind === "suite" && group.source.entrypoint ? (
          <span className="skill-group-entry">入口 {group.source.entrypoint}</span>
        ) : null}
        <span className="skill-group-meta">
          {group.skills.length} 个{type === "standalone" ? "技能" : "成员"}
        </span>
        <span className="skill-group-origin">{originLabel(origin)}</span>
        {issues > 0 ? (
          <span className="skill-group-warning" title={`${issues} 条校验问题`}>
            <Icon name="alert" size={13} />
            {issues}
          </span>
        ) : null}
      </header>
      <div className="skill-table skill-table-grouped">
        <div className="skill-table-head">
          <span>技能</span>
          <span>角色</span>
          <span>安装</span>
          <span />
        </div>
        {group.skills.map((skill) => (
          <div
            key={`${skill.sourceName}/${skill.name}`}
            className={`skill-table-row ${selection.selected === skill.name ? "is-selected" : ""}`}
            onClick={() => selection.onSelect(skill)}
          >
            <div className="skill-cell-main">
              <div>
                <strong>{skill.name}</strong>
                <p>{skill.description ?? "没有填写描述。"}</p>
              </div>
            </div>
            <div className="skill-cell-role">
              <span className={`type-chip ${skill.isEntrypoint ? "is-entry" : ""}`}>{roleLabel(skill)}</span>
            </div>
            <div className="skill-cell-installed">
              {skill.installed.length > 0 ? (
                <span className="installed-label">
                  <span className="installed-dot" />
                  {installedFor(skill)}
                </span>
              ) : (
                <span className="muted-small">未安装</span>
              )}
            </div>
            <div className="skill-row-actions" onClick={(event) => event.stopPropagation()}>
              {skill.origin === "github" ? (
                <button
                  className="row-more"
                  title="Fork 到本地"
                  aria-label={`Fork ${skill.name}`}
                  onClick={() => selection.onFork(skill)}
                >
                  <Icon name="branch" size={14} />
                </button>
              ) : (
                <button
                  className="row-more"
                  title="编辑 SKILL.md"
                  aria-label={`编辑 ${skill.name}`}
                  onClick={() => selection.onEditor(skill)}
                >
                  <Icon name="edit" size={14} />
                </button>
              )}
              <Icon name="chevron-right" size={14} className="row-chevron" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

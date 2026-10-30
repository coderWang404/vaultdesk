import { useMemo, useState } from "react";
import type { ExternalSkillRecord, SkillRecord, VaultSnapshot } from "@vaultdesk/core";
import { externalStatusLabel, externalStatusTone, originLabel } from "../format";
import { Icon } from "./icons";
import { ActionMenu, Button, EmptyState, SectionHeader, StatusMark, StatusPill } from "./ui";

type TypeFilter = "all" | "standalone" | "suite" | "collection" | "external";

const TYPE_LABELS: Record<Exclude<TypeFilter, "all">, string> = {
  standalone: "单技能",
  suite: "套件",
  collection: "合集",
  external: "外部只读",
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
  onSelectExternal,
  onImport,
  onEditor,
  onFork,
}: {
  vault: VaultSnapshot;
  selected: string | null;
  onSelect: (skill: SkillRecord) => void;
  onSelectExternal: (skill: ExternalSkillRecord) => void;
  onImport: () => void;
  onEditor: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [onlyInstalled, setOnlyInstalled] = useState(false);

  const skills = useMemo(() => {
    if (typeFilter === "external") return [];
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

  const externalSkills = useMemo(() => {
    if (typeFilter !== "all" && typeFilter !== "external") return [];
    if (onlyInstalled) return [];
    const needle = query.trim().toLowerCase();
    return vault.externalSkills.filter((skill) => {
      if (!needle) return true;
      return (
        skill.name.toLowerCase().includes(needle) ||
        skill.description?.toLowerCase().includes(needle) ||
        skill.owner.toLowerCase().includes(needle)
      );
    });
  }, [vault.externalSkills, typeFilter, onlyInstalled, query]);

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

  const externalGroups = useMemo(() => {
    const byOwner = new Map<string, ExternalSkillRecord[]>();
    for (const skill of externalSkills) {
      const list = byOwner.get(skill.owner) ?? [];
      list.push(skill);
      byOwner.set(skill.owner, list);
    }
    return [...byOwner.entries()]
      .map(([owner, members]) => ({
        owner,
        skills: [...members].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner));
  }, [externalSkills]);

  return (
    <div className="view skills-view">
      <SectionHeader
        title="技能"
        description="受管技能由 VaultDesk 分发；外部技能只读观察。文件已分发不代表运行依赖就绪。"
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
            placeholder="搜索技能"
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
            ["external", "外部托管"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={typeFilter === value ? "is-active" : ""}
              aria-pressed={typeFilter === value}
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
          {skills.length + externalSkills.length} 个技能 · {groups.length} 个来源
          {externalSkills.length > 0 ? ` · ${externalSkills.length} 个外部` : ""}
        </span>
      </div>

      {groups.length === 0 && externalGroups.length === 0 ? (
        vault.skills.length + vault.externalSkills.length === 0 ? (
          <EmptyState
            icon="skill"
            title="还没有技能"
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={onImport}>
                导入技能
              </Button>
            }
          >
            导入本地目录或 GitHub 来源，建立可检查、可安装的技能记录。
          </EmptyState>
        ) : (
          <EmptyState
            icon="search"
            title="没有匹配的技能"
            action={
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  setQuery("");
                  setTypeFilter("all");
                  setOnlyInstalled(false);
                }}
              >
                清除筛选
              </Button>
            }
          >
            试试其他关键词，或清除类型与安装状态筛选。
          </EmptyState>
        )
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
          {externalGroups.map((group) => (
            <ExternalGroup
              key={`external:${group.owner}`}
              group={group}
              selected={selected}
              onSelect={onSelectExternal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExternalGroup({
  group,
  selected,
  onSelect,
}: {
  group: { owner: string; skills: ExternalSkillRecord[] };
  selected: string | null;
  onSelect: (skill: ExternalSkillRecord) => void;
}) {
  const attention = group.skills.filter(
    (skill) => skill.status === "drift" || skill.status === "missing" || skill.status === "invalid" || skill.status === "conflict",
  ).length;

  return (
    <section className="skill-group">
      <header className="skill-group-header">
        <span className="origin-glyph small origin-external" title="外部托管">
          <Icon name="shield" size={13} />
        </span>
        <strong className="skill-group-name">{group.owner}</strong>
        <span className="type-chip">外部只读</span>
        <span className="skill-group-meta">{group.skills.length} 个</span>
        {attention > 0 ? (
          <span className="skill-group-warning" title={`${attention} 个外部技能需要确认`}>
            <Icon name="alert" size={13} />
            {attention}
          </span>
        ) : null}
      </header>
      <div className="skill-table skill-table-grouped">
        <div className="skill-table-head">
          <span>技能</span>
          <span>角色</span>
          <span>观察状态</span>
          <span />
        </div>
        {group.skills.map((skill) => (
          <div
            key={`external/${skill.name}`}
            className={`skill-table-row ${selected === skill.name ? "is-selected" : ""}`}
            onClick={() => onSelect(skill)}
          >
            <div className="skill-cell-main">
              <div>
                <strong>{skill.name}</strong>
                <p className="clamp-1" title={skill.description ?? undefined}>
                  {skill.description ?? skill.skillPath}
                </p>
              </div>
            </div>
            <div className="skill-cell-role">
              <span className="type-chip">外部只读</span>
            </div>
            <div className="skill-cell-installed">
              {skill.status === "ok" || skill.status === "observed" ? (
                <StatusMark
                  tone={skill.status === "ok" ? "ok" : "muted"}
                  label={externalStatusLabel(skill.status)}
                />
              ) : (
                <StatusPill tone={externalStatusTone(skill.status)}>{externalStatusLabel(skill.status)}</StatusPill>
              )}
            </div>
            <div className="skill-row-actions" onClick={(event) => event.stopPropagation()}>
              <Button className="row-action-primary" size="sm" variant="quiet" onClick={() => onSelect(skill)} aria-pressed={selected === skill.name} aria-label={"查看详情：" + skill.name}>
                查看详情
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
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
        <span className={`origin-glyph small origin-${origin}`} title={originLabel(origin)}>
          <Icon name={origin === "github" ? "git" : "folder"} size={13} />
        </span>
        <strong className="skill-group-name">{group.sourceName}</strong>
        <span className="type-chip">{TYPE_LABELS[type]}</span>
        <span className="skill-group-meta">{group.skills.length} 个</span>
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
          <span>文件分发</span>
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
                <p className="clamp-1" title={skill.description ?? undefined}>
                  {skill.description ?? "—"}
                </p>
              </div>
            </div>
            <div className="skill-cell-role">
              <span className={`type-chip ${skill.isEntrypoint ? "is-entry" : ""}`}>{roleLabel(skill)}</span>
            </div>
            <div
              className="skill-cell-installed"
              title={skill.installed.length > 0 ? skill.installed.map((entry) => entry.targetId).join("、") : "尚未分发文件"}
            >
              {skill.installed.length > 0 ? (
                <span className="installed-label">
                  <StatusMark tone={skill.installed.some((entry) => entry.matches === false) ? "warn" : "ok"} label={skill.installed.some((entry) => entry.matches === false) ? "文件已变化" : "文件已分发"} size={12} />
                  {skill.installed[0]?.targetId}
                  {skill.installed.length > 1 ? ` +${skill.installed.length - 1}` : ""}
                </span>
              ) : (
                <span className="install-none">—</span>
              )}
            </div>
            <div className="skill-row-actions" onClick={(event) => event.stopPropagation()}>
              <Button className="row-action-primary" size="sm" variant="quiet" onClick={() => selection.onSelect(skill)} aria-pressed={selection.selected === skill.name} aria-label={"查看详情：" + skill.name}>
                查看详情
              </Button>
              <ActionMenu label={"更多技能操作：" + skill.name}>
                {skill.origin === "github" ? (
                  <button onClick={() => selection.onFork(skill)}>Fork 到本地</button>
                ) : (
                  <button onClick={() => selection.onEditor(skill)}>编辑技能</button>
                )}
              </ActionMenu>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

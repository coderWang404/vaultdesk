import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ExternalSkillRecord, SkillRecord, VaultSnapshot } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { externalStatusLabel, externalStatusTone, originLabel } from "../format";
import type { Selection } from "../types";
import { Icon } from "./icons";
import { ActionMenu, Button, EmptyState, SectionHeader, StatusMark, StatusPill } from "./ui";
import { TargetsView } from "./TargetsView";

type TypeFilter = "all" | "standalone" | "suite" | "collection" | "external";
type SkillsPane = "library" | "distribution";

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

function readCollapsedSources(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : []);
  } catch {
    return new Set();
  }
}

export function SkillsView({
  vault,
  selection,
  onSelect,
  onSelectExternal,
  onImport,
  onInstall,
  distribution,
  onEnterDistribution,
  onEditor,
  onFork,
}: {
  vault: VaultSnapshot;
  selection: Selection;
  onSelect: (skill: SkillRecord) => void;
  onSelectExternal: (skill: ExternalSkillRecord) => void;
  onImport: () => void;
  onInstall: (names: string[]) => void;
  distribution: {
    presets: ToolPreset[];
    homePath?: string;
    onRefresh: () => Promise<VaultSnapshot | null>;
    onBackups: (targetId?: string) => void;
    onRemove: (targetId: string) => void;
    onReveal: (path: string) => void;
    onError: (message: string) => void;
  };
  onEnterDistribution: () => void;
  onEditor: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
}) {
  const [pane, setPane] = useState<SkillsPane>("library");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [selectedForInstall, setSelectedForInstall] = useState<Set<string>>(new Set());
  const storageKey = `vaultdesk.skills.collapsed:${vault.path}`;
  const [savedCollapsed, setSavedCollapsed] = useState(() => readCollapsedSources(storageKey));
  const filterContext = JSON.stringify([query.trim().toLowerCase(), typeFilter, onlyInstalled]);
  const filtering = Boolean(query.trim()) || typeFilter !== "all" || onlyInstalled;
  const [filteredFold, setFilteredFold] = useState({ context: "", sources: new Set<string>() });
  const collapsed = filtering
    ? filteredFold.context === filterContext ? filteredFold.sources : new Set<string>()
    : savedCollapsed;
  const selected = selection.kind === "skill" || selection.kind === "external" ? selection.name : null;
  const previousSelection = useRef<Selection | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify([...savedCollapsed])); }
    catch { /* Folding remains available when storage is unavailable. */ }
  }, [storageKey, savedCollapsed]);

  useEffect(() => {
    setFilteredFold({ context: filterContext, sources: new Set() });
  }, [filterContext]);

  function updateCollapsed(next: Set<string>): void {
    if (filtering) setFilteredFold({ context: filterContext, sources: next });
    else setSavedCollapsed(next);
  }

  function toggleSource(name: string): void {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    updateCollapsed(next);
  }
  const startInstall = (names: string[]): void => {
    setSelectedForInstall(new Set());
    onInstall(names);
  };

  function switchPane(next: SkillsPane): void {
    if (next === pane) return;
    if (next === "distribution") onEnterDistribution();
    setPane(next);
  }

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

  const sourceByName = useMemo(
    () => new Map(vault.sources.map((source) => [source.name, source])),
    [vault.sources],
  );
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
        source: sourceByName.get(sourceName),
        skills: [...members].sort((a, b) => {
          if (a.isEntrypoint !== b.isEntrypoint) return a.isEntrypoint ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  }, [skills, sourceByName]);
  const collapsibleGroups = groups.filter((group) => group.source?.kind === "suite" || group.source?.kind === "collection");
  const allCollapsed = collapsibleGroups.length > 0 && collapsibleGroups.every((group) => collapsed.has(group.sourceName));
  const issuesBySource = useMemo(() => {
    const result = new Map<string, number>();
    const rootsBySource = new Map<string, string[]>();
    for (const skill of skills) {
      const roots = rootsBySource.get(skill.sourceName) ?? [];
      roots.push(skill.relativePath);
      rootsBySource.set(skill.sourceName, roots);
    }
    const metadataBySource = new Map(vault.sources.map((source) => [source.name, source.metadataPath]));
    // Preserve the existing per-group semantics (a path can legitimately be
    // reported for more than one source when source roots overlap), while doing
    // the work once per snapshot instead of once for every rendered group.
    for (const issue of vault.issues) {
      const issuePath = issue.path;
      if (!issuePath) continue;
      for (const [sourceName, roots] of rootsBySource) {
        const metadataPath = metadataBySource.get(sourceName);
        const matchesMetadata = metadataPath === issuePath;
        const matchesSkill = !matchesMetadata && roots.some((root) => issuePath === root || issuePath.startsWith(`${root}/`));
        if (matchesMetadata || matchesSkill) result.set(sourceName, (result.get(sourceName) ?? 0) + 1);
      }
      for (const [sourceName, metadataPath] of metadataBySource) {
        if (!rootsBySource.has(sourceName) && metadataPath === issuePath) {
          result.set(sourceName, (result.get(sourceName) ?? 0) + 1);
        }
      }
    }
    return result;
  }, [vault.issues, skills, vault.sources]);

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

  useEffect(() => {
    if (previousSelection.current === selection) return;
    previousSelection.current = selection;
    if (!selected) return;
    setPane("library");
    const skill = vault.skills.find((entry) => entry.name === selected);
    if (skill) {
      setSavedCollapsed((current) => {
        if (!current.has(skill.sourceName)) return current;
        const next = new Set(current);
        next.delete(skill.sourceName);
        return next;
      });
      setFilteredFold((current) => {
        if (!current.sources.has(skill.sourceName)) return current;
        const next = new Set(current.sources);
        next.delete(skill.sourceName);
        return { ...current, sources: next };
      });
    }
    if (!skills.some((entry) => entry.name === selected) && !externalSkills.some((entry) => entry.name === selected)) {
      setQuery("");
      setTypeFilter("all");
      setOnlyInstalled(false);
    }
  }, [selection, selected, vault.skills, skills, externalSkills]);

  return (
    <div className="view skills-view">
      <SectionHeader
        title="技能"
        description="受管技能由 VaultDesk 分发；外部技能只读观察。文件已分发不代表运行依赖就绪。"
        actions={
          <div className="section-actions">
            {pane === "library" ? <>
              {selectedForInstall.size > 0 ? (
                <Button variant="primary" icon="download" onClick={() => startInstall([...selectedForInstall])}>
                  分发已选 · {selectedForInstall.size}
                </Button>
              ) : null}
              <Button variant="quiet" icon="plus" onClick={onImport}>导入技能</Button>
            </> : null}
          </div>
        }
      />

      <div className="segmented skills-pane-tabs" role="group" aria-label="技能模块区域">
        <button className={pane === "library" ? "is-active" : ""} aria-pressed={pane === "library"} onClick={() => switchPane("library")}>
          技能库 <span>{vault.counts.skills}</span>
        </button>
        <button className={pane === "distribution" ? "is-active" : ""} aria-pressed={pane === "distribution"} onClick={() => switchPane("distribution")}>
          分发目标 <span>{vault.counts.targets}</span>
        </button>
      </div>

      {pane === "distribution" ? (
        <TargetsView
          vault={vault}
          presets={distribution.presets}
          homePath={distribution.homePath}
          onRefresh={distribution.onRefresh}
          onBackups={distribution.onBackups}
          onRemove={distribution.onRemove}
          onReveal={distribution.onReveal}
          onError={distribution.onError}
          onGoSkills={() => switchPane("library")}
        />
      ) : <div className="skills-library-panel">

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
          只看已分发
        </button>
        {skills.length > 0 ? (
          <button
            className="text-link"
            onClick={() => setSelectedForInstall((current) => {
              const next = new Set(current);
              const allSelected = skills.every((skill) => next.has(skill.name));
              for (const skill of skills) {
                if (allSelected) next.delete(skill.name);
                else next.add(skill.name);
              }
              return next;
            })}
          >
            {skills.every((skill) => selectedForInstall.has(skill.name)) ? "取消选择结果" : "选择当前结果"}
          </button>
        ) : null}
        {selectedForInstall.size > 0 ? (
          <button className="text-link" onClick={() => setSelectedForInstall(new Set())}>清除选择</button>
        ) : null}
        {collapsibleGroups.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={allCollapsed ? "展开全部套件和合集" : "收起全部套件和合集"}
            onClick={() => {
              const next = new Set(collapsed);
              for (const group of collapsibleGroups) {
                if (allCollapsed) next.delete(group.sourceName);
                else next.add(group.sourceName);
              }
              updateCollapsed(next);
            }}
          >
            {allCollapsed ? "展开全部" : "收起全部"}
          </Button>
        ) : null}
        <span className="toolbar-count">
          {skills.length + externalSkills.length} 个技能 · {groups.length} 个来源
          {selectedForInstall.size > 0 ? ` · 已选 ${selectedForInstall.size}` : ""}
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
            导入本地目录或 GitHub 来源，建立可检查、可分发的技能记录。
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
            试试其他关键词，或清除类型与分发状态筛选。
          </EmptyState>
        )
      ) : (
        <div className="skill-groups">
          {groups.map((group) => (
            <SourceGroup
              key={group.sourceName}
              group={group}
              issues={issuesBySource.get(group.sourceName) ?? 0}
              expanded={!collapsed.has(group.sourceName)}
              onToggle={() => toggleSource(group.sourceName)}
              selection={{ selected, onSelect, onInstall: startInstall, selectedForInstall, setSelectedForInstall, onEditor, onFork }}
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
      </div>}
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
  expanded,
  onToggle,
  selection,
}: {
  group: {
    sourceName: string;
    source: VaultSnapshot["sources"][number] | undefined;
    skills: SkillRecord[];
  };
  issues: number;
  expanded: boolean;
  onToggle: () => void;
  selection: {
    selected: string | null;
    onSelect: (skill: SkillRecord) => void;
    onInstall: (names: string[]) => void;
    selectedForInstall: Set<string>;
    setSelectedForInstall: (next: Set<string>) => void;
    onEditor: (skill: SkillRecord) => void;
    onFork: (skill: SkillRecord) => void;
  };
}) {
  const type = group.source?.kind ?? (group.skills.length === 1 ? "standalone" : "collection");
  const origin = group.source?.origin ?? group.skills[0]?.origin ?? "local";
  const collapsible = type === "suite" || type === "collection";
  const contentId = useId();
  const open = !collapsible || expanded;
  const selectedCount = (group.source?.skills ?? group.skills).filter((skill) => selection.selectedForInstall.has(skill.name)).length;
  const heading = <>
    <span className={`origin-glyph small origin-${origin}`} title={originLabel(origin)}>
      <Icon name={origin === "github" ? "git" : "folder"} size={13} />
    </span>
    <strong className="skill-group-name">{group.sourceName}</strong>
    <span className="type-chip">{TYPE_LABELS[type]}</span>
    <span className="skill-group-meta">{group.skills.length} 个</span>
    {selectedCount > 0 ? <span className="skill-group-selected">已选 {selectedCount}</span> : null}
    {issues > 0 ? (
      <span className="skill-group-warning" title={`${issues} 条校验问题`}>
        <Icon name="alert" size={13} />
        {issues}
      </span>
    ) : null}
  </>;

  return (
    <section className="skill-group">
      <header className={`skill-group-header ${collapsible ? "is-collapsible" : ""}`}>
        {collapsible ? <button
          type="button"
          className="skill-group-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          {heading}
          <span className="skill-group-toggle-label">{open ? "收起" : "展开"}</span>
        </button> : heading}
      </header>
      <div className="skill-table skill-table-grouped" id={contentId} hidden={!open}>
        {open ? <>
        <div className="skill-table-head">
          <span>技能</span>
          <span>角色</span>
          <span>文件分发</span>
          <span>操作</span>
        </div>
        {group.skills.map((skill) => (
          <div
            key={`${skill.sourceName}/${skill.name}`}
            className={`skill-table-row ${selection.selected === skill.name ? "is-selected" : ""}`}
            onClick={() => selection.onSelect(skill)}
          >
            <div className="skill-cell-main">
              <label className="skill-select-control" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`选择分发：${skill.name}`}
                  checked={selection.selectedForInstall.has(skill.name)}
                  onChange={() => {
                    const next = new Set(selection.selectedForInstall);
                    if (next.has(skill.name)) next.delete(skill.name);
                    else next.add(skill.name);
                    selection.setSelectedForInstall(next);
                  }}
                />
              </label>
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
              <Button className="row-action-primary" size="sm" variant="quiet" icon="download" onClick={() => selection.onInstall([skill.name])}>
                分发到…
              </Button>
              <Button className="row-action-primary" size="sm" variant="ghost" onClick={() => selection.onSelect(skill)} aria-pressed={selection.selected === skill.name} aria-label={"查看详情：" + skill.name}>
                详情
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
        </> : null}
      </div>
    </section>
  );
}

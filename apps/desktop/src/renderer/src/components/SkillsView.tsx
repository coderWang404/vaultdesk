import { useMemo, useState } from "react";
import type { SkillRecord, VaultSnapshot } from "@vaultdesk/core";
import { installedFor, originLabel } from "../format";
import { Icon } from "./icons";
import { Button, EmptyState, SectionHeader, StatusPill } from "./ui";

type Filter = "all" | "github" | "local" | "installed";

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
  const [filter, setFilter] = useState<Filter>("all");

  const skills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return vault.skills
      .filter((skill) => {
        if (filter === "installed") return skill.installed.length > 0;
        if (filter === "github" || filter === "local") return skill.origin === filter;
        return true;
      })
      .filter((skill) => {
        if (!needle) return true;
        return (
          skill.name.toLowerCase().includes(needle) ||
          skill.description?.toLowerCase().includes(needle) ||
          skill.sourceName.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vault.skills, filter, query]);

  return (
    <div className="view skills-view">
      <SectionHeader
        eyebrow="技能"
        title="仓库里的全部技能"
        description="技能内容与元数据分离。GitHub 来源只读；编辑前需要 fork 成本地来源。"
        actions={
          <Button variant="primary" icon="plus" onClick={onImport}>
            导入技能
          </Button>
        }
      />

      <div className="toolbar">
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
        <div className="segmented" role="group" aria-label="技能筛选">
          {([
            ["all", "全部"],
            ["github", "GitHub"],
            ["local", "本地"],
            ["installed", "已安装"],
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
        <span className="toolbar-count">{skills.length} 个技能</span>
      </div>

      {skills.length === 0 ? (
        <EmptyState icon="skill" title="没有匹配的技能">
          换一个关键词，或导入新的技能目录。
        </EmptyState>
      ) : (
        <div className="skill-table">
          <div className="skill-table-head">
            <span>技能</span>
            <span>来源</span>
            <span>安装</span>
            <span />
          </div>
          {skills.map((skill) => (
            <div
              key={`${skill.sourceName}/${skill.name}`}
              className={`skill-table-row ${selected === skill.name ? "is-selected" : ""}`}
              onClick={() => onSelect(skill)}
            >
              <div className="skill-cell-main">
                <span className={`origin-glyph origin-${skill.origin}`}>
                  <Icon name={skill.origin === "github" ? "git" : "folder"} size={14} />
                </span>
                <div>
                  <strong>{skill.name}</strong>
                  <p>{skill.description ?? "没有填写描述。"}</p>
                </div>
              </div>
              <div className="skill-cell-source">
                <span>{skill.sourceName}</span>
                <StatusPill tone={skill.origin === "github" ? "neutral" : "accent"}>
                  {originLabel(skill.origin)}
                </StatusPill>
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
                    onClick={() => onFork(skill)}
                  >
                    <Icon name="branch" size={14} />
                  </button>
                ) : (
                  <button
                    className="row-more"
                    title="编辑 SKILL.md"
                    aria-label={`编辑 ${skill.name}`}
                    onClick={() => onEditor(skill)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                )}
                <Icon name="chevron-right" size={14} className="row-chevron" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

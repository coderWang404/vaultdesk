import { useId, useMemo, useState } from "react";
import type { InstallVerification, TargetRecord, VaultSnapshot } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { call, errorMessage } from "../api";
import { Icon } from "./icons";
import { ActionMenu, Button, EmptyState, SectionHeader, SlotStrip, StatusMark, StatusPill, type SlotItem, type StatusTone } from "./ui";

type InstalledEntry = TargetRecord["installed"][number];
type Filter = "all" | "attention" | "paused";

function shortPath(path: string, homePath?: string): string {
  if (!homePath) return path;
  return path === homePath ? "~" : path.startsWith(`${homePath}/`) ? `~${path.slice(homePath.length)}` : path;
}

function directoryLabel(dest: string, presets: ToolPreset[], homePath?: string): string {
  const display = shortPath(dest, homePath);
  if (display === "~/.agents/skills") return "共享技能目录";
  const preset = presets.find((entry) => shortPath(entry.dest, homePath) === display);
  if (preset) return preset.label;
  if (display === "~/.qoder-cn/skills") return "Qoder CN";
  if (display === "~/.workbuddy/skills") return "WorkBuddy";
  const segments = dest.split("/").filter(Boolean);
  return `${segments.at(-1) === "skills" ? segments.at(-2) ?? "自定义" : segments.at(-1) ?? "自定义"} · 自定义目录`;
}

function slotFor(name: string, entry: InstalledEntry | undefined): { tone: StatusTone; label: string } {
  if (!entry) return { tone: "warn", label: `${name} · 未分发` };
  if (entry.managedByThisVault === false) return { tone: "warn", label: `${name} · 属于其他仓库` };
  if (!entry.managed) return { tone: "warn", label: `${name} · 未受管目录` };
  if (entry.matches === false) return { tone: "warn", label: `${name} · 内容已变化` };
  if (entry.isSymlink) return { tone: "ok", label: `${name} · 符号链接${entry.linkTarget ? ` → ${entry.linkTarget}` : ""}` };
  return { tone: "ok", label: `${name} · ${entry.matches === true ? "哈希一致" : "文件已分发"}` };
}

export function TargetsView({ vault, presets, homePath, onRefresh, onBackups, onRemove, onReveal, onError, onGoSkills }: {
  vault: VaultSnapshot;
  presets: ToolPreset[];
  homePath?: string;
  onRefresh: () => Promise<VaultSnapshot | null>;
  onBackups: (targetId?: string) => void;
  onRemove: (targetId: string) => void;
  onReveal: (path: string) => void;
  onError: (message: string) => void;
  onGoSkills: () => void;
}) {
  const groupId = useId();
  const displayPath = (path: string): string => shortPath(path, homePath);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const context = `${query}\0${filter}`;
  const [folded, setFolded] = useState<{ context: string; paths: Set<string> }>({ context, paths: new Set() });
  const collapsed = folded.context === context ? folded.paths : new Set<string>();
  const [verifying, setVerifying] = useState<string | null>(null);
  // Verification belongs to the snapshot checked, not a later refresh.
  const [verifications, setVerifications] = useState<Record<string, { vault: VaultSnapshot; result: InstallVerification }>>({});

  async function verify(targetId: string): Promise<void> {
    setVerifying(targetId);
    try {
      const result = await call<InstallVerification>("target.verify", { vaultPath: vault.path, id: targetId });
      const refreshed = await onRefresh();
      if (refreshed) setVerifications((current) => ({ ...current, [targetId]: { vault: refreshed, result } }));
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setVerifying(null);
    }
  }

  const groups = useMemo(() => {
    const byDirectory = new Map<string, TargetRecord[]>();
    for (const target of vault.targets) {
      const entries = byDirectory.get(target.expandedDest) ?? [];
      entries.push(target);
      byDirectory.set(target.expandedDest, entries);
    }
    return [...byDirectory.entries()].map(([dest, targets]) => {
      const skills = new Set(targets.flatMap((target) => target.skills));
      const others = new Map<string, InstalledEntry>();
      for (const target of targets) for (const entry of target.otherManaged) {
        const name = entry.path.split("/").at(-1) ?? entry.path;
        if (!skills.has(name)) others.set(entry.path, entry);
      }
      return { dest, label: directoryLabel(dest, presets, homePath), targets, skills, others: [...others.values()] };
    }).sort((a, b) => Number(shortPath(b.dest, homePath) === "~/.agents/skills") - Number(shortPath(a.dest, homePath) === "~/.agents/skills") || a.label.localeCompare(b.label) || a.dest.localeCompare(b.dest));
  }, [vault.targets, presets, homePath]);

  function verificationFor(target: TargetRecord): InstallVerification | undefined {
    const checked = verifications[target.id];
    return checked?.vault === vault ? checked.result : undefined;
  }

  // Cache attention and source lookups for this immutable snapshot. Previously
  // each filter/count/render pass rebuilt the same maps and scanned all skills
  // for every target, which became quadratic with large target sets.
  const attentionById = useMemo(() => {
    const result = new Map<string, boolean>();
    for (const target of vault.targets) {
      const checked = verifications[target.id];
      if (!target.exists || (checked?.vault === vault && checked.result.filesInPlace === false)) {
        result.set(target.id, true);
        continue;
      }
      const installed = new Map(target.installed.map((entry) => [entry.path.split("/").at(-1), entry]));
      result.set(target.id, target.skills.some((name) => slotFor(name, installed.get(name)).tone === "warn"));
    }
    return result;
  }, [vault, verifications]);
  const skillSourcesByName = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const skill of vault.skills) {
      const sources = result.get(skill.name) ?? [];
      if (!sources.includes(skill.sourceName)) sources.push(skill.sourceName);
      result.set(skill.name, sources);
    }
    return result;
  }, [vault.skills]);
  const needsAttention = (target: TargetRecord): boolean => attentionById.get(target.id) ?? true;
  const counts = useMemo(() => ({
    all: vault.targets.length,
    attention: vault.targets.reduce((count, target) => count + (needsAttention(target) ? 1 : 0), 0),
    paused: vault.targets.filter((target) => !target.installAfterUpdate).length,
  }), [vault.targets, attentionById]);
  const needle = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => groups.map((group) => ({ ...group, visible: group.targets.filter((target) => {
    if (filter === "attention" && !needsAttention(target)) return false;
    if (filter === "paused" && target.installAfterUpdate) return false;
    return !needle || [group.label, target.id, target.dest, target.expandedDest, ...target.skills,
      ...target.skills.flatMap((name) => skillSourcesByName.get(name) ?? []),
    ].join(" ").toLowerCase().includes(needle);
  }) })).filter((group) => group.visible.length > 0), [groups, filter, needle, skillSourcesByName, attentionById]);
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.visible.length, 0);
  const allCollapsed = visibleGroups.length > 0 && visibleGroups.every((group) => collapsed.has(group.dest));

  function toggleGroup(dest: string): void {
    const paths = new Set(collapsed);
    if (paths.has(dest)) paths.delete(dest);
    else paths.add(dest);
    setFolded({ context, paths });
  }

  function changeQuery(value: string): void {
    setQuery(value);
    setFolded({ context: `${value}\0${filter}`, paths: new Set() });
  }

  function changeFilter(value: Filter): void {
    setFilter(value);
    setFolded({ context: `${query}\0${value}`, paths: new Set() });
  }

  return (
    <div className="view targets-view">
      <header className="section-header targets-section-header">
        <div>
          <h2>已分发到的目录</h2>
          <p>检查技能在各 agent 目录中的分发、校验、备份和同步状态。</p>
        </div>
        <div className="section-actions"><Button icon="backup" onClick={() => onBackups()}>备份</Button></div>
      </header>
      {vault.targets.length === 0 ? (
        <EmptyState icon="target" title="还没有登记目标目录" action={<Button size="sm" variant="primary" icon="skill" onClick={onGoSkills}>选择技能并分发</Button>}>
          从技能库发起分发时，可以选择现有目录或新建目标。
        </EmptyState>
      ) : <>
        <div className="targets-overview">
          <p><strong>{groups.length}</strong> 个目录 <span>·</span> <strong>{vault.targets.length}</strong> 条分发规则 <span>·</span> <strong>{new Set(vault.targets.flatMap((target) => target.skills)).size}</strong> 个技能</p>
          <p>按目标目录分组；文件分发与 agent 是否启用分别确认。</p>
        </div>
        <div className="toolbar targets-toolbar">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input aria-label="搜索分发目标" placeholder="搜索 agent、技能、来源或目录" value={query} onChange={(event) => changeQuery(event.target.value)} />
            {query ? <button className="search-clear" aria-label="清除目标搜索" onClick={() => changeQuery("")}><Icon name="x" size={13} /></button> : null}
          </div>
          <div className="segmented" role="group" aria-label="分发目标状态筛选">
            {([["all", "全部"], ["attention", "需要处理"], ["paused", "已暂停"]] as const).map(([value, label]) => <button key={value} className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{label}<span className="target-filter-count">{counts[value]}</span></button>)}
          </div>
          <Button variant="ghost" size="sm" disabled={!visibleGroups.length} aria-label={allCollapsed ? "展开全部分组" : "收起全部分组"} onClick={() => setFolded({ context, paths: allCollapsed ? new Set() : new Set(visibleGroups.map((group) => group.dest)) })}>{allCollapsed ? "展开全部分组" : "收起全部分组"}</Button>
        </div>
        <p className="targets-results" role="status">显示 {visibleGroups.length} 个目录 · {visibleCount} 条分发规则{needle || filter !== "all" ? ` / 共 ${vault.targets.length} 条` : ""}</p>
        {!visibleGroups.length ? <EmptyState icon="search" title="没有匹配的分发目标" action={<Button variant="quiet" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</Button>}>尝试其他技能、来源或目录，或切换状态筛选。</EmptyState> : (
          <div className="target-list">
            {visibleGroups.map((group, index) => {
              const expanded = !collapsed.has(group.dest);
              const sectionId = `${groupId}-${index}`;
              const attention = group.targets.filter(needsAttention).length;
              const paused = group.targets.filter((target) => !target.installAfterUpdate).length;
              return <section className="target-group" key={group.dest} aria-label={`${group.label} · ${displayPath(group.dest)}`}>
                <header className="target-group-head">
                  <div className="target-group-main">
                    <h2><button className="target-group-toggle" aria-label={`${expanded ? "收起" : "展开"}分组 ${group.label}`} aria-expanded={expanded} aria-controls={sectionId} onClick={() => toggleGroup(group.dest)}>
                      <Icon name={expanded ? "chevron-down" : "chevron-right"} size={16} />
                      <span className="target-group-icon"><Icon name={displayPath(group.dest) === "~/.agents/skills" ? "vault" : "folder"} size={18} /></span>
                      <span>{group.label}</span>
                    </button></h2>
                    <button className="target-group-path mono" onClick={() => onReveal(group.dest)} title={`在 Finder 中显示：${group.dest}`}><span>{displayPath(group.dest)}</span><Icon name="external" size={12} /></button>
                  </div>
                  <div className="target-group-summary">
                    <span>{group.skills.size} 个技能 · {group.visible.length === group.targets.length ? group.targets.length : `${group.visible.length}/${group.targets.length}`} 条规则</span>
                    {attention > 0 ? <StatusPill tone="warn">{attention} 条需要处理</StatusPill> : null}
                    {paused > 0 ? <StatusPill tone="muted">{paused} 条已暂停</StatusPill> : null}
                  </div>
                </header>
                <div id={sectionId} hidden={!expanded}>
                  {group.visible.map((target) => {
                    const verification = verificationFor(target);
                    const installed = new Map(target.installed.map((entry) => [entry.path.split("/").at(-1), entry]));
                    const ownSlots: SlotItem[] = target.skills.map((name) => ({ key: name, name, ...slotFor(name, installed.get(name)) }));
                    return <section className={`target-card${needsAttention(target) ? " needs-attention" : ""}`} key={target.id}>
                      <div className="target-head">
                        <div className="target-title-block">
                          <div className="target-title">
                            <h3>{target.id}</h3>
                            <StatusPill tone={target.installAfterUpdate ? "accent" : "muted"} title={target.installAfterUpdate ? "来源更新后自动同步；符号链接跟随主库" : "已暂停自动同步，保留当前副本"}>{target.installAfterUpdate ? "自动同步" : "已暂停"}</StatusPill>
                            {!target.exists ? <StatusPill tone="warn">目录缺失</StatusPill> : needsAttention(target) ? <StatusPill tone="warn">检查文件</StatusPill> : null}
                          </div>
                          <div className="target-slots"><SlotStrip items={ownSlots} emptyLabel="未登记技能" />
                            {verification ? <span className="target-check" title={verification.filesInPlace ? `校验通过，共检查 ${verification.checked} 个文件` : `缺失 ${verification.missing.join("、") || "无"}；修改 ${verification.modified.join("、") || "无"}`}>
                              <StatusMark tone={verification.filesInPlace ? "ok" : "warn"} label={verification.filesInPlace ? "校验通过" : "校验未通过"} size={13} />
                              {verification.filesInPlace ? `通过 · ${verification.checked} 文件` : `${verification.missing.length} 缺失 · ${verification.modified.length} 修改`}
                            </span> : null}
                          </div>
                        </div>
                        <div className="row-actions">
                          <Button className="row-action-primary" size="sm" variant="quiet" icon="shield" onClick={() => void verify(target.id)} disabled={!target.exists || verifying === target.id}>{verifying === target.id ? "验证中…" : "验证文件"}</Button>
                          <ActionMenu label={`更多目标操作：${target.id}`}>
                            <button onClick={() => onBackups(target.id)}>查看备份</button>
                            <button className="is-danger" onClick={() => onRemove(target.id)}>移除目标</button>
                          </ActionMenu>
                        </div>
                      </div>
                    </section>;
                  })}
                  {group.others.length > 0 ? <details className="target-other">
                    <summary>目录内其他受管技能 · {group.others.length}</summary>
                    <p>这些条目不属于此目录已登记的分发规则，重新分发时不会一并选择。</p>
                    <SlotStrip items={group.others.map((entry) => {
                      const name = entry.path.split("/").at(-1) ?? entry.path;
                      return { key: entry.path, name, tone: entry.matches === false ? "warn" : "muted", label: `${name} · 此目录内的其他受管技能` };
                    })} />
                  </details> : null}
                </div>
              </section>;
            })}
          </div>
        )}
      </>}
    </div>
  );
}

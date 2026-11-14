import { useEffect, useMemo, useRef, useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { hasMcpCapability, toolKindLabel } from "../format";
import { checkPresentation, readinessCheckedAt, readinessKey, readinessPresentation, type ToolReadinessState } from "../readiness";
import { Icon } from "./icons";
import { Button, EmptyState, IconButton, SectionHeader, StatusPill } from "./ui";

const PROFILE_STORAGE_KEY = "vaultdesk.toolCheckProfiles";
const INTERPRETER_STORAGE_KEY = "vaultdesk.toolCheckInterpreters";
const NODE_STORAGE_KEY = "vaultdesk.toolCheckNodes";
const EXPANDED_STORAGE_KEY = "vaultdesk.toolExpanded.v1";
type ToolFilter = "all" | "cli" | "mcp" | "plugin" | "other";

function readStoredSelections(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string"));
  } catch {
    return {};
  }
}

function readExpandedTools(vaultPath: string, mode: "tools" | "mcp"): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${EXPANDED_STORAGE_KEY}:${mode}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function ToolsView({
  vault,
  mode = "tools",
  readiness,
  onVerify,
  onCopy,
  onOpen,
  onSkill,
}: {
  vault: VaultSnapshot;
  mode?: "tools" | "mcp";
  readiness: Record<string, ToolReadinessState>;
  onVerify: (name: string, profile?: string, pythonPath?: string, nodePath?: string) => void;
  onCopy: (text: string) => void;
  onOpen: (url: string) => void;
  onSkill: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<Record<string, string>>(() => readStoredSelections(PROFILE_STORAGE_KEY));
  const [interpreters, setInterpreters] = useState<Record<string, string>>(() => readStoredSelections(INTERPRETER_STORAGE_KEY));
  const [nodePaths, setNodePaths] = useState<Record<string, string>>(() => readStoredSelections(NODE_STORAGE_KEY));
  const expansionKey = `${EXPANDED_STORAGE_KEY}:${mode}:${vault.path}`;
  const expansionKeyRef = useRef(expansionKey);
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all");
  const [expandedTools, setExpandedTools] = useState<Set<string>>(() => readExpandedTools(vault.path, mode));
  useEffect(() => {
    try { window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles)); } catch { /* Selection persistence is optional. */ }
  }, [profiles]);
  useEffect(() => {
    try { window.localStorage.setItem(INTERPRETER_STORAGE_KEY, JSON.stringify(interpreters)); } catch { /* Selection persistence is optional. */ }
  }, [interpreters]);
  useEffect(() => {
    try { window.localStorage.setItem(NODE_STORAGE_KEY, JSON.stringify(nodePaths)); } catch { /* Selection persistence is optional. */ }
  }, [nodePaths]);
  useEffect(() => {
    if (expansionKeyRef.current === expansionKey) return;
    expansionKeyRef.current = expansionKey;
    setToolFilter("all");
    setExpandedTools(readExpandedTools(vault.path, mode));
  }, [expansionKey, mode, vault.path]);
  useEffect(() => {
    if (expansionKeyRef.current !== expansionKey) return;
    try {
      window.localStorage.setItem(expansionKey, JSON.stringify([...expandedTools]));
    } catch { /* Selection persistence is optional. */ }
  }, [expandedTools, expansionKey]);
  const isMcp = mode === "mcp";
  const cards = useMemo(
    () => (isMcp ? vault.tools.filter(hasMcpCapability) : vault.tools),
    [isMcp, vault.tools],
  );

  const toolCategory = (tool: VaultSnapshot["tools"][number]): ToolFilter => {
    if (tool.kind === "mcp" || (isMcp && hasMcpCapability(tool))) return "mcp";
    if (tool.kind === "cli" || tool.tags.some((tag) => tag.toLowerCase() === "cli")) return "cli";
    if (tool.kind === "plugin") return "plugin";
    return "other";
  };

  const categoryCounts = useMemo(() => {
    const counts: Record<ToolFilter, number> = { all: cards.length, cli: 0, mcp: 0, plugin: 0, other: 0 };
    for (const tool of cards) counts[toolCategory(tool)] += 1;
    return counts;
  }, [cards, isMcp]);

  const tools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((tool) => {
      if (toolFilter !== "all" && toolCategory(tool) !== toolFilter) return false;
      if (!needle) return true;
      const fields = [
        tool.name,
        tool.title,
        tool.summary,
        tool.kind,
        tool.homepage,
        tool.docs ?? "",
        tool.run ?? "",
        tool.notes ?? "",
        ...tool.tags,
        ...tool.requirements,
        ...tool.related_skills,
        ...tool.install.map((method) => `${method.label} ${method.command}`),
      ];
      return fields.some((field) => field.toLowerCase().includes(needle));
    });
  }, [cards, query, toolFilter, isMcp]);

  const compactMode = cards.length > 3;
  const filteredBySearch = Boolean(query.trim()) || toolFilter !== "all";
  const allCurrentExpanded = compactMode && tools.length > 0 && tools.every((tool) => expandedTools.has(tool.name));
  useEffect(() => {
    if (!compactMode) return;
    if (!filteredBySearch || tools.length > 3) return;
    setExpandedTools((current) => {
      const next = new Set(current);
      for (const tool of tools) next.add(tool.name);
      return next;
    });
  }, [compactMode, filteredBySearch, tools]);
  const groupedTools = useMemo(() => {
    const labels: Record<ToolFilter, string> = {
      all: isMcp ? "MCP 能力" : "全部工具",
      cli: "CLI 工具",
      mcp: "MCP 服务",
      plugin: "插件工具",
      other: "其他工具",
    };
    const order: ToolFilter[] = isMcp ? ["mcp", "cli", "plugin", "other"] : ["cli", "mcp", "plugin", "other"];
    return order
      .map((category) => ({ category, label: labels[category], tools: tools.filter((tool) => toolCategory(tool) === category) }))
      .filter((group) => group.tools.length > 0);
  }, [isMcp, tools]);

  const managedSkillByName = useMemo(
    () => new Map(vault.skills.map((skill) => [skill.name, skill])),
    [vault.skills],
  );
  const externalSkillByName = useMemo(
    () => new Map(vault.externalSkills.map((skill) => [skill.name, skill])),
    [vault.externalSkills],
  );
  const targetsBySkill = useMemo(() => {
    const result = new Map<string, VaultSnapshot["targets"]>();
    for (const target of vault.targets) {
      for (const skillName of target.skills) {
        const targets = result.get(skillName) ?? [];
        targets.push(target);
        result.set(skillName, targets);
      }
    }
    return result;
  }, [vault.targets]);
  const managedInstallCountBySkill = useMemo(() => {
    const result = new Map<string, number>();
    for (const [skillName, targets] of targetsBySkill) {
      const present = targets.filter((target) => {
        const installed = target.installed.some((entry) =>
          entry.targetId === target.id && entry.managedByThisVault && entry.managed,
        );
        return installed;
      }).length;
      result.set(skillName, present);
    }
    return result;
  }, [targetsBySkill]);

  return (
    <div className="view tools-view">
      <SectionHeader title={isMcp ? "MCP" : "工具"} />

      <p className="tool-intro">
        工具卡记录第三方程序与运行条件，不会执行安装。技能是否已分发、工具运行环境是否就绪，分别检查。
      </p>

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isMcp ? "筛选 MCP" : "筛选工具"}
            aria-label={isMcp ? "筛选 MCP 卡" : "筛选工具卡"}
          />
          {query ? (
            <button className="search-clear" onClick={() => setQuery("")} aria-label="清除筛选">
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        <span className="toolbar-count">
          {tools.length} / {cards.length} 张卡
        </span>
      </div>

      <div className="tool-overview" aria-label="工具分类统计">
        <div className="tool-overview-stat">
          <strong>{cards.length}</strong>
          <span>{isMcp ? "MCP 能力卡" : "工具总数"}</span>
        </div>
        <div className="tool-overview-stat">
          <strong>{categoryCounts.mcp}</strong>
          <span>MCP</span>
        </div>
        <div className="tool-overview-stat">
          <strong>{categoryCounts.cli}</strong>
          <span>CLI</span>
        </div>
        <div className="tool-overview-stat">
          <strong>{categoryCounts.plugin}</strong>
          <span>插件</span>
        </div>
      </div>

      {cards.length > 0 ? (
        <div className="tool-filters" role="group" aria-label="工具类型筛选">
          {([
            ["all", "全部", categoryCounts.all],
            ["mcp", "MCP", categoryCounts.mcp],
            ["cli", "CLI", categoryCounts.cli],
            ["plugin", "插件", categoryCounts.plugin],
            ["other", "其他", categoryCounts.other],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={`tool-filter ${toolFilter === value ? "is-active" : ""}`}
              aria-pressed={toolFilter === value}
              onClick={() => setToolFilter(value)}
            >
              <span>{label}</span>
              <em>{count}</em>
            </button>
          ))}
          {compactMode ? (
            <button
              type="button"
              className="tool-expand-all"
              onClick={() => setExpandedTools((current) => {
                const next = new Set(current);
                if (allCurrentExpanded) {
                  for (const tool of tools) next.delete(tool.name);
                } else {
                  for (const tool of tools) next.add(tool.name);
                }
                return next;
              })}
            >
              <Icon name={allCurrentExpanded ? "chevron-up" : "chevron-down"} size={13} /> {allCurrentExpanded ? "收起当前结果" : "展开当前结果"}
            </button>
          ) : null}
        </div>
      ) : null}

      {tools.length === 0 ? (
        <EmptyState
          icon={isMcp ? "server" : "terminal"}
          title={
            vault.format === "v1"
              ? "需要 v2 仓库"
              : cards.length === 0
                ? isMcp
                  ? "还没有 MCP 卡"
                  : "还没有工具卡"
                : isMcp
                  ? "没有匹配的 MCP 卡"
                  : "没有匹配的工具卡"
          }
          action={
            cards.length > 0 ? (
              <Button size="sm" variant="quiet" onClick={() => { setQuery(""); setToolFilter("all"); }}>
                清除筛选
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="tool-groups">
          {groupedTools.map((group) => (
            <section className="tool-group" key={group.category}>
              <div className="tool-group-head">
                <div>
                  <span className="eyebrow">工具分类</span>
                  <h2>{group.label}</h2>
                </div>
                <span className="tool-group-count">{group.tools.length} 张</span>
              </div>
              <div className="tool-grid">
          {group.tools.map((tool) => {
            const selectionKey = readinessKey(vault.path, tool.name);
            const availableProfiles = [...new Set(tool.checks.flatMap((check) => check.profiles ?? []))].sort();
            const storedProfile = profiles[selectionKey];
            const profile = storedProfile && availableProfiles.includes(storedProfile) ? storedProfile : "";
            const pythonPath = interpreters[selectionKey]?.trim() ?? "";
            const nodePath = nodePaths[selectionKey]?.trim() ?? "";
            const hasPythonChecks = tool.checks.some((check) => check.kind === "python" || check.kind === "python-package");
            const hasNodeChecks = tool.checks.some((check) => check.kind === "node");
            const hasCliCapability = tool.kind === "cli" || tool.tags.some((tag) => tag.toLowerCase() === "cli");
            const capabilities = [hasCliCapability ? "CLI" : null, hasMcpCapability(tool) ? "MCP" : null].filter(
              (value): value is string => Boolean(value),
            );
            const state = readiness[readinessKey(vault.path, tool.name, profile || undefined, pythonPath || undefined, nodePath || undefined)];
            const status = readinessPresentation(tool.checks.length > 0, state);
            const checkedAt = readinessCheckedAt(state?.report);
            const detailsOpen = !compactMode || expandedTools.has(tool.name);
            return (
            <article className="tool-card" key={tool.name}>
              <header className="tool-card-head">
                <div className="tool-card-title">
                  <span className="eyebrow">{toolKindLabel(tool.kind)}</span>
                  <h2>{tool.title}</h2>
                  <p className="tool-card-name">
                    <span className="mono">{tool.name}</span>
                    {tool.recorded_version ? <span className="type-chip">v{tool.recorded_version}</span> : null}
                    {tool.tags.map((tag) => (
                      <span className="type-chip" key={tag}>
                        #{tag}
                      </span>
                    ))}
                  </p>
                </div>
                <span className="tool-glyph">
                  <Icon name={isMcp || tool.kind === "mcp" ? "server" : "terminal"} size={19} />
                </span>
              </header>

              <p className="tool-summary clamp-2" title={tool.summary}>
                {tool.summary}
              </p>
              {!detailsOpen ? (
                <div className="tool-card-compact-meta">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  <span>{tool.checks.length > 0 ? `${tool.checks.length} 项环境检查` : "未声明环境检查"}</span>
                  {tool.run ? <code title={tool.run}>{tool.run}</code> : null}
                </div>
              ) : null}
              {compactMode ? (
                <button
                  type="button"
                  className="tool-card-toggle"
                  aria-expanded={detailsOpen}
                  onClick={() => setExpandedTools((current) => {
                    const next = new Set(current);
                    if (next.has(tool.name)) next.delete(tool.name); else next.add(tool.name);
                    return next;
                  })}
                >
                  <span>{detailsOpen ? "收起详情" : "查看详情"}</span>
                  <Icon name={detailsOpen ? "chevron-up" : "chevron-down"} size={13} />
                </button>
              ) : null}
              {detailsOpen ? <div className="tool-card-details">
              {capabilities.length > 0 ? (
                <p className="tool-readiness-hint">
                  能力：{capabilities.join("、")}。VaultDesk 只记录官方安装与运行方式，不会自动安装、注册或启用工具。
                </p>
              ) : null}
              {isMcp && tool.kind !== "mcp" ? (
                <p className="tool-readiness-hint">
                  此工具以{toolKindLabel(tool.kind)}形式提供，同时提供 {capabilities.length > 0 ? capabilities.join("、") : "MCP"} 能力；技能文件分发与 agent 接入需要分别验证。
                </p>
              ) : null}

              <section className="tool-readiness" aria-label={tool.title + "运行环境"}>
                <div className="tool-readiness-head">
                  <span className="tool-readiness-label">运行环境</span>
                  <span role="status" aria-atomic="true">
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </span>
                  {tool.checks.length > 0 ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => onVerify(tool.name, profile || undefined, pythonPath || undefined, nodePath || undefined)}
                      disabled={state?.loading}
                    >
                      {state?.loading ? "检查中…" : state?.report ? "重新检查" : "检查运行环境"}
                    </Button>
                  ) : null}
                </div>
                {availableProfiles.length > 0 ? (
                  <label className="tool-profile-label">
                    检查场景
                    <select
                      value={profile}
                      onChange={(event) => setProfiles((current) => ({ ...current, [selectionKey]: event.target.value }))}
                      aria-label={tool.title + "检查场景"}
                    >
                      <option value="">通用检查</option>
                      {availableProfiles.map((item) => <option value={item} key={item}>{item}</option>)}
                    </select>
                  </label>
                ) : null}
                {availableProfiles.length > 0 && !profile ? (
                  <p className="tool-readiness-hint">通用检查不包含 {availableProfiles.join("、")} 场景的专用项；请按实际用途逐个选择场景并检查。</p>
                ) : null}
                {hasPythonChecks ? (
                  <label className="tool-interpreter-label">
                    Python 解释器（可选）
                    <input
                      type="text"
                      value={interpreters[selectionKey] ?? ""}
                      onChange={(event) => setInterpreters((current) => ({ ...current, [selectionKey]: event.target.value }))}
                      placeholder="留空优先使用 Miniconda base；或填入绝对路径覆盖"
                      aria-label={tool.title + " Python 解释器绝对路径"}
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                {hasNodeChecks ? (
                  <label className="tool-interpreter-label">
                    Node 解释器（可选）
                    <input
                      type="text"
                      value={nodePaths[selectionKey] ?? ""}
                      onChange={(event) => setNodePaths((current) => ({ ...current, [selectionKey]: event.target.value }))}
                      placeholder="留空自动查找受信任的 Node；或填入绝对路径"
                      aria-label={tool.title + " Node 绝对路径"}
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                {hasPythonChecks ? (
                  <p className="tool-readiness-hint">Python 检查会启动所选解释器运行 VaultDesk 内置的只读检测代码；各项可能使用不同解释器，实际运行时请与对应检查项保持一致。</p>
                ) : null}
                {hasNodeChecks ? <p className="tool-readiness-hint">Node 检查只读取所选可执行文件的版本；实际运行时请让对应 agent 使用相同的 Node。</p> : null}
                {checkedAt ? (
                  <p className="tool-readiness-hint">上次检查：{checkedAt}。环境变化后请重新检查。</p>
                ) : null}
                {state?.error ? <p className="tool-readiness-error" role="alert">{state.error}</p> : null}
                {state?.report?.checks.length ? (
                  <ul className="tool-check-list">
                    {state.report.checks.map((check) => {
                      const result = checkPresentation(check.status);
                      return (
                        <li className="tool-check" key={check.id}>
                          <div className="tool-check-heading">
                            <strong>{check.label}</strong>
                            {check.optional ? <span className="tool-check-optional">可选</span> : null}
                            <StatusPill tone={result.tone}>{result.label}</StatusPill>
                          </div>
                          {check.detail ? <span className="tool-check-detail">{check.detail}</span> : null}
                          {check.pythonPath ? <span className="tool-check-detail">解释器：<span className="mono">{check.pythonPath}</span></span> : null}
                          {check.nodePath ? <span className="tool-check-detail">Node：<span className="mono">{check.nodePath}</span></span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="tool-readiness-hint">
                    {tool.checks.length === 0
                      ? "尚未声明可验证的依赖；这张卡不能证明工具已安装或可运行。"
                      : "点击检查后，才会读取解释器、依赖与文件状态；不会执行安装命令。"}
                  </p>
                )}
                {state?.report?.status === "incomplete" ? (
                  <p className="tool-readiness-hint">按缺失项和下方安装说明处理后，再重新检查。</p>
                ) : null}
              </section>

              <section className="tool-section">
                <span className="tool-section-label">安装</span>
                {tool.install.map((method, index) => (
                  <div className="tool-command" key={`${method.label}-${index}`}>
                    <span className="tool-command-label">{method.label}</span>
                    <code>{method.command}</code>
                    <IconButton icon="copy" label="复制安装命令" onClick={() => onCopy(method.command)} />
                  </div>
                ))}
              </section>

              {tool.run ? (
                <section className="tool-section">
                  <span className="tool-section-label">{isMcp || tool.kind === "mcp" ? "连接 / 启动" : "运行"}</span>
                  <div className="tool-command">
                    <span className="tool-command-label">{isMcp || tool.kind === "mcp" ? "connect" : "run"}</span>
                    <code>{tool.run}</code>
                    <IconButton
                      icon="copy"
                      label={isMcp || tool.kind === "mcp" ? "复制连接命令" : "复制运行命令"}
                      onClick={() => onCopy(tool.run as string)}
                    />
                  </div>
                </section>
              ) : null}

              {tool.requirements.length > 0 ? (
                <section className="tool-section">
                  <span className="tool-section-label">要求</span>
                  <div className="tool-chips">
                    {tool.requirements.map((requirement) => (
                      <span className="tool-chip" key={requirement}>
                        {requirement}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {tool.related_skills.length > 0 ? (
                <section className="tool-section">
                  <span className="tool-section-label">相关技能</span>
                  <div className="tool-related-list">
                    {tool.related_skills.map((skillName) => {
                      const managed = managedSkillByName.get(skillName);
                      const external = externalSkillByName.get(skillName);
                      const targets = managed ? (targetsBySkill.get(skillName) ?? []) : [];
                      const present = managed ? (managedInstallCountBySkill.get(skillName) ?? 0) : 0;
                      const missing = targets.length - present;
                      return (
                        <div className="tool-related-row" key={skillName}>
                          {managed || external ? (
                            <button className="tool-chip is-link" onClick={() => onSkill(skillName)}>{skillName}</button>
                          ) : <span className="tool-chip">{skillName}</span>}
                          <span className="tool-related-meta">
                            {managed ? (targets.length === 0
                              ? "Vault 受管 · 未登记分发目标"
                              : `Vault 受管 · 已登记 ${targets.length} 个目标 · 目录/链接已发现 ${present} 个${missing ? ` · ${missing} 个未分发` : ""} · 状态需到技能页的“分发目标”区域核验`)
                              : external ? `${external.owner} 外部工具托管 · Vault 只读观察` : "未找到关联技能记录"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {tool.kind === "plugin" || hasMcpCapability(tool) ? (
                <p className="tool-integration-status"><StatusPill tone="warn">需在对应 agent 验证</StatusPill>工具依赖与技能文件检查不能证明工具已在 agent 中接入或启用。</p>
              ) : null}

              {tool.notes ? (
                <p className="tool-notes clamp-2" title={tool.notes}>
                  {tool.notes}
                </p>
              ) : null}

              <footer className="tool-links">
                <button className="tool-link" onClick={() => onOpen(tool.homepage)}>
                  <Icon name="external" size={13} /> 官方地址
                </button>
                {tool.docs ? (
                  <button className="tool-link" onClick={() => onOpen(tool.docs as string)}>
                    <Icon name="file" size={13} /> 文档
                  </button>
                ) : null}
              </footer>
              </div> : null}
            </article>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="tool-boundary">
        <Icon name="shield" size={13} />
        工具卡仅记录，不安装。Python 检查会运行 VaultDesk 内置的只读检测代码；Node 检查只读取版本；不会执行工具卡中的命令。
      </p>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { hasMcpCapability, toolKindLabel } from "../format";
import { checkPresentation, readinessCheckedAt, readinessKey, readinessPresentation, type ToolReadinessState } from "../readiness";
import { Icon } from "./icons";
import { Button, EmptyState, IconButton, SectionHeader, StatusPill } from "./ui";

const PROFILE_STORAGE_KEY = "vaultdesk.toolCheckProfiles";
const INTERPRETER_STORAGE_KEY = "vaultdesk.toolCheckInterpreters";
const NODE_STORAGE_KEY = "vaultdesk.toolCheckNodes";

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
  useEffect(() => {
    try { window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles)); } catch { /* Selection persistence is optional. */ }
  }, [profiles]);
  useEffect(() => {
    try { window.localStorage.setItem(INTERPRETER_STORAGE_KEY, JSON.stringify(interpreters)); } catch { /* Selection persistence is optional. */ }
  }, [interpreters]);
  useEffect(() => {
    try { window.localStorage.setItem(NODE_STORAGE_KEY, JSON.stringify(nodePaths)); } catch { /* Selection persistence is optional. */ }
  }, [nodePaths]);
  const isMcp = mode === "mcp";
  const cards = useMemo(
    () => (isMcp ? vault.tools.filter(hasMcpCapability) : vault.tools),
    [isMcp, vault.tools],
  );

  const tools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((tool) => {
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
  }, [cards, query]);

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
              <Button size="sm" variant="quiet" onClick={() => setQuery("")}>
                清除筛选
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="tool-grid">
          {tools.map((tool) => {
            const selectionKey = readinessKey(vault.path, tool.name);
            const availableProfiles = [...new Set(tool.checks.flatMap((check) => check.profiles ?? []))].sort();
            const storedProfile = profiles[selectionKey];
            const profile = storedProfile && availableProfiles.includes(storedProfile) ? storedProfile : "";
            const pythonPath = interpreters[selectionKey]?.trim() ?? "";
            const nodePath = nodePaths[selectionKey]?.trim() ?? "";
            const hasPythonChecks = tool.checks.some((check) => check.kind === "python" || check.kind === "python-package");
            const hasNodeChecks = tool.checks.some((check) => check.kind === "node");
            const state = readiness[readinessKey(vault.path, tool.name, profile || undefined, pythonPath || undefined, nodePath || undefined)];
            const status = readinessPresentation(tool.checks.length > 0, state);
            const checkedAt = readinessCheckedAt(state?.report);
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
              {isMcp && tool.kind !== "mcp" ? (
                <p className="tool-readiness-hint">此工具以{toolKindLabel(tool.kind)}形态安装，同时提供 MCP 能力；技能文件分发不会自动完成 MCP 连接。</p>
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
                      placeholder="留空使用卡内解释器；或填入 venv/bin/python 的绝对路径"
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
                      const managed = vault.skills.find((skill) => skill.name === skillName);
                      const external = vault.externalSkills.find((skill) => skill.name === skillName);
                      const targets = managed ? vault.targets.filter((target) => target.skills.includes(skillName)) : [];
                      const present = managed ? targets.filter((target) => managed.installed.some((entry) =>
                        entry.targetId === target.id && entry.managedByThisVault && entry.managed)).length : 0;
                      const missing = targets.length - present;
                      return (
                        <div className="tool-related-row" key={skillName}>
                          {managed || external ? (
                            <button className="tool-chip is-link" onClick={() => onSkill(skillName)}>{skillName}</button>
                          ) : <span className="tool-chip">{skillName}</span>}
                          <span className="tool-related-meta">
                            {managed ? (targets.length === 0
                              ? "Vault 受管 · 未登记分发目标"
                              : `Vault 受管 · 已登记 ${targets.length} 个目标 · 目录/链接已发现 ${present} 个${missing ? ` · ${missing} 个未分发` : ""} · 状态需到安装目标页核验`)
                              : external ? `${external.owner} 外部工具托管 · Vault 只读观察` : "未找到关联技能记录"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {tool.kind === "plugin" || hasMcpCapability(tool) ? (
                <p className="tool-integration-status"><StatusPill tone="warn">需在对应 agent 验证</StatusPill>工具依赖与技能文件检查不能证明插件或 MCP 已接入。</p>
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
            </article>
            );
          })}
        </div>
      )}

      <p className="tool-boundary">
        <Icon name="shield" size={13} />
        工具卡仅记录，不安装。Python 检查会运行 VaultDesk 内置的只读检测代码；Node 检查只读取版本；不会执行工具卡中的命令。
      </p>
    </div>
  );
}

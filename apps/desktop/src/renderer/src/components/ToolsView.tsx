import { useMemo, useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { toolKindLabel } from "../format";
import { Icon } from "./icons";
import { Button, EmptyState, IconButton, SectionHeader, StatusPill } from "./ui";

export function ToolsView({
  vault,
  mode = "tools",
  onCopy,
  onOpen,
  onSkill,
}: {
  vault: VaultSnapshot;
  mode?: "tools" | "mcp";
  onCopy: (text: string) => void;
  onOpen: (url: string) => void;
  onSkill: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const isMcp = mode === "mcp";
  const cards = useMemo(
    () => (isMcp ? vault.tools.filter((tool) => tool.kind === "mcp") : vault.tools),
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
          {tools.map((tool) => (
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
                  <Icon name={tool.kind === "mcp" ? "server" : "terminal"} size={19} />
                </span>
              </header>

              <p className="tool-summary clamp-2" title={tool.summary}>
                {tool.summary}
              </p>

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
                  <span className="tool-section-label">{tool.kind === "mcp" ? "连接 / 启动" : "运行"}</span>
                  <div className="tool-command">
                    <span className="tool-command-label">{tool.kind === "mcp" ? "connect" : "run"}</span>
                    <code>{tool.run}</code>
                    <IconButton
                      icon="copy"
                      label={tool.kind === "mcp" ? "复制连接命令" : "复制运行命令"}
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
                  <div className="tool-chips">
                    {tool.related_skills.map((skill) => (
                      <button className="tool-chip is-link" key={skill} onClick={() => onSkill(skill)}>
                        {skill}
                      </button>
                    ))}
                  </div>
                </section>
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
          ))}
        </div>
      )}

      <p className="tool-boundary">
        <Icon name="shield" size={13} />
        仅记录，不安装
      </p>
    </div>
  );
}

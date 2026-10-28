import { useMemo, useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { toolKindLabel } from "../format";
import { Icon } from "./icons";
import { EmptyState, IconButton, SectionHeader, StatusPill } from "./ui";

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
      <SectionHeader
        eyebrow={isMcp ? "MCP" : "工具"}
        title={isMcp ? "MCP 服务卡" : "外部工具卡"}
        description={
          isMcp
            ? "这里只记录 MCP 服务的官方地址、安装方式和启动或连接入口。VaultDesk 不下载、不安装、不注册、不启动 MCP，也不写任何 agent 配置；agent 读取卡片后按自己的规则接入。打包了 MCP 的工具留在「工具」页。"
            : "这里只记录外部工具的官方地址、安装方式和运行入口。VaultDesk 不下载、不安装、不运行，也不写任何 agent 配置；agent 读取工具卡后自行安装。仓库里已保存的插件源码请看「插件」页。"
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isMcp ? "筛选 MCP、标签、安装或连接命令…" : "筛选工具、标签、安装命令或相关技能…"}
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
              ? isMcp
                ? "旧版仓库不支持 MCP 卡"
                : "旧版仓库不支持工具卡"
              : cards.length === 0
                ? isMcp
                  ? "这个仓库还没有 MCP 卡"
                  : "这个仓库还没有工具卡"
                : isMcp
                  ? "没有匹配的 MCP 卡"
                  : "没有匹配的工具卡"
          }
        >
          {vault.format === "v1" ? (
            isMcp ? "先把仓库迁移到 v2，再记录 MCP 卡。" : "先把仓库迁移到 v2，再记录工具卡。"
          ) : cards.length === 0 ? (
            <>
              用 <code>vaultdesk tool add &lt;name&gt; --kind {isMcp ? "mcp" : "plugin"} --title … --summary … --homepage … --install-command label=command</code>{" "}
              记录安装入口，或直接写 <code>tools/&lt;name&gt;.yml</code>。
            </>
          ) : (
            "换一个关键词，或清除筛选。"
          )}
        </EmptyState>
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
                    {tool.recorded_version ? <StatusPill tone="muted">v{tool.recorded_version}</StatusPill> : null}
                    {tool.tags.map((tag) => (
                      <StatusPill key={tag} tone="neutral">
                        #{tag}
                      </StatusPill>
                    ))}
                  </p>
                </div>
                <span className="tool-glyph">
                  <Icon name={tool.kind === "mcp" ? "server" : "terminal"} size={19} />
                </span>
              </header>

              <p className="tool-summary">{tool.summary}</p>

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

              {tool.notes ? <p className="tool-notes">{tool.notes}</p> : null}

              <footer className="tool-links">
                <button className="tool-link" onClick={() => onOpen(tool.homepage)}>
                  <Icon name="external" size={13} /> 官方地址
                </button>
                {tool.docs ? (
                  <button className="tool-link" onClick={() => onOpen(tool.docs as string)}>
                    <Icon name="file" size={13} /> 文档
                  </button>
                ) : null}
                <span className="tool-card-path mono">{tool.relativePath}</span>
              </footer>
            </article>
          ))}
        </div>
      )}

      <p className="tool-boundary">
        <Icon name="shield" size={13} />
        {isMcp
          ? "MCP 卡是人工记录的快照，不检查新版本，也不代表已注册到任何 agent。"
          : "工具卡是人工记录的快照，不检查新版本，也不代表已在本机安装。"}
      </p>
    </div>
  );
}

import type { SkillRecord, SourceRecord, VaultSnapshot } from "@vaultdesk/core";
import {
  installedFor,
  relativeTime,
  shortSha,
  statusLabel,
  statusTone,
} from "../format";
import { Icon, type IconName } from "./icons";
import { Button, Callout, EmptyState, SectionHeader, StatusMark, StatusPill } from "./ui";

export function Overview({
  vault,
  selected,
  checking,
  onCheck,
  onSource,
  onSkill,
  onValidate,
  onMigration,
  onDiff,
  onUpdate,
  onInstall,
  onImport,
}: {
  vault: VaultSnapshot;
  selected: string | null;
  checking: boolean;
  onCheck: () => void;
  onSource: (source: SourceRecord) => void;
  onSkill: (skill: SkillRecord) => void;
  onValidate: () => void;
  onMigration: () => void;
  onDiff: (sourceName: string) => void;
  onUpdate: (sourceName?: string) => void;
  onInstall: () => void;
  onImport: () => void;
}) {
  const updates = vault.sources.filter((source) => source.status === "update-available");
  const problems = vault.sources.filter(
    (source) => source.status === "error" || source.status === "auth-failed",
  );
  const errors = vault.issues.filter((issue) => issue.severity === "error");
  const warnings = vault.issues.filter((issue) => issue.severity === "warning");
  const github = vault.sources.filter((source) => source.origin === "github").length;
  const local = vault.sources.length - github;
  const mcpCount = vault.tools.filter((tool) => tool.kind === "mcp").length;
  const featured = [...vault.skills]
    .sort((a, b) => {
      const aInstalled = a.installed.length > 0 ? 1 : 0;
      const bInstalled = b.installed.length > 0 ? 1 : 0;
      if (aInstalled !== bInstalled) return bInstalled - aInstalled;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);

  return (
    <div className="view overview">
      <SectionHeader
        title="总览"
        description={
          vault.git.isRepo
            ? `${vault.git.branch ?? "detached"} · ${shortSha(vault.git.head)} · ${vault.git.dirty ? "未提交" : "干净"}`
            : "未纳入 Git"
        }
        actions={
          <>
            <Button icon="refresh" onClick={onCheck} loading={checking}>
              检查更新
            </Button>
            {vault.format === "v1" ? (
              <Button variant="primary" icon="arrow-right" onClick={onMigration}>
                迁移预览
              </Button>
            ) : (
              <Button variant="primary" icon="download" onClick={onInstall}>
                安装技能
              </Button>
            )}
          </>
        }
      />

      <div className="overview-priority">
        <section className="panel">
          <div className="panel-head">
            <h2>下一步</h2>
          </div>
          {vault.format === "v1" ? (
            <div className="quiet-state">
              <div><strong>迁移到新版仓库</strong><p>迁移后即可管理来源、安装与更新。</p></div>
              <Button size="sm" onClick={onMigration}>查看迁移方案</Button>
            </div>
          ) : errors.length > 0 ? (
            <div className="quiet-state">
              <div><strong>处理校验错误</strong><p>先确认仓库问题，再继续管理资产。</p></div>
              <Button size="sm" onClick={onValidate}>查看校验</Button>
            </div>
          ) : problems.length > 0 ? (
            <div className="quiet-state">
              <div><strong>重试来源检查</strong><p>部分来源未能确认上游状态。</p></div>
              <Button size="sm" onClick={onCheck} loading={checking}>重新检查来源</Button>
            </div>
          ) : updates.length > 0 ? (
            <div className="quiet-state">
              <div><strong>预览待更新来源</strong><p>{updates.length} 个来源有新版本，确认差异后再应用。</p></div>
              <Button size="sm" onClick={() => onUpdate()}>预览更新计划</Button>
            </div>
          ) : github > 0 && !vault.state?.last_checked_at ? (
            <div className="quiet-state">
              <div><strong>检查上游状态</strong><p>还没有检查 GitHub 来源，先确认是否有更新。</p></div>
              <Button size="sm" onClick={onCheck} loading={checking}>检查上游</Button>
            </div>
          ) : vault.counts.skills === 0 ? (
            <div className="quiet-state">
              <div><strong>导入第一个技能</strong><p>添加本地目录或 GitHub 仓库，开始整理资产。</p></div>
              <Button size="sm" onClick={onImport}>添加首个来源</Button>
            </div>
          ) : vault.counts.targets === 0 ? (
            <div className="quiet-state">
              <div><strong>配置安装目标</strong><p>为技能选择使用位置，完成后即可安装。</p></div>
              <Button size="sm" onClick={onInstall}>选择安装目录</Button>
            </div>
          ) : (
            <div className="quiet-state">
              <StatusMark tone="ok" label="没有待处理项目" size={22} />
              <div><strong>没有待处理项目</strong><p>可以检查上游，或继续导入技能。</p></div>
            </div>
          )}
        </section>

        {errors.length > 0 ? (
          <Callout tone="danger" title={`${errors.length} 个校验错误`}>
            <p>{errors[0]?.message}</p>
            <Button size="sm" variant="ghost" onClick={onValidate}>
              查看全部
            </Button>
          </Callout>
        ) : null}

        {problems.length > 0 ? (
          <Callout tone="danger" title={`${problems.length} 个来源检查失败`}>
            <p>{problems[0]?.name}：{problems[0]?.lastError ?? "无法确认上游状态，请检查网络或认证后重试。"}</p>
            <Button size="sm" variant="ghost" onClick={onCheck} loading={checking}>
              重试检查
            </Button>
          </Callout>
        ) : null}

        {vault.operation ? (
          <Callout tone="warn" title="上次操作未正常结束">
            <p>
              {vault.operation.kind} 停在「{vault.operation.steps.find((step) => step.status === "running")?.label ?? "未知步骤"}」。
              不会自动回滚，请用 Git 状态与安装备份核对后继续。
            </p>
          </Callout>
        ) : null}

        <section className="panel update-panel">
          <div className="panel-head">
            <h2>更新</h2>
            {updates.length > 0 ? (
              <Button size="sm" variant="quiet" onClick={() => onUpdate()}>
                全部预览
              </Button>
            ) : null}
          </div>

          {updates.length === 0 && problems.length === 0 ? (
            <div className="quiet-state">
              <StatusMark
                tone={github === 0 || !vault.state?.last_checked_at ? "muted" : "ok"}
                label={github === 0 ? "没有 GitHub 来源" : vault.state?.last_checked_at ? "没有待更新" : "尚未检查上游"}
                size={22}
              />
              <div>
                <strong>{github === 0 ? "没有 GitHub 来源" : vault.state?.last_checked_at ? "没有待更新" : "尚未检查上游"}</strong>
                {github === 0 ? (
                  <p>添加 GitHub 来源后，可在这里检查上游更新。</p>
                ) : vault.state?.last_checked_at ? (
                  <p>检查于 {relativeTime(vault.state.last_checked_at)}</p>
                ) : (
                  <p>检查上游后才能确认是否有可用更新。</p>
                )}
              </div>
              {github > 0 && vault.state?.last_checked_at ? (
                <Button size="sm" variant="quiet" icon="refresh" onClick={onCheck} loading={checking}>检查上游</Button>
              ) : github === 0 ? (
                <Button size="sm" variant="quiet" icon="plus" onClick={onImport}>添加来源</Button>
              ) : null}
            </div>
          ) : (
            <div className="update-list">
              {[...updates, ...problems].map((source) => (
                <div className="update-row" key={source.name}>
                  <div className="update-row-main">
                    <button className="link-strong" onClick={() => onSource(source)}>
                      {source.name}
                    </button>
                    <span className="update-repo">{source.repo ?? "本地来源"}</span>
                    {source.lastError ? (
                      <span className="update-error" title={source.lastError}>{source.lastError}</span>
                    ) : null}
                  </div>
                  <div className="update-row-meta">
                    <StatusPill tone={statusTone(source.status)}>{statusLabel(source.status)}</StatusPill>
                    <span className="mono">{shortSha(source.locked?.commit)}</span>
                  </div>
                  <div className="row-actions">
                    {source.origin === "github" ? (
                      <>
                        <Button size="sm" variant="quiet" onClick={() => onDiff(source.name)}>
                          查看差异
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => onUpdate(source.name)} disabled={source.status === "auth-failed" || source.status === "error"}>
                          预览更新
                        </Button>
                      </>
                    ) : (
                      <span className="muted-small">本地</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="overview-summary">
        <div className="stat-groups">
          <StatGroup
            label="仓库内容"
            cells={[
              {
                icon: "source",
                value: vault.counts.sources,
                label: "来源",
                title: `${github} 个 GitHub · ${local} 个本地`,
              },
              {
                icon: "skill",
                value: vault.counts.skills,
                label: "技能",
                title: `${vault.counts.packages} 个包`,
              },
              {
                icon: "sparkle",
                value: vault.counts.plugins,
                label: "插件",
                title: `${vault.counts.pluginSkills} 个插件内技能`,
              },
            ]}
          />
          <StatGroup
            label="外部记录"
            cells={[
              {
                icon: "terminal",
                value: vault.counts.tools,
                label: "工具",
                title: "插件分发 · MCP · CLI · 桌面应用",
              },
              { icon: "server", value: mcpCount, label: "MCP", title: "独立 MCP 服务记录" },
              {
                icon: "shield",
                value: vault.counts.externalSkills,
                label: "外部技能",
                title: "由对应工具自己管理",
              },
            ]}
          />
          <StatGroup
            label="安装"
            cells={[
              { icon: "target", value: vault.counts.targets, label: "目标", title: "安装规则" },
              {
                icon: "download",
                value: vault.counts.managedInstalls,
                label: "受管",
                title: "目标目录里的受管安装",
              },
              {
                icon: "refresh",
                value: updates.length,
                label: "待更新",
                title: "检查上游后可知",
                accent: updates.length > 0,
              },
            ]}
          />
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2>来源</h2>
            <Button size="sm" variant="quiet" icon="plus" onClick={onImport}>导入技能</Button>
          </div>
          <div className="origin-bars">
            <OriginBar label="GitHub" value={github} total={vault.sources.length} tone="ink" />
            <OriginBar label="本地" value={local} total={vault.sources.length} tone="accent" />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>技能</h2>
          <Button size="sm" variant="quiet" icon="shield" onClick={onValidate}>校验仓库</Button>
        </div>
        {featured.length === 0 ? (
          <EmptyState
            title="还没有技能"
            icon="skill"
            action={
              <Button size="sm" onClick={onImport}>
                导入技能
              </Button>
            }
          />
        ) : (
          <div className="skill-grid">
            {featured.map((skill) => (
              <button
                className={`skill-card ${selected === skill.name ? "is-selected" : ""}`}
                key={`${skill.sourceName}/${skill.name}`}
                aria-pressed={selected === skill.name}
                onClick={() => onSkill(skill)}
              >
                <div className="skill-card-top">
                  <span className={`origin-glyph origin-${skill.origin}`}>
                    <Icon name={skill.origin === "github" ? "git" : "folder"} size={15} />
                  </span>
                  <span className="skill-card-name">{skill.name}</span>
                  <Icon name="chevron-right" size={14} className="skill-card-arrow" />
                </div>
                <p className="clamp-1" title={skill.description ?? undefined}>
                  {skill.description ?? "—"}
                </p>
                <div className="skill-card-meta">
                  <span>{skill.sourceName}</span>
                  {skill.installed.length > 0 ? (
                    <span title={`已安装：${installedFor(skill)}`}>
                      <StatusMark tone="ok" label="已安装" size={11} />
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {warnings.length > 0 && errors.length === 0 ? (
        <Callout tone="warn" title={`${warnings.length} 条提示`}>
          <p>{warnings[0]?.message}</p>
        </Callout>
      ) : null}
    </div>
  );
}

interface StatCell {
  icon: IconName;
  value: number;
  label: string;
  title: string;
  accent?: boolean;
}

function StatGroup({ label, cells }: { label: string; cells: StatCell[] }) {
  return (
    <div className="stat-group">
      <span className="stat-group-label">{label}</span>
      {cells.map((cell) => (
        <div className={`stat-cell ${cell.accent ? "is-accent" : ""}`} key={cell.label} title={cell.title}>
          <Icon name={cell.icon} size={15} />
          <strong>{cell.value}</strong>
          <span>{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

function OriginBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "ink" | "accent" | "moss";
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="origin-bar">
      <div className="origin-bar-label">
        <span>{label}</span>
        <em>{value}</em>
      </div>
      <div className="origin-track">
        <span className={`origin-fill tone-${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

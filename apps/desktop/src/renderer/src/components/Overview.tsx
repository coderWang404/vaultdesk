import type { SkillRecord, SourceRecord, VaultSnapshot } from "@vaultdesk/core";
import { originLabel, relativeTime, shortSha, sourceShapeLabel, statusLabel, statusTone } from "../format";
import { Icon } from "./icons";
import { Button, Callout, EmptyState, SectionHeader, StatusPill } from "./ui";

export function Overview({
  vault,
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
  onSettings,
}: {
  vault: VaultSnapshot;
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
  onSettings: () => void;
}) {
  const updates = vault.sources.filter((source) => source.status === "update-available");
  const problems = vault.sources.filter(
    (source) => source.status === "error" || source.status === "auth-failed",
  );
  const errors = vault.issues.filter((issue) => issue.severity === "error");
  const warnings = vault.issues.filter((issue) => issue.severity === "warning");
  const github = vault.sources.filter((source) => source.origin === "github").length;
  const local = vault.sources.length - github;
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
        eyebrow={vault.format === "v1" ? "旧版仓库 · 只读" : "仓库总览"}
        title={vault.name}
        description={
          vault.git.isRepo
            ? `${vault.git.branch ?? "detached"} · ${shortSha(vault.git.head)} · ${vault.git.dirty ? "有未提交变更" : "工作区干净"}`
            : "这个仓库还没有纳入 Git。迁移与更新会保持禁用。"
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

      <section className="stat-grid">
        <StatCard label="来源" value={vault.counts.sources} hint={`${github} GitHub · ${local} 本地`} icon="source" />
        <StatCard label="技能" value={vault.counts.skills} hint={`${vault.counts.packages} 个包`} icon="skill" />
        <StatCard label="安装目标" value={vault.counts.targets} hint={`${vault.counts.managedInstalls} 个受管安装`} icon="target" />
        <StatCard
          label="待更新"
          value={updates.length}
          hint={updates.length > 0 ? "review-before-apply" : "没有发现新提交"}
          icon="download"
          tone={updates.length > 0 ? "accent" : undefined}
        />
      </section>

      {errors.length > 0 ? (
        <Callout tone="danger" title={`${errors.length} 个校验错误`}>
          <p>{errors[0]?.message}</p>
          <Button size="sm" variant="ghost" onClick={onValidate}>
            查看全部
          </Button>
        </Callout>
      ) : null}

      {vault.operation ? (
        <Callout tone="warn" title="上次操作未正常结束">
          <p>
            {vault.operation.kind} 停在「{vault.operation.steps.find((step) => step.status === "running")?.label ?? "未知步骤"}」。
            VaultDesk 不会自动回滚，请用 Git 状态与安装备份核对后继续。
          </p>
        </Callout>
      ) : null}

      <div className="overview-columns">
        <section className="panel update-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">更新队列</span>
              <h2>先看差异，再落盘</h2>
            </div>
            {updates.length > 0 ? (
              <Button size="sm" variant="quiet" onClick={() => onUpdate()}>
                全部预览
              </Button>
            ) : null}
          </div>

          {updates.length === 0 && problems.length === 0 ? (
            <div className="quiet-state">
              <span className="quiet-mark">
                <Icon name="check" size={18} />
              </span>
              <div>
                <strong>没有待应用的更新</strong>
                <p>
                  {vault.state?.last_checked_at
                    ? `上次检查于 ${relativeTime(vault.state.last_checked_at)}`
                    : "还没检查过上游提交。"}
                </p>
              </div>
              <Button size="sm" variant="ghost" icon="refresh" onClick={onCheck} loading={checking}>
                检查
              </Button>
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
                  </div>
                  <div className="update-row-meta">
                    <StatusPill tone={statusTone(source.status)}>{statusLabel(source.status)}</StatusPill>
                    <span className="mono">{shortSha(source.locked?.commit)}</span>
                  </div>
                  <div className="update-row-actions">
                    {source.origin === "github" ? (
                      <>
                        <Button size="sm" variant="quiet" onClick={() => onDiff(source.name)}>
                          差异
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onUpdate(source.name)}
                          disabled={source.status === "auth-failed" || source.status === "error"}
                        >
                          更新
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

        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">仓库结构</span>
              <h2>来源构成</h2>
            </div>
            <Button size="sm" variant="quiet" icon="plus" onClick={onImport}>
              导入
            </Button>
          </div>
          <div className="origin-bars">
            <OriginBar label="GitHub 来源" value={github} total={vault.sources.length} tone="ink" />
            <OriginBar label="本地来源" value={local} total={vault.sources.length} tone="accent" />
            <OriginBar
              label="受管安装"
              value={vault.counts.managedInstalls}
              total={Math.max(vault.counts.skills, 1)}
              tone="moss"
            />
          </div>
          <div className="mini-facts">
            <button className="mini-fact" onClick={() => onSettings()}>
              <Icon name="shield" size={15} />
              <span>备份保留 {vault.state?.targets ? Object.keys(vault.state.targets).length : 0} 个目标</span>
            </button>
            <div className="mini-fact">
              <Icon name="clock" size={15} />
              <span>上次应用 {relativeTime(vault.state?.last_applied_at)}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">技能</span>
            <h2>快速进入</h2>
          </div>
          <Button size="sm" variant="quiet" onClick={onValidate}>
            校验仓库
          </Button>
        </div>
        {featured.length === 0 ? (
          <EmptyState title="这个仓库还没有技能" icon="skill">
            导入本地目录，或添加一个 GitHub 来源。
            <div className="empty-action">
              <Button size="sm" onClick={onImport}>
                导入技能
              </Button>
            </div>
          </EmptyState>
        ) : (
          <div className="skill-grid">
            {featured.map((skill) => (
              <button className="skill-card" key={`${skill.sourceName}/${skill.name}`} onClick={() => onSkill(skill)}>
                <div className="skill-card-top">
                  <span className={`origin-glyph origin-${skill.origin}`}>
                    <Icon name={skill.origin === "github" ? "git" : "folder"} size={15} />
                  </span>
                  <span className="skill-card-name">{skill.name}</span>
                  <Icon name="chevron-right" size={14} className="skill-card-arrow" />
                </div>
                <p>{skill.description ?? "没有填写描述。"}</p>
                <div className="skill-card-meta">
                  <span>{skill.sourceName}</span>
                  <span>{originLabel(skill.origin)}</span>
                  {skill.installed.length > 0 ? <span className="installed-dot">已安装</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {(warnings.length > 0 || vault.warnings.length > 0) && errors.length === 0 ? (
        <Callout tone="warn" title={`${warnings.length + vault.warnings.length} 条提示`}>
          <p>{warnings[0]?.message ?? vault.warnings[0]}</p>
        </Callout>
      ) : null}

      <footer className="overview-footer">
        <span>仓库格式 {vault.format} · schema {vault.schemaVersion}</span>
        <span>{vault.path}</span>
      </footer>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: "source" | "skill" | "target" | "download";
  tone?: "accent";
}) {
  return (
    <div className={`stat-card ${tone ? "is-accent" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <Icon name={icon} size={16} />
      </div>
      <strong>{value}</strong>
      <em>{hint}</em>
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

import type { SkillRecord, SourceRecord, VaultSnapshot } from "@vaultdesk/core";
import {
  hashLabel,
  installedFor,
  originLabel,
  relativeTime,
  shortSha,
  sourceShapeLabel,
  statusLabel,
  statusTone,
} from "../format";
import type { Selection } from "../types";
import { Icon } from "./icons";
import { Button, Callout, EmptyState, MetaRow, StatusPill } from "./ui";

export function Inspector({
  vault,
  selection,
  onClose,
  onReveal,
  onDiff,
  onUpdate,
  onRemoveSource,
  onEdit,
  onFork,
  onInstall,
  onSkill,
  onBackups,
}: {
  vault: VaultSnapshot;
  selection: Selection;
  onClose: () => void;
  onReveal: (path: string) => void;
  onDiff: (source: string) => void;
  onUpdate: (source: string) => void;
  onRemoveSource: (source: string) => void;
  onEdit: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
  onInstall: (targetId?: string) => void;
  onSkill: (skill: SkillRecord) => void;
  onBackups: (targetId?: string) => void;
}) {
  if (!selection.kind || !selection.name) {
    return (
      <aside className="inspector">
        <EmptyState icon="info" title="选择一个条目">
          在左侧选择来源或技能，这里会显示路径、锁定的 commit、内容哈希与安装位置。
        </EmptyState>
      </aside>
    );
  }

  if (selection.kind === "source") {
    const source = vault.sources.find((entry) => entry.name === selection.name);
    if (!source) return <aside className="inspector" />;
    return (
      <SourceInspector
        vault={vault}
        source={source}
        onClose={onClose}
        onReveal={onReveal}
        onDiff={onDiff}
        onUpdate={onUpdate}
        onRemove={onRemoveSource}
        onInstall={onInstall}
        onSkill={onSkill}
        onBackups={onBackups}
      />
    );
  }

  const skill = vault.skills.find((entry) => entry.name === selection.name);
  if (!skill) return <aside className="inspector" />;
  return (
    <SkillInspector
      vault={vault}
      skill={skill}
      onClose={onClose}
      onReveal={onReveal}
      onEdit={onEdit}
      onFork={onFork}
      onInstall={onInstall}
      onBackups={onBackups}
    />
  );
}

function SourceInspector({
  vault,
  source,
  onClose,
  onReveal,
  onDiff,
  onUpdate,
  onRemove,
  onInstall,
  onSkill,
  onBackups,
}: {
  vault: VaultSnapshot;
  source: SourceRecord;
  onClose: () => void;
  onReveal: (path: string) => void;
  onDiff: (source: string) => void;
  onUpdate: (source: string) => void;
  onRemove: (source: string) => void;
  onInstall: (targetId?: string) => void;
  onSkill: (skill: SkillRecord) => void;
  onBackups: (targetId?: string) => void;
}) {
  const installedCount = source.skills.filter((skill) => skill.installed.length > 0).length;
  return (
    <aside className="inspector">
      <header className="inspector-head">
        <span className={`source-glyph origin-${source.origin}`}>
          <Icon name={source.origin === "github" ? "git" : "folder"} size={17} />
        </span>
        <div>
          <span className="eyebrow">来源</span>
          <h2>{source.name}</h2>
        </div>
        <button className="inspector-close" onClick={onClose} aria-label="关闭详情">
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className="inspector-tags">
        <StatusPill tone="muted">{sourceShapeLabel(source)}</StatusPill>
        <StatusPill tone={source.origin === "github" ? "neutral" : "accent"}>{originLabel(source.origin)}</StatusPill>
        <StatusPill tone={statusTone(source.status)}>{statusLabel(source.status)}</StatusPill>
      </div>

      {source.description ? <p className="inspector-copy">{source.description}</p> : null}

      <div className="inspector-section">
        <span className="inspector-section-title">上游</span>
        {source.origin === "github" ? (
          <>
            <MetaRow label="仓库">
              <span className="mono">{source.repo ?? "—"}</span>
            </MetaRow>
            <MetaRow label="引用">
              <span className="mono">{source.ref}</span>
            </MetaRow>
            <MetaRow label="锁定 commit">
              <span className="mono">{shortSha(source.locked?.commit, 12)}</span>
            </MetaRow>
            <MetaRow label="锁定哈希">
              <span className="mono">{hashLabel(source.locked?.hash)}</span>
            </MetaRow>
            <MetaRow label="远端 commit">
              <span className="mono">{shortSha(source.remoteCommit, 12)}</span>
            </MetaRow>
          </>
        ) : (
          <MetaRow label="来源类型">本地目录，不参与上游更新</MetaRow>
        )}
        <MetaRow label="上次检查">{relativeTime(source.lastCheckedAt)}</MetaRow>
        <MetaRow label="上次应用">{relativeTime(source.lastAppliedAt)}</MetaRow>
        {source.version ? <MetaRow label="版本">{source.version}</MetaRow> : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">路径</span>
        <div className="path-row">
          <span className="mono">{source.workingPath}</span>
          <button className="inline-icon" onClick={() => onReveal(source.workingPath)} aria-label="显示工作副本">
            <Icon name="external" size={12} />
          </button>
        </div>
        {source.vendorRoot ? (
          <div className="path-row">
            <span className="mono">{source.vendorRoot}</span>
            <button className="inline-icon" onClick={() => onReveal(source.vendorRoot as string)} aria-label="显示 vendor 目录">
              <Icon name="external" size={12} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">
          技能 <em>{source.skills.length}</em>
        </span>
        <div className="inspector-skill-list">
          {source.skills.map((skill) => (
            <button className="inspector-skill" key={skill.name} onClick={() => onSkill(skill)}>
              <span className={`origin-glyph small origin-${skill.origin}`}>
                <Icon name={skill.origin === "github" ? "git" : "folder"} size={12} />
              </span>
              <span className="inspector-skill-name">
                {skill.name}
                {skill.isEntrypoint ? <StatusPill tone="accent">入口</StatusPill> : null}
              </span>
              {skill.installed.length > 0 ? <span className="installed-dot" /> : null}
            </button>
          ))}
        </div>
        <p className="muted-small">{installedCount} 个技能已安装到目标目录。</p>
      </div>

      <div className="inspector-actions">
        {source.origin === "github" ? (
          <>
            <Button size="sm" variant="quiet" icon="file" onClick={() => onDiff(source.name)}>
              上游差异
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              onClick={() => onUpdate(source.name)}
              disabled={vault.format === "v1" || source.status !== "update-available"}
            >
              应用更新
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" icon="download" onClick={() => onInstall()}>
          安装技能
        </Button>
        <Button size="sm" variant="ghost" icon="backup" onClick={() => onBackups()}>
          备份
        </Button>
      </div>
      {vault.format === "v2" ? (
        <button className="danger-link" onClick={() => onRemove(source.name)}>
          移除这个来源
        </button>
      ) : null}
    </aside>
  );
}

function SkillInspector({
  vault,
  skill,
  onClose,
  onReveal,
  onEdit,
  onFork,
  onInstall,
  onBackups,
}: {
  vault: VaultSnapshot;
  skill: SkillRecord;
  onClose: () => void;
  onReveal: (path: string) => void;
  onEdit: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
  onInstall: (targetId?: string) => void;
  onBackups: (targetId?: string) => void;
}) {
  const drift = Boolean(skill.lockedHash && skill.lockedHash !== skill.contentHash);
  const source = vault.sources.find((entry) => entry.name === skill.sourceName);
  const readOnly = skill.origin === "github" || vault.format === "v1";

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <span className={`source-glyph origin-${skill.origin}`}>
          <Icon name="skill" size={17} />
        </span>
        <div>
          <span className="eyebrow">技能</span>
          <h2>{skill.name}</h2>
        </div>
        <button className="inspector-close" onClick={onClose} aria-label="关闭详情">
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className="inspector-tags">
        <StatusPill tone={skill.origin === "github" ? "neutral" : "accent"}>{originLabel(skill.origin)}</StatusPill>
        <StatusPill tone="muted">{skill.shape === "standalone" ? "独立技能" : source ? sourceShapeLabel(source) : "包内技能"}</StatusPill>
        {skill.userInvocable ? <StatusPill tone="muted">可调用</StatusPill> : <StatusPill tone="warn">仅内部</StatusPill>}
        {drift ? <StatusPill tone="warn">内容有本地改动</StatusPill> : null}
      </div>

      <p className="inspector-copy">{skill.description ?? "没有填写描述。"}</p>

      <div className="inspector-section">
        <span className="inspector-section-title">归属</span>
        <MetaRow label="来源">{skill.sourceName}</MetaRow>
        {skill.packageName ? <MetaRow label="包">{skill.packageName}</MetaRow> : null}
        {skill.repo ? <MetaRow label="仓库"><span className="mono">{skill.repo}</span></MetaRow> : null}
        {skill.ref ? <MetaRow label="引用"><span className="mono">{skill.ref}</span></MetaRow> : null}
        {skill.forkedFrom ? (
          <MetaRow label="Fork 自">
            <span className="mono">{skill.forkedFrom.repo}@{shortSha(skill.forkedFrom.commit)}</span>
          </MetaRow>
        ) : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">内容</span>
        <div className="path-row">
          <span className="mono">{skill.workingPath}</span>
          <button className="inline-icon" onClick={() => onReveal(skill.workingPath)} aria-label="显示技能目录">
            <Icon name="external" size={12} />
          </button>
        </div>
        <MetaRow label="内容哈希"><span className="mono">{hashLabel(skill.contentHash)}</span></MetaRow>
        <MetaRow label="锁定哈希"><span className="mono">{hashLabel(skill.lockedHash)}</span></MetaRow>
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">
          安装 <em>{skill.installed.length}</em>
        </span>
        {skill.installed.length === 0 ? (
          <p className="muted-small">还没有安装到任何目标目录。</p>
        ) : (
          skill.installed.map((entry) => (
            <div className="installed-entry" key={entry.path}>
              <span className={`slot-dot ${entry.isSymlink ? "is-link" : entry.managed ? "is-managed" : "is-unmanaged"}`} />
              <div>
                <strong>{entry.targetId}</strong>
                <span className="mono">{entry.hash ? hashLabel(entry.hash) : entry.isSymlink ? "符号链接" : "无标记"}</span>
              </div>
              {entry.matches === false ? <StatusPill tone="warn">已变化</StatusPill> : null}
            </div>
          ))
        )}
        <p className="muted-small">安装状态：{installedFor(skill)}</p>
      </div>

      <div className="inspector-actions">
        {readOnly ? (
          <Button
            size="sm"
            variant="quiet"
            icon="branch"
            onClick={() => onFork(skill)}
            disabled={vault.format === "v1"}
            title={vault.format === "v1" ? "迁移到 v2 后才能 fork" : "Fork 成本地来源后可编辑"}
          >
            Fork 到本地
          </Button>
        ) : (
          <Button size="sm" variant="quiet" icon="edit" onClick={() => onEdit(skill)}>
            编辑 SKILL.md
          </Button>
        )}
        <Button size="sm" variant="ghost" icon="download" onClick={() => onInstall()}>
          安装
        </Button>
        <Button size="sm" variant="ghost" icon="backup" onClick={() => onBackups()}>
          备份
        </Button>
      </div>

      {readOnly && skill.origin === "github" ? (
        <Callout tone="info">
          <p>GitHub 来源技能只读。编辑会先创建本地副本，并记录 forked_from。</p>
        </Callout>
      ) : null}
    </aside>
  );
}

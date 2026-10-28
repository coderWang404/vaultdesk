import { useState } from "react";
import type {
  ExternalSkillRecord,
  PluginAssetKind,
  PluginRecord,
  SkillRecord,
  SourceRecord,
  VaultSnapshot,
} from "@vaultdesk/core";
import {
  assetKindLabel,
  externalStatusLabel,
  externalStatusTone,
  hashLabel,
  issuesForPlugin,
  originLabel,
  pluginAgentLabel,
  relativeTime,
  shortSha,
  sourceShapeLabel,
  statusLabel,
  statusTone,
} from "../format";
import type { Selection } from "../types";
import { Icon } from "./icons";
import { Button, Callout, EmptyState, MetaRow, StatusMark, StatusPill } from "./ui";

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
        <EmptyState icon="info" title="选择一项" />
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

  if (selection.kind === "plugin") {
    const plugin = vault.plugins.find((entry) => entry.name === selection.name);
    if (!plugin) return <aside className="inspector" />;
    return (
      <PluginInspector
        vault={vault}
        plugin={plugin}
        onClose={onClose}
        onReveal={onReveal}
      />
    );
  }

  if (selection.kind === "external") {
    const external = vault.externalSkills.find((entry) => entry.name === selection.name);
    if (!external) return <aside className="inspector" />;
    return <ExternalInspector skill={external} onClose={onClose} onReveal={onReveal} />;
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
          <p className="muted-small">—</p>
        ) : (
          skill.installed.map((entry) => (
            <div className="installed-entry" key={entry.path}>
              <StatusMark
                tone={entry.managed ? "ok" : "warn"}
                label={entry.isSymlink ? "符号链接" : entry.managed ? "受管" : "未受管"}
                size={13}
              />
              <div>
                <strong>{entry.targetId}</strong>
                <span className="mono">{entry.hash ? hashLabel(entry.hash) : entry.isSymlink ? "符号链接" : "无标记"}</span>
              </div>
              {entry.matches === false ? <StatusPill tone="warn">已变化</StatusPill> : null}
            </div>
          ))
        )}
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
    </aside>
  );
}

function ExternalInspector({
  skill,
  onClose,
  onReveal,
}: {
  skill: ExternalSkillRecord;
  onClose: () => void;
  onReveal: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy(): Promise<void> {
    if (await copyPath(skill.skillPath)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <span className="source-glyph origin-external">
          <Icon name="shield" size={17} />
        </span>
        <div>
          <span className="eyebrow">外部技能</span>
          <h2>{skill.name}</h2>
        </div>
        <button className="inspector-close" onClick={onClose} aria-label="关闭详情">
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className="inspector-tags">
        <StatusPill tone="neutral">{originLabel("external")}</StatusPill>
        <StatusPill tone={externalStatusTone(skill.status)}>{externalStatusLabel(skill.status)}</StatusPill>
        {skill.version ? <StatusPill tone="muted">v{skill.version}</StatusPill> : null}
        {skill.observedVersion && skill.observedVersion !== skill.version ? (
          <StatusPill tone="muted">实际 v{skill.observedVersion}</StatusPill>
        ) : null}
      </div>

      {skill.status === "conflict" ? (
        <Callout tone="danger" title="归属冲突">
          <p>
            路径上仍有 <span className="mono">.vault-managed</span> 标记，说明另一个 VaultDesk 仓库曾管理它。
            先解决归属，再让工具写入这个目录。
          </p>
        </Callout>
      ) : null}
      {skill.status === "missing" ? (
        <Callout tone="warn" title="路径不存在">
          <p>工具可能尚未安装，或目录被移动了。VaultDesk 不会替你创建或安装它。</p>
        </Callout>
      ) : null}
      {skill.status === "invalid" ? (
        <Callout tone="warn" title="不是可识别的技能目录">
          <p>目录存在，但里面没有 SKILL.md。等工具写入后再刷新状态。</p>
        </Callout>
      ) : null}
      {skill.status === "drift" ? (
        <Callout tone="warn" title="内容与记录不一致">
          <p>
            目录内容与 expected_hash 不同。若这是工具正常升级造成的，确认后可用
            <span className="mono"> vaultdesk external add {skill.name} --force --pin …</span> 重新记录。
          </p>
        </Callout>
      ) : null}

      <p className="inspector-copy">{skill.description ?? "没有填写描述。"}</p>

      <div className="inspector-section">
        <span className="inspector-section-title">归属</span>
        <MetaRow label="所有者">{skill.owner}</MetaRow>
        {skill.relatedTool ? <MetaRow label="关联工具">{skill.relatedTool}</MetaRow> : null}
        <MetaRow label="记录">{skill.relativePath}</MetaRow>
        {skill.modifiedAt ? <MetaRow label="目录改动">{relativeTime(skill.modifiedAt)}</MetaRow> : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">外部路径</span>
        <div className="path-row">
          <span className="mono">{skill.skillPath}</span>
          <button className="inline-icon" onClick={() => onReveal(skill.skillPath)} aria-label="显示外部技能目录">
            <Icon name="external" size={12} />
          </button>
        </div>
        <div className="path-row">
          <span className="mono">{skill.relativePath}</span>
          <button className="inline-icon" onClick={() => onReveal(skill.metadataPath)} aria-label="显示记录文件">
            <Icon name="external" size={12} />
          </button>
        </div>
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">观察</span>
        <MetaRow label="当前哈希">
          <span className="mono">{hashLabel(skill.observedHash)}</span>
        </MetaRow>
        <MetaRow label="记录哈希">
          <span className="mono">{skill.expectedHash ? hashLabel(skill.expectedHash) : "未固定"}</span>
        </MetaRow>
        <MetaRow label="标记">
          {skill.markerPresent ? "存在 .vault-managed" : "无 .vault-managed"}
        </MetaRow>
      </div>

      {skill.notes ? (
        <div className="inspector-section">
          <span className="inspector-section-title">备注</span>
          <p className="muted-small">{skill.notes}</p>
        </div>
      ) : null}

      <div className="inspector-actions">
        <Button size="sm" variant="quiet" icon="folder" onClick={() => onReveal(skill.skillPath)}>
          在 Finder 中显示
        </Button>
        <Button size="sm" variant="ghost" icon="file" onClick={() => void onCopy()}>
          {copied ? "已复制" : "复制路径"}
        </Button>
      </div>

      <p className="muted-small">{skill.owner} 管理 · VaultDesk 只读</p>
    </aside>
  );
}

async function copyPath(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

function PluginInspector({
  vault,
  plugin,
  onClose,
  onReveal,
}: {
  vault: VaultSnapshot;
  plugin: PluginRecord;
  onClose: () => void;
  onReveal: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const issues = issuesForPlugin(vault, plugin);
  const assetCounts = new Map<PluginAssetKind, number>();
  for (const asset of plugin.assets) {
    assetCounts.set(asset.kind, (assetCounts.get(asset.kind) ?? 0) + 1);
  }

  async function onCopy(): Promise<void> {
    if (await copyPath(plugin.workingPath)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <span className={`source-glyph origin-${plugin.origin}`}>
          <Icon name="sparkle" size={17} />
        </span>
        <div>
          <span className="eyebrow">插件</span>
          <h2>{plugin.name}</h2>
        </div>
        <button className="inspector-close" onClick={onClose} aria-label="关闭详情">
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className="inspector-tags">
        <StatusPill tone="muted">插件</StatusPill>
        <StatusPill tone={plugin.origin === "github" ? "neutral" : "accent"}>{originLabel(plugin.origin)}</StatusPill>
        <StatusPill tone={statusTone(plugin.status)}>{statusLabel(plugin.status)}</StatusPill>
        {plugin.version ? <StatusPill tone="muted">v{plugin.version}</StatusPill> : null}
        {plugin.hasHooks ? <StatusPill tone="warn">含 hooks</StatusPill> : null}
      </div>

      {plugin.hasHooks ? (
        <Callout tone="warn" title="这个插件包含 hooks">
          <p>hooks 已随插件保存，但不会执行。交给 agent 安装前先确认清单与风险。</p>
        </Callout>
      ) : null}

      <p className="inspector-copy">
        {plugin.description ?? "—"}
      </p>

      <div className="inspector-section">
        <span className="inspector-section-title">上游</span>
        {plugin.origin === "github" ? (
          <>
            <MetaRow label="仓库">
              <span className="mono">{plugin.repo ?? "—"}</span>
            </MetaRow>
            <MetaRow label="引用">
              <span className="mono">{plugin.ref}</span>
            </MetaRow>
            {plugin.contentPath ? (
              <MetaRow label="仓库内路径">
                <span className="mono">{plugin.contentPath}</span>
              </MetaRow>
            ) : null}
            <MetaRow label="锁定 commit">
              <span className="mono">{shortSha(plugin.locked?.commit, 12)}</span>
            </MetaRow>
            <MetaRow label="整根哈希">
              <span className="mono">{hashLabel(plugin.locked?.hash)}</span>
            </MetaRow>
            <MetaRow label="远端 commit">
              <span className="mono">{shortSha(plugin.remoteCommit, 12)}</span>
            </MetaRow>
          </>
        ) : (
          <MetaRow label="来源类型">本地目录，不参与上游更新</MetaRow>
        )}
        <MetaRow label="上次检查">{relativeTime(plugin.lastCheckedAt)}</MetaRow>
        <MetaRow label="上次应用">{relativeTime(plugin.lastAppliedAt)}</MetaRow>
        {plugin.license ? <MetaRow label="许可">{plugin.license}</MetaRow> : null}
        {plugin.lastError ? <MetaRow label="错误">{plugin.lastError}</MetaRow> : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">路径</span>
        <div className="path-row">
          <span className="mono">{plugin.workingPath}</span>
          <button className="inline-icon" onClick={() => onReveal(plugin.workingPath)} aria-label="显示插件根目录">
            <Icon name="external" size={12} />
          </button>
        </div>
        {plugin.vendorRoot ? (
          <div className="path-row">
            <span className="mono">{plugin.vendorRoot}</span>
            <button className="inline-icon" onClick={() => onReveal(plugin.vendorRoot as string)} aria-label="显示上游副本">
              <Icon name="external" size={12} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">
          manifest <em>{plugin.manifests.length}</em>
        </span>
        <div className="plugin-manifest-list">
          {plugin.manifests.length === 0 ? (
            <span className="muted-small">无 manifest，按目录结构识别。</span>
          ) : null}
          {plugin.manifests.map((manifest) => (
            <div className={`plugin-manifest ${manifest.parseError ? "is-error" : ""}`} key={manifest.relativePath}>
              <StatusPill tone={manifest.parseError ? "danger" : "neutral"}>{pluginAgentLabel(manifest.agent)}</StatusPill>
              <div>
                <span className="mono">{manifest.relativePath}</span>
                <span className="muted-small">
                  {manifest.parseError
                    ? manifest.parseError
                    : [manifest.name, manifest.version ? `v${manifest.version}` : undefined]
                        .filter(Boolean)
                        .join(" · ") || "没有声明 name / version"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">
          资产 <em>{plugin.assets.length}</em>
        </span>
        <div className="plugin-asset-tags">
          {[...assetCounts.entries()].map(([kind, count]) => (
            <StatusPill tone={kind === "hooks" ? "warn" : "muted"} key={kind}>
              {assetKindLabel(kind)} {count}
            </StatusPill>
          ))}
          {plugin.assets.length === 0 ? <span className="muted-small">没有识别到资产目录或 manifest 引用。</span> : null}
        </div>
        {plugin.assets.length > 0 ? (
          <div className="plugin-asset-list">
            {plugin.assets.map((asset) => (
              <div className="plugin-asset" key={`${asset.kind}:${asset.relativePath}`}>
                <span>{assetKindLabel(asset.kind)}</span>
                <span className="mono">{asset.relativePath}</span>
              </div>
            ))}
          </div>
        ) : null}
        {plugin.otherCount > 0 ? (
          <p className="muted-small">插件根另有 {plugin.otherCount} 个未分类条目。</p>
        ) : null}
      </div>

      <div className="inspector-section">
        <span className="inspector-section-title">
          插件内技能 <em>{plugin.skills.length}</em>
        </span>
        {plugin.skills.length === 0 ? (
          <p className="muted-small">没有技能。插件仍会完整保存。</p>
        ) : (
          <div className="plugin-skill-list">
            {plugin.skills.map((skill) => (
              <div className="plugin-skill" key={skill.name}>
                <div>
                  <strong>{skill.name}</strong>
                  <span className="muted-small">{skill.description ?? "—"}</span>
                </div>
                <button
                  className="inline-icon"
                  onClick={() => onReveal(skill.workingPath)}
                  aria-label={`显示 ${skill.name} 目录`}
                >
                  <Icon name="external" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="muted-small">不进入 build 或安装计划。</p>
      </div>

      {issues.length > 0 ? (
        <div className="inspector-section">
          <span className="inspector-section-title">
            校验问题 <em>{issues.length}</em>
          </span>
          <div className="plugin-issue-list">
            {issues.map((issue) => (
              <div className={`plugin-issue is-${issue.severity}`} key={`${issue.code}:${issue.message}`}>
                <StatusPill tone={issue.severity === "error" ? "danger" : "warn"}>
                  {issue.severity === "error" ? "错误" : "提示"}
                </StatusPill>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="inspector-actions">
        <Button size="sm" variant="quiet" icon="folder" onClick={() => onReveal(plugin.workingPath)}>
          在 Finder 中显示
        </Button>
        {plugin.vendorRoot ? (
          <Button size="sm" variant="ghost" icon="file" onClick={() => onReveal(plugin.vendorRoot as string)}>
            上游副本
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon="file" onClick={() => void onCopy()}>
          {copied ? "已复制" : "复制路径"}
        </Button>
      </div>
      <p className="muted-small">VaultDesk 不会安装、启用或更新 agent 侧的插件副本。</p>
    </aside>
  );
}

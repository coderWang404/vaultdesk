import { useState } from "react";
import type {
  ExternalSkillRecord,
  PluginAssetKind,
  PluginRecord,
  SkillRecord,
  SourceRecord,
  ToolRecord,
  VaultSnapshot,
} from "@vaultdesk/core";
import { checkPresentation, readinessCheckedAt, readinessKey, readinessPresentation, type ToolReadinessState } from "../readiness";
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
import type { InstallIntent, Selection } from "../types";
import { call, errorMessage } from "../api";
import { Icon } from "./icons";
import { Button, Callout, EmptyState, MetaRow, StatusMark, StatusPill } from "./ui";

function inspectorAttributes(overlay: boolean, title: string) {
  return {
    role: overlay ? "dialog" as const : undefined,
    "aria-modal": overlay ? true : undefined,
    "aria-label": title,
    tabIndex: -1,
  };
}

export function Inspector({
  vault,
  selection,
  readiness,
  onVerifyTool,
  overlay,
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
  onRefresh,
}: {
  vault: VaultSnapshot;
  selection: Selection;
  readiness: Record<string, ToolReadinessState>;
  onVerifyTool: (name: string, profile?: string) => void;
  overlay: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
  onDiff: (source: string) => void;
  onUpdate: (source: string) => void;
  onRemoveSource: (source: string) => void;
  onEdit: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
  onInstall: (intent?: InstallIntent) => void;
  onSkill: (skill: SkillRecord) => void;
  onBackups: (targetId?: string) => void;
  onRefresh: () => Promise<unknown>;
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
        overlay={overlay}
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
        overlay={overlay}
        onClose={onClose}
        onReveal={onReveal}
        onRefresh={() => onRefresh()}
      />
    );
  }

  if (selection.kind === "external") {
    const external = vault.externalSkills.find((entry) => entry.name === selection.name);
    if (!external) return <aside className="inspector" />;
    return <ExternalInspector vault={vault} skill={external} readiness={readiness} onVerifyTool={onVerifyTool} overlay={overlay} onClose={onClose} onReveal={onReveal} />;
  }

  const skill = vault.skills.find((entry) => entry.name === selection.name);
  if (!skill) return <aside className="inspector" />;
  return (
    <SkillInspector
      vault={vault}
      skill={skill}
      readiness={readiness}
      onVerifyTool={onVerifyTool}
      overlay={overlay}
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
  overlay,
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
  overlay: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
  onDiff: (source: string) => void;
  onUpdate: (source: string) => void;
  onRemove: (source: string) => void;
  onInstall: (intent?: InstallIntent) => void;
  onSkill: (skill: SkillRecord) => void;
  onBackups: (targetId?: string) => void;
}) {
  return (
    <aside className="inspector" {...inspectorAttributes(overlay, source.name + " 详情")}>
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
        <Button size="sm" variant="ghost" icon="download" onClick={() => onInstall({ mode: "skills", names: source.skills.map((skill) => skill.name) })}>
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
  readiness,
  onVerifyTool,
  overlay,
  onClose,
  onReveal,
  onEdit,
  onFork,
  onInstall,
  onBackups,
}: {
  vault: VaultSnapshot;
  skill: SkillRecord;
  readiness: Record<string, ToolReadinessState>;
  onVerifyTool: (name: string, profile?: string) => void;
  overlay: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
  onEdit: (skill: SkillRecord) => void;
  onFork: (skill: SkillRecord) => void;
  onInstall: (intent?: InstallIntent) => void;
  onBackups: (targetId?: string) => void;
}) {
  const drift = Boolean(skill.lockedHash && skill.lockedHash !== skill.contentHash);
  const source = vault.sources.find((entry) => entry.name === skill.sourceName);
  const readOnly = skill.origin === "github" || vault.format === "v1";
  const relatedTools = vault.tools.filter((tool) => tool.related_skills.includes(skill.name));

  return (
    <aside className="inspector" {...inspectorAttributes(overlay, skill.name + " 详情")}>
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
          文件分发 <em>{skill.installed.length}</em>
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

      <div className="inspector-section">
        <span className="inspector-section-title">运行环境</span>
        <p className="muted-small">文件已分发只证明目录和哈希符合预期；Python、外部程序与凭据需要单独核对。</p>
        {relatedTools.length > 0 ? relatedTools.map((tool) => (
          <LinkedToolReadiness
            key={tool.name}
            tool={tool}
            state={readiness[readinessKey(vault.path, tool.name)]}
            onVerify={() => onVerifyTool(tool.name)}
          />
        )) : <StatusPill tone="muted">未关联运行时检查</StatusPill>}
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
        <Button size="sm" variant="ghost" icon="download" onClick={() => onInstall({ mode: "skills", names: [skill.name] })}>
          安装
        </Button>
        <Button size="sm" variant="ghost" icon="backup" onClick={() => onBackups()}>
          备份
        </Button>
      </div>
    </aside>
  );
}

function LinkedToolReadiness({
  tool,
  state,
  onVerify,
}: {
  tool: ToolRecord;
  state?: ToolReadinessState;
  onVerify: () => void;
}) {
  const status = readinessPresentation(tool.checks.length > 0, state);
  const attention = state?.report?.checks.filter((check) => check.status !== "ok") ?? [];
  const scenarios = [...new Set(tool.checks.flatMap((check) => check.profiles ?? []))].sort();
  const checkedAt = readinessCheckedAt(state?.report);
  return (
    <div className="linked-tool-readiness">
      <div className="linked-tool-head">
        <strong>{tool.title}</strong>
        <span role="status" aria-atomic="true"><StatusPill tone={status.tone}>{status.label}</StatusPill></span>
      </div>
      {tool.checks.length > 0 ? (
        <Button size="sm" variant="quiet" disabled={state?.loading} onClick={onVerify}>
          {state?.loading ? "检查中…" : state?.report ? "重新检查运行环境" : "检查运行环境"}
        </Button>
      ) : <p className="muted-small">这张工具卡尚未声明检查项，不能判断工具是否可运行。</p>}
      {scenarios.length > 0 && !state?.report?.profile ? (
        <p className="muted-small">仅显示通用项；{scenarios.join("、")} 场景请到「工具」页单独检查。</p>
      ) : null}
      {checkedAt ? <p className="muted-small">上次检查：{checkedAt}</p> : null}
      {state?.error ? <p className="linked-tool-error" role="alert">{state.error}</p> : null}
      {attention.length > 0 ? (
        <ul className="linked-tool-issues">
          {attention.map((check) => (
            <li key={check.id}>
              <strong>{check.label}</strong>
              <span>{checkPresentation(check.status).label}{check.optional ? "（可选）" : ""}</span>
              {check.detail ? <small>{check.detail}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ExternalInspector({
  vault,
  skill,
  readiness,
  onVerifyTool,
  overlay,
  onClose,
  onReveal,
}: {
  vault: VaultSnapshot;
  skill: ExternalSkillRecord;
  readiness: Record<string, ToolReadinessState>;
  onVerifyTool: (name: string, profile?: string) => void;
  overlay: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const relatedTool = vault.tools.find((tool) => tool.name === skill.relatedTool);

  async function onCopy(): Promise<void> {
    if (await copyPath(skill.skillPath)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <aside className="inspector" {...inspectorAttributes(overlay, skill.name + " 详情")}>
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

      <div className="inspector-section">
        <span className="inspector-section-title">运行环境</span>
        <p className="muted-small">观察状态只证明外部技能目录可读；安装与更新仍由 {skill.owner} 负责。</p>
        {relatedTool ? (
          <LinkedToolReadiness
            tool={relatedTool}
            state={readiness[readinessKey(vault.path, relatedTool.name)]}
            onVerify={() => onVerifyTool(relatedTool.name)}
          />
        ) : <StatusPill tone="muted">未关联运行时检查</StatusPill>}
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
  overlay,
  onClose,
  onReveal,
  onRefresh,
}: {
  vault: VaultSnapshot;
  plugin: PluginRecord;
  overlay: boolean;
  onClose: () => void;
  onReveal: (path: string) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [copied, setCopied] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [targetDest, setTargetDest] = useState("");
  const [targetAutoSync, setTargetAutoSync] = useState(true);
  const [targetFormOpen, setTargetFormOpen] = useState(false);
  const [targetBusy, setTargetBusy] = useState<string | null>(null);
  const [targetMessage, setTargetMessage] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const issues = issuesForPlugin(vault, plugin);
  const pluginTargets = (vault.metadata.plugin_targets ?? []).filter((target) => target.names.includes(plugin.name));
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

  async function addTarget(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const id = targetId.trim();
    const dest = targetDest.trim();
    if (!id || !dest) {
      setTargetError("请填写目标 ID 和绝对路径（可使用 ~/ 开头）。");
      return;
    }
    setTargetBusy("add");
    setTargetError(null);
    setTargetMessage(null);
    try {
      await call("pluginTarget.add", {
        vaultPath: vault.path,
        id,
        dest,
        names: [plugin.name],
        installAfterUpdate: targetAutoSync,
        confirm: true,
      });
      await onRefresh();
      setTargetId("");
      setTargetDest("");
      setTargetAutoSync(true);
      setTargetFormOpen(false);
      setTargetMessage(`已登记目标 ${id}。点击“立即同步”才会复制当前插件内容。`);
    } catch (reason) {
      setTargetError(errorMessage(reason));
    } finally {
      setTargetBusy(null);
    }
  }

  async function distributeTarget(): Promise<void> {
    setTargetBusy("sync");
    setTargetError(null);
    setTargetMessage(null);
    try {
      const result = await call<{ name: string; changedPaths: string[] }>("source.distribute", {
        vaultPath: vault.path,
        name: plugin.name,
        confirm: true,
      });
      await onRefresh();
      setTargetMessage(result.changedPaths.length > 0 ? `已同步 ${result.changedPaths.length} 个受管路径。` : "目标内容已是最新。");
    } catch (reason) {
      setTargetError(errorMessage(reason));
    } finally {
      setTargetBusy(null);
    }
  }

  async function removeTarget(id: string): Promise<void> {
    if (!window.confirm(`移除目标“${id}”？登记会被删除，目标目录中的插件副本会保留。`)) return;
    setTargetBusy(`remove:${id}`);
    setTargetError(null);
    setTargetMessage(null);
    try {
      await call("pluginTarget.remove", {
        vaultPath: vault.path,
        id,
        deleteFiles: false,
        confirm: true,
      });
      await onRefresh();
      setTargetMessage(`已移除目标 ${id}；目标目录中的副本未删除。`);
    } catch (reason) {
      setTargetError(errorMessage(reason));
    } finally {
      setTargetBusy(null);
    }
  }

  return (
    <aside className="inspector" {...inspectorAttributes(overlay, plugin.name + " 详情")}>
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
        <div className="plugin-target-head">
          <span className="inspector-section-title">受管插件目标 <em>{pluginTargets.length}</em></span>
          <Button size="sm" variant="quiet" icon="plus" onClick={() => { setTargetFormOpen((open) => !open); setTargetError(null); }}>
            {targetFormOpen ? "取消" : "登记目标"}
          </Button>
        </div>
        <p className="muted-small">这里登记的是 VaultDesk 要复制插件目录的位置，不代表对应 agent 已安装或启用插件。</p>
        {pluginTargets.length === 0 ? <p className="muted-small">尚未登记目标。agent 自行安装的插件不会被 VaultDesk 接管。</p> : (
          <div className="plugin-target-list">
            {pluginTargets.map((target) => (
              <div className="plugin-target" key={target.id}>
                <div className="plugin-target-main">
                  <div className="plugin-target-title">
                    <strong>{target.id}</strong>
                    <StatusPill tone={target.install_after_update ? "accent" : "muted"}>
                      {target.install_after_update ? "更新后自动同步" : "已暂停同步"}
                    </StatusPill>
                  </div>
                  <span className="mono plugin-target-path">{target.dest}</span>
                  <span className="muted-small">插件：{target.names.join("、")}</span>
                </div>
                <div className="plugin-target-actions">
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="refresh"
                    onClick={() => void distributeTarget()}
                    disabled={targetBusy !== null || !target.install_after_update}
                    title={target.install_after_update ? "同步所有启用自动同步的插件目标" : "此目标已暂停同步；恢复开关后才会同步"}
                  >
                    {target.install_after_update ? "立即同步" : "已暂停"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeTarget(target.id)} disabled={targetBusy !== null}>
                    移除登记
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {targetFormOpen ? (
          <form className="plugin-target-form" onSubmit={(event) => void addTarget(event)}>
            <label className="field">
              <span className="field-label">目标 ID</span>
              <input className="input" value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="例如 claude-plugin" spellCheck={false} />
            </label>
            <label className="field">
              <span className="field-label">复制到目录</span>
              <input className="input mono" value={targetDest} onChange={(event) => setTargetDest(event.target.value)} placeholder="/absolute/path 或 ~/..." spellCheck={false} />
            </label>
            <label className="toggle-row plugin-target-toggle">
              <span className="toggle-copy">
                <span className="toggle-label">上游更新后自动同步</span>
                <span className="toggle-hint">关闭后保留当前插件副本，后续更新不会覆盖。</span>
              </span>
              <input type="checkbox" checked={targetAutoSync} onChange={(event) => setTargetAutoSync(event.target.checked)} />
              <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
            </label>
            <div className="plugin-target-preview">
              <span className="eyebrow">登记预览</span>
              <strong>{targetId.trim() || "未填写目标 ID"}</strong>
              <span className="mono">{targetDest.trim() || "未填写复制目录"}</span>
              <span>将登记插件：{plugin.name}</span>
            </div>
            <Button type="submit" size="sm" variant="primary" loading={targetBusy === "add"} disabled={targetBusy !== null}>
              登记目标
            </Button>
          </form>
        ) : null}
        {targetMessage ? <p className="form-success" role="status">{targetMessage}</p> : null}
        {targetError ? <Callout tone="danger" title="插件目标操作失败"><p>{targetError}</p></Callout> : null}
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

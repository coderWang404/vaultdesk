import { useMemo, useState } from "react";
import type { InstallPlan, InstallResult, VaultSnapshot } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import type { InstallIntent } from "../../types";
import { call, errorMessage } from "../../api";
import { Icon } from "../icons";
import { Button, Callout, Field, Modal, StatusPill } from "../ui";

export function InstallModal({
  vault,
  intent,
  presets,
  onClose,
  onDone,
}: {
  vault: VaultSnapshot;
  intent: InstallIntent;
  presets: ToolPreset[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const fixedTarget = intent.mode === "reinstall" || intent.mode === "add";
  const target = fixedTarget ? vault.targets.find((entry) => entry.id === intent.targetId) : undefined;
  const fixedSkills = intent.mode === "reinstall" || intent.mode === "skills";
  const [names, setNames] = useState<string[]>(intent.mode === "skills" ? intent.names : intent.mode === "reinstall" ? target?.skills ?? [] : []);
  const [dest, setDest] = useState(target?.dest ?? "~/.agents/skills");
  const [id, setId] = useState(target?.id ?? "agents-shared");
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const availableSkills = useMemo(() => vault.skills.filter((skill) => intent.mode !== "add" || !target?.skills.includes(skill.name)), [vault.skills, intent.mode, target]);
  const validScope = (!fixedTarget || Boolean(target)) && names.length > 0 && names.every((name) => vault.skills.some((skill) => skill.name === name));
  const canSubmit = vault.format === "v2" && validScope;
  const title = intent.mode === "reinstall" ? `重新安装到 ${intent.targetId}` : intent.mode === "add" ? `添加技能到 ${intent.targetId}` : intent.mode === "skills" && names.length === 1 ? `安装 ${names[0]}` : "安装技能";
  const actionLabel = intent.mode === "reinstall" ? "确认重新安装" : intent.mode === "add" ? "确认添加" : "确认安装";
  function close(): void {
    if (busy) return;
    if (result) onDone(`已${intent.mode === "reinstall" ? "重新安装" : "安装"} ${result.installed} 个技能到 ${result.targetId}`);
    else onClose();
  }

  const grouped = useMemo(() => {
    const map = new Map<string, typeof vault.skills>();
    for (const skill of availableSkills) {
      if (query.trim() && !`${skill.name} ${skill.sourceName} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())) continue;
      const list = map.get(skill.sourceName) ?? [];
      list.push(skill);
      map.set(skill.sourceName, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [availableSkills, query]);

  function resetPreview(): void {
    setPlan(null);
    setResult(null);
    setError(null);
  }

  function toggleSkill(name: string): void {
    resetPreview();
    setNames((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  }

  function applyPreset(preset: ToolPreset): void {
    resetPreview();
    setDest(preset.dest);
    const guess = preset.dest.split("/").filter(Boolean).at(-2) ?? preset.id;
    setId(`${guess}-skills`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase());
  }

  async function preview(): Promise<void> {
    if (!canSubmit || busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const next = await call<InstallResult>("target.install", {
        vaultPath: vault.path,
        names,
        skillsOnly: true,
        dest,
        ...(id.trim() ? { id: id.trim() } : {}),
        dryRun: true,
        confirm: false,
      });
      setPlan(next.plan);
      setResult(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!canSubmit || !plan || busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const next = await call<InstallResult>("target.install", {
        vaultPath: vault.path,
        names,
        skillsOnly: true,
        dest,
        ...(id.trim() ? { id: id.trim() } : {}),
        dryRun: false,
        confirm: true,
      });
      setResult(next);
      setPlan(next.plan);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      subtitle={intent.mode === "reinstall" ? "将此目标已登记的技能重新写入原目录。请先预览替换内容。" : intent.mode === "add" ? "只选择要新增到此目标的技能。" : "选择安装目录，预览后确认写入。"}
      onClose={close}
      width={fixedSkills ? "default" : "wide"}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {result ? "关闭" : "取消"}
          </Button>
          {result ? (
            <Button variant="primary" onClick={close}>
              完成
            </Button>
          ) : (
            <>
              <Button variant="quiet" icon="shield" onClick={() => void preview()} disabled={!canSubmit || busy}>
                预览计划
              </Button>
              <Button
                variant="primary"
                icon="download"
                onClick={() => void apply()}
                loading={busy}
                disabled={!canSubmit || !plan}
              >
                {actionLabel}
              </Button>
            </>
          )}
        </>
      }
    >
      {vault.format !== "v2" ? (
        <Callout tone="warn" title="v1 仓库只读">
          <p>安装需要 v2 元数据。先迁移仓库。</p>
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" title="安装失败">
          <p>{error}</p>
        </Callout>
      ) : null}

      {fixedTarget && !target ? <Callout tone="danger" title="安装目标已不存在"><p>请关闭此窗口，刷新后重新选择目标。</p></Callout> : null}
      {target ? (
        <section className="install-context" aria-label="安装目标信息">
          <div className="install-context-head"><strong>{target.id}</strong><StatusPill tone={target.installAfterUpdate ? "accent" : "muted"}>{target.installAfterUpdate ? "自动同步已开启" : "自动同步已暂停"}</StatusPill></div>
          <p className="mono">{target.expandedDest}</p>
          <p className="muted-small">{intent.mode === "reinstall" ? `本次仅重新安装已登记的 ${names.length} 个技能。` : `已登记 ${target.skills.length} 个技能，请选择新增项。`}{!target.installAfterUpdate ? " 完成后仍保持暂停。" : ""}</p>
        </section>
      ) : null}

      <fieldset className="install-fields" disabled={busy || Boolean(result)}>
      {!fixedTarget ? <div className="install-form">
        <Field label="安装目标目录" hint="绝对路径或 ~/ 开头，不能位于仓库内。">
          <input
            className="input mono"
            value={dest}
            onChange={(event) => {
              setDest(event.target.value);
              resetPreview();
            }}
          />
        </Field>
        <Field label="目标 ID" hint="用于 vault.yml 与备份目录。">
          <input
            className="input"
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              resetPreview();
            }}
          />
        </Field>
        <Field label="快速填入" hint="均未验证，请核对工具文档。">
          <div className="preset-chips">
            {presets.map((preset) => (
              <button className="preset-chip" key={preset.id} onClick={() => applyPreset(preset)}>
                <Icon name="folder" size={12} />
                {preset.label}
              </button>
            ))}
          </div>
        </Field>
      </div> : null}

      {fixedSkills ? (
        <section className="install-scope" aria-label="本次安装的技能">
          <h3>本次{intent.mode === "reinstall" ? "重新安装" : "安装"} · {names.length} 个技能</h3>
          <ul>{names.map((name) => <li key={name}><Icon name="skill" size={16} /><span>{name}</span></li>)}</ul>
          {!validScope ? <p className="muted-small">有技能已不存在，请关闭后刷新仓库。</p> : null}
        </section>
      ) : <div className="install-skill-picker">
        <div className="picker-head">
          <span>{intent.mode === "add" ? "选择新增技能" : "选择技能"} · 已选 {names.length} 项</span>
          <div>
            <button
              className="text-link"
              onClick={() => {
                resetPreview();
                setNames((current) => [...new Set([...current, ...grouped.flatMap(([, skills]) => skills.map((skill) => skill.name))])]);
              }}
            >
              {query.trim() ? "全选结果" : "全选"}
            </button>
            <button
              className="text-link"
              onClick={() => {
                resetPreview();
                setNames([]);
              }}
            >
              清空
            </button>
          </div>
        </div>
        <div className="picker-search"><input className="input" type="search" aria-label="搜索可安装技能" placeholder="搜索技能或来源" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="picker-groups">
          {grouped.length === 0 ? <p className="muted-small">{availableSkills.length === 0 ? "所有技能都已登记到此目标。" : "没有匹配的技能。"}</p> : null}
          {grouped.map(([sourceName, skills]) => (
            <div className="picker-group" key={sourceName}>
              <span className="picker-group-name">{sourceName}</span>
              <div className="picker-chips">
                {skills.map((skill) => (
                  <label className={`picker-chip ${names.includes(skill.name) ? "is-active" : ""}`} key={skill.name}>
                    <input
                      type="checkbox"
                      checked={names.includes(skill.name)}
                      onChange={() => toggleSkill(skill.name)}
                    />
                    <span>{skill.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>}
      </fieldset>

      {plan ? (
        <div className="install-plan">
          <div className="panel-head">
            <div>
              <span className="eyebrow">安装计划</span>
              <h3>
                {plan.slots.length} 个技能 · {result ? "已写入" : "等待确认"}
              </h3>
            </div>
            {result ? <StatusPill tone="ok">已写入</StatusPill> : <StatusPill tone="warn">尚未写入</StatusPill>}
          </div>
          <div className="plan-rows">
            {plan.slots.map((slot) => (
              <div className="plan-row" key={slot.skill}>
                <span className="mono">{slot.skill}</span>
                <StatusPill tone={slotActionTone(slot.action)}>{slotStateLabel(slot.state)}</StatusPill>
                <span className="muted-small">
                  {slot.action === "backup-and-replace"
                    ? "先备份"
                    : slot.action === "replace-symlink"
                      ? "只删链接"
                      : slot.action === "replace-managed"
                        ? "原地替换"
                        : "新建目录"}
                </span>
              </div>
            ))}
          </div>
          {plan.warnings.map((warning) => (
            <p className="muted-small" key={warning}>
              {warning}
            </p>
          ))}
          {result ? (
            <Callout tone={result.verification.filesInPlace ? "ok" : "warn"}>
              <p>
                {result.verification.filesInPlace
                  ? `校验通过 · ${result.verification.checked} 个文件一致`
                  : `文件校验失败：${result.verification.missing.length} 缺失、${result.verification.modified.length} 被修改。`}
              </p>
              {result.backups.length > 0 ? (
                <p>已备份 {result.backups.length} 个目录。</p>
              ) : null}
            </Callout>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function slotStateLabel(state: InstallPlan["slots"][number]["state"]): string {
  switch (state) {
    case "create":
      return "新建";
    case "managed":
      return "受管";
    case "symlink":
      return "符号链接";
    case "unmanaged":
      return "未受管";
    default:
      return state;
  }
}

function slotActionTone(action: InstallPlan["slots"][number]["action"]): "ok" | "warn" | "danger" | "neutral" | "muted" {
  switch (action) {
    case "create":
      return "ok";
    case "replace-managed":
      return "neutral";
    case "replace-symlink":
      return "warn";
    case "backup-and-replace":
      return "danger";
    default:
      return "muted";
  }
}

import { useMemo, useState } from "react";
import type { InstallPlan, InstallResult, VaultSnapshot } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { call, errorMessage } from "../../api";
import { Icon } from "../icons";
import { Button, Callout, Field, Modal, StatusPill } from "../ui";

export function InstallModal({
  vault,
  targetId,
  presets,
  onClose,
  onDone,
}: {
  vault: VaultSnapshot;
  targetId?: string;
  presets: ToolPreset[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const target = vault.targets.find((entry) => entry.id === targetId);
  const [names, setNames] = useState<string[]>(target?.skills ?? []);
  const [dest, setDest] = useState(target?.dest ?? "~/.agents/skills");
  const [id, setId] = useState(target?.id ?? "agents-shared");
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof vault.skills>();
    for (const skill of vault.skills) {
      const list = map.get(skill.sourceName) ?? [];
      list.push(skill);
      map.set(skill.sourceName, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [vault.skills]);

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
    setBusy(true);
    setError(null);
    try {
      const next = await call<InstallResult>("target.install", {
        vaultPath: vault.path,
        names,
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
    setBusy(true);
    setError(null);
    try {
      const next = await call<InstallResult>("target.install", {
        vaultPath: vault.path,
        names,
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
      title={target ? `安装到 ${target.id}` : "安装技能"}
      subtitle="先构建再写入。受管目录原地替换，符号链接只删链接，未受管目录先备份。"
      onClose={onClose}
      width="wide"
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {result ? "关闭" : "取消"}
          </Button>
          {result ? (
            <Button variant="primary" onClick={() => onDone(`已安装 ${result.installed} 个技能到 ${result.targetId}`)}>
              完成
            </Button>
          ) : (
            <>
              <Button variant="quiet" icon="shield" onClick={() => void preview()} disabled={names.length === 0 || busy}>
                预览计划
              </Button>
              <Button
                variant="primary"
                icon="download"
                onClick={() => void apply()}
                loading={busy}
                disabled={names.length === 0 || !plan}
              >
                确认安装
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

      <div className="install-form">
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
      </div>

      <div className="install-skill-picker">
        <div className="picker-head">
          <span>选择技能</span>
          <div>
            <button
              className="text-link"
              onClick={() => {
                resetPreview();
                setNames(vault.skills.map((skill) => skill.name));
              }}
            >
              全选
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
        <div className="picker-groups">
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
                    {skill.installed.length > 0 ? <span className="installed-dot" /> : null}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {plan ? (
        <div className="install-plan">
          <div className="panel-head">
            <div>
              <span className="eyebrow">安装计划</span>
              <h3>
                {plan.targetId} · {plan.slots.length} 个槽位
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
          {!result ? (
            <Button variant="primary" icon="check" onClick={() => void apply()} loading={busy}>
              确认并写入
            </Button>
          ) : (
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
          )}
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

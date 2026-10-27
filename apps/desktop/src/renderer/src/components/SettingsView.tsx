import { useEffect, useState } from "react";
import type { AppSettings, BundledAgentSkill, VaultSnapshot } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { call, errorMessage } from "../api";
import type { AppInfo } from "../types";
import { Icon } from "./icons";
import { PresetVerifyModal } from "./modals/PresetVerifyModal";
import { Button, Callout, Field, SectionHeader, StatusPill } from "./ui";

export function SettingsView({
  vault,
  settings,
  info,
  presets,
  onSaved,
  onReveal,
  onError,
}: {
  vault: VaultSnapshot;
  settings: AppSettings;
  info: AppInfo | null;
  presets: ToolPreset[];
  onSaved: (settings: AppSettings) => void;
  onReveal: (path: string) => void;
  onError: (message: string) => void;
}) {
  const [checkInterval, setCheckInterval] = useState(String(settings.checkIntervalHours));
  const [retention, setRetention] = useState(String(settings.backupRetention));
  const [backupRoot, setBackupRoot] = useState(settings.backupRoot ?? "");
  const [saving, setSaving] = useState(false);
  const [verifyPreset, setVerifyPreset] = useState<ToolPreset | null>(null);
  const [agentSkill, setAgentSkill] = useState<BundledAgentSkill | null>(null);
  const [agentSkillError, setAgentSkillError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call<BundledAgentSkill>("agentSkill.show", {})
      .then((skill) => {
        if (!cancelled) setAgentSkill(skill);
      })
      .catch((reason) => {
        if (!cancelled) setAgentSkillError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCheckInterval(String(settings.checkIntervalHours));
    setRetention(String(settings.backupRetention));
    setBackupRoot(settings.backupRoot ?? "");
  }, [settings]);

  async function chooseRoot(): Promise<void> {
    const selected = await window.vaultdesk.chooseDirectory({
      title: "选择备份根目录",
      defaultPath: backupRoot || undefined,
    });
    if (selected) setBackupRoot(selected);
  }

  async function save(): Promise<void> {
    const interval = Number(checkInterval);
    const keep = Number(retention);
    if (!Number.isInteger(interval) || interval < 0 || interval > 720) {
      onError("检查间隔必须是 0 到 720 之间的整数小时。");
      return;
    }
    if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
      onError("备份保留数量必须是 1 到 100 之间的整数。");
      return;
    }
    setSaving(true);
    try {
      const saved = await call<AppSettings>("app.setSettings", {
        settings: {
          checkIntervalHours: interval,
          backupRetention: keep,
          ...(backupRoot.trim() ? { backupRoot: backupRoot.trim() } : {}),
        },
      });
      onSaved(saved);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view settings-view">
      <SectionHeader
        eyebrow="设置"
        title="应用与仓库偏好"
        description="这些设置保存在本机的 Application Support 目录，不写入仓库。"
      />

      <div className="settings-columns">
        <section className="panel settings-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">更新检查</span>
              <h2>启动时检查上游</h2>
            </div>
          </div>
          <Field label="检查间隔（小时）" hint="设为 0 可关闭启动检查。运行期间不设置定时器，手动刷新始终可用。">
            <input
              className="input"
              type="number"
              min={0}
              max={720}
              value={checkInterval}
              onChange={(event) => setCheckInterval(event.target.value)}
            />
          </Field>
          <Callout tone="info">
            <p>上次检查：{vault.state?.last_checked_at ? new Date(vault.state.last_checked_at).toLocaleString("zh-CN") : "从未"}</p>
            <p>当前仓库格式：{vault.format}</p>
          </Callout>
        </section>

        <section className="panel settings-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">安装备份</span>
              <h2>保留与存放位置</h2>
            </div>
          </div>
          <Field label="每个目标保留备份数" hint="更早的备份不会被自动删除，需要你手动清理。">
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              value={retention}
              onChange={(event) => setRetention(event.target.value)}
            />
          </Field>
          <Field label="备份根目录" hint="留空使用 ~/Library/Application Support/VaultDesk/backups。">
            <div className="input-with-button">
              <input
                className="input mono"
                value={backupRoot}
                onChange={(event) => setBackupRoot(event.target.value)}
                placeholder="默认位置"
              />
              <Button variant="quiet" icon="folder" onClick={() => void chooseRoot()}>
                选择
              </Button>
            </div>
          </Field>
          {backupRoot ? (
            <button className="text-link" onClick={() => onReveal(backupRoot)}>
              在 Finder 中显示备份目录
              <Icon name="external" size={12} />
            </button>
          ) : null}
        </section>
      </div>

      <div className="settings-save">
        <Button variant="primary" icon="check" onClick={() => void save()} loading={saving}>
          保存设置
        </Button>
        <span>只影响本机，不写入 vault.yml。</span>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">工具预设</span>
            <h2>候选安装位置</h2>
          </div>
          <StatusPill tone="warn">均未经验证</StatusPill>
        </div>
        <p className="panel-copy">
          VaultDesk 不硬编码任何 agent 工具的发现规则。以下只是候选目录，安装前请核对对应工具的当前文档。
        </p>
        <div className="preset-list">
          {presets.map((preset) => (
            <div className="preset-row" key={preset.id}>
              <div className="preset-main">
                <strong>{preset.label}</strong>
                <span className="mono">{preset.dest}</span>
                {preset.notes ? <p>{preset.notes}</p> : null}
              </div>
              <div className="preset-actions">
                <StatusPill tone={preset.verified_at ? "ok" : "warn"}>
                  {preset.verified_at ? `已验证 ${preset.verified_at}` : "未验证"}
                </StatusPill>
                {preset.verify_command ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="terminal"
                    onClick={() => setVerifyPreset(preset)}
                  >
                    验证命令
                  </Button>
                ) : null}
                {preset.docs_url ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="external"
                    onClick={() => {
                      void call("app.openExternal", { url: preset.docs_url as string }).catch((error) =>
                        onError(errorMessage(error)),
                      );
                    }}
                  >
                    文档
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel agent-skill-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">随附 Agent 技能</span>
            <h2>vaultdesk</h2>
          </div>
          <StatusPill tone="accent">随应用打包</StatusPill>
        </div>
        <p className="panel-copy">
          这是工具自带的说明技能，教 agent 如何安全地调用 VaultDesk CLI。它与你的个人技能分开，不会被写入仓库或自动安装。
        </p>
        {agentSkillError ? (
          <Callout tone="danger" title="无法读取随附技能">
            <p>{agentSkillError}</p>
          </Callout>
        ) : agentSkill ? (
          <>
            <p className="agent-skill-description">{agentSkill.description}</p>
            <div className="agent-skill-path">
              <span className="mono">{agentSkill.path}</span>
              <Button
                size="sm"
                variant="quiet"
                icon="external"
                onClick={() => onReveal(agentSkill.path)}
              >
                在 Finder 中显示
              </Button>
            </div>
            <details className="agent-skill-details">
              <summary>查看 SKILL.md</summary>
              <pre className="agent-skill-content mono">{agentSkill.content.trimEnd()}</pre>
            </details>
            <p className="agent-skill-hint">
              CLI 等价命令：<span className="mono">vaultdesk agent skill</span>
            </p>
          </>
        ) : null}
      </section>

      <section className="panel about-panel">
        <div className="about-brand">
          <span className="brand-mark large">
            <Icon name="vault" size={22} strokeWidth={1.8} />
          </span>
          <div>
            <h2>VaultDesk</h2>
            <p>本地优先的技能仓库管理器。桌面与 CLI 共用一套核心。</p>
          </div>
        </div>
        <div className="about-meta">
          <div>
            <span>版本</span>
            <strong>{info?.version ?? window.vaultdesk.versions.app}</strong>
          </div>
          <div>
            <span>平台</span>
            <strong>{info ? `${info.platform} ${info.arch}` : "macOS"}</strong>
          </div>
          <div>
            <span>Electron</span>
            <strong>{info?.electron ?? window.vaultdesk.versions.electron}</strong>
          </div>
          <div>
            <span>许可证</span>
            <strong>Apache-2.0</strong>
          </div>
        </div>
        <div className="about-links">
          <Button
            variant="quiet"
            icon="external"
            onClick={() => {
              void call("app.openExternal", { url: "https://github.com/coderWang404/vaultdesk" }).catch((error) =>
                onError(errorMessage(error)),
              );
            }}
          >
            GitHub 仓库
          </Button>
          <Button variant="quiet" icon="file" onClick={() => onReveal(vault.path)}>
            当前仓库目录
          </Button>
        </div>
      </section>

      {verifyPreset ? (
        <PresetVerifyModal
          preset={verifyPreset}
          onClose={() => setVerifyPreset(null)}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

import { useEffect, useState } from "react";
import type { AppSettings, BundledAgentSkill, VaultSnapshot } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { call, errorMessage } from "../api";
import { relativeTime } from "../format";
import type { AppInfo } from "../types";
import { Icon } from "./icons";
import { PresetVerifyModal } from "./modals/PresetVerifyModal";
import { Button, Callout, Field, SectionHeader, StatusPill } from "./ui";

type ThemePreference = "system" | "light" | "dark";
type ActivityStatus = "updated" | "current" | "skipped" | "error" | "push-failed";
interface AutoSyncActivity {
  at: string;
  trigger: "startup" | "poll" | "resume" | "manual";
  vaultPath: string;
  vaultName: string;
  source: string;
  status: ActivityStatus;
  message?: string;
  pendingSkills?: string[];
}
interface BackgroundStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
}
const activityLabels: Record<ActivityStatus, string> = {
  updated: "已更新",
  current: "最新",
  skipped: "已跳过",
  error: "失败",
  "push-failed": "推送失败",
};

export function SettingsView({
  vault,
  settings,
  themePreference,
  onThemePreference,
  info,
  presets,
  syncing,
  onAutoSync,
  onAdopt,
  onSaved,
  onReveal,
  onError,
}: {
  vault: VaultSnapshot;
  settings: AppSettings;
  themePreference: ThemePreference;
  onThemePreference: (theme: ThemePreference) => void;
  info: AppInfo | null;
  presets: ToolPreset[];
  syncing: boolean;
  onAutoSync: () => Promise<void>;
  onAdopt: (vaultPath: string, source: string) => void;
  onSaved: (settings: AppSettings) => void;
  onReveal: (path: string) => void;
  onError: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(settings.autoSyncEnabled);
  const [checkInterval, setCheckInterval] = useState(String(settings.checkIntervalHours));
  const [retention, setRetention] = useState(String(settings.backupRetention));
  const [retentionDays, setRetentionDays] = useState(String(settings.backupRetentionDays));
  const [backupRoot, setBackupRoot] = useState(settings.backupRoot ?? "");
  const [background, setBackground] = useState<BackgroundStatus | null>(null);
  const [activity, setActivity] = useState<AutoSyncActivity[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
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
    setEnabled(settings.autoSyncEnabled);
    setCheckInterval(String(settings.checkIntervalHours));
    setRetention(String(settings.backupRetention));
    setRetentionDays(String(settings.backupRetentionDays));
    setBackupRoot(settings.backupRoot ?? "");
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [status, log] = await Promise.allSettled([
        call<BackgroundStatus>("app.backgroundStatus", {}),
        call<AutoSyncActivity[]>("app.autoSyncActivity", { limit: 30 }),
      ]);
      if (cancelled) return;
      if (status.status === "fulfilled") setBackground(status.value);
      if (log.status === "fulfilled") {
        setActivity(log.value);
        setActivityError(null);
      } else {
        setActivityError(errorMessage(log.reason));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [syncing, settings]);

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
    const days = Number(retentionDays);
    if (!Number.isInteger(interval) || interval < 1 || interval > 720) {
      onError("后台检查间隔必须是 1 到 720 之间的整数小时；如需暂停，请关闭自动更新。");
      return;
    }
    if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
      onError("备份保留数量必须是 1 到 100 之间的整数。");
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      onError("备份保留天数必须是 1 到 365 之间的整数。");
      return;
    }
    setSaving(true);
    try {
      const saved = await call<AppSettings>("app.setSettings", {
        settings: {
          autoSyncEnabled: enabled,
          checkIntervalHours: interval,
          backupRetention: keep,
          backupRetentionDays: days,
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
      <SectionHeader title="设置" />

      <section className="panel appearance-panel" aria-labelledby="appearance-heading">
        <div className="panel-head">
          <div>
            <h2 id="appearance-heading">外观</h2>
            <p>为 VaultDesk 选择适合当前环境的界面。</p>
          </div>
        </div>
        <div className="theme-options" role="group" aria-label="外观主题">
          {([
            ["system", "跟随系统"],
            ["light", "浅色"],
            ["dark", "深色"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={themePreference === value ? "theme-option is-active" : "theme-option"}
              aria-pressed={themePreference === value}
              onClick={() => onThemePreference(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="appearance-hint">即时生效，仅保存在本机。</p>
      </section>

      <div className="settings-columns">
        <section className="panel settings-panel">
          <div className="panel-head">
            <div>
              <h2>后台自动更新</h2>
              <p>登录后、恢复网络时和每隔一段时间检查全部已登记仓库。</p>
            </div>
            <StatusPill tone={settings.autoSyncEnabled && settings.checkIntervalHours > 0 && background?.loaded ? "ok" : "muted"}>
              {settings.autoSyncEnabled && settings.checkIntervalHours > 0 && background?.loaded ? "后台运行中" : "后台未运行"}
            </StatusPill>
          </div>
          <label className="toggle-row auto-sync-toggle">
            <span className="toggle-copy">
              <span className="toggle-label">关闭应用后继续自动更新</span>
              <span className="toggle-hint">仅更新设为“自动更新”的远程 Git 来源；本地来源不会自动拉取，也不会自动分发本地编辑。</span>
            </span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
          </label>
          <Field label="检查间隔（小时）" hint="默认每小时；如需暂停，请关闭自动更新。">
            <input
              className="input"
              type="number"
              min={1}
              max={720}
              value={checkInterval}
              onChange={(event) => setCheckInterval(event.target.value)}
            />
          </Field>
          <p className="auto-sync-help">
            {!background?.supported
              ? "后台服务仅在 /Applications 中安装的正式版可用。"
              : settings.autoSyncEnabled && settings.checkIntervalHours > 0 && !background.loaded
                ? "后台服务尚未运行。请保存设置重试；若仍失败，请查看系统日志。"
                : "来源新增技能会提示接纳；手动改动或目标冲突不会被覆盖。本地来源有编辑时，请到来源页手动分发。"}
          </p>
          <Button size="sm" variant="quiet" icon="refresh" loading={syncing} onClick={() => void onAutoSync()} >
            立即检查并同步全部仓库
          </Button>
          <div className="settings-meta">
            <span
              title={
                vault.state?.last_checked_at
                  ? new Date(vault.state.last_checked_at).toLocaleString("zh-CN")
                  : undefined
              }
            >
              <Icon name="clock" size={12} /> 上次检查 {relativeTime(vault.state?.last_checked_at)}
            </span>
            <span>
              <Icon name="vault" size={12} /> {vault.format}
            </span>
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-head">
            <div>
              <h2>安装备份</h2>
            </div>
          </div>
          <Field label="每个目标最多保留备份数" hint="默认 3 次，先达到数量或时间限制的旧备份会清理。">
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              value={retention}
              onChange={(event) => setRetention(event.target.value)}
            />
          </Field>
          <Field label="备份保留天数" hint="默认 7 天。">
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
            />
          </Field>
          <Field label="备份根目录">
            <div className="input-with-button">
              <input
                className="input mono"
                value={backupRoot}
                onChange={(event) => setBackupRoot(event.target.value)}
                placeholder="~/Library/Application Support/VaultDesk/backups"
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
        <span>仅保存在本机</span>
      </div>

      <section className="panel auto-sync-activity" aria-labelledby="auto-sync-activity-heading">
        <div className="panel-head">
          <div>
            <h2 id="auto-sync-activity-heading">同步活动</h2>
            <p>最近 30 条记录，涵盖全部已登记仓库。</p>
          </div>
        </div>
        {activityError ? <Callout tone="danger" title="无法读取活动记录"><p>{activityError}</p></Callout> : null}
        {activity.length === 0 && !activityError ? (
          <p className="auto-sync-empty">暂无同步活动。可以点击“立即检查并同步全部仓库”开始。</p>
        ) : (
          <ol className="auto-sync-activity-list">
            {activity.map((entry, index) => (
              <li key={`${entry.at}-${entry.vaultName}-${entry.source}-${index}`} className="auto-sync-activity-row">
                <div className="auto-sync-activity-main">
                  <strong>{entry.vaultName} · {entry.source}</strong>
                  <time dateTime={entry.at} title={new Date(entry.at).toLocaleString("zh-CN")}>
                    {relativeTime(entry.at)}
                  </time>
                </div>
                <StatusPill tone={entry.status === "error" || entry.status === "push-failed" ? "danger" : entry.pendingSkills?.length ? "warn" : entry.status === "updated" ? "ok" : "muted"}>
                  {activityLabels[entry.status]}{entry.pendingSkills?.length ? " · 待接纳" : ""}
                </StatusPill>
                {entry.pendingSkills?.length ? (
                  <p className="auto-sync-activity-detail">待接纳新技能：{entry.pendingSkills.join("、")}</p>
                ) : null}
                {entry.status === "error" || entry.status === "push-failed" ? (
                  <p className="auto-sync-activity-detail">{entry.message ?? "请检查该来源及其目标目录。"}</p>
                ) : null}
                {entry.pendingSkills?.length ? (
                  <div className="auto-sync-activity-actions">
                    <Button size="sm" variant="quiet" icon="plus" onClick={() => onAdopt(entry.vaultPath, entry.source)}>
                      选择接纳
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>候选目录</h2>
          </div>
        </div>
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
            <span className="eyebrow">随附技能</span>
            <h2>vaultdesk</h2>
          </div>
          <StatusPill tone="accent">随应用打包</StatusPill>
        </div>
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

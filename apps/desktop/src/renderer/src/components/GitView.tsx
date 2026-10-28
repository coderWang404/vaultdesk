import { useEffect, useMemo, useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { call, errorMessage } from "../api";
import { shortSha } from "../format";
import { Icon } from "./icons";
import { Button, Callout, ConfirmDialog, EmptyState, Field, SectionHeader, StatusMark, StatusPill } from "./ui";

function statusCode(status: string): { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "accent" } {
  if (status.includes("?")) return { label: "新文件", tone: "accent" };
  if (status.includes("A")) return { label: "新增", tone: "ok" };
  if (status.includes("D")) return { label: "删除", tone: "danger" };
  if (status.includes("R")) return { label: "重命名", tone: "warn" };
  if (status.includes("C")) return { label: "复制", tone: "warn" };
  if (status.includes("M")) return { label: "修改", tone: "warn" };
  return { label: status || "变更", tone: "neutral" };
}

export function GitView({
  vault,
  readOnly = false,
  onRefresh,
  onReveal,
  onError,
  onNotify,
}: {
  vault: VaultSnapshot;
  readOnly?: boolean;
  onRefresh: () => Promise<void>;
  onReveal: (path: string) => void;
  onError: (message: string) => void;
  onNotify: (message: string) => void;
}) {
  const changes = vault.git.changes;
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmPush, setConfirmPush] = useState(false);

  useEffect(() => {
    setSelected((current) => current.filter((path) => changes.some((change) => change.path === path)));
  }, [changes]);

  const allSelected = changes.length > 0 && selected.length === changes.length;
  const canCommit = selected.length > 0 && message.trim().length > 0 && !busy && !readOnly;

  const changeList = useMemo(() => changes, [changes]);

  async function commit(): Promise<void> {
    if (readOnly) {
      onError("v1 仓库只读。先迁移到 v2，再通过 Git 提交写入。");
      return;
    }
    if (!canCommit) return;
    setBusy(true);
    try {
      const result = await call<{ commit: string }>("git.commit", {
        vaultPath: vault.path,
        paths: selected,
        message: message.trim(),
        confirm: true,
      });
      setMessage("");
      setSelected([]);
      await onRefresh();
      onNotify(`已创建提交 ${shortSha(result.commit, 10)}`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function doPush(): Promise<void> {
    if (readOnly) {
      onError("v1 仓库只读，不执行推送。");
      return;
    }
    setBusy(true);
    try {
      await call("git.push", { vaultPath: vault.path, confirm: true });
      setConfirmPush(false);
      await onRefresh();
      onNotify("已推送到上游分支");
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view git-view">
      <SectionHeader
        title="Git"
        actions={
          <Button icon="refresh" onClick={() => void onRefresh()}>
            刷新
          </Button>
        }
      />

      {!vault.git.isRepo ? (
        <EmptyState
          icon="git"
          title="未启用 Git"
          action={
            <Button size="sm" onClick={() => onReveal(vault.path)}>
              在 Finder 中打开
            </Button>
          }
        />
      ) : (
        <>
          {readOnly ? (
            <Callout tone="warn" title="v1 仓库只读">
              <p>迁移到 v2 后再写入。</p>
            </Callout>
          ) : null}
          <section className="git-hero panel">
            <div className="git-hero-main">
              <span className="git-branch-mark">
                <Icon name="branch" size={20} />
              </span>
              <div>
                <h2>{vault.git.branch ?? "detached HEAD"}</h2>
                <p className="mono">{vault.git.head ?? "还没有提交"}</p>
              </div>
            </div>
            <div className="git-hero-meta">
              <div>
                <span>远端</span>
                <strong className="mono">{vault.git.remote ?? "未配置"}</strong>
              </div>
              <div>
                <span>领先 / 落后</span>
                <strong>
                  {vault.git.ahead ?? 0} / {vault.git.behind ?? 0}
                </strong>
              </div>
              <div>
                <span>工作区</span>
                <strong>{vault.git.dirty ? `${changes.length} 个变更` : "干净"}</strong>
              </div>
            </div>
            <Button
              variant="quiet"
              icon="upload"
              onClick={() => setConfirmPush(true)}
              disabled={busy || !vault.git.upstream || readOnly}
              title={
                readOnly
                  ? "v1 仓库只读"
                  : !vault.git.upstream
                    ? "当前分支没有上游分支"
                    : "推送到上游分支"
              }
            >
              推送
            </Button>
          </section>

          <div className="git-columns">
            <section className="panel">
              <div className="panel-head">
                <h2>变更</h2>
                <label className="select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={readOnly}
                    onChange={(event) =>
                      setSelected(event.target.checked ? changes.map((change) => change.path) : [])
                    }
                  />
                  全选
                </label>
              </div>

              {changeList.length === 0 ? (
                <div className="quiet-state">
                  <StatusMark tone="ok" label="工作区干净" size={22} />
                  <div>
                    <strong>工作区干净</strong>
                  </div>
                </div>
              ) : (
                <div className="change-list">
                  {changeList.map((change) => {
                    const code = statusCode(change.status);
                    const active = selected.includes(change.path);
                    return (
                      <label className={`change-row ${active ? "is-checked" : ""}`} key={change.path}>
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={readOnly}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, change.path]
                                : current.filter((path) => path !== change.path),
                            )
                          }
                        />
                        <StatusPill tone={code.tone}>{code.label}</StatusPill>
                        <span className="change-path mono">
                          {change.from ? `${change.from} → ${change.path}` : change.path}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="panel commit-panel">
              <div className="panel-head">
                <h2>提交</h2>
              </div>
              <Field label="提交信息" hint="只暂存勾选的路径">
                <textarea
                  className="input textarea"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="例如：更新 baoyu-skills 到上游 4f2a1c"
                  rows={4}
                  disabled={readOnly}
                />
              </Field>
              <div className="commit-summary">
                <span>{selected.length} 个路径</span>
                <Button
                  variant="primary"
                  icon="check"
                  onClick={() => void commit()}
                  disabled={!canCommit}
                  loading={busy}
                >
                  创建提交
                </Button>
              </div>
              <p className="git-guard">
                <Icon name="lock" size={12} />
                只提交勾选路径 · 不执行 force push
              </p>
            </section>
          </div>
        </>
      )}

      {confirmPush ? (
        <ConfirmDialog
          title="推送到远端？"
          message={
            <>
              将当前分支 <strong>{vault.git.branch}</strong> 推送到{" "}
              <strong>{vault.git.upstream ?? "上游分支"}</strong>。
            </>
          }
          detail="不执行 force push。远端有新提交时 push 会失败。"
          confirmLabel="推送"
          busy={busy}
          onCancel={() => setConfirmPush(false)}
          onConfirm={() => void doPush()}
        />
      ) : null}
    </div>
  );
}

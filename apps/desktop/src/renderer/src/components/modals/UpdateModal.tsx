import { useEffect, useState } from "react";
import type { SourceDiff, UpdateResult, VaultSnapshot } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { shortSha } from "../../format";
import { Icon } from "../icons";
import { PatchView, diffStatusLabel } from "../PatchView";
import { Button, Callout, Field, Modal, Spinner, StatusPill, Toggle } from "../ui";

interface UpdatePreview {
  changes: { name: string; commit: string; diff: SourceDiff }[];
  warnings: string[];
}

export function UpdateModal({
  vault,
  source,
  onClose,
  onDone,
}: {
  vault: VaultSnapshot;
  source?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [commit, setCommit] = useState(false);
  const [install, setInstall] = useState(false);
  const [force, setForce] = useState(false);
  const [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call<UpdatePreview>("source.updatePreview", {
      vaultPath: vault.path,
      ...(source ? { names: [source] } : {}),
    })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setActiveSource(result.changes[0]?.name ?? null);
        setActiveFile(result.changes[0]?.diff.files[0]?.path ?? null);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [vault.path, source]);

  const change = preview?.changes.find((entry) => entry.name === activeSource) ?? preview?.changes[0] ?? null;
  const file = change?.diff.files.find((entry) => entry.path === activeFile) ?? change?.diff.files[0] ?? null;
  const fileCount = preview?.changes.reduce((total, entry) => total + entry.diff.files.length, 0) ?? 0;
  const canWrite = vault.format === "v2" && vault.git.isRepo && !vault.git.dirty;

  async function apply(): Promise<void> {
    if (!preview || !confirmed) return;
    setApplying(true);
    setError(null);
    try {
      const names = source ? [source] : preview.changes.map((entry) => entry.name);
      const result = await call<UpdateResult>("source.update", {
        vaultPath: vault.path,
        names,
        commit,
        install,
        force,
        ...(message.trim() ? { message: message.trim() } : {}),
        confirm: true,
      });
      const files = result.changes.reduce((total, entry) => total + entry.files.length, 0);
      onDone(`已应用 ${result.changes.length} 个来源、${files} 个文件${result.commit ? "，并创建提交" : ""}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      title={source ? `应用更新 · ${source}` : "应用上游更新"}
      subtitle="先抓取到缓存，确认后写入仓库并按选项构建、安装。"
      onClose={onClose}
      width="xwide"
      dismissable={!applying}
      footer={
        <>
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={!canWrite || !preview || preview.changes.length === 0}
            />
            我确认把上述差异写入仓库
          </label>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            取消
          </Button>
          <Button
            variant="primary"
            icon="download"
            onClick={() => void apply()}
            loading={applying}
            disabled={!confirmed || !canWrite || !preview || preview.changes.length === 0}
          >
            应用更新
          </Button>
        </>
      }
    >
      {!canWrite ? (
        <Callout tone="warn" title="当前不能写入">
          <p>
            {vault.format !== "v2"
              ? "v1 仓库只读。先迁移到 v2。"
              : !vault.git.isRepo
                ? "更新要求仓库已纳入 Git。"
                : "工作区存在未提交变更，先提交或暂存后再更新。"}
          </p>
        </Callout>
      ) : null}

      {error ? (
        <Callout tone="danger" title="操作失败">
          <p>{error}</p>
        </Callout>
      ) : null}

      {!preview && !error ? (
        <div className="modal-loading">
          <Spinner size={20} />
          <p>正在抓取上游并比较文件…</p>
        </div>
      ) : preview ? (
        preview.changes.length === 0 ? (
          <Callout tone="ok" title="没有可应用的更新">
            <p>所选来源的上游提交与工作副本一致。</p>
          </Callout>
        ) : (
          <>
            <div className="update-summary-row">
              <span>{preview.changes.length} 个来源</span>
              <span>{fileCount} 个文件</span>
            </div>
            <div className="update-diff-layout">
              <div className="diff-files">
                {preview.changes.map((entry) => (
                  <div key={entry.name}>
                    <button
                      className={`diff-source ${entry.name === activeSource ? "is-active" : ""}`}
                      onClick={() => {
                        setActiveSource(entry.name);
                        setActiveFile(entry.diff.files[0]?.path ?? null);
                      }}
                    >
                      <Icon name="source" size={14} />
                      <span>{entry.name}</span>
                      <span className="muted-small">{entry.diff.files.length}</span>
                    </button>
                    {entry.name === activeSource ? (
                      <div className="diff-source-files">
                        {entry.diff.files.map((item) => (
                          <button
                            key={item.path}
                            className={`diff-file nested ${item.path === activeFile ? "is-active" : ""}`}
                            onClick={() => setActiveFile(item.path)}
                          >
                            <span className="diff-file-path">{item.path}</span>
                            <span className={`diff-file-status status-${item.status}`}>
                              {diffStatusLabel(item.status)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="diff-viewer">
                {file ? (
                  <>
                    <div className="diff-viewer-head">
                      <span className="mono">{file.path}</span>
                      <StatusPill tone="muted">{diffStatusLabel(file.status)}</StatusPill>
                    </div>
                    <PatchView patch={file.patch} />
                  </>
                ) : (
                  <div className="patch-empty">选择文件查看差异。</div>
                )}
              </div>
            </div>

            <div className="update-options">
              <Field label="提交信息（可选）">
                <input
                  className="input"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={`chore: update ${preview.changes.map((entry) => entry.name).join(", ")}`}
                />
              </Field>
              <Toggle
                checked={commit}
                onChange={setCommit}
                label="同时创建 Git 提交"
                hint="只暂存本次写入涉及的路径。"
                disabled={!vault.git.isRepo}
              />
              <Toggle
                checked={install}
                onChange={setInstall}
                label="更新后重新安装到登记目标"
                hint="只处理 vault.yml 中标记 install_after_update 的目标。"
              />
              <Toggle
                checked={force}
                onChange={setForce}
                label="覆盖本地对技能内容的改动"
                hint="默认阻止；确认本地改动可丢弃后再打开。"
              />
              {force ? (
                <Callout tone="warn">
                  <p>本地改动将被覆盖，只能从 Git 或备份恢复。</p>
                </Callout>
              ) : null}
              {preview.warnings.map((warning) => (
                <p className="muted-small" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          </>
        )
      ) : null}
    </Modal>
  );
}

export function updateCommitLabel(commit: string | undefined): string {
  return commit ? shortSha(commit, 10) : "未锁定";
}

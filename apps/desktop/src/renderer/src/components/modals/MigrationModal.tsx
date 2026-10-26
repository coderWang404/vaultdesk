import { useEffect, useState } from "react";
import type { MigrationPlan, MigrationResult } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { shortSha } from "../../format";
import { Icon } from "../icons";
import { PatchView } from "../PatchView";
import { Button, Callout, Modal, Spinner, StatusPill } from "../ui";

export function MigrationModal({
  vaultPath,
  onClose,
  onDone,
}: {
  vaultPath: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call<MigrationPlan>("vault.migrationPreview", { vaultPath })
      .then((value) => {
        if (!cancelled) setPlan(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  async function apply(): Promise<void> {
    if (!plan || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const next = await call<MigrationResult>("vault.migrationApply", {
        vaultPath,
        confirm: true,
      });
      setResult(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="迁移预览 · v1 → v2"
      subtitle="v1 的三份元数据会合并为 vault.yml 与 sources/*.yml。迁移在独立分支完成，不推送。"
      onClose={onClose}
      width="wide"
      dismissable={!busy}
      footer={
        result ? (
          <Button variant="primary" onClick={() => onDone(`迁移完成于 ${result.branch}`)}>
            完成
          </Button>
        ) : (
          <>
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={!plan?.cleanWorktree || busy}
              />
              我确认在 {plan?.branch ?? "vault-v2"} 分支写入 v2 元数据
            </label>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              icon="arrow-right"
              onClick={() => void apply()}
              loading={busy}
              disabled={!confirmed || !plan?.cleanWorktree}
            >
              写入迁移
            </Button>
          </>
        )
      }
    >
      {error ? (
        <Callout tone="danger" title="迁移预览失败">
          <p>{error}</p>
        </Callout>
      ) : null}

      {!plan && !error ? (
        <div className="modal-loading">
          <Spinner size={20} />
          <p>正在读取 v1 元数据并生成确定性差异…</p>
        </div>
      ) : plan ? (
        <>
          <div className="migration-stats">
            <div>
              <span>来源</span>
              <strong>{plan.sourceCount}</strong>
            </div>
            <div>
              <span>技能</span>
              <strong>{plan.skillCount}</strong>
            </div>
            <div>
              <span>写入</span>
              <strong>{plan.writes.length}</strong>
            </div>
            <div>
              <span>删除</span>
              <strong>{plan.deletes.length}</strong>
            </div>
            <div>
              <span>分支</span>
              <strong className="mono">{plan.branch}</strong>
            </div>
          </div>

          <StatusPill tone={plan.cleanWorktree ? "ok" : "danger"}>
            {plan.cleanWorktree ? "工作区干净，可以迁移" : "工作区不干净，迁移已阻止"}
          </StatusPill>

          <div className="migration-lists">
            <div>
              <span className="eyebrow">写入</span>
              <ul className="file-list">
                {plan.writes.map((write) => (
                  <li key={write.path}>
                    <span className="file-add">+</span>
                    <span className="mono">{write.path}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <span className="eyebrow">删除</span>
              {plan.deletes.length === 0 ? (
                <p className="muted-small">没有需要删除的 v1 文件。</p>
              ) : (
                <ul className="file-list">
                  {plan.deletes.map((item) => (
                    <li key={item}>
                      <span className="file-del">−</span>
                      <span className="mono">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              <span className="eyebrow kept">保留</span>
              <p className="muted-small">{plan.unaffected.join("、")}</p>
            </div>
          </div>

          {plan.warnings.map((warning) => (
            <p className="muted-small" key={warning}>
              {warning}
            </p>
          ))}

          <div className="migration-diff">
            <button className="disclosure" onClick={() => setShowDiff((value) => !value)}>
              <Icon name={showDiff ? "chevron-down" : "chevron-right"} size={14} />
              完整 unified diff
            </button>
            {showDiff ? <PatchView patch={plan.diff} /> : null}
          </div>

          {result ? (
            <Callout tone="ok" title="迁移已写入">
              <p>
                已创建分支 {result.branch}
                {result.commit ? `，提交 ${shortSha(result.commit, 10)}` : ""}。尚未推送。
              </p>
              {result.validation.ok ? (
                <p>迁移后的仓库通过校验，没有错误。</p>
              ) : (
                <p>迁移后有 {result.validation.errors.length} 个校验错误，请检查。</p>
              )}
            </Callout>
          ) : (
            <Callout tone="info">
              <p>写入顺序：创建分支、写 vault.yml 与 sources、重建 build、执行校验、提交。任一步失败会保留操作日志，不自动回滚。</p>
            </Callout>
          )}
        </>
      ) : null}
    </Modal>
  );
}

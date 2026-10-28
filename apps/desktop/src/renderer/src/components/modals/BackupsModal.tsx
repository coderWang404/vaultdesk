import { useEffect, useMemo, useState } from "react";
import type { BackupEntry, TargetRecord } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { relativeTime } from "../../format";
import { Icon } from "../icons";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  Modal,
  Spinner,
  StatusPill,
} from "../ui";

export function BackupsModal({
  vaultPath,
  targetId,
  targets,
  onClose,
  onRestored,
  onReveal,
}: {
  vaultPath: string;
  targetId?: string;
  targets: TargetRecord[];
  onClose: () => void;
  onRestored: (message: string) => void;
  onReveal: (path: string) => void;
}) {
  const [scope, setScope] = useState<string>(targetId ?? "");
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ entry: BackupEntry; skill: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void call<{ backups: BackupEntry[] }>("target.backups", {
      vaultPath,
      ...(scope ? { targetId: scope } : {}),
    })
      .then((result) => {
        if (!cancelled) setBackups(result.backups);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, scope]);

  const grouped = useMemo(() => {
    const map = new Map<string, BackupEntry[]>();
    for (const entry of backups ?? []) {
      const list = map.get(entry.targetId) ?? [];
      list.push(entry);
      map.set(entry.targetId, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [backups]);

  async function restore(): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await call<{ restored: string; previousBackup?: string }>("target.restore", {
        vaultPath,
        id: pending.entry.targetId,
        backupPath: `${pending.entry.path}/${pending.skill}`,
        name: pending.skill,
        confirm: true,
      });
      setNotice(
        `已恢复 ${result.restored} 到 ${pending.entry.targetId}${
          result.previousBackup ? "，原有受管目录已移入备份" : ""
        }。`,
      );
      setPending(null);
      onRestored(`已从备份恢复 ${result.restored}`);
    } catch (reason) {
      setError(errorMessage(reason));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="安装备份"
      subtitle="替换或备份受管目录时留下的快照。"
      onClose={onClose}
      width="wide"
      dismissable={!busy}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          关闭
        </Button>
      }
    >
      <div className="backups-body">
        {targets.length > 0 ? (
          <div className="segmented backups-filter" role="group" aria-label="按安装目标筛选">
            <button className={scope === "" ? "is-active" : ""} onClick={() => setScope("")}>
              全部目标
            </button>
            {targets.map((target) => (
              <button
                key={target.id}
                className={scope === target.id ? "is-active" : ""}
                onClick={() => setScope(target.id)}
              >
                {target.id}
              </button>
            ))}
          </div>
        ) : null}

        {notice ? (
          <Callout tone="ok" title="恢复完成">
            <p>{notice}</p>
          </Callout>
        ) : null}

        {error ? (
          <Callout tone="danger" title="备份操作失败">
            <p>{error}</p>
          </Callout>
        ) : null}

        {loading ? (
          <div className="modal-loading">
            <Spinner size={20} />
            <p>正在读取备份目录…</p>
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState icon="backup" title="还没有备份" />
        ) : (
          grouped.map(([name, entries]) => {
            const registered = targets.some((target) => target.id === name);
            return (
              <section className="backup-group" key={name}>
                <header className="backup-group-head">
                  <div>
                    <span className="eyebrow">目标</span>
                    <h3>{name}</h3>
                  </div>
                  <div className="backup-group-badges">
                    {registered ? null : <StatusPill tone="danger">目标已注销</StatusPill>}
                    <StatusPill tone="muted">{entries.length} 份快照</StatusPill>
                  </div>
                </header>
                {registered ? null : (
                  <Callout tone="warn">
                    <p>
                      目标已注销，无法确定目录。重新注册同名目标后可恢复。
                    </p>
                  </Callout>
                )}
                <div className="backup-list">
                  {entries.map((entry) => (
                    <article className="backup-entry" key={`${entry.targetId}/${entry.timestamp}`}>
                      <div className="backup-entry-head">
                        <div className="backup-stamp">
                          <Icon name="clock" size={14} />
                          <strong>{relativeTime(entry.timestamp)}</strong>
                          <span className="mono">{entry.timestamp}</span>
                        </div>
                        <button className="text-link" onClick={() => onReveal(entry.path)}>
                          在 Finder 中显示
                          <Icon name="external" size={12} />
                        </button>
                      </div>
                      {entry.skills.length === 0 ? (
                        <p className="muted-small">没有技能目录。</p>
                      ) : (
                        <div className="backup-skills">
                          {entry.skills.map((skill) => (
                            <div className="backup-skill" key={skill}>
                              <span className="mono">{skill}</span>
                              <Button
                                size="sm"
                                variant="quiet"
                                icon="backup"
                                title={registered ? undefined : "目标未注册，无法恢复"}
                                onClick={() => setPending({ entry, skill })}
                                disabled={busy || !registered}
                              >
                                恢复
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })
        )}

        <Callout tone="info">
          <p>只恢复到同名槽位；未受管目录不覆盖，受管副本先备份。</p>
        </Callout>
      </div>

      {pending ? (
        <ConfirmDialog
          title={`恢复 ${pending.skill}？`}
          message={
            <>
              将 <strong className="mono">{pending.skill}</strong> 从{" "}
              {pending.entry.targetId} 的快照 {pending.entry.timestamp} 恢复到目标目录。
            </>
          }
          detail="同名受管副本先备份后替换；未受管目录不覆盖。"
          confirmLabel="恢复"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void restore()}
        />
      ) : null}
    </Modal>
  );
}

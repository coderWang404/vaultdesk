import { useEffect, useState } from "react";
import type { AutoSyncSourceResult, PendingSkill } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { Button, Callout, Modal, Spinner } from "../ui";

export function PendingSkillsModal({ vaultPath, source, onClose, onDone }: {
  vaultPath: string;
  source: string;
  onClose: () => void;
  onDone: (result: AutoSyncSourceResult) => void;
}) {
  const [pending, setPending] = useState<PendingSkill[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call<PendingSkill[]>("source.pending", { vaultPath, name: source })
      .then((items) => { if (!cancelled) setPending(items); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [vaultPath, source]);

  const toggle = (item: string): void => {
    setSelected((current) => current.includes(item) ? current.filter((path) => path !== item) : [...current, item]);
  };

  const adopt = async (): Promise<void> => {
    if (selected.length === 0 || applying) return;
    setApplying(true);
    setError(null);
    try {
      const result = await call<AutoSyncSourceResult>("source.adopt", {
        vaultPath, name: source, paths: selected, confirm: true,
      });
      if (result.status === "error") {
        setError(result.message ?? "接纳失败；请检查来源和目标目录。");
      } else {
        onDone(result);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={"接纳新技能 · " + source}
      subtitle="核对上游路径后选择技能；接纳成功会同步受管目录，并只提交推送本次变更。"
      onClose={onClose}
      dismissable={!applying}
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying}>取消</Button>
          <Button variant="primary" icon="check" onClick={() => void adopt()} loading={applying} disabled={selected.length === 0}>
            接纳所选 {selected.length} 项
          </Button>
        </>
      }
    >
      {error ? <Callout tone="danger" title="无法接纳"><p>{error}</p></Callout> : null}
      {!pending && !error ? <div className="modal-loading"><Spinner size={20} /><p>正在读取上游新技能…</p></div> : null}
      {pending?.length === 0 ? <Callout tone="ok" title="没有待接纳技能"><p>该来源的新技能已处理或上游不再提供。</p></Callout> : null}
      {pending && pending.length > 0 ? (
        <>
          <div className="pending-skills-toolbar">
            <span>待接纳 {pending.length} 项</span>
            <Button size="sm" variant="quiet" onClick={() => setSelected(pending.map((item) => item.sourcePath))}>全选</Button>
          </div>
          <div className="pending-skills-list" role="group" aria-label="选择待接纳技能">
            {pending.map((item) => (
              <label className="pending-skill-row" key={item.sourcePath}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.sourcePath)}
                  onChange={() => toggle(item.sourcePath)}
                  disabled={applying}
                />
                <span><strong>{item.name}</strong><small className="mono">{item.sourcePath}</small></span>
              </label>
            ))}
          </div>
          <p className="auto-sync-help">插件更新需要接纳该来源的全部新增技能；有同名或本地改动时操作会停止并保留现状。</p>
        </>
      ) : null}
    </Modal>
  );
}

import { useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { Button, Callout, Modal, Toggle } from "../ui";

interface RemoveResult {
  name: string;
  removedPaths: string[];
}

export function RemoveSourceModal({
  vault,
  source,
  onClose,
  onDone,
}: {
  vault: VaultSnapshot;
  source: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const record = vault.sources.find((entry) => entry.name === source);
  const affectedTargets = vault.targets.filter(
    (target) => record?.skills.some((skill) => target.names.includes(skill.name)) ?? false,
  );
  const [typed, setTyped] = useState("");
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim() === source;
  const installedOnly = vault.skills.filter(
    (skill) => skill.sourceName === source && skill.installed.length > 0,
  );

  async function remove(): Promise<void> {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call<RemoveResult>("source.remove", {
        vaultPath: vault.path,
        name: source,
        deleteFiles,
        confirm: true,
      });
      onDone(
        `已移除来源 ${result.name}${result.removedPaths.length > 0 ? `，删除 ${result.removedPaths.length} 个目录` : "，工作副本保留"}`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`移除来源 · ${source}`}
      subtitle="移除元数据，并清理安装目标与 lock 中的引用。已安装文件不会被自动删除。"
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={() => void remove()}
            loading={busy}
            disabled={!confirmed}
          >
            移除来源
          </Button>
        </>
      }
    >
      <div className="remove-body">
        {!record ? (
          <Callout tone="danger" title="来源不存在">
            <p>这个来源可能已经被移除，刷新仓库后再试。</p>
          </Callout>
        ) : (
          <>
            <Callout tone="warn" title="会写入仓库">
              <p>
                将从 sources/ 删除 {source}.yml，并从 vault.yml 的安装目标中移除
                {record.skills.length > 0 ? ` ${record.skills.length} 个技能名` : "相关技能名"}，然后重新构建与校验。
              </p>
            </Callout>

            {installedOnly.length > 0 ? (
              <Callout tone="danger" title="目标目录中的副本不会被删除">
                <p>
                  {installedOnly.length} 个技能已经安装到
                  {[...new Set(installedOnly.flatMap((skill) => skill.installed.map((entry) => entry.targetId)))].join(
                    "、",
                  )}
                  。移除来源后，这些目录里的文件仍会留在磁盘上；如需清理，请到对应目标目录手动处理。
                </p>
              </Callout>
            ) : null}

            <div className="remove-facts">
              <div>
                <span>工作副本</span>
                <strong className="mono">{record.workingPath}</strong>
              </div>
              {record.vendorRoot ? (
                <div>
                  <span>Vendor</span>
                  <strong className="mono">{record.vendorRoot}</strong>
                </div>
              ) : null}
              {affectedTargets.length > 0 ? (
                <div>
                  <span>受影响目标</span>
                  <strong>{affectedTargets.map((target) => target.id).join("、")}</strong>
                </div>
              ) : null}
            </div>

            <Toggle
              checked={deleteFiles}
              onChange={setDeleteFiles}
              label="同时删除仓库内的工作副本与 vendor 目录"
              hint="只删除这个来源在仓库里的目录。安装目标中的副本不受影响。"
            />

            {deleteFiles ? (
              <Callout tone="warn">
                <p>删除后只能通过 Git 历史或你自己的备份恢复。</p>
              </Callout>
            ) : null}

            <Callout tone="info">
              <p>建议先创建一次 Git 提交，方便随时回滚。</p>
            </Callout>

            <label className="field">
              <span className="field-label">
                输入来源名称 <em>需要完全一致</em>
              </span>
              <input
                className="input mono"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={source}
                autoFocus
                spellCheck={false}
              />
              <span className="field-hint">
                这是不可撤销的元数据操作。输入 <code>{source}</code> 后才能继续。
              </span>
            </label>

            {error ? (
              <Callout tone="danger" title="移除失败">
                <p>{error}</p>
              </Callout>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

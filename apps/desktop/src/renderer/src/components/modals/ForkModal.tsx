import { useEffect, useState } from "react";
import type { ForkPreview } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { shortSha } from "../../format";
import { Icon } from "../icons";
import { Button, Callout, Field, Modal, Spinner } from "../ui";

export function ForkModal({
  vaultPath,
  skill,
  onClose,
  onDone,
}: {
  vaultPath: string;
  skill: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [as, setAs] = useState("");
  const [preview, setPreview] = useState<ForkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void call<ForkPreview>("source.forkPreview", {
        vaultPath,
        skill,
        ...(as.trim() ? { as: as.trim() } : {}),
      })
        .then((value) => {
          if (!cancelled) {
            setPreview(value);
            setError(null);
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(errorMessage(reason));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [vaultPath, skill, as]);

  async function apply(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await call("source.fork", {
        vaultPath,
        skill,
        ...(as.trim() ? { as: as.trim() } : {}),
        confirm: true,
      });
      onDone(`已把 ${skill} fork 成本地来源 ${as.trim() || preview?.newSourceName || ""}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Fork ${skill}`}
      subtitle="GitHub 来源只读；Fork 复制为本地来源。"
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            icon="branch"
            onClick={() => void apply()}
            loading={busy}
            disabled={!preview || Boolean(error) || loading}
          >
            创建本地副本
          </Button>
        </>
      }
    >
      <div className="fork-body">
        <Field label="新来源名称" optional hint="留空使用 <技能名>-local。">
          <input
            className="input mono"
            value={as}
            onChange={(event) => setAs(event.target.value)}
            placeholder={preview?.newSourceName ?? "自动"}
          />
        </Field>

        {loading ? (
          <div className="modal-loading compact">
            <Spinner size={16} />
            <span>正在计算 fork 目标…</span>
          </div>
        ) : error ? (
          <Callout tone="danger" title="无法 fork">
            <p>{error}</p>
          </Callout>
        ) : preview ? (
          <div className="fork-detail">
            <div className="fork-line">
              <span>来源</span>
              <strong>{preview.sourceName}</strong>
              <Icon name="arrow-right" size={14} />
              <strong>{preview.newSourceName}</strong>
            </div>
            <div className="fork-line">
              <span>目标路径</span>
              <span className="mono">{preview.targetPath}</span>
            </div>
            {preview.from ? (
              <div className="fork-line">
                <span>上游</span>
                <span className="mono">
                  {preview.from.repo}@{shortSha(preview.from.commit)} · {preview.from.source_path}
                </span>
              </div>
            ) : null}
            {preview.removesFromPackage ? (
              <Callout tone="warn">
                <p>脱离原包，其他技能不受影响。</p>
              </Callout>
            ) : null}
            {preview.warnings.map((warning) => (
              <p className="muted-small" key={warning}>
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

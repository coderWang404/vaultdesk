import { useEffect, useState } from "react";
import type { DiffFile, SourceDiff } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { shortSha } from "../../format";
import { Icon } from "../icons";
import { PatchView, diffStatusLabel } from "../PatchView";
import { Callout, Modal, Spinner, StatusPill } from "../ui";

export function DiffModal({
  vaultPath,
  source,
  onClose,
}: {
  vaultPath: string;
  source: string;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<SourceDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call<SourceDiff>("source.diff", { vaultPath, name: source })
      .then((result) => {
        if (cancelled) return;
        setDiff(result);
        setSelected(result.files[0]?.path ?? null);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, source]);

  const file = diff?.files.find((entry) => entry.path === selected) ?? null;

  return (
    <Modal
      title={`上游差异 · ${source}`}
      subtitle="工作副本与当前上游提交的逐文件比较。此操作只读取，不写盘。"
      onClose={onClose}
      width="xwide"
      footer={
        <span className="modal-footnote">
          {diff ? `上游 ${shortSha(diff.toCommit, 10)} · 锁定 ${shortSha(diff.fromCommit, 10)}` : "正在获取上游…"}
        </span>
      }
    >
      {error ? (
        <Callout tone="danger" title="无法生成差异">
          <p>{error}</p>
        </Callout>
      ) : !diff ? (
        <div className="modal-loading">
          <Spinner size={20} />
          <p>正在抓取上游到缓存并比较文件…</p>
        </div>
      ) : diff.files.length === 0 ? (
        <Callout tone="ok" title="没有文件差异">
          <p>工作副本与上游提交 {shortSha(diff.toCommit, 10)} 一致。</p>
        </Callout>
      ) : (
        <div className="diff-layout">
          <div className="diff-files">
            <div className="diff-summary">
              <StatusPill tone="ok">+{diff.summary.added}</StatusPill>
              <StatusPill tone="warn">~{diff.summary.modified}</StatusPill>
              <StatusPill tone="danger">−{diff.summary.deleted}</StatusPill>
              {diff.summary.binary > 0 ? <StatusPill tone="muted">{diff.summary.binary} 二进制</StatusPill> : null}
            </div>
            {diff.files.map((entry) => (
              <button
                key={entry.path}
                className={`diff-file ${entry.path === selected ? "is-active" : ""}`}
                onClick={() => setSelected(entry.path)}
              >
                <FileGlyph file={entry} />
                <span className="diff-file-path">{entry.path}</span>
                <span className={`diff-file-status status-${entry.status}`}>{diffStatusLabel(entry.status)}</span>
              </button>
            ))}
            {diff.warnings.map((warning) => (
              <p className="diff-warning" key={warning}>
                {warning}
              </p>
            ))}
          </div>
          <div className="diff-viewer">
            {file ? (
              <>
                <div className="diff-viewer-head">
                  <span className="mono">{file.path}</span>
                  <span className="muted-small">
                    {file.binary ? "二进制文件" : `${file.bytesBefore} → ${file.bytesAfter} bytes`}
                  </span>
                </div>
                {file.binary ? (
                  <Callout tone="info">
                    <p>二进制文件只报告大小变化，不生成文本差异。</p>
                  </Callout>
                ) : file.truncated ? (
                  <Callout tone="warn">
                    <p>文件过大，未生成补丁。请直接比较本地与上游文件。</p>
                  </Callout>
                ) : (
                  <PatchView patch={file.patch} />
                )}
              </>
            ) : (
              <div className="patch-empty">选择一个文件查看差异。</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function FileGlyph({ file }: { file: DiffFile }) {
  const icon = file.status === "added" ? "plus" : file.status === "deleted" ? "trash" : "file";
  return <Icon name={icon} size={13} className={`diff-glyph status-${file.status}`} />;
}

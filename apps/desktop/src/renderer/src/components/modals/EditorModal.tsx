import { useEffect, useState } from "react";
import type { SkillRecord } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { Button, Callout, Modal, Spinner, StatusPill } from "../ui";

interface ReadResult {
  skill: SkillRecord;
  content: string;
  editable: boolean;
  reason?: string;
}

export function EditorModal({
  vaultPath,
  skill,
  onClose,
  onDone,
  onFork,
}: {
  vaultPath: string;
  skill: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onFork: () => void;
}) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [editable, setEditable] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call<ReadResult>("skill.read", { vaultPath, skill })
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setOriginal(result.content);
        setEditable(result.editable);
        setReason(result.reason);
      })
      .catch((reasonValue) => {
        if (!cancelled) setError(errorMessage(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, skill]);

  const dirty = content !== original;

  function requestClose(): void {
    if (saving) return;
    if (dirty && !window.confirm("有未保存的修改，确定关闭吗？")) return;
    onClose();
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const result = await call<{ path: string; bytes: number }>("skill.write", {
        vaultPath,
        skill,
        content,
      });
      setOriginal(content);
      onDone(`已保存 ${skill}（${result.bytes} 字节）`);
    } catch (reasonValue) {
      setError(errorMessage(reasonValue));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`编辑 ${skill}`}
      subtitle="只编辑 SKILL.md；name 须与目录名一致。"
      onClose={requestClose}
      width="wide"
      dismissable={!saving}
      footer={
        <>
          <span className="modal-footnote">
            {dirty ? <StatusPill tone="warn">未保存</StatusPill> : editable ? <span>没有修改</span> : null}
          </span>
          <Button variant="ghost" onClick={requestClose} disabled={saving}>
            取消
          </Button>
          <Button
            variant="primary"
            icon="check"
            onClick={() => void save()}
            loading={saving}
            disabled={!editable || !dirty}
          >
            保存
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="modal-loading">
          <Spinner size={20} />
          <p>正在读取 SKILL.md…</p>
        </div>
      ) : error && !editable ? (
        <Callout tone="danger" title="无法打开">
          <p>{error}</p>
        </Callout>
      ) : (
        <>
          {!editable ? (
            <Callout tone="warn" title="这个技能只读">
              <p>{reason ?? "GitHub 来源技能需要先 fork 成本地来源。"}</p>
              <Button size="sm" variant="quiet" icon="branch" onClick={onFork}>
                Fork 到本地
              </Button>
            </Callout>
          ) : null}
          {error ? (
            <Callout tone="danger" title="保存失败">
              <p>{error}</p>
            </Callout>
          ) : null}
          <textarea
            className="code-editor"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            readOnly={!editable}
            spellCheck={false}
            aria-label={`${skill} 的 SKILL.md`}
          />
        </>
      )}
    </Modal>
  );
}

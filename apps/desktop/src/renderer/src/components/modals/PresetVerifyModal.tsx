import { useEffect, useState } from "react";
import type { PresetVerifyPreview, PresetVerifyResult } from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { call, errorMessage } from "../../api";
import { Button, Callout, Modal, Spinner, StatusPill } from "../ui";

export function PresetVerifyModal({
  preset,
  onClose,
  onError,
}: {
  preset: ToolPreset;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<PresetVerifyPreview | null>(null);
  const [result, setResult] = useState<PresetVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call<PresetVerifyPreview>("presets.verifyCommand", { id: preset.id })
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [preset.id]);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const value = await call<PresetVerifyResult>("presets.verifyCommand", {
        id: preset.id,
        confirm: true,
      });
      setResult(value);
      if (value.timedOut) onError("验证命令超时，已被终止。");
      else if (value.truncated) onError("验证命令输出过多，已截断。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const statusTone = result ? (result.exitCode === 0 && !result.timedOut ? "ok" : "warn") : "neutral";
  const statusText = result
    ? result.timedOut
      ? "超时终止"
      : result.exitCode !== null
        ? `退出码 ${result.exitCode}`
        : `信号 ${result.signal ?? "unknown"}`
    : null;

  return (
    <Modal
      title="验证工具预设"
      subtitle={`${preset.label} · ${preset.dest}`}
      onClose={onClose}
      dismissable={!busy}
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            关闭
          </Button>
          <Button
            variant="primary"
            icon="terminal"
            onClick={() => void run()}
            loading={busy}
            disabled={!preview}
          >
            {result ? "重新运行" : "运行验证命令"}
          </Button>
        </>
      }
    >
      <div className="preset-verify">
        <Callout tone="warn" title="命令来自预设文件">
          <p>以你的权限执行，最长 15 秒；只展示输出，不判断工具是否加载技能。</p>
        </Callout>

        {preview ? (
          <div className="verify-command-block">
            <span className="eyebrow">命令</span>
            <pre className="verify-command mono">{preview.command}</pre>
          </div>
        ) : error ? null : (
          <div className="verify-loading">
            <Spinner />
            <span>读取验证命令…</span>
          </div>
        )}

        {error ? (
          <Callout tone="danger" title="验证失败">
            <p>{error}</p>
          </Callout>
        ) : null}

        {result ? (
          <div className="verify-result" aria-live="polite">
            <div className="verify-result-head">
              <StatusPill tone={statusTone}>{statusText}</StatusPill>
              <span className="verify-meta">{result.durationMs}ms</span>
              {result.truncated ? <span className="verify-meta">输出已截断</span> : null}
            </div>
            {result.stdout.trim() ? (
              <div className="verify-stream">
                <span className="eyebrow">stdout</span>
                <pre className="verify-output mono">{result.stdout.trimEnd()}</pre>
              </div>
            ) : null}
            {result.stderr.trim() ? (
              <div className="verify-stream">
                <span className="eyebrow">stderr</span>
                <pre className="verify-output mono">{result.stderr.trimEnd()}</pre>
              </div>
            ) : null}
            {!result.stdout.trim() && !result.stderr.trim() ? (
              <p className="verify-empty">命令没有产生输出。</p>
            ) : null}
            <p className="verify-hint">
              只证明命令执行完成；文件是否存在请用验证安装。
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

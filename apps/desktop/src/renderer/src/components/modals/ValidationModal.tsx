import { useEffect, useState } from "react";
import type { ValidationIssue, ValidationReport } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { Icon } from "../icons";
import { Button, Callout, EmptyState, Modal, Spinner, StatusPill } from "../ui";

export function ValidationModal({
  vaultPath,
  onClose,
  onValidated,
}: {
  vaultPath: string;
  onClose: () => void;
  onValidated: (report: ValidationReport) => void;
}) {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await call<ValidationReport>("vault.validate", { vaultPath });
      setReport(result);
      onValidated(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run();
    // Validation is read-only; rerunning on path change is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);

  return (
    <Modal
      title="仓库校验"
      subtitle="检查元数据、锁文件、技能目录、安装目标与 Git 状态。校验只读，不会修改任何文件。"
      onClose={onClose}
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button variant="primary" icon="refresh" onClick={() => void run()} loading={busy}>
            重新校验
          </Button>
        </>
      }
    >
      {busy && !report ? (
        <div className="modal-loading">
          <Spinner size={20} />
          <p>正在校验仓库结构…</p>
        </div>
      ) : error ? (
        <Callout tone="danger" title="校验失败">
          <p>{error}</p>
        </Callout>
      ) : report ? (
        <div className="validation-body">
          <div className={`validation-hero ${report.ok ? "is-ok" : "is-bad"}`}>
            <span className="validation-mark">
              <Icon name={report.ok ? "check" : "alert"} size={22} />
            </span>
            <div>
              <h3>{report.ok ? "仓库结构有效" : "发现需要修复的问题"}</h3>
              <p>
                {report.errors.length} 个错误 · {report.warnings.length} 条提示 · 校验于{" "}
                {new Date(report.checkedAt).toLocaleString("zh-CN")}
              </p>
            </div>
          </div>

          {report.errors.length === 0 && report.warnings.length === 0 ? (
            <EmptyState icon="shield" title="没有发现问题">
              元数据、锁文件与目录结构一致。
            </EmptyState>
          ) : (
            <div className="issue-sections">
              {report.errors.length > 0 ? (
                <section>
                  <header className="issue-head">
                    <StatusPill tone="danger">错误</StatusPill>
                    <span>{report.errors.length} 项</span>
                  </header>
                  <div className="issue-list">
                    {report.errors.map((issue) => (
                      <IssueRow issue={issue} key={`${issue.code}-${issue.path ?? ""}-${issue.message}`} />
                    ))}
                  </div>
                </section>
              ) : null}
              {report.warnings.length > 0 ? (
                <section>
                  <header className="issue-head">
                    <StatusPill tone="warn">提示</StatusPill>
                    <span>{report.warnings.length} 项</span>
                  </header>
                  <div className="issue-list">
                    {report.warnings.map((issue) => (
                      <IssueRow issue={issue} key={`${issue.code}-${issue.path ?? ""}-${issue.message}`} />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  return (
    <div className={`issue-row severity-${issue.severity}`}>
      <Icon name={issue.severity === "error" ? "alert" : "info"} size={15} />
      <div className="issue-copy">
        <p>{issue.message}</p>
        <div className="issue-meta">
          <code>{issue.code}</code>
          {issue.path ? <span className="mono">{issue.path}</span> : null}
        </div>
      </div>
    </div>
  );
}

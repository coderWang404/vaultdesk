import { useState } from "react";
import type { InstallVerification, VaultSnapshot } from "@vaultdesk/core";
import { call, errorMessage } from "../api";
import { hashLabel, relativeTime } from "../format";
import { Icon } from "./icons";
import { Button, Callout, EmptyState, SectionHeader, StatusPill } from "./ui";

export function TargetsView({
  vault,
  onInstall,
  onBackups,
  onRemove,
  onReveal,
  onError,
}: {
  vault: VaultSnapshot;
  onInstall: (targetId?: string) => void;
  onBackups: (targetId?: string) => void;
  onRemove: (targetId: string) => void;
  onReveal: (path: string) => void;
  onError: (message: string) => void;
}) {
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, InstallVerification>>({});

  async function verify(targetId: string): Promise<void> {
    setVerifying(targetId);
    try {
      const result = await call<InstallVerification>("target.verify", { vaultPath: vault.path, id: targetId });
      setVerifications((current) => ({ ...current, [targetId]: result }));
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setVerifying(null);
    }
  }

  return (
    <div className="view targets-view">
      <SectionHeader
        eyebrow="安装目标"
        title="产物落在哪里"
        description="安装目录只是构建产物。VaultDesk 只写入带标记的目录，遇到未受管内容会先备份。"
        actions={
          <>
            <Button icon="backup" onClick={() => onBackups()}>
              备份
            </Button>
            <Button variant="primary" icon="download" onClick={() => onInstall()}>
              安装到目录
            </Button>
          </>
        }
      />

      {vault.targets.length === 0 ? (
        <EmptyState icon="target" title="还没有登记安装目标">
          选择一个目录并把技能安装过去。目标会记录在 vault.yml，之后可以随时重建。
          <div className="empty-action">
            <Button size="sm" variant="primary" onClick={() => onInstall()}>
              选择安装目录
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div className="target-list">
          {vault.targets.map((target) => {
            const verification = verifications[target.id];
            return (
              <section className="target-card" key={target.id}>
                <header className="target-head">
                  <div className="target-head-main">
                    <span className="target-glyph">
                      <Icon name="target" size={18} />
                    </span>
                    <div>
                      <div className="target-title">
                        <h3>{target.id}</h3>
                        <StatusPill tone={target.exists ? "ok" : "warn"}>
                          {target.exists ? "目录存在" : "目录缺失"}
                        </StatusPill>
                        {target.installAfterUpdate ? <StatusPill tone="muted">更新后安装</StatusPill> : null}
                      </div>
                      <button className="target-path mono" onClick={() => onReveal(target.expandedDest)}>
                        {target.expandedDest}
                        <Icon name="external" size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="target-actions">
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="shield"
                      onClick={() => void verify(target.id)}
                      loading={verifying === target.id}
                      disabled={!target.exists}
                    >
                      验证
                    </Button>
                    <Button size="sm" variant="ghost" icon="download" onClick={() => onInstall(target.id)}>
                      安装
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onBackups(target.id)}>
                      备份
                    </Button>
                    <button
                      className="row-more"
                      title="移除目标"
                      aria-label={`移除目标 ${target.id}`}
                      onClick={() => onRemove(target.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </header>

                <div className="target-summary">
                  <div>
                    <span>登记技能</span>
                    <strong>{target.skills.length}</strong>
                  </div>
                  <div>
                    <span>已发现</span>
                    <strong>{target.installed.length}</strong>
                  </div>
                  <div>
                    <span>最近安装</span>
                    <strong>{relativeTime(target.lastInstalledAt)}</strong>
                  </div>
                  <div>
                    <span>安装哈希</span>
                    <strong className="mono">{hashLabel(target.installedHash)}</strong>
                  </div>
                </div>

                {target.installed.length > 0 ? (
                  <div className="install-slots">
                    {target.installed.map((entry) => (
                      <div className="install-slot" key={entry.path}>
                        <span
                          className={`slot-dot ${
                            entry.isSymlink ? "is-link" : entry.managed ? "is-managed" : "is-unmanaged"
                          }`}
                        />
                        <span className="slot-name">{entry.path.split("/").at(-1)}</span>
                        <span className="slot-kind">
                          {entry.isSymlink ? "符号链接" : entry.managed ? "VaultDesk 受管" : "未受管目录"}
                        </span>
                        {entry.isSymlink && entry.linkTarget ? (
                          <span className="mono slot-target">{entry.linkTarget}</span>
                        ) : null}
                        {entry.matches === false ? <StatusPill tone="warn">内容已变化</StatusPill> : null}
                        {entry.matches === true ? <StatusPill tone="ok">哈希一致</StatusPill> : null}
                        {entry.managed && !entry.managedByThisVault ? (
                          <StatusPill tone="warn">属于其他仓库</StatusPill>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="target-empty">目标目录里还没有发现已登记技能。</p>
                )}

                {verification ? (
                  <Callout tone={verification.filesInPlace ? "ok" : "warn"}>
                    <p>
                      {verification.filesInPlace
                        ? `文件层面校验通过，共检查 ${verification.checked} 个文件。`
                        : `发现 ${verification.missing.length} 个缺失文件、${verification.modified.length} 个被修改文件。`}
                    </p>
                    {verification.unmanagedByTarget.length > 0 ? (
                      <p className="muted-small">
                        另有 {verification.unmanagedByTarget.length} 个未受管目录保持原样。
                      </p>
                    ) : null}
                  </Callout>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

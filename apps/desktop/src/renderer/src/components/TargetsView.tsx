import { useState } from "react";
import type { InstallVerification, TargetRecord, VaultSnapshot } from "@vaultdesk/core";
import { call, errorMessage } from "../api";
import { Icon } from "./icons";
import {
  Button,
  EmptyState,
  FlowStrip,
  IconButton,
  SectionHeader,
  SlotStrip,
  StatusMark,
  type SlotItem,
  type StatusTone,
} from "./ui";

type InstalledEntry = TargetRecord["installed"][number];

function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function slotFor(name: string, entry: InstalledEntry | undefined): { tone: StatusTone; label: string } {
  if (!entry) return { tone: "muted", label: `${name} · 未安装` };
  if (entry.managedByThisVault === false) return { tone: "warn", label: `${name} · 属于其他仓库` };
  if (!entry.managed) return { tone: "warn", label: `${name} · 未受管目录` };
  if (entry.matches === false) return { tone: "warn", label: `${name} · 内容已变化` };
  if (entry.isSymlink) {
    return { tone: "ok", label: `${name} · 符号链接${entry.linkTarget ? ` → ${entry.linkTarget}` : ""}` };
  }
  return { tone: "ok", label: `${name} · ${entry.matches === true ? "哈希一致" : "已安装"}` };
}

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
        title="安装目标"
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
        <EmptyState
          icon="target"
          title="还没有安装目标"
          action={
            <Button size="sm" variant="primary" icon="plus" onClick={() => onInstall()}>
              选择目录
            </Button>
          }
        />
      ) : (
        <div className="target-list">
          {vault.targets.map((target) => {
            const verification = verifications[target.id];
            const installedByName = new Map(
              target.installed.map((entry) => [entry.path.split("/").at(-1) ?? entry.path, entry]),
            );
            const ownSlots: SlotItem[] = target.skills.map((name) => {
              const state = slotFor(name, installedByName.get(name));
              return { key: name, name, tone: state.tone, label: state.label };
            });
            const otherSlots: SlotItem[] = target.otherManaged.map((entry) => {
              const name = entry.path.split("/").at(-1) ?? entry.path;
              return {
                key: entry.path,
                name,
                tone: entry.matches === false ? "warn" : "muted",
                label: `${name} · 同目录，未登记到此目标`,
              };
            });

            return (
              <section className="target-card" key={target.id}>
                <header className="target-head">
                  <div className="target-head-main">
                    <span className="target-glyph">
                      <Icon name="target" size={18} />
                    </span>
                    <div className="target-title-block">
                      <div className="target-title">
                        <h3>{target.id}</h3>
                        <StatusMark
                          tone={target.exists ? "ok" : "warn"}
                          label={target.exists ? "目录存在" : "目录缺失"}
                        />
                        {target.installAfterUpdate ? (
                          <span className="target-flag" title="更新后自动安装" aria-label="更新后自动安装" role="img">
                            <Icon name="refresh" size={11} />
                          </span>
                        ) : null}
                      </div>
                      <button
                        className="target-path mono"
                        onClick={() => onReveal(target.expandedDest)}
                        title="在 Finder 中显示"
                      >
                        {shortPath(target.expandedDest)}
                        <Icon name="external" size={11} />
                      </button>
                    </div>
                  </div>
                  <div className="row-actions">
                    <IconButton
                      icon="shield"
                      label="验证文件"
                      onClick={() => void verify(target.id)}
                      loading={verifying === target.id}
                      disabled={!target.exists}
                    />
                    <IconButton
                      icon="download"
                      label="安装到此目标"
                      onClick={() => onInstall(target.id)}
                    />
                    <IconButton icon="backup" label="查看此目标的备份" onClick={() => onBackups(target.id)} />
                    <IconButton
                      icon="trash"
                      label={`移除目标 ${target.id}`}
                      className="is-danger"
                      onClick={() => onRemove(target.id)}
                    />
                  </div>
                </header>

                <div className="target-body">
                  <FlowStrip
                    steps={[
                      { icon: "vault", label: `${target.skills.length} 个技能` },
                      { icon: "file", label: "build/skills" },
                      { icon: "folder", label: shortPath(target.expandedDest) },
                    ]}
                  />
                  <div className="target-slots">
                    <SlotStrip items={ownSlots} emptyLabel="未登记技能" />
                    {otherSlots.length > 0 ? (
                      <details className="target-other">
                        <summary title="同一目录下由其他目标管理的技能">+{otherSlots.length} 同目录</summary>
                        <div className="target-other-list">
                          <SlotStrip items={otherSlots} />
                        </div>
                      </details>
                    ) : null}
                    {verification ? (
                      <span
                        className="target-check"
                        title={
                          verification.filesInPlace
                            ? `校验通过，共检查 ${verification.checked} 个文件`
                            : `缺失 ${verification.missing.join("、") || "无"}；修改 ${verification.modified.join("、") || "无"}`
                        }
                      >
                        <StatusMark
                          tone={verification.filesInPlace ? "ok" : "warn"}
                          label={verification.filesInPlace ? "校验通过" : "校验未通过"}
                          size={13}
                        />
                        {verification.filesInPlace
                          ? `通过 · ${verification.checked} 文件`
                          : `${verification.missing.length} 缺失 · ${verification.modified.length} 修改`}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

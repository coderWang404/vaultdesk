import type { AppInfo } from "../types";
import { relativeTime } from "../format";
import { Icon } from "./icons";
import { Button, EmptyState, Spinner, StatusPill } from "./ui";

interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
  exists?: boolean;
}

export function Welcome({
  recents,
  loading,
  info,
  opening,
  onOpen,
  onBrowse,
  onNew,
  onRemoveRecent,
}: {
  recents: RecentEntry[];
  loading: boolean;
  info: AppInfo | null;
  opening: string | null;
  onOpen: (path: string) => void;
  onBrowse: () => void;
  onNew: () => void;
  onRemoveRecent: (path: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <section className="welcome-hero">
          <div className="welcome-brand">
            <span className="brand-mark xl">
              <Icon name="vault" size={30} strokeWidth={1.6} />
            </span>
            <span className="welcome-word">VaultDesk</span>
          </div>
          <h1>把技能仓库放回它该在的位置。</h1>
          <p className="welcome-lede">
            本地优先的技能仓库管理器。查看来源、在写入前审阅上游差异、安全地安装到 agent 工具目录。
            桌面端与 CLI 共用一套核心，v1 仓库以只读方式打开。
          </p>
          <div className="welcome-actions">
            <Button variant="primary" size="md" icon="folder" onClick={onBrowse}>
              打开仓库
            </Button>
            <Button variant="quiet" size="md" icon="plus" onClick={onNew}>
              新建仓库
            </Button>
          </div>
          <div className="welcome-promises">
            <span>
              <Icon name="shield" size={14} /> 不自动删除已安装技能
            </span>
            <span>
              <Icon name="file" size={14} /> 写入前先看差异
            </span>
            <span>
              <Icon name="branch" size={14} /> Git 只提交你选中的路径
            </span>
          </div>
        </section>

        <section className="welcome-recents panel">
          <header className="welcome-recents-head">
            <div>
              <span className="eyebrow">最近打开</span>
              <h2>继续之前的仓库</h2>
            </div>
            <StatusPill tone="muted">本机记录</StatusPill>
          </header>

          {loading ? (
            <div className="welcome-loading">
              <Spinner size={16} />
              <span>正在读取最近记录…</span>
            </div>
          ) : recents.length === 0 ? (
            <EmptyState icon="vault" title="还没有打开过仓库">
              打开一个包含 <code>vault.yml</code> 或 <code>sources.yml</code> 的目录开始。
            </EmptyState>
          ) : (
            <div className="recent-list">
              {recents.map((entry) => {
                const missing = entry.exists === false;
                return (
                  <div className={`recent-row ${missing ? "is-missing" : ""}`} key={entry.path}>
                    <button
                      className="recent-main"
                      onClick={() => onOpen(entry.path)}
                      disabled={missing || opening === entry.path}
                      title={missing ? "目录不存在" : entry.path}
                    >
                      <span className="recent-glyph">
                        {opening === entry.path ? <Spinner size={15} /> : <Icon name="vault" size={16} />}
                      </span>
                      <span className="recent-copy">
                        <strong>{entry.name}</strong>
                        <span className="mono">{entry.path.replace(/^\/Users\/[^/]+/, "~")}</span>
                      </span>
                      <span className="recent-meta">
                        {missing ? (
                          <StatusPill tone="danger">路径缺失</StatusPill>
                        ) : (
                          <span>{relativeTime(entry.openedAt)}</span>
                        )}
                      </span>
                    </button>
                    <button
                      className="row-more"
                      title="从最近记录中移除"
                      aria-label={`移除最近记录 ${entry.name}`}
                      onClick={() => onRemoveRecent(entry.path)}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <footer className="welcome-recents-foot">
            <span>最近记录只保存在本机，最多 12 条。</span>
            <button className="text-link" onClick={onBrowse}>
              选择其他目录
              <Icon name="arrow-right" size={12} />
            </button>
          </footer>
        </section>
      </div>

      <footer className="welcome-footer">
        <span>VaultDesk {info?.version ?? window.vaultdesk.versions.app}</span>
        <span>macOS · Apache-2.0</span>
        <span>v1 只读 · v2 可写</span>
      </footer>
    </div>
  );
}

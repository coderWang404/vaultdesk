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
          <div className="welcome-actions">
            <Button variant="primary" size="md" icon="folder" onClick={onBrowse}>
              打开仓库
            </Button>
            <Button variant="quiet" size="md" icon="plus" onClick={onNew}>
              新建仓库
            </Button>
          </div>
        </section>

        <section className="welcome-recents panel">
          <header className="welcome-recents-head">
            <div>
              <h2>最近打开</h2>
            </div>
          </header>

          {loading ? (
            <div className="welcome-loading">
              <Spinner size={16} />
              <span>正在读取最近记录…</span>
            </div>
          ) : recents.length === 0 ? (
            <EmptyState icon="vault" title="还没有最近仓库" />
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
        </section>
      </div>

      <footer className="welcome-footer">
        <span>VaultDesk {info?.version ?? window.vaultdesk.versions.app}</span>
        <span>macOS · Apache-2.0</span>
      </footer>
    </div>
  );
}

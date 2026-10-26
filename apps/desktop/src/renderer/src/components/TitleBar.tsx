import type { VaultSnapshot } from "@vaultdesk/core";
import { Icon } from "./icons";
import { IconButton, Spinner } from "./ui";

export function TitleBar({
  vaults,
  activePath,
  checking,
  onSelect,
  onClose,
  onOpen,
  onNew,
  onSearch,
  onCheck,
  onSettings,
}: {
  vaults: VaultSnapshot[];
  activePath: string | null;
  checking: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onOpen: () => void;
  onNew: () => void;
  onSearch: () => void;
  onCheck: () => void;
  onSettings: () => void;
}) {
  const activeVault = vaults.find((vault) => vault.path === activePath);
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark">
          <Icon name="vault" size={17} strokeWidth={1.9} />
        </span>
        <span className="brand-word">VaultDesk</span>
      </div>

      <div className="vault-tabs-shell">
        <div className="vault-tabs" role="tablist" aria-label="已打开的仓库">
          {vaults.map((vault, index) => (
            <button
              key={vault.path}
              role="tab"
              aria-selected={vault.path === activePath}
              tabIndex={vault.path === activePath ? 0 : -1}
              className={`vault-tab ${vault.path === activePath ? "is-active" : ""}`}
              onClick={() => onSelect(vault.path)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : undefined;
                let next: number | undefined;
                if (delta !== undefined) next = (index + delta + vaults.length) % vaults.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = vaults.length - 1;
                const targetVault = next === undefined ? undefined : vaults[next];
                if (next === undefined || !targetVault) return;
                event.preventDefault();
                const target = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next];
                target?.focus();
                onSelect(targetVault.path);
              }}
              title={vault.path}
            >
              <span className={`tab-dot ${vault.format === "v1" ? "is-v1" : ""}`} />
              <span className="tab-name">{vault.name}</span>
              <span
                className="tab-close"
                aria-hidden="true"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(vault.path);
                }}
              >
                <Icon name="x" size={12} />
              </span>
            </button>
          ))}
        </div>
        <div className="tab-add-group">
          <button className="tab-add" onClick={onOpen} title="打开仓库（⌘O）" aria-label="打开仓库">
            <Icon name="plus" size={14} />
          </button>
          <button className="tab-add" onClick={onNew} title="新建仓库（⌘N）" aria-label="新建仓库">
            <Icon name="vault" size={14} />
          </button>
        </div>
      </div>

      <div className="titlebar-actions">
        <button className="search-trigger" onClick={onSearch} aria-keyshortcuts="Meta+K" title="搜索（⌘K）">
          <Icon name="search" size={15} />
          <span>搜索</span>
          <kbd>⌘K</kbd>
        </button>
        {activeVault ? (
          <IconButton icon="x" label={`关闭 ${activeVault.name}`} onClick={() => onClose(activeVault.path)} />
        ) : null}
        <IconButton
          icon={checking ? "refresh" : "refresh"}
          label={checking ? "正在检查更新" : "检查上游更新"}
          onClick={onCheck}
          className={checking ? "is-spinning" : ""}
          disabled={checking || !activePath}
        />
        <IconButton icon="settings" label="设置" onClick={onSettings} disabled={!activePath} />
      </div>
      {checking ? <Spinner size={13} /> : null}
    </header>
  );
}

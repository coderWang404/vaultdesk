import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SearchHit } from "@vaultdesk/core";
import { call, errorMessage } from "../api";
import { Icon } from "./icons";
import { Spinner, StatusPill } from "./ui";

interface SearchReport {
  hits: SearchHit[];
  warnings: string[];
}

export function SearchPalette({
  vaults,
  onClose,
  onPick,
}: {
  vaults: { path: string; name: string }[];
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<SearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle || vaults.length === 0) {
      setReport(null);
      setError(null);
      setActive(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void call<SearchReport>("search.query", {
        vaults: vaults.map((vault) => ({ path: vault.path, label: vault.name })),
        query: needle,
        limit: 40,
      })
        .then((result) => {
          if (cancelled) return;
          setReport(result);
          setError(null);
          setActive(0);
        })
        .catch((reason) => {
          if (!cancelled) setError(errorMessage(reason));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, vaults]);

  const hits = useMemo(() => report?.hits ?? [], [report]);
  const empty = query.trim().length > 0 && !loading && hits.length === 0 && !error;

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (hits.length === 0 ? 0 : (current + 1) % hits.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (hits.length === 0 ? 0 : (current - 1 + hits.length) % hits.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active];
      if (hit) onPick(hit);
    }
  }

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="元数据搜索">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索技能名、来源、描述或安装目标…"
            aria-label="搜索技能"
            spellCheck={false}
          />
          {loading ? <Spinner size={15} /> : <kbd>esc</kbd>}
        </div>

        <div className="palette-body">
          {vaults.length === 0 ? (
            <p className="palette-note">先打开一个仓库，再搜索技能元数据。</p>
          ) : query.trim().length === 0 ? (
            <div className="palette-idle">
              <p className="palette-note">搜索已打开的 {vaults.length} 个仓库的元数据。</p>
              <div className="palette-vaults">
                {vaults.map((vault) => (
                  <span key={vault.path} className="palette-vault">
                    <Icon name="vault" size={12} />
                    {vault.name}
                  </span>
                ))}
              </div>
              <div className="palette-tips">
                <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
                <span><kbd>↵</kbd> 打开</span>
                <span><kbd>esc</kbd> 关闭</span>
              </div>
            </div>
          ) : error ? (
            <p className="palette-note is-danger">{error}</p>
          ) : empty ? (
            <p className="palette-note">没有匹配的技能。搜索只覆盖元数据，不读取技能全文。</p>
          ) : (
            <div className="palette-results">
              {hits.map((hit, index) => (
                <button
                  key={`${hit.vaultPath}/${hit.sourceName}/${hit.skill}`}
                  className={`palette-hit ${index === active ? "is-active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(hit)}
                >
                  <span className={`origin-glyph origin-${hit.origin}`}>
                    <Icon name={hit.origin === "github" ? "git" : "folder"} size={14} />
                  </span>
                  <span className="palette-hit-main">
                    <span className="palette-hit-title">
                      <strong>{hit.skill}</strong>
                      <StatusPill tone="muted">{hit.shape === "standalone" ? "独立" : "包内"}</StatusPill>
                      {hit.installedTargets.length > 0 ? (
                        <StatusPill tone="ok">{hit.installedTargets.length} 个安装</StatusPill>
                      ) : null}
                    </span>
                    <span className="palette-hit-meta">
                      {hit.sourceName} · {hit.vaultName}
                      {hit.installedTargets.length > 0 ? ` · ${hit.installedTargets.join("、")}` : ""}
                    </span>
                  </span>
                  <span className="palette-hit-enter">
                    <Icon name="arrow-right" size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="palette-foot">
          <span>跨仓库搜索元数据，不修改任何内容</span>
          {report && hits.length > 0 ? <span>{hits.length} 个结果</span> : null}
        </div>
      </div>
    </div>
  );
}

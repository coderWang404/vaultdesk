import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AppSettings,
  AutoSyncSourceResult,
  CheckReport,
  ExternalSkillRecord,
  PluginRecord,
  SearchHit,
  SkillRecord,
  SourceRecord,
  ValidationReport,
  VaultSnapshot,
} from "@vaultdesk/core";
import type { ToolPreset } from "@vaultdesk/schema";
import { call, errorMessage } from "./api";
import { GitView } from "./components/GitView";
import { Icon } from "./components/icons";
import { Inspector } from "./components/Inspector";
import { Overview } from "./components/Overview";
import { PluginsView } from "./components/PluginsView";
import { SearchPalette } from "./components/SearchPalette";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { SkillsView } from "./components/SkillsView";
import { SourcesView } from "./components/SourcesView";
import { TargetsView } from "./components/TargetsView";
import { TitleBar } from "./components/TitleBar";
import { ToolsView } from "./components/ToolsView";
import { Welcome } from "./components/Welcome";
import { BackupsModal } from "./components/modals/BackupsModal";
import { DiffModal } from "./components/modals/DiffModal";
import { EditorModal } from "./components/modals/EditorModal";
import { ForkModal } from "./components/modals/ForkModal";
import { ImportModal } from "./components/modals/ImportModal";
import { InstallModal } from "./components/modals/InstallModal";
import { MigrationModal } from "./components/modals/MigrationModal";
import { NewVaultModal } from "./components/modals/NewVaultModal";
import { PendingSkillsModal } from "./components/modals/PendingSkillsModal";
import { RemoveSourceModal } from "./components/modals/RemoveSourceModal";
import { UpdateModal } from "./components/modals/UpdateModal";
import { ValidationModal } from "./components/modals/ValidationModal";
import { Button, ConfirmDialog, Spinner } from "./components/ui";
import type { AppInfo, ModalState, Section, Selection, ToastItem } from "./types";

interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
  exists?: boolean;
}

interface RemoveTargetResult {
  removed: string;
  backupPath?: string;
  filesMoved: string[];
}

const EMPTY_SELECTION: Selection = { kind: null, name: null };
const DEFAULT_SETTINGS: AppSettings = {
  autoSyncEnabled: true,
  checkIntervalHours: 1,
  backupRetention: 3,
  backupRetentionDays: 7,
};
interface AutoSyncRunSummary {
  checkedVaults: number;
  updated: number;
  errors: number;
  entries: Array<{ source: string; vaultName: string; pendingSkills?: string[] }>;
}
type ThemePreference = "system" | "light" | "dark";
type SidebarPreference = "auto" | "expanded" | "collapsed";

function readPreference<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return values.find((value) => value === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function App() {
  const [vaults, setVaults] = useState<VaultSnapshot[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [presets, setPresets] = useState<ToolPreset[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(true);
  const [booted, setBooted] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [modeChanging, setModeChanging] = useState<string | null>(null);
  const [targetToRemove, setTargetToRemove] = useState<string | null>(null);
  const [removingTarget, setRemovingTarget] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readPreference("vaultdesk.theme", ["system", "light", "dark"] as const, "system"),
  );
  const [sidebarPreference, setSidebarPreference] = useState<SidebarPreference>(() =>
    readPreference("vaultdesk.sidebar", ["auto", "expanded", "collapsed"] as const, "auto"),
  );
  const compactWorkspace = useMediaQuery("(max-width: 1240px)");
  const inspectorOverlay = useMediaQuery("(max-width: 1360px)");
  const sidebarCollapsed = sidebarPreference === "auto" ? compactWorkspace : sidebarPreference === "collapsed";

  const toastId = useRef(0);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const bootStarted = useRef(false);
  const lastBackgroundActivity = useRef<string | null>(null);

  const activeVault = useMemo(
    () => vaults.find((vault) => vault.path === activePath) ?? null,
    [vaults, activePath],
  );
  const readOnly = activeVault?.format === "v1";
  const activeChecking = checking !== null && checking === activeVault?.path;
  const showInspector = Boolean(
    activeVault && selection.kind && selection.name &&
    ((section === "overview" && (selection.kind === "source" || selection.kind === "skill")) ||
      (section === "sources" && selection.kind === "source") ||
      (section === "skills" && (selection.kind === "skill" || selection.kind === "external")) ||
      (section === "plugins" && selection.kind === "plugin")),
  );
  const drawerActive = showInspector && inspectorOverlay && !modal && !targetToRemove && !searchOpen;

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => {
      document.documentElement.dataset.theme = themePreference === "system"
        ? media.matches ? "dark" : "light"
        : themePreference;
    };
    apply();
    media.addEventListener("change", apply);
    try { window.localStorage.setItem("vaultdesk.theme", themePreference); } catch { /* Storage may be unavailable. */ }
    return () => media.removeEventListener("change", apply);
  }, [themePreference]);

  const toggleSidebar = useCallback((): void => {
    const next = sidebarCollapsed ? "expanded" : "collapsed";
    setSidebarPreference(next);
    try { window.localStorage.setItem("vaultdesk.sidebar", next); } catch { /* Storage may be unavailable. */ }
  }, [sidebarCollapsed]);

  const changeSection = useCallback((next: Section): void => {
    inspectorTriggerRef.current = null;
    setSection(next);
    setSelection(EMPTY_SELECTION);
  }, []);

  const openSearch = useCallback((): void => {
    if (modal || targetToRemove || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    setSearchOpen(true);
  }, [modal, targetToRemove]);

  const notify = useCallback((message: string, tone: ToastItem["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-4), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === "danger" ? 7000 : 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const upsert = useCallback((snapshot: VaultSnapshot, activate = false) => {
    setVaults((current) => {
      const index = current.findIndex((entry) => entry.path === snapshot.path);
      if (index === -1) return [...current, snapshot];
      const next = [...current];
      next[index] = snapshot;
      return next;
    });
    if (activate) setActivePath(snapshot.path);
  }, []);

  const refreshRecents = useCallback(async () => {
    try {
      const entries = await call<RecentEntry[]>("app.recents", {});
      setRecents(entries);
    } catch {
      // Recents are a convenience; failure must not block opening a vault.
    } finally {
      setRecentsLoading(false);
    }
  }, []);

  const reloadVault = useCallback(
    async (path: string): Promise<VaultSnapshot | null> => {
      try {
        const snapshot = await call<VaultSnapshot>("vault.reload", { vaultPath: path });
        upsert(snapshot);
        return snapshot;
      } catch (reason) {
        notify(errorMessage(reason), "danger");
        return null;
      }
    },
    [notify, upsert],
  );

  const openVault = useCallback(
    async (input: string): Promise<void> => {
      const existing = vaultsRef.current.find((vault) => vault.path === input);
      if (existing) {
        setActivePath(existing.path);
        setSection("overview");
        return;
      }
      setOpening(input);
      try {
        const snapshot = await call<VaultSnapshot>("vault.open", { path: input });
        upsert(snapshot, true);
        setSection("overview");
        setSelection(EMPTY_SELECTION);
        notify(`已打开 ${snapshot.name}`, "ok");
        await refreshRecents();
      } catch (reason) {
        notify(errorMessage(reason), "danger");
      } finally {
        setOpening(null);
      }
    },
    [notify, refreshRecents, upsert],
  );

  const browseVault = useCallback(async (): Promise<void> => {
    const selected = await window.vaultdesk.chooseDirectory({ title: "选择 VaultDesk 仓库目录" });
    if (selected) await openVault(selected);
  }, [openVault]);

  const closeVault = useCallback(
    (path: string): void => {
      const current = vaultsRef.current;
      const index = current.findIndex((vault) => vault.path === path);
      const rest = current.filter((vault) => vault.path !== path);
      setVaults(rest);
      setActivePath((active) => {
        if (active !== path) return active;
        return rest[Math.min(Math.max(index, 0), rest.length - 1)]?.path ?? null;
      });
      setSelection(EMPTY_SELECTION);
      void call("vault.close", { path }).catch(() => undefined);
    },
    [],
  );

  const checkVault = useCallback(
    async (path: string, quiet: boolean): Promise<void> => {
      setChecking(path);
      try {
        const report = await call<CheckReport>("source.check", { vaultPath: path });
        await reloadVault(path);
        const updates = report.results.filter((result) => result.status === "update-available").length;
        const failures = report.results.filter(
          (result) => result.status === "error" || result.status === "auth-failed",
        ).length;
        if (updates > 0) {
          notify(`发现 ${updates} 个来源有可用更新`, "info");
        } else if (failures > 0) {
          notify(`${failures} 个来源检查失败，详情见来源状态`, "warn");
        } else if (!quiet) {
          notify("所有已检查来源都是最新", "ok");
        }
      } catch (reason) {
        if (!quiet) notify(errorMessage(reason), "danger");
      } finally {
        setChecking(null);
      }
    },
    [notify, reloadVault],
  );

  const runAutoSync = useCallback(async (vaultPath?: string): Promise<void> => {
    if (syncing) return;
    setSyncing(true);
    try {
      const summary = await call<AutoSyncRunSummary>("app.autoSyncNow", { vaultPath });
      const openPaths = vaultsRef.current
        .filter((vault) => !vaultPath || vault.path === vaultPath)
        .map((vault) => vault.path);
      await Promise.all(openPaths.map((openPath) => reloadVault(openPath)));
      const pending = summary.entries.filter((entry) => entry.pendingSkills?.length).length;
      if (summary.errors > 0) {
        notify(`${summary.errors} 个来源同步失败，请查看设置中的活动记录`, "danger");
      } else if (pending > 0) {
        notify(`${pending} 个来源有新技能待接纳，请查看活动记录`, "warn");
      } else {
        notify(`已检查 ${summary.checkedVaults} 个仓库，更新 ${summary.updated} 个来源`, "ok");
      }
    } catch (reason) {
      notify(errorMessage(reason), "danger");
    } finally {
      setSyncing(false);
    }
  }, [notify, reloadVault, syncing]);

  const changeSourceMode = useCallback(async (source: string, mode: SourceRecord["updateMode"]): Promise<void> => {
    if (!activeVault || modeChanging) return;
    setModeChanging(source);
    try {
      await call("source.setUpdateMode", { vaultPath: activeVault.path, name: source, mode });
      notify(`${source} 的更新方式已设为${mode === "auto" ? "自动更新" : mode === "frozen" ? "暂停" : "人工审核"}`, "ok");
    } catch (reason) {
      notify(errorMessage(reason), "danger");
    } finally {
      await reloadVault(activeVault.path);
      setModeChanging(null);
    }
  }, [activeVault, modeChanging, notify, reloadVault]);

  const reveal = useCallback(
    (target: string): void => {
      void call("app.reveal", { path: target }).catch((reason) => notify(errorMessage(reason), "danger"));
    },
    [notify],
  );

  const guardWritable = useCallback((): boolean => {
    if (readOnly) {
      notify("v1 仓库以只读方式打开。先完成迁移，再执行写入操作。", "warn");
      return false;
    }
    return true;
  }, [notify, readOnly]);

  const openInstall = useCallback(
    (targetId?: string): void => {
      if (!activeVault || !guardWritable()) return;
      setModal({ kind: "install", vaultPath: activeVault.path, ...(targetId ? { targetId } : {}) });
    },
    [activeVault, guardWritable],
  );

  const openBackups = useCallback(
    (targetId?: string): void => {
      if (!activeVault) return;
      setModal({ kind: "backups", vaultPath: activeVault.path, ...(targetId ? { targetId } : {}) });
    },
    [activeVault],
  );

  const openImport = useCallback((): void => {
    if (!activeVault || !guardWritable()) return;
    setModal({ kind: "import", vaultPath: activeVault.path });
  }, [activeVault, guardWritable]);

  const openFork = useCallback(
    (skill: SkillRecord): void => {
      if (!activeVault || !guardWritable()) return;
      setModal({ kind: "fork", vaultPath: activeVault.path, skill: skill.name });
    },
    [activeVault, guardWritable],
  );

  const openEditor = useCallback(
    (skill: SkillRecord): void => {
      if (!activeVault || !guardWritable()) return;
      if (skill.origin === "github") {
        setModal({ kind: "fork", vaultPath: activeVault.path, skill: skill.name });
        return;
      }
      setModal({ kind: "editor", vaultPath: activeVault.path, skill: skill.name });
    },
    [activeVault, guardWritable],
  );

  const openUpdate = useCallback(
    (source?: string): void => {
      if (!activeVault) return;
      if (readOnly) {
        if (source) {
          setModal({ kind: "diff", vaultPath: activeVault.path, source });
        } else {
          notify("v1 仓库只读。逐个来源查看差异，或先迁移到 v2。", "warn");
        }
        return;
      }
      setModal({ kind: "update", vaultPath: activeVault.path, ...(source ? { source } : {}) });
    },
    [activeVault, notify, readOnly],
  );

  const openRemoveSource = useCallback(
    (source: string): void => {
      if (!activeVault || !guardWritable()) return;
      setModal({ kind: "remove-source", vaultPath: activeVault.path, source });
    },
    [activeVault, guardWritable],
  );

  const rememberInspectorTrigger = useCallback((): void => {
    const active = document.activeElement;
    inspectorTriggerRef.current = active instanceof HTMLButtonElement && active.closest(".content-pane") ? active : null;
  }, []);

  const selectSource = useCallback((source: SourceRecord): void => {
    rememberInspectorTrigger();
    setSelection({ kind: "source", name: source.name });
  }, [rememberInspectorTrigger]);

  const selectSkill = useCallback((skill: SkillRecord): void => {
    rememberInspectorTrigger();
    setSelection({ kind: "skill", name: skill.name });
  }, [rememberInspectorTrigger]);

  const selectExternalSkill = useCallback((skill: ExternalSkillRecord): void => {
    rememberInspectorTrigger();
    setSelection({ kind: "external", name: skill.name });
  }, [rememberInspectorTrigger]);

  const selectPlugin = useCallback((plugin: PluginRecord): void => {
    rememberInspectorTrigger();
    setSelection({ kind: "plugin", name: plugin.name });
  }, [rememberInspectorTrigger]);

  const closeInspector = useCallback((): void => {
    const preferred = inspectorTriggerRef.current;
    inspectorTriggerRef.current = null;
    const trigger = document.querySelector<HTMLElement>(
      '.content-pane .skill-card[aria-pressed="true"], .content-pane .row-action-primary[aria-pressed="true"], .content-pane .row-actions .icon-btn[aria-pressed="true"], .content-pane .skill-row-actions .icon-btn[aria-pressed="true"]',
    );
    const fallback = document.querySelector<HTMLElement>(".content-pane");
    setSelection(EMPTY_SELECTION);
    requestAnimationFrame(() => {
      (trigger?.isConnected ? trigger : preferred?.isConnected ? preferred : fallback)?.focus({ preventScroll: true });
    });
  }, []);

  const copyText = useCallback(
    (text: string): void => {
      void call("app.copyText", { text })
        .then(() => notify("已复制到剪贴板", "ok"))
        .catch((reason) => notify(errorMessage(reason), "danger"));
    },
    [notify],
  );

  const openExternal = useCallback(
    (url: string): void => {
      void call("app.openExternal", { url }).catch((reason) => notify(errorMessage(reason), "danger"));
    },
    [notify],
  );

  const openRelatedSkill = useCallback((name: string): void => {
    inspectorTriggerRef.current = null;
    setSection("skills");
    setSelection({ kind: "skill", name });
  }, []);

  const handleSearchHit = useCallback(
    async (hit: SearchHit): Promise<void> => {
      inspectorTriggerRef.current = null;
      setSearchOpen(false);
      if (!vaultsRef.current.some((vault) => vault.path === hit.vaultPath)) {
        await openVault(hit.vaultPath);
      }
      setActivePath(hit.vaultPath);
      if (hit.shape === "plugin") {
        setSection("plugins");
        setSelection({ kind: "plugin", name: hit.skill });
        return;
      }
      if (hit.shape === "plugin-skill" && hit.pluginName) {
        setSection("plugins");
        setSelection({ kind: "plugin", name: hit.pluginName });
        return;
      }
      if (hit.shape === "tool") {
        setSection(hit.toolKind === "mcp" ? "mcp" : "tools");
        setSelection(EMPTY_SELECTION);
        return;
      }
      if (hit.shape === "external-skill") {
        setSection("skills");
        setSelection({ kind: "external", name: hit.skill });
        return;
      }
      setSection("skills");
      setSelection({ kind: "skill", name: hit.skill });
    },
    [openVault],
  );

  const removeRecent = useCallback(
    async (path: string): Promise<void> => {
      try {
        await call("app.removeRecent", { path });
        await refreshRecents();
      } catch (reason) {
        notify(errorMessage(reason), "danger");
      }
    },
    [notify, refreshRecents],
  );

  const confirmRemoveTarget = useCallback(async (): Promise<void> => {
    if (!activeVault || !targetToRemove) return;
    const vaultPath = activeVault.path;
    const id = targetToRemove;
    setRemovingTarget(true);
    try {
      const result = await call<RemoveTargetResult>("target.remove", {
        vaultPath,
        id,
        deleteFiles: true,
        confirm: true,
      });
      setTargetToRemove(null);
      notify(
        `已注销目标 ${result.removed}${result.filesMoved.length > 0 ? `，${result.filesMoved.length} 个受管目录已移入备份` : ""}`,
        "ok",
      );
      await reloadVault(vaultPath);
    } catch (reason) {
      notify(errorMessage(reason), "danger");
    } finally {
      setRemovingTarget(false);
    }
  }, [activeVault, notify, reloadVault, targetToRemove]);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    void (async () => {
      const [infoResult, settingsResult, presetsResult, recentsResult] = await Promise.allSettled([
        call<AppInfo>("app.info", {}),
        call<AppSettings>("app.settings", {}),
        call<ToolPreset[]>("presets.list", {}),
        call<RecentEntry[]>("app.recents", {}),
      ]);
      if (infoResult.status === "fulfilled") setInfo(infoResult.value);
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
      if (presetsResult.status === "fulfilled") setPresets(presetsResult.value);
      if (recentsResult.status === "fulfilled") setRecents(recentsResult.value);
      setRecentsLoading(false);

      const initial = window.vaultdesk.initialVault;
      if (initial) {
        try {
          const snapshot = await call<VaultSnapshot>("vault.open", { path: initial });
          setVaults([snapshot]);
          setActivePath(snapshot.path);
          const entries = await call<RecentEntry[]>("app.recents", {});
          setRecents(entries);
        } catch (reason) {
          notify(errorMessage(reason), "danger");
        }
      }
      setBooted(true);
    })();
  }, [notify]);

  useEffect(() => {
    const refreshAfterBackgroundSync = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      try {
        const events = await call<Array<{ at: string; vaultPath: string; source: string }>>("app.autoSyncActivity", { limit: 1 });
        const latest = events[0];
        if (!latest) return;
        const signature = [latest.at, latest.vaultPath, latest.source].join("|");
        const changed = lastBackgroundActivity.current !== null && lastBackgroundActivity.current !== signature;
        lastBackgroundActivity.current = signature;
        if (!changed) return;
        for (const vault of vaultsRef.current) {
          void call<VaultSnapshot>("vault.reload", { vaultPath: vault.path })
            .then((snapshot) => upsert(snapshot))
            .catch(() => undefined);
        }
      } catch {
        // Activity is best-effort; an inaccessible log must not block the UI.
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void refreshAfterBackgroundSync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void refreshAfterBackgroundSync();
    const timer = window.setInterval(() => void refreshAfterBackgroundSync(), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [upsert]);

  useEffect(() => {
    if (!activeVault) {
      setSelection(EMPTY_SELECTION);
      return;
    }
    setSelection((current) => {
      if (!current.kind || !current.name) return current;
      const exists =
        current.kind === "source"
          ? activeVault.sources.some((source) => source.name === current.name)
          : current.kind === "plugin"
            ? activeVault.plugins.some((plugin) => plugin.name === current.name)
            : current.kind === "external"
              ? activeVault.externalSkills.some((skill) => skill.name === current.name)
              : activeVault.skills.some((skill) => skill.name === current.name);
      return exists ? current : EMPTY_SELECTION;
    });
  }, [activeVault]);

  useEffect(() => {
    if (!showInspector || !inspectorOverlay || modal || targetToRemove || searchOpen) return;
    const root = document.querySelector<HTMLElement>(".inspector");
    if (!root) return;
    const frame = requestAnimationFrame(() => {
      root.querySelector<HTMLElement>(".inspector-close")?.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeInspector();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [showInspector, inspectorOverlay, modal, targetToRemove, searchOpen, selection.kind, selection.name, closeInspector]);

  useEffect(() => {
    if (modal || targetToRemove) setSearchOpen(false);
  }, [modal, targetToRemove]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (searchOpen) {
          setSearchOpen(false);
        } else if (!modal && !targetToRemove && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, targetToRemove, searchOpen]);

  const actionsRef = useRef({
    browse: browseVault,
    newVault: () => setModal({ kind: "new-vault" }),
    search: openSearch,
    reload: () => {
      if (activePath) void reloadVault(activePath);
    },
    check: () => {
      if (activePath) void checkVault(activePath, false);
    },
    settings: () => changeSection("settings"),
    close: () => {
      if (activePath) closeVault(activePath);
    },
  });
  actionsRef.current = {
    browse: browseVault,
    newVault: () => setModal({ kind: "new-vault" }),
    search: openSearch,
    reload: () => {
      if (activePath) void reloadVault(activePath);
    },
    check: () => {
      if (activePath) void checkVault(activePath, false);
    },
    settings: () => changeSection("settings"),
    close: () => {
      if (activePath) closeVault(activePath);
    },
  };

  useEffect(() => {
    return window.vaultdesk.onMenuAction((action) => {
      const actions = actionsRef.current;
      switch (action) {
        case "open-vault":
          void actions.browse();
          break;
        case "new-vault":
          actions.newVault();
          break;
        case "search":
          actions.search();
          break;
        case "refresh":
          actions.reload();
          break;
        case "check":
          actions.check();
          break;
        case "settings":
          actions.settings();
          break;
        case "close-vault":
          actions.close();
          break;
      }
    });
  }, []);

  const modalVault =
    modal && modal.kind !== "new-vault"
      ? vaults.find((vault) => vault.path === modal.vaultPath) ?? null
      : null;

  function renderView(): ReactNode {
    if (!activeVault) return null;
    switch (section) {
      case "overview":
        return (
          <Overview
            vault={activeVault}
            selected={selection.kind === "skill" ? selection.name : null}
            checking={activeChecking}
            onCheck={() => void checkVault(activeVault.path, false)}
            onSource={selectSource}
            onSkill={selectSkill}
            onValidate={() => setModal({ kind: "validation", vaultPath: activeVault.path })}
            onMigration={() => setModal({ kind: "migration", vaultPath: activeVault.path })}
            onDiff={(source) => setModal({ kind: "diff", vaultPath: activeVault.path, source })}
            onUpdate={openUpdate}
            onInstall={() => openInstall()}
            onImport={openImport}
          />
        );
      case "sources":
        return (
          <SourcesView
            vault={activeVault}
            selected={selection.kind === "source" ? selection.name : null}
            checking={activeChecking}
            syncing={syncing}
            modeChanging={modeChanging}
            onSelect={selectSource}
            onCheck={() => void checkVault(activeVault.path, false)}
            onAutoSync={() => void runAutoSync(activeVault.path)}
            onUpdateMode={(source, mode) => void changeSourceMode(source, mode)}
            onDiff={(source) => setModal({ kind: "diff", vaultPath: activeVault.path, source })}
            onUpdate={openUpdate}
            onImport={openImport}
            onRemove={openRemoveSource}
          />
        );
      case "skills":
        return (
          <SkillsView
            vault={activeVault}
            selected={selection.kind === "skill" || selection.kind === "external" ? selection.name : null}
            onSelect={selectSkill}
            onSelectExternal={selectExternalSkill}
            onImport={openImport}
            onEditor={openEditor}
            onFork={openFork}
          />
        );
      case "plugins":
        return (
          <PluginsView
            vault={activeVault}
            selected={selection.kind === "plugin" ? selection.name : null}
            onSelect={selectPlugin}
            onImport={openImport}
          />
        );
      case "mcp":
        return (
          <ToolsView
            vault={activeVault}
            mode="mcp"
            onCopy={copyText}
            onOpen={openExternal}
            onSkill={openRelatedSkill}
          />
        );
      case "tools":
        return (
          <ToolsView
            vault={activeVault}
            onCopy={copyText}
            onOpen={openExternal}
            onSkill={openRelatedSkill}
          />
        );
      case "targets":
        return (
          <TargetsView
            vault={activeVault}
            onInstall={openInstall}
            onBackups={openBackups}
            onRemove={(id) => {
              if (!guardWritable()) return;
              setTargetToRemove(id);
            }}
            onReveal={reveal}
            onError={(message) => notify(message, "danger")}
          />
        );
      case "git":
        return (
          <GitView
            vault={activeVault}
            readOnly={readOnly}
            onRefresh={() => reloadVault(activeVault.path).then(() => undefined)}
            onReveal={reveal}
            onError={(message) => notify(message, "danger")}
            onNotify={(message) => notify(message, "ok")}
          />
        );
      case "settings":
        return (
          <SettingsView
            vault={activeVault}
            settings={settings}
            themePreference={themePreference}
            onThemePreference={setThemePreference}
            info={info}
            presets={presets}
            syncing={syncing}
            onAutoSync={() => runAutoSync()}
            onAdopt={(vaultPath, source) => setModal({ kind: "pending-skills", vaultPath, source })}
            onSaved={(saved) => {
              setSettings(saved);
              notify("设置已保存", "ok");
            }}
            onReveal={reveal}
            onError={(message) => notify(message, "danger")}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="app-shell">
      <TitleBar
        drawerOpen={drawerActive}
        vaults={vaults}
        activePath={activePath}
        checking={activeChecking}
        onSelect={(path) => {
          setActivePath(path);
          setSection("overview");
          setSelection(EMPTY_SELECTION);
        }}
        onClose={closeVault}
        onOpen={() => void browseVault()}
        onNew={() => setModal({ kind: "new-vault" })}
        onSearch={openSearch}
        onCheck={() => {
          if (activePath) void checkVault(activePath, false);
        }}
        onSettings={() => changeSection("settings")}
      />

      {!booted ? (
        <div className="boot-screen">
          <span className="brand-mark xl">
            <Icon name="vault" size={30} strokeWidth={1.6} />
          </span>
          <h1>VaultDesk</h1>
          <p>正在准备本地仓库…</p>
          <Spinner size={18} />
        </div>
      ) : activeVault ? (
        <div className={sidebarCollapsed ? "workspace is-sidebar-collapsed" : "workspace"}>
          <Sidebar
            drawerOpen={drawerActive}
            vault={activeVault}
            section={section}
            checking={activeChecking}
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
            onSection={changeSection}
            onCheck={() => void checkVault(activeVault.path, false)}
            onReveal={() => reveal(activeVault.path)}
            onMigration={() => setModal({ kind: "migration", vaultPath: activeVault.path })}
          />

          <div className="main-pane">
            {activeVault.operation ? (
              <div className="recovery-banner">
                <Icon name="alert" size={16} />
                <div>
                  <strong>上次操作未正常结束</strong>
                  <span>
                    {activeVault.operation.kind} 未完成。不会自动回滚；请核对 Git 与安装备份。
                  </span>
                </div>
                <Button size="sm" variant="quiet" icon="refresh" onClick={() => void reloadVault(activeVault.path)}>
                  刷新状态
                </Button>
              </div>
            ) : null}
            <div className={showInspector ? "workspace-body with-inspector has-selection" : "workspace-body"}>
              <main className="content-pane" inert={drawerActive} tabIndex={-1}>
                {renderView()}
              </main>
              {showInspector ? (
                <>
                  <button className="inspector-scrim" type="button" tabIndex={-1} aria-hidden="true" onClick={closeInspector} />
                  <Inspector
                    vault={activeVault}
                    selection={selection}
                    overlay={drawerActive}
                    onClose={closeInspector}
                    onReveal={reveal}
                    onDiff={(source) => setModal({ kind: "diff", vaultPath: activeVault.path, source })}
                    onUpdate={openUpdate}
                    onRemoveSource={openRemoveSource}
                    onEdit={openEditor}
                    onFork={openFork}
                    onInstall={openInstall}
                    onSkill={selectSkill}
                    onBackups={openBackups}
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <Welcome
          recents={recents}
          loading={recentsLoading}
          info={info}
          opening={opening}
          themePreference={themePreference}
          onOpen={(path) => void openVault(path)}
          onBrowse={() => void browseVault()}
          onNew={() => setModal({ kind: "new-vault" })}
          onThemePreference={setThemePreference}
          onRemoveRecent={(path) => void removeRecent(path)}
        />
      )}

      {modal?.kind === "new-vault" ? (
        <NewVaultModal
          onClose={() => setModal(null)}
          onCreated={(path) => {
            setModal(null);
            void openVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "migration" ? (
        <MigrationModal
          vaultPath={modal.vaultPath}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            notify(message, "ok");
            void reloadVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "validation" ? (
        <ValidationModal
          vaultPath={modal.vaultPath}
          onClose={() => setModal(null)}
          onValidated={(report: ValidationReport) => {
            if (!report.ok) notify(`校验发现 ${report.errors.length} 个错误`, "warn");
          }}
        />
      ) : null}

      {modal?.kind === "diff" ? (
        <DiffModal
          vaultPath={modal.vaultPath}
          source={modal.source}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === "pending-skills" ? (
        <PendingSkillsModal
          vaultPath={modal.vaultPath}
          source={modal.source}
          onClose={() => setModal(null)}
          onDone={(result: AutoSyncSourceResult) => {
            const vaultPath = modal.vaultPath;
            setModal(null);
            notify(
              result.status === "push-failed"
                ? "已在本地接纳并提交，但推送失败；请查看 Git 状态。"
                : "新技能已接纳并同步受管目标。",
              result.status === "push-failed" ? "warn" : "ok",
            );
            if (vaultsRef.current.some((vault) => vault.path === vaultPath)) void reloadVault(vaultPath);
          }}
        />
      ) : null}

      {modal?.kind === "update" && modalVault ? (
        <UpdateModal
          vault={modalVault}
          source={modal.source}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            notify(message, "ok");
            void reloadVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "install" && modalVault ? (
        <InstallModal
          vault={modalVault}
          targetId={modal.targetId}
          presets={presets}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            notify(message, "ok");
            void reloadVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "import" ? (
        <ImportModal
          vaultPath={modal.vaultPath}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            notify(message, "ok");
            void reloadVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "fork" ? (
        <ForkModal
          vaultPath={modal.vaultPath}
          skill={modal.skill}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            notify(message, "ok");
            void reloadVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "editor" ? (
        <EditorModal
          vaultPath={modal.vaultPath}
          skill={modal.skill}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            notify(message, "ok");
            void reloadVault(path);
          }}
          onFork={() => {
            const target = { path: modal.vaultPath, skill: modal.skill };
            setModal({ kind: "fork", vaultPath: target.path, skill: target.skill });
          }}
        />
      ) : null}

      {modal?.kind === "remove-source" && modalVault ? (
        <RemoveSourceModal
          vault={modalVault}
          source={modal.source}
          onClose={() => setModal(null)}
          onDone={(message) => {
            const path = modal.vaultPath;
            setModal(null);
            setSelection(EMPTY_SELECTION);
            notify(message, "ok");
            void reloadVault(path);
          }}
        />
      ) : null}

      {modal?.kind === "backups" ? (
        <BackupsModal
          vaultPath={modal.vaultPath}
          targetId={modal.targetId}
          targets={modalVault?.targets ?? []}
          onClose={() => setModal(null)}
          onReveal={reveal}
          onRestored={(message) => {
            notify(message, "ok");
            void reloadVault(modal.vaultPath);
          }}
        />
      ) : null}

      {targetToRemove ? (
        <ConfirmDialog
          title={`注销安装目标 ${targetToRemove}？`}
          message={
            <>
              从 <strong>{activeVault?.name}</strong> 的 vault.yml 中移除这个安装目标。
            </>
          }
          detail="这个仓库安装的受管目录会移动到备份目录，不会直接删除；未受管目录保持原样。"
          confirmLabel="注销目标"
          danger
          busy={removingTarget}
          onCancel={() => setTargetToRemove(null)}
          onConfirm={() => void confirmRemoveTarget()}
        />
      ) : null}

      {searchOpen && !modal && !targetToRemove ? (
        <SearchPalette
          vaults={vaults.map((vault) => ({ path: vault.path, name: vault.name }))}
          onClose={() => setSearchOpen(false)}
          onPick={(hit) => void handleSearchHit(hit)}
        />
      ) : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon
              name={toast.tone === "ok" ? "check" : toast.tone === "danger" || toast.tone === "warn" ? "alert" : "info"}
              size={15}
            />
            <span>{toast.message}</span>
            <button className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="关闭提示">
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

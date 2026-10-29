import { useEffect, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const dialogStack: HTMLElement[] = [];
let activeActionMenu: HTMLDetailsElement | null = null;
let actionMenuCount = 0;

function closeActiveActionMenu(restoreFocus = false): void {
  const menu = activeActionMenu;
  activeActionMenu = null;
  if (!menu) return;
  menu.open = false;
  if (restoreFocus) menu.querySelector<HTMLElement>("summary")?.focus();
}

function onActionMenuPointerDown(event: PointerEvent): void {
  if (activeActionMenu && !activeActionMenu.contains(event.target as Node)) closeActiveActionMenu();
}

function onActionMenuKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !activeActionMenu) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeActiveActionMenu(true);
}

export function useDialogFocus<T extends HTMLElement>(
  rootRef: RefObject<T | null>,
  state: { dismissable: boolean; onClose: () => void },
): void {
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    if (root) dialogStack.push(root);
    document.body.classList.toggle("modal-open", dialogStack.length > 0);

    const focusable = (): HTMLElement[] => {
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
    };

    const onKey = (event: KeyboardEvent): void => {
      if (dialogStack.at(-1) !== root) return;
      if (event.key === "Escape" && stateRef.current.dismissable) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stateRef.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const index = active ? items.indexOf(active) : -1;
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          items.at(-1)?.focus();
        }
      } else if (index === -1 || index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const wasTop = dialogStack.at(-1) === root;
      const index = root ? dialogStack.lastIndexOf(root) : -1;
      if (index >= 0) dialogStack.splice(index, 1);
      document.body.classList.toggle("modal-open", dialogStack.length > 0);
      if (wasTop && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [rootRef]);
}

export function Button({
  children,
  variant = "default",
  size = "md",
  icon,
  loading = false,
  className = "",
  disabled,
  ...rest
}: {
  children?: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger" | "quiet";
  size?: "sm" | "md";
  icon?: IconName;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  loading = false,
  className = "",
  ...rest
}: {
  icon: IconName;
  label: string;
  loading?: boolean;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`icon-btn ${className}`.trim()}
      title={label}
      aria-label={label}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : <Icon name={icon} size={17} />}
    </button>
  );
}

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    actionMenuCount += 1;
    if (actionMenuCount === 1) {
      document.addEventListener("pointerdown", onActionMenuPointerDown, true);
      document.addEventListener("keydown", onActionMenuKeyDown, true);
    }
    return () => {
      if (activeActionMenu === menuRef.current) closeActiveActionMenu();
      actionMenuCount -= 1;
      if (actionMenuCount === 0) {
        document.removeEventListener("pointerdown", onActionMenuPointerDown, true);
        document.removeEventListener("keydown", onActionMenuKeyDown, true);
      }
    };
  }, []);

  return (
    <details
      ref={menuRef}
      className="row-menu"
      onToggle={(event) => {
        const menu = event.currentTarget;
        if (menu.open) {
          if (activeActionMenu && activeActionMenu !== menu) closeActiveActionMenu();
          activeActionMenu = menu;
        } else if (activeActionMenu === menu) {
          activeActionMenu = null;
        }
      }}
    >
      <summary
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          const menu = menuRef.current;
          if (!menu) return;
          if (menu.open) {
            if (activeActionMenu === menu) closeActiveActionMenu();
            else menu.open = false;
          } else {
            closeActiveActionMenu();
            menu.open = true;
            activeActionMenu = menu;
          }
        }}
      >
        更多 <Icon name="chevron-down" size={13} />
      </summary>
      <div
        className="row-menu-panel"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button:not([disabled])")) {
            event.currentTarget.closest("details")?.removeAttribute("open");
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />;
}

export type StatusTone = "ok" | "warn" | "danger" | "muted";

function StatusGlyph({ tone }: { tone: StatusTone }) {
  if (tone === "ok") {
    return (
      <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="m4.8 8.2 2.1 2.1 4.3-4.6" fill="none" stroke="var(--paper-raised)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "muted") {
    return (
      <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">
      <path d="M8 1.6 15 14H1z" fill="currentColor" />
      <path d="M8 6v3.6M8 11.6v.2" fill="none" stroke="var(--paper-raised)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function StatusMark({
  tone = "ok",
  label,
  size = 15,
}: {
  tone?: StatusTone;
  label: string;
  size?: number;
}) {
  return (
    <span
      className={`status-mark tone-${tone}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      title={label}
    >
      <StatusGlyph tone={tone} />
    </span>
  );
}

export interface SlotItem {
  key: string;
  name: string;
  tone?: StatusTone;
  label?: string;
}

function slotStatus(item: SlotItem): string {
  if (item.label?.includes("未登记")) return "未登记";
  if (item.label?.includes("未安装")) return "未安装";
  return item.tone === "ok" ? "已安装" : item.tone === "warn" ? "需检查" : "待确认";
}

export function SlotStrip({ items, emptyLabel }: { items: SlotItem[]; emptyLabel?: string }) {
  if (items.length === 0) {
    return emptyLabel ? <span className="slot-strip-empty">{emptyLabel}</span> : null;
  }
  return (
    <span className="slot-strip">
      {items.map((item) => (
        <span
          className="slot-chip"
          key={item.key}
          title={item.label ?? item.name}
        >
          <span className="slot-chip-name">{item.name}</span>
          <span className={`slot-chip-corner tone-${item.tone ?? "ok"}`}>{slotStatus(item)}</span>
        </span>
      ))}
    </span>
  );
}

export function FlowStrip({ steps }: { steps: Array<{ icon: IconName; label: string; detail?: string }> }) {
  return (
    <div className="flow-strip">
      {steps.map((step, index) => (
        <span className="flow-part" key={`${step.label}-${index}`}>
          {index > 0 ? (
            <span className="flow-arrow" aria-hidden="true">
              <Icon name="arrow-right" size={11} />
            </span>
          ) : null}
          <span className="flow-step">
            <Icon name={step.icon} size={13} />
            <span className="flow-step-label" title={step.label}>{step.label}</span>
            {step.detail ? <span className="flow-detail">{step.detail}</span> : null}
          </span>
        </span>
      ))}
    </div>
  );
}

export function StatusPill({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "ok" | "warn" | "danger" | "muted" | "neutral" | "accent";
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "default",
  dismissable = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "default" | "wide" | "xwide";
  dismissable?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, { dismissable, onClose });

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissable) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="关闭" onClick={onClose} disabled={!dismissable} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = "确认",
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  detail?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-copy">
        <p>{message}</p>
        {detail ? <div className="confirm-detail">{detail}</div> : null}
      </div>
    </Modal>
  );
}

export function Field({
  label,
  hint,
  children,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  optional?: boolean;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  const controlId = useId();

  useLayoutEffect(() => {
    const control = fieldRef.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input, select, textarea",
    );
    if (!control || !labelRef.current) return;
    if (!control.id) control.id = controlId;
    labelRef.current.htmlFor = control.id;
  });

  return (
    <div ref={fieldRef} className="field">
      <label ref={labelRef} className="field-label">
        {label}
        {optional ? <em>可选</em> : null}
      </label>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row ${disabled ? "is-disabled" : ""}`}>
      <span className="toggle-copy">
        <span className="toggle-label">{label}</span>
        {hint ? <span className="toggle-hint">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const icon: IconName = tone === "warn" || tone === "danger" ? "alert" : tone === "ok" ? "check" : "info";
  return (
    <div className={`callout callout-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon} size={17} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <div className="callout-body">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon = "sparkle",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </header>
  );
}

export function KeyHint({ children }: { children: ReactNode }) {
  return <kbd className="key-hint">{children}</kbd>;
}

export function MetaRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className={`meta-value ${mono ? "mono" : ""}`}>{children}</span>
    </div>
  );
}

export function Divider() {
  return <div className="divider" />;
}

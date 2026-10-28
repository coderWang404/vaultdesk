import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "vault"
  | "overview"
  | "source"
  | "skill"
  | "target"
  | "git"
  | "settings"
  | "plus"
  | "search"
  | "refresh"
  | "check"
  | "alert"
  | "x"
  | "chevron-right"
  | "chevron-down"
  | "folder"
  | "external"
  | "edit"
  | "trash"
  | "lock"
  | "clock"
  | "download"
  | "upload"
  | "command"
  | "arrow-right"
  | "sparkle"
  | "file"
  | "shield"
  | "branch"
  | "terminal"
  | "server"
  | "backup"
  | "copy"
  | "info";

const paths: Record<IconName, ReactNode> = {
  vault: (
    <>
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  source: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H10v18H6.5A2.5 2.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18h3.5a2.5 2.5 0 0 0 2.5-2.5z" />
    </>
  ),
  skill: (
    <>
      <path d="M12 3v4M12 17v4M4.8 7.5l3.5 2M15.7 14.5l3.5 2M4.8 16.5l3.5-2M15.7 9.5l3.5-2" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  git: (
    <>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="18" cy="5" r="2.2" />
      <circle cx="12" cy="19" r="2.2" />
      <path d="M6 7.2v3.3A3 3 0 0 0 9 13.5h6a3 3 0 0 0 3-3V7.2M12 13.5V16.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.46V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.46-.97H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.05A1.6 1.6 0 0 0 10 3.14V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.05a1.6 1.6 0 0 0 1.46.95H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.7L3 9" />
      <path d="M3 4v5h5M4 13a8 8 0 0 0 14.3 4.7L21 15" />
      <path d="M21 20v-5h-5" />
    </>
  ),
  check: <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />,
  alert: (
    <>
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 9v4.5M12 17h.01" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  "chevron-down": <path d="m5 9 7 7 7-7" />,
  folder: (
    <>
      <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2.5h6a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z" />
      <path d="M3.5 9.5h17" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14.5 7.5 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7 10.5 12 15l5-4.5" />
      <path d="M4 19.5h16" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 8.5 12 4l5 4.5" />
      <path d="M4 19.5h16" />
    </>
  ),
  command: (
    <>
      <path d="M9 9V6a2.5 2.5 0 1 0-2.5 2.5H9zm0 0h6m-6 0v6m6-6V6a2.5 2.5 0 1 1 2.5 2.5H15zm0 0v6m0 0H9m6 0v3a2.5 2.5 0 1 0 2.5-2.5H15zM9 15H6a2.5 2.5 0 1 0 2.5 2.5V15z" />
    </>
  ),
  "arrow-right": <path d="M4 12h15M13 6l6 6-6 6" />,
  sparkle: (
    <>
      <path d="M12 3.5 13.8 9l5.2 1.8-5.2 1.9L12 18l-1.8-5.3L5 10.8 10.2 9z" />
      <path d="M18.5 16.5 19.2 18l1.5.7-1.5.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 16h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4-3 7.4-7 9-4-1.6-7-5-7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10M8 7c4 0 4-1 8-1M8 17c4 0 5-3 8-4" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="6" rx="1.6" />
      <rect x="3.5" y="14" width="17" height="6" rx="1.6" />
      <path d="M7 7h.01M7 17h.01M11 7h5M11 17h5" />
    </>
  ),
  backup: (
    <>
      <path d="M4 8.5A8 8 0 1 1 4.6 15" />
      <path d="M4 4v5h5" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8v.2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

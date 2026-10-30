export interface ToolReadinessCheck {
  id: string;
  kind: string;
  label: string;
  status: "ok" | "missing" | "incompatible" | "drift" | "error";
  detail?: string;
  pythonPath?: string;
  nodePath?: string;
  optional?: boolean;
  profiles?: string[];
}

export interface ToolReadinessReport {
  name: string;
  status: "ready" | "incomplete" | "unconfigured";
  profile?: string;
  pythonPath?: string;
  nodePath?: string;
  checks: ToolReadinessCheck[];
  checkedAt: string;
}

export interface ToolReadinessState {
  loading?: boolean;
  report?: ToolReadinessReport;
  error?: string;
}

export function readinessKey(vaultPath: string, name: string, profile?: string, pythonPath?: string, nodePath?: string): string {
  return JSON.stringify([vaultPath, name, profile ?? null, pythonPath ?? null, nodePath ?? null]);
}

export function readinessCheckedAt(report?: ToolReadinessReport): string | null {
  if (!report) return null;
  const date = new Date(report.checkedAt);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("zh-CN");
}

export function readinessPresentation(
  checksDeclared: boolean,
  state?: ToolReadinessState,
): { label: string; tone: "ok" | "warn" | "danger" | "muted" | "neutral" } {
  if (!checksDeclared) {
    return { label: "未配置运行时检查", tone: "muted" };
  }
  if (state?.report?.status === "unconfigured") {
    return { label: "当前场景无检查项", tone: "muted" };
  }
  if (state?.loading) return { label: "检查中", tone: "neutral" };
  if (state?.error) return { label: "检查失败", tone: "danger" };
  if (state?.report?.status === "ready") {
    return { label: state.report.profile ? "当前场景检查通过" : "通用检查通过", tone: "ok" };
  }
  if (state?.report?.status === "incomplete") return { label: "运行环境未就绪", tone: "warn" };
  return { label: "待检查", tone: "muted" };
}

export function checkPresentation(status: ToolReadinessCheck["status"]): {
  label: string;
  tone: "ok" | "warn" | "danger" | "muted";
} {
  switch (status) {
    case "ok": return { label: "通过", tone: "ok" };
    case "missing": return { label: "缺失", tone: "warn" };
    case "incompatible": return { label: "版本不兼容", tone: "warn" };
    case "drift": return { label: "依赖清单已变更", tone: "warn" };
    case "error": return { label: "检查失败", tone: "danger" };
  }
}

import React, { type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class RendererErrorBoundary extends React.Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("VaultDesk renderer recovered from an error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="renderer-error-screen" role="alert">
          <div className="renderer-error-card">
            <span className="eyebrow">VaultDesk</span>
            <h1>界面暂时没有响应</h1>
            <p>批量操作或数据刷新触发了界面异常。你的仓库文件不会因此被自动修改，可以重新加载后继续。</p>
            <button className="btn btn-primary btn-md" onClick={() => window.location.reload()}>
              重新加载界面
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing");

createRoot(container).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>,
);

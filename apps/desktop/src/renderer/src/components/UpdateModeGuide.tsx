import { Fragment } from "react";
import { sourceUpdateModes } from "../format";

export function UpdateModeGuide() {
  return (
    <details className="source-mode-guide">
      <summary>更新方式有什么区别？</summary>
      <dl>
        {Object.entries(sourceUpdateModes).map(([mode, { label, hint }]) => (
          <Fragment key={mode}>
            <dt>{label}</dt>
            <dd>{hint}</dd>
          </Fragment>
        ))}
      </dl>
      <p>“检查”只查询上游；“立即同步”按各来源的更新方式执行。后台定时运行需在设置中开启。</p>
      <p>手动改动、归属冲突或敏感文件会阻止本次自动更新，具体原因可在设置的活动记录中查看。</p>
      <p>本地来源没有远程更新；插件和 MCP 的启用仍需在对应 AI 工具中完成。</p>
    </details>
  );
}

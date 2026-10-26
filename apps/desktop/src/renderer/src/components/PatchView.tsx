export function PatchView({ patch }: { patch?: string }) {
  if (!patch) {
    return <div className="patch-empty">这个文件没有文本差异，或差异过大未生成补丁。</div>;
  }
  const lines = patch.split("\n");
  return (
    <pre className="patch">
      {lines.map((line, index) => {
        let tone = "";
        if (line.startsWith("+++") || line.startsWith("---")) tone = "meta";
        else if (line.startsWith("@@")) tone = "hunk";
        else if (line.startsWith("+")) tone = "add";
        else if (line.startsWith("-")) tone = "del";
        else if (line.startsWith("diff --git") || line.startsWith("index ")) tone = "meta";
        return (
          <div className={`patch-line ${tone}`} key={index}>
            <span className="patch-number">{index + 1}</span>
            <span className="patch-text">{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

export function diffStatusLabel(status: string): string {
  switch (status) {
    case "added":
      return "新增";
    case "deleted":
      return "删除";
    case "type-changed":
      return "类型变化";
    default:
      return "修改";
  }
}

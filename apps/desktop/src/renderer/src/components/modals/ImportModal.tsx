import { useState } from "react";
import type { ImportPreview, ImportResult, PluginImportPreview, PluginImportResult } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { assetKindLabel, pluginAgentLabel } from "../../format";
import { Icon } from "../icons";
import { Button, Callout, Field, Modal, Spinner, StatusPill } from "../ui";

type Mode = "local" | "github";
type KindChoice = "auto" | "collection" | "suite";
type ShapeChoice = "auto" | "plugin" | "skills";
type Preview = ImportPreview | PluginImportPreview;
type Result = ImportResult | PluginImportResult;

export function ImportModal({
  vaultPath,
  onClose,
  onDone,
}: {
  vaultPath: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("local");
  const [path, setPath] = useState("");
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("main");
  const [contentPath, setContentPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<KindChoice>("auto");
  const [shape, setShape] = useState<ShapeChoice>("auto");
  const [entrypoint, setEntrypoint] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Result | null>(null);

  function clearPreview(): void {
    setPreview(null);
    setError(null);
    setApplied(null);
  }

  function options(): {
    name?: string;
    kind?: "suite" | "collection";
    entrypoint?: string;
    plugin?: boolean;
    noPlugin?: boolean;
  } {
    return {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(kind !== "auto" ? { kind } : {}),
      ...(entrypoint.trim() ? { entrypoint: entrypoint.trim() } : {}),
      ...(shape === "plugin" ? { plugin: true } : {}),
      ...(shape === "skills" ? { noPlugin: true } : {}),
    };
  }

  async function choosePath(): Promise<void> {
    const selected = await window.vaultdesk.chooseDirectory({
      title: "选择技能目录或仓库目录",
      defaultPath: path || undefined,
    });
    if (selected) {
      setPath(selected);
      clearPreview();
    }
  }

  async function previewLocal(): Promise<void> {
    if (!path) return;
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const result = await call<Preview>("source.addLocal", {
        vaultPath,
        path,
        ...options(),
        confirm: false,
      });
      setPreview(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function previewGithub(): Promise<void> {
    if (!repo.trim()) return;
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const result = await call<Preview>("source.addGithub", {
        vaultPath,
        repo: repo.trim(),
        ref: ref.trim() || "main",
        ...(contentPath.trim() ? { path: contentPath.trim() } : {}),
        ...options(),
        confirm: false,
      });
      setPreview(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "local"
          ? await call<Result>("source.addLocal", {
              vaultPath,
              path,
              ...options(),
              confirm: true,
            })
          : await call<Result>("source.addGithub", {
              vaultPath,
              repo: repo.trim(),
              ref: ref.trim() || "main",
              ...(contentPath.trim() ? { path: contentPath.trim() } : {}),
              ...options(),
              confirm: true,
            });
      setApplied(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const conflicts = preview?.conflicts ?? [];
  const canApply = Boolean(preview) && conflicts.length === 0 && !applied;
  const pluginPreview = preview?.shape === "plugin" ? preview : null;
  const assetKinds = pluginPreview
    ? [...new Set(pluginPreview.assets.map((asset) => asset.kind))]
    : [];

  return (
    <Modal
      title="添加来源"
      subtitle="自动识别插件、技能与组合资产；插件只写入仓库，可手动指定形态。"
      onClose={onClose}
      width="wide"
      dismissable={!busy}
      footer={
        applied ? (
          <Button variant="primary" onClick={() => onDone(`已导入 ${applied.sourceName}`)}>
            完成
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              icon="check"
              onClick={() => void apply()}
              loading={busy}
              disabled={!canApply}
            >
              确认导入
            </Button>
          </>
        )
      }
    >
      <div className="import-tabs" role="group" aria-label="来源类型">
        <button aria-pressed={mode === "local"} className={mode === "local" ? "is-active" : ""} onClick={() => { setMode("local"); clearPreview(); }}>
          <Icon name="folder" size={15} /> 本地目录
        </button>
        <button aria-pressed={mode === "github"} className={mode === "github" ? "is-active" : ""} onClick={() => { setMode("github"); clearPreview(); }}>
          <Icon name="git" size={15} /> GitHub 仓库
        </button>
      </div>

      {mode === "local" ? (
        <div className="import-form">
          <Field label="来源目录" hint="复制进仓库，原目录不变。">
            <div className="input-with-button">
              <input
                className="input mono"
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  clearPreview();
                }}
                placeholder="/path/to/skill-or-repo"
              />
              <Button variant="quiet" icon="folder" onClick={() => void choosePath()}>
                选择
              </Button>
            </div>
          </Field>
        </div>
      ) : (
        <div className="import-form grid-two">
          <Field label="GitHub 仓库" hint="owner/name，或完整仓库地址。">
            <input
              className="input mono"
              value={repo}
              onChange={(event) => {
                setRepo(event.target.value);
                clearPreview();
              }}
              placeholder="JimLiu/baoyu-skills"
            />
          </Field>
          <Field label="引用" hint="分支或标签。">
            <input
              className="input mono"
              value={ref}
              onChange={(event) => {
                setRef(event.target.value);
                clearPreview();
              }}
              placeholder="main"
            />
          </Field>
          <Field label="仓库内路径" optional hint="留空扫描整个仓库。">
            <input
              className="input mono"
              value={contentPath}
              onChange={(event) => {
                setContentPath(event.target.value);
                clearPreview();
              }}
              placeholder="packages/baoyu-skills"
            />
          </Field>
        </div>
      )}

      <div className="import-form">
        <Field
          label="来源形态"
          hint="优先看 manifest，其次看资产组合。"
        >
          <select
            className="input"
            value={shape}
            onChange={(event) => {
              setShape(event.target.value as ShapeChoice);
              clearPreview();
            }}
          >
            <option value="auto">自动识别</option>
            <option value="plugin">作为插件入库</option>
            <option value="skills">作为技能 / 合集 / 套件</option>
          </select>
        </Field>
      </div>

      <div className="import-form grid-three">
        <Field label="来源名称" optional hint="留空时按目录或技能名推断。">
          <input
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clearPreview();
            }}
            placeholder="自动"
          />
        </Field>
        <Field label="分类" hint={pluginPreview || shape === "plugin" ? "插件不使用分类。" : undefined}>
          <select
            className="input"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as KindChoice);
              clearPreview();
            }}
            disabled={Boolean(pluginPreview) || shape === "plugin"}
          >
            <option value="auto">自动检测</option>
            <option value="collection">collection · 合集</option>
            <option value="suite">suite · 套件</option>
          </select>
        </Field>
        <Field
          label="套件入口"
          optional
          hint={pluginPreview || shape === "plugin" ? "插件不使用入口。" : "suite 必填，且须在导入技能内。"}
        >
          <input
            className="input"
            value={entrypoint}
            onChange={(event) => {
              setEntrypoint(event.target.value);
              clearPreview();
            }}
            placeholder="入口技能名"
            disabled={Boolean(pluginPreview) || shape === "plugin" || kind !== "suite"}
          />
        </Field>
      </div>

      <div className="import-preview-bar">
        <Button
          variant="quiet"
          icon="search"
          onClick={() => void (mode === "local" ? previewLocal() : previewGithub())}
          loading={busy}
          disabled={mode === "local" ? !path : !repo.trim()}
        >
          预览分类
        </Button>
        <span className="muted-small">预览不写盘</span>
      </div>

      {error ? (
        <Callout tone="danger" title="导入失败">
          <p>{error}</p>
        </Callout>
      ) : null}

      {!preview && busy ? (
        <div className="modal-loading">
          <Spinner size={20} />
          <p>{mode === "github" ? "正在抓取仓库并扫描 SKILL.md…" : "正在扫描目录…"}</p>
        </div>
      ) : null}

      {preview ? (
        <div className="import-preview">
          <div className="import-preview-head">
            <div>
              <span className="eyebrow">{mode === "github" ? "GitHub 导入" : "本地导入"}</span>
              <h3>{preview.suggestedName}</h3>
            </div>
            <div className="import-badges">
              {pluginPreview ? (
                <StatusPill tone="accent">插件</StatusPill>
              ) : (
                <StatusPill tone="accent">
                  {preview.shape === "package" ? `package/${preview.kind}` : "standalone"}
                </StatusPill>
              )}
              {preview.shape !== "plugin" && preview.entrypoint ? (
                <StatusPill tone="warn">入口 {preview.entrypoint}</StatusPill>
              ) : null}
              {pluginPreview
                ? pluginPreview.manifests.map((manifest) => (
                    <StatusPill
                      key={manifest.relativePath}
                      tone={manifest.parseError ? "danger" : "neutral"}
                      title={manifest.relativePath}
                    >
                      {pluginAgentLabel(manifest.agent)}
                    </StatusPill>
                  ))
                : null}
              {pluginPreview && pluginPreview.detectedBy !== "manifest" ? (
                <StatusPill tone="warn">
                  {pluginPreview.detectedBy === "composition" ? "按组合识别" : "强制插件"}
                </StatusPill>
              ) : null}
              {pluginPreview?.hasHooks ? <StatusPill tone="warn">含 hooks</StatusPill> : null}
              {"commit" in preview && preview.commit ? (
                <StatusPill tone="muted">{preview.commit.slice(0, 8)}</StatusPill>
              ) : null}
            </div>
          </div>
          <div className="import-meta mono">
            <span>{preview.inputPath}</span>
            <span>
              → {preview.shape === "plugin" ? `plugins/${preview.suggestedName}` : preview.targetRoot}
            </span>
          </div>
          {pluginPreview ? (
            <div className="import-plugin-summary">
              <div className="import-plugin-facts">
                <span>
                  {pluginPreview.manifests.length > 0
                    ? `${pluginPreview.manifests.length} 个 manifest`
                    : pluginPreview.detectedBy === "override"
                      ? "无 manifest（强制插件）"
                      : "无 manifest（按组合识别）"}
                </span>
                <span>{pluginPreview.assets.length} 项资产</span>
                <span>{pluginPreview.skills.length} 个插件内技能</span>
              </div>
              {assetKinds.length > 0 ? (
                <div className="import-plugin-assets">
                  {assetKinds.map((assetKind) => (
                    <StatusPill key={assetKind} tone={assetKind === "hooks" ? "warn" : "muted"}>
                      {assetKindLabel(assetKind)}
                    </StatusPill>
                  ))}
                </div>
              ) : null}
              {pluginPreview.hasHooks ? (
                <Callout tone="warn" title="插件包含 hooks">
                  <p>hooks 会写入仓库，VaultDesk 不执行；请先在 agent 侧确认行为。</p>
                </Callout>
              ) : null}
            </div>
          ) : null}
          <div className="import-skills">
            {preview.skills.map((skill) => (
              <div className="import-skill" key={skill.name}>
                <Icon name="skill" size={13} />
                <span>{skill.name}</span>
                <span className="mono muted-small">{skill.relativePath}</span>
                <span className="muted-small">{skill.description ?? "无描述"}</span>
              </div>
            ))}
          </div>
          {conflicts.length > 0 ? (
            <Callout tone="danger" title="存在命名冲突">
              <ul>
                {conflicts.map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
          {preview.warnings.map((warning) => (
            <p className="muted-small" key={warning}>
              {warning}
            </p>
          ))}
          {applied ? (
            <Callout tone="ok" title="导入完成">
              <p>已写入 {applied.wrote.length} 个路径，来源 {applied.sourceName}。</p>
              {applied.shape === "plugin" ? (
                <p>插件已写入仓库，未安装到 agent。</p>
              ) : null}
            </Callout>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

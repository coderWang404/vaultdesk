import { useState } from "react";
import type { VaultSnapshot } from "@vaultdesk/core";
import { call, errorMessage } from "../../api";
import { Icon } from "../icons";
import { Button, Callout, Field, Modal, Toggle } from "../ui";

export function NewVaultModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [git, setGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(): Promise<void> {
    const selected = await window.vaultdesk.chooseDirectory({
      title: "选择新仓库目录（空目录或尚不存在）",
      defaultPath: path || undefined,
    });
    if (selected) {
      setPath(selected);
      setError(null);
    }
  }

  async function create(): Promise<void> {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call<{ init: unknown; snapshot: VaultSnapshot }>("vault.create", {
        path,
        ...(name.trim() ? { name: name.trim() } : {}),
        git,
      });
      onCreated(result.snapshot.path);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="新建仓库"
      subtitle="创建 v2 仓库骨架。"
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" icon="vault" onClick={() => void create()} loading={busy} disabled={!path}>
            创建仓库
          </Button>
        </>
      }
    >
      <div className="new-vault">
        <Field label="仓库目录" hint="空目录或尚不存在。">
          <div className="input-with-button">
            <input
              className="input mono"
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
                setError(null);
              }}
              placeholder="/Users/you/Vaults/my-skills"
            />
            <Button variant="quiet" icon="folder" onClick={() => void choose()}>
              选择
            </Button>
          </div>
        </Field>
        <Field label="仓库名称" optional hint="留空时使用目录名。">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="我的技能库"
          />
        </Field>
        <Toggle
          checked={git}
          onChange={setGit}
          label="初始化 Git 仓库"
          hint="建议启用；更新与迁移要求工作区干净。"
        />
        <div className="new-vault-tree">
          <span className="eyebrow">将创建</span>
          <pre>{`vault.yml
vault.lock
sources/
.vault/.gitignore
.gitignore
README.md`}</pre>
        </div>
        {error ? (
          <Callout tone="danger" title="无法创建">
            <p>{error}</p>
          </Callout>
        ) : null}
        <p className="muted-small">
          <Icon name="shield" size={12} /> 不影响已有技能与安装目录
        </p>
      </div>
    </Modal>
  );
}

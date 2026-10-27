# VaultDesk 插件登记设计

- 状态：0.7 与 0.8 已实现；插件导入、整根 diff、更新、删除清理、搜索、总览与安装 guard 均有单元/集成/CLI/桌面 E2E 覆盖
- 日期：2026-10-27
- 范围：Qoder、Claude Code、Codex 的插件登记与展示
- 非范围：OpenCode 插件、插件安装、marketplace 生成、adapter manifest 生成、agent registry 写入

## 1. 产品边界

VaultDesk 是 Git 仓库承载的技能与插件登记库。

- 技能：由 VaultDesk 构建、安装、校验、备份和恢复。
- 插件：由 VaultDesk 存储、校验、展示，agent 通过 vault-manager skill 自行安装和适配。

VaultDesk 不负责让插件在 agent 中生效。插件页没有安装按钮，也不显示 agent 侧的 installed/enabled 状态。

边界理由：

- SKILL.md 是跨 agent 的稳定格式，VaultDesk 可以安全地复制和验证。
- 插件格式、hooks 语义、安装位置和启用状态由各 agent 自己定义。
- 生成 marketplace 或 adapter manifest 会把 VaultDesk 变成半套安装器，升级和回滚边界都会失控。

## 2. 数据模型

### 2.1 source 文件

插件是 `shape: plugin` 的 source，复用现有的 origin、repo、ref、update_mode、lock 和 diff 流程。

```yaml
schema: 1
name: security-scan
shape: plugin
origin: github
repo: owner/repo
ref: main
content_path: plugins/security-scan
version: 0.9.4
description: Automated security review
update_mode: review-before-apply
skills: []
```

规则：

- `shape: plugin` 禁止 `kind` 和 `entrypoint`。
- 插件不声明 `skills` 成员，`skills` 必须为空。成员在读取时从插件根目录发现，避免 metadata 与内容漂移。
- `origin: github` 必须有 `repo` 和 `ref`；`content_path` 可选，表示上游仓库中插件根的相对路径。
- `origin: local` 不写 `repo`、`ref`、`content_path`，不参与上游更新。
- `forked_from` 不适用于插件。GitHub 插件只读，本地插件可原地编辑。
- 插件 source 名与其他 source 名、skill 名共用命名空间。

本地插件示例：

```yaml
schema: 1
name: local-tools
shape: plugin
origin: local
version: 0.1.0
description: Internal command bundle
update_mode: review-before-apply
skills: []
```

### 2.2 目录布局

```text
vault/
├── plugins/<name>/                    # 插件工作根，agent 读取此路径
├── third_party/<name>/                # GitHub 插件的 pristine 上游副本
├── sources/<name>.yml
├── vault.lock
└── build/skills/                      # 只放可安装技能，不放插件
```

- `plugins/<name>/` 始终是完整、自包含的插件根。换机器或移动 vault 后，agent 仍可从这里安装。
- GitHub 插件复制两份：`third_party/<name>/` 保存上游原样内容，`plugins/<name>/` 是暴露给 agent 的工作副本。两份内容在导入和更新后保持一致。
- 本地插件只有 `plugins/<name>/`，没有 pristine 副本。
- 插件内容进入 Git。第三方插件必须保留 LICENSE 和归属信息。
- 插件不进 `build/skills/`。

### 2.3 lock 语义

`vault.lock` 的 source 条目继续使用 `commit`、`hash`、`skills`：

```yaml
schema: 1
sources:
  security-scan:
    commit: 4f3c2a1...
    hash: sha256:...        # 整个插件根的内容哈希
    skills:
      security-scan: sha256:...
```

- `hash` 覆盖整个插件根，用于发现 commands、agents、hooks、MCP 等非 skill 资产的变化。
- `skills` 记录发现到的插件内 skill 的目录哈希，用于展示和单技能 diff。
- 本地插件不写 lock。
- 更新检测同时比较 commit 和整根 hash。

### 2.4 snapshot 记录

新增 `PluginRecord`，由 `shape: plugin` 的 source 派生：

```ts
interface PluginManifest {
  agent: "claude" | "codex" | "qoder" | "generic";
  path: string;             // 绝对路径
  relativePath: string;     // 相对插件根
  name?: string;
  version?: string;
  description?: string;
  license?: string;
}

interface PluginAsset {
  kind: "skills" | "commands" | "agents" | "hooks" | "mcp" | "rules" | "workflows" | "other";
  path: string;
  relativePath: string;
}

interface PluginRecord {
  name: string;
  origin: Origin;
  repo?: string;
  ref: string;
  version?: string;
  description?: string;
  license?: string;
  workingPath: string;
  vendorRoot?: string;
  metadataPath: string;
  manifests: PluginManifest[];
  assets: PluginAsset[];
  hasHooks: boolean;
  skills: SkillRecord[];
  locked?: SourceRecord["locked"];
  status: CheckStatus;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  remoteCommit?: string;
  lastError?: string;
}
```

`VaultSnapshot` 新增：

- `plugins: PluginRecord[]`
- `counts.plugins`
- `counts.pluginSkills`

`counts.skills` 只统计可安装技能。插件内技能不计入技能页、安装计划和 build。

## 3. 插件发现

### 3.1 manifest 检测

在插件根检测以下文件，命中任意一个即视为插件：

```text
plugin.json
.claude-plugin/plugin.json
.codex-plugin/plugin.json
.qoder-plugin/plugin.json
```

- 同时存在多个 manifest 时全部解析，按 agent 标记。
- Qoder 能读取 `.claude-plugin`，但 VaultDesk 只展示实际存在的文件，不生成别名。
- 多个 manifest 的 name 或 version 不一致时产生 warning。
- 没有任何 manifest 时不能按 plugin 导入，退回现有 skill/package 检测。

### 3.2 资产清单

按目录和 manifest 引用收集，去重后写入 `PluginRecord.assets`：

```text
skills/
commands/
agents/
hooks/
rules/
workflows/
output-styles/
.mcp.json
mcp.json
```

- manifest 中 `skills`、`commands`、`agents`、`hooks`、`mcpServers`、`rules`、`outputStyles`、`workflows` 指向的路径也纳入清单。
- 清单之外的顶层文件计入 `other`，只展示数量，不逐文件列出。
- `hasHooks` 为真：manifest 声明了 hooks，或 `hooks/` 下存在文件。
- LICENSE 优先取 manifest 的 `license`，否则读取根目录 LICENSE 文件的存在与文件名。

### 3.3 插件内技能

发现规则：

1. manifest 的 `skills` 指向的目录中存在 `SKILL.md`。
2. `skills/*/SKILL.md` 一层子目录。
3. 两者合并，按目录规范路径去重。

每个发现的技能生成 `SkillRecord`，标记 `pluginName`，但：

- 不进入 `snapshot.skills`
- 不进入 `build/skills/`
- 不进入安装目标解析
- 不出现在技能页
- 可以被全局搜索命中，跳转到插件页

## 4. 导入与存储

### 4.1 本地导入

输入一个目录：

1. 检测插件 manifest。
2. 命中时按 plugin 预览，展示 manifest、资产、插件内技能和冲突。
3. 用户确认后，把整个目录复制到 `plugins/<name>/`。
4. 写 `sources/<name>.yml`，`skills: []`。
5. 不写 lock。
6. 不构建、不安装。

未命中 manifest 时走现有 skill/package 导入。

### 4.2 GitHub 导入

输入 `owner/repo`：

1. 拉取到上游缓存。
2. 在仓库根检测 manifest；没有时在 `content_path` 指向的目录检测。
3. 命中时按 plugin 预览，展示 commit、manifest、资产和插件内技能。
4. 确认后复制上游插件根到 `third_party/<name>/` 和 `plugins/<name>/`。
5. 写 source 文件和 lock，lock 记录 commit、整根 hash、插件内技能哈希。
6. 不构建、不安装。

如果一个仓库包含多个插件根，导入必须显式提供 `content_path`。未提供时报错并列出候选目录。

### 4.3 命名与冲突

- 默认 source 名取 manifest name，slug 化。
- 与现有 source 名、skill 名冲突时拒绝导入，并给出冲突项。
- 插件内技能名与外部技能重名不阻塞导入，但产生 warning；安装解析不会选中插件内技能。

## 5. 更新与 diff

### 5.1 检查

- 继续使用 `git ls-remote` 获取上游 commit。
- 与 lock 的 commit 比较，结果写入 state。
- 插件 source 与 skill source 使用同一套状态枚举。

### 5.2 diff

现有逐技能 diff 不适用于插件。插件 source 增加整根 diff：

- 比较 `third_party/<name>/` 与上游缓存中的插件根；`third_party/<name>/` 缺失时回退到 `plugins/<name>/`。
- `content_path` 非空时，上游根解析为该子目录，且必须留在检出目录内。
- 展示逐文件 unified diff，路径相对插件根，包含 commands、agents、hooks、MCP 和技能。
- 二进制文件只报大小变化。
- 0 个技能的插件仍能产生 diff。

### 5.3 更新

顺序：

1. 要求工作区干净。
2. 抓取上游到缓存。
3. 先写 `third_party/<name>/`。
4. 同步 `plugins/<name>/`。
5. 重新发现插件内技能。
6. 用新 manifest 刷新 source 元数据里的 version 与 description。
7. 更新 lock 的 commit、整根 hash、技能哈希。
8. 校验。
9. 不构建、不安装。

默认拒绝覆盖本地改动；`--force` 才能用上游内容覆盖整根。纯插件更新会跳过 build 与 install，返回空的 build 结果。

插件更新不会触碰 agent 侧已安装的副本。vault-manager skill 必须提示 agent 在更新后重新安装。

### 5.4 删除

`source remove <plugin>`：

- 删除 source 元数据、lock 和 state 条目。
- 可选删除 `plugins/<name>/` 和 `third_party/<name>/`。
- 删除后重新校验；插件的 contained skills 从技能页、搜索和安装解析中同时消失。
- 不删除任何 agent 安装目录中的插件副本。
- 不删除安装备份。

## 6. 校验规则

### 6.1 error

- 插件根不存在或不是目录。
- 没有任何可识别的 manifest。
- manifest 不是合法 JSON。
- manifest 路径逃出插件根。
- 插件 source 声明了 `kind`、`entrypoint` 或非空 `skills`。
- 插件内技能的 `SKILL.md` 缺失、frontmatter 无效、name 与目录不符。
- 插件 source 名与现有 source 或 skill 冲突。
- 安装目标引用了插件 source 或插件内技能。

### 6.2 warning

- 多个 manifest 的 name 或 version 不一致。
- 存在 hooks。
- 存在 commands、agents 或 MCP 资产。
- 插件内技能与外部技能重名。
- manifest name 与 source 名不一致。
- 未识别的资产。
- LICENSE 缺失。

### 6.3 永不执行

校验和读取只解析 JSON、YAML、Markdown 和目录结构。VaultDesk 不执行 hooks、commands、脚本或 MCP 服务。

## 7. CLI 契约

新增：

```text
vaultdesk plugin list [--json]
vaultdesk plugin show <name> [--json]
```

`plugin list` 人类输出列：name、origin、version、manifests、skills、assets、status。

`plugin show --json` 的 `data`：

```json
{
  "name": "security-scan",
  "origin": "github",
  "repo": "owner/repo",
  "ref": "main",
  "commit": "4f3c2a1",
  "status": "current",
  "version": "0.9.4",
  "description": "Automated security review",
  "license": "Apache-2.0",
  "rootPath": "/vault/plugins/security-scan",
  "vendorPath": "/vault/third_party/security-scan",
  "vaultPath": "/vault",
  "manifests": [
    {
      "agent": "qoder",
      "path": "/vault/plugins/security-scan/.qoder-plugin/plugin.json",
      "relativePath": ".qoder-plugin/plugin.json",
      "name": "security-scan",
      "version": "0.9.4"
    }
  ],
  "assets": [
    {
      "kind": "hooks",
      "path": "/vault/plugins/security-scan/.qoder-plugin/qoder-hooks.json",
      "relativePath": ".qoder-plugin/qoder-hooks.json"
    }
  ],
  "hasHooks": true,
  "containedSkills": [
    {
      "name": "security-scan",
      "path": "/vault/plugins/security-scan/skills/security-scan"
    }
  ]
}
```

其他命令：

- `source list` 和 `source show` 包含 `shape: plugin` 条目。
- `source diff <plugin>` 返回整根 diff，`files[].path` 相对插件根。
- `source update [<plugin>]` 支持插件；纯插件更新返回 `build.skills: []`，且不产生 install 结果。
- `vault status` 的 counts 增加 `plugins` 和 `pluginSkills`。
- `target install` 遇到插件 source 或插件内技能返回 `plugin-not-installable`。
- 退出码沿用 0/1/2/3。
- `plugin` 命令全部只读，不需要 `--yes`。

## 8. 桌面

### 8.1 技能页

- 类型筛选：全部、单技能、套件、合集。
- 按 source 分组，组头显示 source 名、类型、成员数。
- suite 组内把 entrypoint 标为「入口」，其他成员正常列出。
- 行内显示类型徽章、来源、安装状态。
- 插件内技能不出现。
- 有校验 warning 的组头显示标记。

### 8.2 插件页

独立导航项「插件」，列表和详情：

- 列表：name、manifest agents、version、插件内技能数、hooks 标记、status、origin。
- 详情：description、license、插件根路径、manifest 列表、资产清单、插件内技能、上游 commit/status、warning。
- 操作：在 Finder 中显示、复制路径。
- 没有安装、启用、更新到 agent 的按钮。
- 含 hooks 时详情顶部显示持续 warning。

### 8.3 搜索与总览

- Cmd+K 搜索插件名、描述、manifest 字段和插件内技能名。
- 插件命中跳到插件页并选中。
- 插件内技能命中跳到所属插件页。
- 总览计数分开显示来源、可安装技能、插件、安装目标、待更新。

### 8.4 导入入口

- 插件页提供「导入插件」。
- 复用现有导入流程，检测到 manifest 时切换为插件预览，展示资产与 hooks warning。
- 确认后只写 vault，不安装到 agent。

## 9. agent 契约

vault-manager skill 增加插件章节，内容必须包含：

1. 发现：`vaultdesk plugin list --json` 和 `vaultdesk plugin show <name> --json`。
2. 安装源：使用 `rootPath`，不要使用 `third_party`。
3. Claude Code：按 `.claude-plugin/plugin.json` 使用 agent 自己的 plugin/marketplace 机制。
4. Codex：按 `.codex-plugin/plugin.json` 使用 `codex plugin` 或本地 marketplace；缺少 Codex manifest 时，在 agent 自己的目录生成 adapter，不回写 vault。
5. Qoder：按 `.qoder-plugin/plugin.json` 或 `.claude-plugin/plugin.json` 使用应用内本地插件导入；不写 `installed_plugins_v2.json`。
6. hooks：安装前把资产清单和 hooks 风险展示给用户，得到明确确认。
7. 更新：先 `source check`，再 `source update --yes`，然后在 agent 中重新安装。VaultDesk 不跟踪 agent 侧版本。
8. 只读：GitHub 插件不得修改 `plugins/<name>/`；需要改动时复制到 agent 自己的目录再改。

## 10. 安全

- 不执行插件中的任何代码。
- 读取 manifest 只做 JSON 解析和字段读取。
- 复制和校验拒绝路径逃逸，拒绝跟随指向插件根之外的符号链接。
- hooks 只展示、不调用。
- 插件内容进入 Git 前保留 LICENSE 和归属信息。
- 导入预览展示 hooks、commands、agents、MCP 数量，用户确认后才写盘。

## 11. 测试与验收

### 11.1 fixture

新增 `fixtures/v2-plugins/`，包含：

- Claude 插件：skills、commands、hooks、`.claude-plugin/plugin.json`
- Codex-only 插件：`.codex-plugin/plugin.json`，无 skills
- Qoder 插件：`.qoder-plugin/plugin.json`，skills、hooks
- 本地插件：无上游，单 skill
- 多 manifest 冲突插件：name/version 不一致
- 路径逃逸 fixture：符号链接指向插件根之外

### 11.2 单元与集成

- manifest 检测、资产收集、hasHooks、license。
- 插件内技能发现、重名 warning、0 技能插件。
- 本地导入、GitHub 导入、pristine 副本、lock 整根 hash。
- 更新、整根 diff、删除。
- 校验 error/warning 全部覆盖。
- 确认 hooks 未被执行：fixture 的 hook 写标记文件，测试断言标记不存在。

### 11.3 CLI

- `plugin list/show` 人类输出与 JSON 信封。
- `source list/show` 包含插件。
- `target install` 拒绝插件 source 和插件内技能。
- 只读命令不写盘。
- 真实插件 fixture 的 JSON 字段完整。

### 11.4 桌面与 E2E

- 技能页类型筛选、来源分组、suite 入口标记。
- 插件页列表、详情、hooks warning、复制路径。
- 插件内技能不出现在技能页。
- 搜索命中插件和插件内技能并正确跳转。
- 安装弹窗不列出插件内技能。
- 只读浏览前后 `git status` 不变。

### 11.5 验收清单

1. 导入含 hooks 的 Claude 插件后，插件页显示资产，CLI JSON 的 `hasHooks` 为真，hooks 未执行。
2. 导入 Codex-only 和 Qoder-only 插件后，原 manifest 原样保存，不生成 adapter。
3. 插件内技能不出现在技能页，`target install` 返回 `plugin-skill-not-installable`。
4. 0 技能插件可导入、展示、更新。
5. 插件更新能显示整根 diff，并在更新后保留 pristine 副本一致。
6. grill-me suite 的成员引用检查通过；缺失引用产生 warning。
7. 只靠 `plugin show --json` 和 vault-manager skill，agent 能定位插件根和资产。
8. 只读浏览后 `git status` 无变化。

## 12. 路线

| 版本 | 内容 |
|---|---|
| 0.6.x | 技能页类型筛选与来源分组；suite 成员引用 warning |
| 0.7 | plugin source、导入、存储、校验、`plugin list/show`、插件页、CLI JSON、skill 文档、fixture |
| 0.8 | 插件更新、整根 diff、搜索、总览、安装 guard、边界测试 |
| 0.9 | E2E、DMG、文档、硬化 |
| 1.0 | 收口、延期 0.6 项、发布审计 |

## 13. 决策记录

| 编号 | 决策 |
|---|---|
| 21 | 插件按 `shape: plugin` 的 source 存储，复用来源、更新和 lock 流程 |
| 22 | 插件完整复制进 vault，保证 vault 自包含 |
| 23 | 插件内技能可搜索、可展示，不可安装 |
| 24 | VaultDesk 不生成 marketplace、adapter manifest，不写 agent registry |
| 25 | 插件页不显示 agent 侧 installed/enabled |
| 26 | 插件安装交给 agent，vault-manager skill 是接口 |
| 27 | OpenCode 不在插件适配范围 |
| 28 | suite 成员关系用校验 warning 维护，不生成额外技能 |

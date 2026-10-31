<p align="center">
  <img src="docs/assets/icon.png" alt="VaultDesk" width="96" height="96">
</p>

<h1 align="center">VaultDesk</h1>

<p align="center">
  <strong>本地优先的桌面应用与 CLI，用来管理由 Git 托管的 agent 技能库。</strong><br>
  浏览技能、审阅上游差异、安装可重建的副本，并登记插件、MCP 服务与工具托管的技能，全程不运行它们。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/coderWang404/vaultdesk/actions/workflows/ci.yml"><img src="https://github.com/coderWang404/vaultdesk/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="许可证：Apache-2.0"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey.svg" alt="平台：macOS 13+">
  <img src="https://img.shields.io/badge/node-22%2B-339933.svg" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/version-1.2.7-brightgreen.svg" alt="版本 1.2.7">
</p>

<p align="center">
  <img src="docs/assets/desktop-overview.png" alt="VaultDesk 桌面应用显示 vault 概览" width="100%">
</p>

> [!NOTE]
> VaultDesk 1.2.7 已在 [GitHub Releases](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.7) 提供 Apple Silicon DMG。构建采用 ad-hoc 签名，未公证；CLI 随应用内置，不依赖源码目录或额外 Node.js。

## 目录

- [为什么需要 VaultDesk](#为什么需要-vaultdesk)
- [它管理什么](#它管理什么)
- [桌面应用](#桌面应用)
- [截图](#截图)
- [安装](#安装)
- [快速开始](#快速开始)
- [审阅更新](#审阅更新)
- [CLI](#cli)
- [工具卡与 MCP](#工具卡与-mcp)
- [外部技能](#外部技能)
- [Vault 布局](#vault-布局)
- [架构](#架构)
- [安全模型](#安全模型)
- [测试](#测试)
- [状态](#状态)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 为什么需要 VaultDesk

Agent 技能写起来很快，长期维护却很难。它们被复制到多个 agent 目录，就地修改，几个月后已经和最初的仓库对不上。VaultDesk 把控制权交还给仓库：仓库是唯一事实来源，每个安装位置都只是一份可以校验、可以重建的副本。

项目建立在四条规则上：

1. **仓库是唯一事实来源。** 安装目标是产物，不是主副本。
2. **先审阅，再修改受管内容。** 网络拉取发生在 vault 之外；修改技能、插件或目标前会给出预览。来源检查会单独记录本机状态。
3. **一个路径只有一个所有者。** VaultDesk 管理导入的技能、插件目录及明确登记的文件目标；外部工具和工具托管技能由其安装器或更新器负责，VaultDesk 只登记或观察。Agent 注册、启用和运行依赖与文件分发分别处理。
4. **一个核心，两个入口。** 桌面应用和 CLI 共用同一套 TypeScript 核心、规则与 JSON 契约。

VaultDesk 面向同时使用多个编码 agent、并且维护自己技能库的人。它管理文件和记录；具体 agent 的插件注册与启用仍由该 agent 完成。

## 它管理什么

| 资产 | 存放位置 | VaultDesk 会做 | VaultDesk 不会做 |
| --- | --- | --- | --- |
| 技能 | `skills/`、`packages/` | 构建、安装、校验、恢复、编辑本地技能、fork GitHub 技能 | 在 fork 之前修改 GitHub 原文 |
| 插件 | `plugins/`、`third_party/`、`plugin_targets` | 登记整个目录、校验资产、显示差异、更新并分发到明确登记的文件目标 | 向 agent 注册或启用插件、适配清单、执行 hooks、脚本或 MCP 服务 |
| 工具卡 | `tools/<name>.yml` | 记录官方链接、安装方式、运行入口和按场景声明的依赖；按需验证本机环境 | 下载、安装、运行工具或写 agent 配置 |
| 外部技能 | `external-skills/<name>.yml` 与工具自己的路径 | 记录所有者和路径、可选固定 hash、只读观察状态、把技能从 vault 转出 | 安装、更新、运行或写入外部路径；写 agent 配置 |
| 安装目标 | `vault.yml`、`.vault-managed` 标记 | 区分槽位、备份、复制、校验、恢复 | 删除未托管的内容 |

四类资产的边界是刻意分开的：

- **技能**由 VaultDesk 管理。它们构建到 `build/skills/`；受管分发将内容投影到 `~/.agents/skills`，再逐技能链接到已登记的 agent 目标，不支持链接时使用受跟踪的副本。
- **插件**以 `shape: plugin` 的 source 形式登记。VaultDesk 保存、校验和更新整个目录，并可分发到登记的插件文件目标；agent 仍须用自己的插件机制注册、启用和加载该目录。
- **工具卡**记录的是 VaultDesk 完全不托管的东西：MCP 服务、CLI、桌面工具，以及 REA 这类包含多个工具的套件。Agent 读取卡片，然后从官方渠道自行安装。
- **外部技能**由负责安装或改写其文件的工具或管理器拥有。VaultDesk 记录路径、可选固定 hash，并报告漂移或冲突，但从不写这个路径。只读的署名或完整性检查本身不代表工具拥有该目录。

同一产品可以同时提供技能、CLI、MCP 和插件。归属、技能文件分发、运行依赖、agent 内的注册或启用是四件不同的事：关联的工具卡让前几项分别可见；MCP 或插件是否已在具体 agent 中启用仍须按该 agent 的规则核对，不能由文件存在或版本检查推断。

### Agent 如何完成安装闭环

先读取 `agent catalog --json`，沿用用户已确定的归属和安装授权；仅在目标路径、所有者或范围尚不明确时提问。

| 资产 | 文件与安装 | 验收与更新 |
| --- | --- | --- |
| 受管技能 | 预览并应用 `target install <技能> --dest <目录> --id <目标>`，随后运行 `source distribute <来源> --yes` 建立共享主库与受管链接。 | 用 `target verify <目标>` 验证文件，再检查关联工具依赖和 agent 技能发现；远程 auto 来源持续同步开启更新的登记目标。 |
| 受管插件目录 | 先读 `plugin show <名称> --json`；用 `plugin target add <名称> --id <目标> --dest <父目录>` 登记稳定路径，再运行 `source distribute <名称> --yes`；副本位于 `<父目录>/<名称>`。 | 用 `agent catalog --json` 查看文件状态，再按 agent 的规则注册、启用并在 agent 内验证。远程 auto 来源同步登记的文件目标；由 agent 安装器改写的缓存目录不再交给 VaultDesk 管理。 |
| 工具卡：MCP、CLI、应用或外部插件 | 阅读 `tool show <名称> --json`，在用户请求范围内按当前官方方法安装并接入目标 agent。 | 执行相应 `tool verify`，再用 agent 状态检查或小型端到端任务验收。二进制更新使用工具的官方更新器；卡片本身不安装或更新工具。 |
| 工具托管的外部技能 | 阅读 `external show <名称> --json`，使用其所有者的安装器或更新器；同一路径不再执行 `target install`。 | 所有者更新后观察 hash/status 并核对 agent 发现；有授权时接受新版本并重新固定 hash。 |

## 桌面应用

桌面应用是 Electron + React 外壳，内部调用共享核心。它提供：

- 多 vault 标签页，每个 vault 有自己的锁与状态
- 概览、来源、技能、插件、MCP、工具、目标、Git 与设置页面
- 跨已打开 vault 的 `Cmd+K` 元数据搜索
- 上游检查、逐文件差异、审阅后应用的更新
- 本地文件夹、GitHub 仓库、技能、包与插件目录的导入流程
- 安装预览、槽位分类、带时间戳的备份、校验与恢复
- 只针对 VaultDesk 改动路径的显式 Git 提交与推送
- 插件的导入与更新审阅页，以及工具卡与 MCP 服务的只读记录页
- 按所有者分组的外部技能，带筛选与只读检查器

桌面界面目前是中文。CLI 输出与 JSON 信封使用英文。文档中英并存：本 README 有[简体中文版](README.zh-CN.md)，`docs/` 下的设计说明也是中英文都有。

## 截图

| MCP 记录 | 外部工具卡 |
| --- | --- |
| ![MCP 页面显示一台已记录的 MCP 服务](docs/assets/desktop-mcp.png) | ![工具页显示两张已记录的外部工具卡](docs/assets/desktop-tools.png) |

两张截图使用由公开 fixture 构建的演示 vault，不包含任何个人技能内容。

## 安装

### 环境要求

- **桌面应用：** macOS 13 或更新版本，Apple Silicon 或 Intel
- **构建：** Node.js 22+、pnpm 11.5.2、`PATH` 中可用的 Git
- **CLI：** Node.js 22+；CI 也会在 Ubuntu 上构建和测试

Apple Silicon 桌面版可从 [GitHub Releases](https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.7) 下载。首次打开后，在“设置 → 命令行与 MCP”点击“安装命令行工具”；它会把随应用提供的 CLI 安全安装到 `~/.local/bin/vaultdesk`。Intel 用户也可从源码构建桌面版。

### 从源码运行桌面应用

```bash
git clone https://github.com/coderWang404/vaultdesk.git
cd vaultdesk
corepack enable
pnpm install
pnpm dev
```

打包一个临时签名的 DMG：

```bash
pnpm package:mac
# release/VaultDesk-1.2.7-<arch>.dmg
```

构建产物使用 ad-hoc 签名，没有公证。第一次启动时右键点击应用并选择 **打开**，或者在 **系统设置 → 隐私与安全性** 中放行。

### 从源码使用 CLI

```bash
pnpm build:packages
node packages/cli/dist/index.js --help
```

源码模式需要 Node.js 22+。正式 DMG 的 CLI 不需要这一步，使用应用设置中的安装按钮即可。

## 快速开始

创建一个 vault，导入本地技能，构建并安装到 agent 目录：

```bash
export VAULT=~/Vaults/skills

vaultdesk vault init "$VAULT" --git --name skills --yes
vaultdesk source add ~/src/my-skill --vault "$VAULT" --yes
vaultdesk vault validate --vault "$VAULT"
vaultdesk build --vault "$VAULT" --yes
vaultdesk target install my-skill --vault "$VAULT" \
  --dest ~/.claude/skills --id claude-code --yes
vaultdesk target verify claude-code --vault "$VAULT"
```

`~/src/my-skill` 是包含 `SKILL.md` 的目录。`target install` 会创建或复用名为 `claude-code` 的目标，把 `--dest` 换成你的 agent 实际读取的目录即可。

打开桌面应用，用 `+` 按钮添加同一个 vault。应用和 CLI 可以操作同一个 vault，但同一时间只应有一个桌面实例打开它。

## 审阅更新

```bash
vaultdesk source check --vault "$VAULT"
vaultdesk source diff some-source --vault "$VAULT"
vaultdesk source update some-source --vault "$VAULT" --yes
```

`source check` 查询远端提交，并把检查结果写入被 Git 忽略的 `.vault/state.json`；它不修改 Git 跟踪的 vault 内容。`source diff` 会在 vault 外缓存上游内容，并显示逐文件的 unified diff。`source update` 先预览，只有传入 `--yes` 才应用；桌面应用会把同样的预览放在确认对话框后面。

`source update` 刷新 Vault 内容，默认不分发。完成后用 `source distribute <来源> --yes` 刷新共享技能主库与开启同步的登记技能目标，或登记的插件文件目标；有意修改本地来源后也使用这条命令分发。自动同步则将远程更新和受管分发放在同一来源事务中。两种方式都不会接管 agent 安装器拥有的插件目录，也不会替 agent 启用插件。

## 自动同步

安装在 `/Applications/VaultDesk.app` 的 macOS 版本默认注册用户级后台任务：登录后、恢复网络后以及每小时检查所有仍登记的 vault；应用窗口关闭后仍可运行。可在「设置」中暂停、手动同步、查看活动记录并调整间隔与备份保留期。开发版和挂载 DMG 中的应用不会注册该后台任务。

远程 Git 来源默认使用 `auto`，也可逐来源切换为人工审核或暂停。技能自动更新按来源同步 Vault 内容、`~/.agents/skills` 主库与已登记目标；插件自动更新同步插件目录与明确登记的插件文件目标。技能目标优先使用逐技能符号链接，不支持时复制；`install_after_update=false` 的目标保持暂停。手动修改、未知归属或同名冲突会阻止该来源并保留原文件。成功后仅提交本轮改动并普通推送；推送失败保留本地提交并提示，不强推。新增上游技能等待接纳，上游删除不会自动删掉现有副本。

CLI 可用 `source pending <来源>` 查看待接纳技能，`source adopt <来源> --path <上游相对路径> --yes` 明确接纳，`source distribute <来源> --yes` 初始化或刷新受管分发。插件目标可通过 `plugin target add|list|remove` 登记和管理。

手动更新已让 `auto` 来源处于最新版本时，下次自动检查也会补发缺失或过时且未经手改的受管副本。只修复分发状态时不提交其他 Vault 改动；review/frozen 来源和暂停目标继续保留原状。

## CLI

```text
vaultdesk <group> <action> [arguments] [options]
```

| 命令组 | 操作 |
| --- | --- |
| `vault` | `list`、`status`、`validate`、`init`、`migrate` |
| `source` | `list`、`show`、`check`、`diff`、`update`、`auto-sync`、`mode`、`pending`、`adopt`、`distribute`、`add`、`remove`、`fork` |
| `plugin` | `list`、`show`、`target add/list/remove` |
| `tool` | `list`、`show`、`verify`、`add` |
| `external` | `list`、`show`、`add`、`remove`、`adopt` |
| `target` | `list`、`install`、`remove`、`verify`、`restore` |
| `build` | 重建 `build/skills/`、`build/tools.json` 与 `build/external-skills.json` |
| `presets` | `list`、`verify` |
| `agent` | `skill`、`catalog` |
| `mcp` | `serve`（只读 stdio 服务） |
| `git` | `status`、`commit`、`push` |

纯查询命令不写盘。`source check` 虽不修改受管内容，仍会写入本机检查状态；修改受管内容的命令默认打印预览，传入 `--yes` 才落盘。全局选项包括 `--vault <path>`、`--json`、`--yes`、`--help` 与 `--version`。

CLI 命令支持 `--json`，在 stdout 返回一个信封；`mcp serve` 则将 stdout 留给 MCP JSON-RPC 协议：

```json
{
  "schema": 1,
  "command": "tool.list",
  "data": [],
  "warnings": [],
  "errors": []
}
```

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 操作失败 |
| `2` | 用法或校验错误 |
| `3` | 网络或认证错误 |

交互提示写到 stderr，stdout 始终可以解析。GitHub 相关操作设置 `GIT_TERMINAL_PROMPT=0`，缺少凭据时直接失败，不会挂起等待输入。

## 工具卡与 MCP

工具卡记录一个外部工具。它不是 source，VaultDesk 也不会安装它。

```yaml
schema: 1
name: fetch-mcp
kind: mcp
title: Fetch MCP
summary: A recorded Python MCP server that fetches and converts web pages.
homepage: https://github.com/modelcontextprotocol/servers
docs: https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
install:
  - label: Install
    command: uvx mcp-server-fetch
run: uvx mcp-server-fetch
requirements:
  - uv
tags: [mcp, fetch]
notes: Recorded for display only; VaultDesk never installs, starts, or registers this MCP server.
```

`kind` 描述分发形态，协议信息放在 `tags` 里。

| `kind` | 适用对象 | 示例 |
| --- | --- | --- |
| `plugin` | 以 agent 插件形式分发的多工具套件 | REA |
| `mcp` | MCP 服务 | Filesystem、fetch |
| `cli` | 独立命令行工具 | 一个构建辅助脚本 |
| `app` | 桌面或图形工具 | 一个本地编辑器 |

卡片存放在 `tools/<name>.yml`。桌面 **工具** 页显示全部卡片；**MCP** 页包括 `kind: mcp` 和带 `mcp` 标签的卡片，涵盖插件与 CLI 形态。`tool list --kind mcp` 仅筛选独立 MCP 卡；查看全部具备 MCP 能力的工具时，应使用 catalog 的 `capabilities` 或全部工具卡：

```bash
vaultdesk tool list --vault "$VAULT" --json
vaultdesk tool list --vault "$VAULT" --kind mcp --json
vaultdesk tool show fetch-mcp --vault "$VAULT"
```

用 CLI 记录卡片。命令先预览，传入 `--yes` 才写入：

```bash
vaultdesk tool add fetch-mcp --vault "$VAULT" --kind mcp \
  --title "Fetch MCP" \
  --summary "A recorded Python MCP server that fetches and converts web pages." \
  --homepage https://github.com/modelcontextprotocol/servers \
  --docs https://github.com/modelcontextprotocol/servers/tree/main/src/fetch \
  --install-command "install=uvx mcp-server-fetch" \
  --run "uvx mcp-server-fetch" --requirement uv --tag mcp --tag fetch --yes
```

`vaultdesk build` 会写出 `build/tools.json`，这是全部卡片的确定性索引，不含时间戳。Agent 可以读 YAML、读 JSON 索引，或者调用 `tool show --json`，然后按自己的规则完成安装与注册。

### 文件分发与运行环境分别验证

`target verify` 只验证 VaultDesk 受管技能文件是否齐全。关联的工具卡可声明 Python 和 Node.js 版本、Python 包版本、PATH 命令、路径、环境变量是否存在，以及 Vault 内依赖文件的 SHA-256 基线。`profiles` 将 PDF、旁白等可选工作流与通用依赖分开；不选场景只查通用项，不能据此推断所有工作流可用。没有 `checks` 的卡片显示“未配置”，而不是“就绪”。

```yaml
related_skills: [ppt-master]
checks:
  - id: python
    kind: python
    label: 支持的 Python
    executable: python3
    min_version: "3.10"
    max_version_exclusive: "3.15"
  - id: svg-package
    kind: python-package
    label: SVG 转 PPTX 依赖
    interpreter: python3
    requirement: skia-pathops>=0.9.2
    profiles: [svg-pptx]
```

未填写覆盖路径时，VaultDesk 优先使用 `~/miniconda3/bin` 中的 Miniconda base Python，再查找其他受信任的 Conda、系统、Homebrew 和 pyenv 解释器；报告会显示实际使用的路径和版本。CLT 的 Python 由 Apple 随整套工具链维护，没有受支持的单独升级入口。运行 `vaultdesk tool verify ppt-master-runtime --profile svg-pptx --python /absolute/path/to/venv/bin/python --json`，可用隔离环境覆盖本次检查的解释器。桌面工具页也提供相同的手动入口。Python 检查会启动选定解释器执行 VaultDesk 内置的、限时的依赖查询；不会执行卡片中的安装或运行命令，也不会读取环境变量的值。检查通过只说明该解释器中的声明依赖已满足；实际运行仍需让工具使用同一个解释器或将其 `bin` 放在 PATH 前。VaultDesk 不会替用户改动全局 Python、自动安装包或注册 MCP。

VaultDesk 提供只读 MCP server，让支持 MCP 的 agent 直接查询已登记 Vault。用 `vaultdesk mcp serve` 注册到 agent 客户端；存在多个 Vault 时加 `--vault <path>`。服务包含 Vault 列表、资产目录、搜索和单项工具卡查询，会脱敏常见凭据样式；它不执行卡片命令、不检查记录的工具版本、不启动或健康检查第三方 MCP，也不自动写 agent 配置。仍不要在卡片里放 token、密钥或私有 URL。

## 外部技能

有些工具会随包提供技能目录，并在 setup 或升级时改写它。如果 vault 也管理同一个路径，两个写入方可能互相覆盖。外部技能卡记录所有者和路径，只报告状态，从不写内容。单纯的只读校验不代表工具拥有该目录。

```yaml
schema: 1
name: reverse-engineer-anything
owner: rea-agents
path: ~/.agents/skills/reverse-engineer-anything
version: "49"
expected_hash: sha256:...
related_tool: rea
description: Reverse engineering workflows bundled with the REA tool.
notes: Owned by rea-agents; re-pin after a tool update.
```

`path` 是绝对路径或以 `~/` 开头，并且必须位于 vault 之外。`name` 不能与受管技能重名。一个路径只有一个所有者：如果路径上已有 `.vault-managed` 标记，VaultDesk 会拒绝记录。`expected_hash` 可选，用于固定内容快照；卡片中的 `version` 由用户记录，VaultDesk 只从技能 `SKILL.md` 的 `metadata.version` 读取观察版本，不查询工具的实际安装版本。`related_tool` 指向一张工具卡的名称。

| 状态 | 含义 |
| --- | --- |
| `ok` | 已固定 hash，且与目录一致 |
| `observed` | 技能可读取，尚未固定 hash |
| `drift` | 固定的 hash 与当前内容不一致 |
| `missing` | 路径不存在 |
| `invalid` | 路径存在但没有 `SKILL.md` |
| `conflict` | 路径上有 `.vault-managed` 标记，被另一个所有者占用 |

计算目录 hash 时，VaultDesk 会忽略自己的元数据、`.vault-managed`、`.DS_Store`、`.git`、`node_modules` 和 `.vault`。展示时会读取技能描述和 `metadata.version`。`vault validate` 会把以下情况报为错误：路径位于 vault 内、安装目标引用了外部技能、卡片不合法、名称与文件名不一致、名称重复。漂移、路径缺失和残留标记属于警告。

```bash
vaultdesk external list --vault "$VAULT"
vaultdesk external show reverse-engineer-anything --vault "$VAULT"

vaultdesk external add reverse-engineer-anything --vault "$VAULT" \
  --owner rea-agents --path ~/.agents/skills/reverse-engineer-anything \
  --related-tool rea --pin --yes

vaultdesk external remove reverse-engineer-anything --vault "$VAULT" --yes
```

`add` 先预览，传入 `--yes` 才写入。它会拒绝受管技能的名称和 vault 内的路径；路径尚不存在时给出警告，路径不存在又同时传入 `--pin` 则直接报错。工具更新自带技能后，重新执行 `add <name> --force --pin` 接受新的快照。

`adopt` 把一个由 vault 管理的技能交给已经拥有该路径的工具：

```bash
vaultdesk external adopt reverse-engineer-anything --vault "$VAULT" \
  --owner rea-agents --path ~/.agents/skills/reverse-engineer-anything \
  --related-tool rea --pin --yes
```

它只接受 vault 之外、恰好包含一个技能的 standalone source，并且路径上没有标记，或者标记属于当前 vault。执行时会删除 source 元数据、lock 条目、安装目标引用、受管内容、vendor 副本和本 vault 的标记，然后写入外部技能卡。属于其他 vault 的标记会阻止操作。`external remove` 只删除卡片，从不碰外部路径。

### 工具到来时如何推荐归属

收录新工具或其技能之前，先检查路径和工具本身，沿用用户已有的归属决定。只有归属尚未确定时才给出推荐并提问；同一操作的既有授权不需要重复确认。

- **工具自己管理**（安装器或更新器拥有并改写技能路径）：推荐外部技能卡。REA 是默认例子。只读的署名或完整性检查本身不意味着外部归属。
- **应该由 VaultDesk 管理**：推荐普通 source。
- **另一个管理器负责**：推荐保留原状；需要跟踪状态时，记一张以该管理器为 owner 的外部卡。
- **需要独立副本**：推荐 fork 到新路径和新名称。

把依据和推荐说清楚，例如：「REA 的 setup 会重写这个技能，建议按外部托管记录，owner 为 rea-agents。」用户已确定所有者时照办。一个路径只有一个所有者。

`vaultdesk build` 会写出 `build/external-skills.json`，为每张卡片记录 `observed_hash`、`observed_version` 与 `status`。Agent 读取卡片、索引或 `external show --json`，再自行安装和更新工具。

Agent 发现入口：`vaultdesk vault list --json` 只列出 VaultDesk 桌面端明确登记过的 Vault，不扫描用户目录；`vaultdesk agent catalog --json` 与只读 MCP server 会汇总来源归属、远程更新策略、技能主库与登记目标的 marker/hash、插件目标、工具卡安装/运行说明以及外部技能 owner。工具的 `installState`、`enabledState`、`connectedState` 和技能的 `agentLoaded` 在没有对应 agent 探针时保持 `unknown`，文件已分发不等于 agent 已加载或 MCP 已连接。MCP server 由用户在具体 agent 客户端显式登记，VaultDesk 不代写客户端配置。

## Vault 布局

VaultDesk 支持 v2 布局，可以打开、校验并迁移 v1 vault。

```text
vault.yml                  # vault 元数据、默认值、安装目标
vault.lock                 # 上游 commit 与内容 hash
sources/<name>.yml         # source 元数据：origin、ref、更新方式
skills/<name>/SKILL.md     # 本地技能
packages/<pkg>/skills/...  # 导入的多技能包
plugins/<name>/            # 完整插件目录
tools/<name>.yml           # 只记录、不安装的外部工具卡
external-skills/<name>.yml # 工具托管技能的只读记录卡
third_party/<name>/        # GitHub 插件目录的原始副本
build/skills/<name>/       # 生成的技能输出
build/tools.json           # 生成的工具索引
build/external-skills.json # 生成的外部技能观察索引
.vault/state.json          # 本机状态，已被 gitignore
```

VaultDesk 用 `.vault-managed` 标记受管技能副本与主库目录，用 `.vaultdesk-plugin-managed` 标记插件文件目标；逐技能链接记录在主库标记中。手动技能安装可备份明确选定的未托管槽位；自动分发遇到未知归属或手动修改会停止，不会覆盖。

## 架构

```text
┌──────────────────────────────┐
│ Desktop renderer (React)     │  无 Node 集成
└──────────────┬───────────────┘
               │ 类型化 IPC，用 zod 校验
┌──────────────▼───────────────┐
│ Electron main process        │  文件系统、Git、网络
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ packages/core                │  vault 模型、导入、插件、
│                              │  工具卡、外部技能、
│                              │  搜索、构建、安装
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ packages/schema              │  zod schema 与 IPC 契约
└──────────────────────────────┘
               ▲
               │
┌──────────────┴───────────────┐
│ packages/cli                 │  vaultdesk CLI、JSON 信封
└──────────────────────────────┘
```

仓库结构：

| 路径 | 用途 |
| --- | --- |
| `apps/desktop/` | Electron 应用、React 渲染层、preload 桥 |
| `packages/cli/` | `vaultdesk` 命令行接口 |
| `packages/core/` | vault 模型、导入、插件、工具卡、外部技能、构建、安装、Git |
| `packages/schema/` | Zod schema 与共享 IPC 类型 |
| `agent-skill/vaultdesk/` | 随应用和 CLI 分发的 agent 技能 |
| `fixtures/` | 公开的 v1 与 v2 测试 vault |
| `tests/` | Vitest 集成测试与 Playwright Electron E2E |
| `docs/` | 设计文档、插件规则、发布说明与互操作说明 |

渲染层没有 Node 权限。文件系统、Git 与网络操作全部由主进程执行，入口是经 zod 校验的 IPC。VaultDesk 不启动本地 HTTP 服务。外部链接使用系统浏览器打开。

## 安全模型

- **手动操作先预览。** CLI 手动写入需要 `--yes`，应用需要确认对话框；仅选为 `auto` 的远程来源按已登记的目标自动同步。
- **在 vault 之外拉取。** 上游数据先落到缓存，预览被接受之前不会写入 vault。
- **GitHub 内容在 fork 前只读。** 来自 GitHub 的技能不能就地编辑。
- **插件文件可分发，插件代码不执行。** 只管理明确登记的文件目标；VaultDesk 不运行插件目录内的 hooks、脚本、命令或 MCP 服务，也不生成市场清单或适配器清单。
- **工具卡记录运行条件。** 不下载、不安装、不执行工具卡命令，也不向 agent 注册；用户主动验证时，可运行内置的限时 Python 依赖查询。
- **外部技能属于它的工具。** VaultDesk 读取并计算路径 hash，报告漂移，从不写入。`adopt` 只删除 vault 自己的内容和本 vault 的标记。
- **一个路径一个所有者。** 受管技能与外部技能不能共用路径；其他所有者的标记会阻止 `adopt`。
- **自动同步不覆盖未托管目录。** 手动安装可在明确确认后备份旧目录；自动同步遇到未知归属或手动修改时暂停受影响来源。自动分发备份最多保留最近 3 次或 7 天。
- **自动提交先做敏感内容检查。** 检出高置信度凭据路径、私钥、Python 缓存或 token 形态时，会在提交推送前暂停来源，只报告路径和风险类型。这能降低误上传风险，但不是完整的泄密检测保证。
- **Git 暂存是显式的。** VaultDesk 只提交自己改过的路径，从不执行 `git add -A`，并拒绝 vault 之外或 `.git` 之下的路径。
- **校验的范围是明确的。** `target verify` 证明预期文件存在且 hash 一致，不能证明某个 agent 已经加载了技能。
- **密钥不进入 vault。** 不要在 vault、插件记录或工具卡中存放 token、密钥或私有 URL。

## 测试

```bash
pnpm typecheck
pnpm test             # 单元与集成测试
pnpm test:e2e         # CLI + 桌面 Playwright 套件
pnpm test:e2e:cli
pnpm test:e2e:desktop
pnpm test:e2e:dmg     # 打包 DMG、挂载并验证应用
```

E2E 套件会启动真实的 Electron 应用和构建后的 CLI，面向隔离的临时 vault、本地裸 Git 远端，以及用于认证和网络退出码的本地 HTTP 服务。它们从不接触真实 vault。无障碍场景会用 axe-core 扫描每个视图，包括外部技能检查器。失败的运行会把工作目录保留在 `$TMPDIR` 并打印路径。

CI 会运行类型检查、单元与集成测试，并在 macOS 和 Ubuntu 上构建。macOS 任务还会运行 Electron 冒烟测试、上传截图、打包 DMG 并作为构建产物上传。

场景矩阵和有意的覆盖边界见 [tests/e2e/README.md](tests/e2e/README.md)。
发布验收结果另记于 [docs/QA-CURRENT.md](docs/QA-CURRENT.md)；[docs/RELEASE.md](docs/RELEASE.md) 保留当前及历史版本的发布记录。

## 状态

| 范围 | 状态 |
| --- | --- |
| 桌面应用与 CLI | 1.2.7；Apple Silicon DMG 已发布，CLI 随应用提供并可从设置安装 |
| 工具卡与 MCP 页面 | v1.2.3 加入运行环境检查和跨类别 MCP 展示；v1.2.4 默认优先使用 Miniconda base；v1.2.5 增加 agent catalog 与只读 MCP 发现入口 |
| 外部技能记录 | 已包含在 v1.2.0 |
| DMG | Apple Silicon 版本已发布，ad-hoc 签名，未公证 |
| GitHub Release / Homebrew / npm | GitHub Release 已发布；Homebrew 与 npm 未发布 |
| 来源自动同步 | 已在 macOS 安装版提供，支持逐来源自动/审核/暂停 |
| Windows 与 Linux 桌面端 | v1.2.7 未包含 |

桌面应用在 1.2.7 只支持 macOS。源码 CLI 已在 macOS 和 Ubuntu 上测试；DMG 内置 CLI 使用 Electron 自带 Node 运行时。

## 参与贡献

欢迎提交 issue 和 pull request。改动行为之前，请先读：

- [docs/DESIGN.md](docs/DESIGN.md)：数据模型、CLI 契约与安全规则
- [docs/PLUGINS.md](docs/PLUGINS.md)：插件识别、校验与更新规则
- [agent-skill/vaultdesk/SKILL.md](agent-skill/vaultdesk/SKILL.md)：面向 agent 的契约

保持归属边界清楚。VaultDesk 存储、校验受管技能与插件文件，并分发到登记目标；agent 启用、外部工具安装及工具托管路径仍由其所有者负责。VaultDesk 不执行插件或工具命令、不生成市场清单或适配器清单，也不写 agent 配置。新增资产类别时，依据用户请求和已有授权确定归属；仅澄清尚未确定的所有者或范围。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e
```

小而聚焦、并带有对应测试的 pull request 最容易审阅。修改行为时，请同步更新 [README.md](README.md) 与本文件。

## 许可

Apache-2.0。见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

本仓库包含工具、测试、fixture 与公开文档，不包含维护者的个人 vault 或第三方技能内容。

<p align="center"><sub>Copyright © 2026 coderWang404</sub></p>

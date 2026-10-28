# VaultDesk 设计定稿

- 状态：0.1–1.0 已实现；截至 2026-10-28，1.0.0 已构建并通过本地 DMG 验收，尚未发布；工具卡、MCP 与外部技能记录层已实现但未随版本发布；插件登记设计见 `docs/PLUGINS.md`，SkillDeck 互操作结论见 `docs/SKILLDECK-INTEROP.md`，发布状态与 Homebrew/公证评估见 `docs/RELEASE.md`
- 日期：2026-10-28
- 产品名：VaultDesk
- CLI：`vaultdesk`
- 仓库：`github.com/coderWang404/vaultdesk`
- npm 包：`@coderWang404/vaultdesk`
- 许可证：Apache-2.0，版权人 `coderWang404`
- 平台：macOS（1.0 验收产物为 Apple Silicon；Intel 可从源码构建）
- 技术栈：Electron + React + TypeScript，pnpm monorepo

## 实现状态（2026-10-28）

> 1.0 的状态记录保留在下方；工具卡与外部技能记录层是本轮新增、尚未随版本发布的功能。

- 工具卡记录层（未发布）：`tools/<name>.yml` 独立记录、schema 与校验、`tool list/show/add`、`tool list --kind`、`build/tools.json`、搜索、桌面只读工具页与 MCP 页、随 CLI 分发的 `vaultdesk` skill 契约已实现。
- 外部技能记录层（未发布）：`external-skills/<name>.yml` 卡片、只读观察（路径、目录哈希、description、`metadata.version`、`.vault-managed` 标记）、`external list/show/add/remove/adopt`、`build/external-skills.json`、搜索、技能页外部托管分组与只读 inspector、校验规则已实现。VaultDesk 不写入外部路径。
- 0.1 只读浏览、校验、上游检查与 diff、迁移预览、多 tab、跨库 Cmd+K 已实现。
- 0.2 迁移写盘（独立分支、要求干净工作区、提交不推送）已实现。
- 0.3 安装、目标管理、槽位判定、备份/恢复、文件级验证已实现。
- 0.4 本地技能编辑与 GitHub fork-to-local 已实现。
- 0.5 本地目录与 GitHub 来源导入、standalone/collection/suite 检测已实现。
- 0.6 Git 提交/推送（仅限应用改动路径）与跨库元数据搜索已实现。延期项在 1.0 前补齐：preset `verify_command` 仅显式确认后执行、输出限时截断且只展示不判定 agent 是否加载；打包 `vaultdesk` agent skill 并提供 `vaultdesk agent skill`；SkillDeck 互操作完成源码级复核，结论是不读写 `.skill-lock.json`。
- 0.6.x 技能页类型筛选与来源分组、suite 成员引用 warning 已实现。
- 0.7 插件登记已实现：`shape: plugin` source、整根导入与存储、manifest/资产/contained skills 校验、`plugin list/show`（含稳定 agent 契约）、插件页、插件搜索、安装 guard、fixture 与桌面 E2E。hooks 只展示、不执行。
- 0.8 已实现：插件整根 diff、review-before-apply 更新、source 元数据刷新、conflict/--force guard、纯插件更新跳过 build 与 install、删除清理；搜索与总览、安装 guard 同前。
- 验证证据：75 个 vitest 测试通过（15 个文件）；tool 测试覆盖卡片写入与 force 覆盖、字段校验、文件名/重复/关联技能检查、确定性 `build/tools.json`、搜索命中（含 `toolKind`）、`tool list --kind` 过滤与非法 kind，以及安装命令不被执行；外部技能测试覆盖只读观察、drift/missing/marker 冲突、路径与命名冲突拒绝、目标引用拒绝、搜索索引、adopt 全流程、拒绝他库标记，以及 CLI add/show/list/remove/adopt 与路径/名称校验；插件集成测试覆盖整根 diff、更新、force guard、content_path 与删除清理；preset 测试覆盖 verify_command 解析、显式确认、退出码/输出捕获、超时杀进程与 64KB 截断；CLI 与桌面 E2E 覆盖插件导入、检查、diff、更新、删除与 hooks 不执行，工具卡与 MCP 页展示、复制、跳转、搜索路由与 v1 空状态，外部技能卡片、过滤、inspector、搜索路由与源文件不变，以及 agent skill、验证命令预览/执行；各视图 axe 扫描 0 violations；Electron 生产构建 smoke 通过并产出截图；`VaultDesk-1.0.0-arm64.dmg`（125,189,367 字节，SHA-256 `d1b76e4f4c7ce31617240b103aea843093f09718ffca956626d643271bfa47c6`）通过 `hdiutil verify`，ad-hoc 签名为有效 bundle 签名（`codesign --verify --deep --strict` 通过，Identifier 为 `com.coderwang404.vaultdesk`），包内 agent skill 存在，安装后的应用可启动、校验并编辑 v2 fixture，应用退出后编辑仍在。
- 真实 v1 仓库只读验收：6 个来源、27 个技能、8 个安装目标，`vault validate` 无错误；迁移预览生成 9 个写入与 5 个删除；验收前后 `git status` 完全一致，未创建 `.vault/`。该仓库因已有未跟踪文件而 `cleanWorktree: false`，迁移按设计被阻止。
- 插件边界：VaultDesk 只存储、校验、展示；不安装、不启用、不适配、不生成 marketplace/adapter manifest、不写 agent 注册表。agent 通过随 CLI 提供的 `vaultdesk` skill 自行安装。


## 1. 产品定义

VaultDesk 是一个本地优先的 skill / plugin 资产管理器。它把一个以 Git 仓库为载体的技能库变成可浏览、可校验、可更新、可安装的桌面应用，同时提供同一套核心能力的 CLI。

技能与插件采用不同边界：

- 技能：VaultDesk 负责构建、安装、校验、备份和恢复。SKILL.md 是跨 agent 的稳定格式。
- 插件：VaultDesk 负责登记、存储、校验和展示；实际安装与适配由 agent 在使用时自行完成，接口是随 CLI 提供的 `vaultdesk` skill。
- 工具卡：只记录外部工具的官方地址、安装方式和运行入口，不保存工具源码，不执行安装或运行。适用于 MCP 服务、CLI、桌面应用，以及 REA 这类内含多个工具、以插件形式分发的套件。MCP 管理模块是 `kind: mcp` 的工具卡视图，不单独存储。
- 外部技能：由某个工具随包分发、并在安装或升级时由该工具改写或校验的技能，只记录归属工具、路径和可选哈希。VaultDesk 读取并展示观察状态，不安装、不更新、不运行工具，也不写入该路径。
- VaultDesk 不生成 marketplace 或 adapter manifest，不写入 agent 的插件注册表，不显示 agent 侧的 installed/enabled 状态。

目标用户：同时使用多个 agent 工具、自己维护技能库、需要知道「装了什么、来自哪里、哪个版本、装到哪、有没有更新」的个人开发者。

核心承诺：

1. 仓库是唯一事实源。安装目录只是产物，随时可以重建。
2. 先看差异，再落盘。网络抓取永远发生在仓库之外的缓存，用户确认后才写入。
3. 可复现。锁文件记录每个上游来源的 commit 与内容哈希。
4. 不替用户删除。安装、更新、迁移都不自动清理未识别的内容。
5. 桌面与 CLI 共用一套 TypeScript core，行为一致，JSON 输出稳定。
6. 技能归 VaultDesk 管，插件归 agent 管。VaultDesk 只保证插件在 vault 内完整、可读、可追溯。
7. 一个路径只有一个所有者。工具自己管理的技能不进 vault；VaultDesk 只记录并观察，不与其争抢写入权。

非目标：

- 不做 12 个 agent 工具的 symlink 分发农场。VaultDesk 只向用户指定的目录复制产物，工具发现规则由 agent 自己核实。
- 不做插件安装器、marketplace 生成器或 adapter manifest 生成器；不写 agent 插件注册表。
- 不做工具安装器或版本检查器；工具卡只记录人工确认过的官方入口。
- 不做外部技能的内容同步器；不替工具升级、不运行工具 setup、不写外部路径。
- 不做技能市场、评分、云同步。
- 不追求原生 SwiftUI 手感。
- 不读取或改写其他管理器（如 SkillDeck）的私有锁文件。
- 不把用户的技能资产随工具开源。开源仓库只包含工具代码、测试夹具和公开文档。

## 2. 竞品与差异化

直接竞品 SkillDeck（MIT，SwiftUI，v0.1.2，2026-10-26）：

- 单一规范存储 `~/.agents/skills`，向 12+ agent 工具建立 symlink。
- `.skill-lock.json` v3 与 `npx skills` 生态共用，只管理全局锁。
- 支持编辑与导入，没有应用内 diff，没有多仓库，没有 CLI。

VaultDesk 的差异化：

- Git 仓库为源，多仓库并行打开。
- review-before-apply 的更新流程，逐来源展示上游差异。
- 桌面与 CLI / agent 自动化共用 core，JSON 契约稳定。
- 锁文件记录 commit 与内容哈希，安装可追溯。

共存策略：VaultDesk 独立管理目标目录，写入自己的 `.vault-managed` 标记，不读写 `.skill-lock.json`。理由是两者的锁语义不同、共享锁没有稳定契约、写入会波及其他工具；完整论证与共存行为见 `docs/SKILLDECK-INTEROP.md`。

## 3. 仓库结构（monorepo）

```text
vaultdesk/
├── packages/schema/        # zod schema、类型、JSON Schema
├── packages/core/          # 全部业务逻辑：读写、校验、迁移、更新、构建、安装、Git
├── packages/cli/           # vaultdesk 命令
├── apps/desktop/           # Electron main / preload / renderer
├── fixtures/               # v1 / v2 测试 vault
├── tests/                  # 跨包集成、golden、CLI 测试
├── docs/
└── release/                # 产物，gitignored
```

依赖方向严格单向：`cli → core → schema`，`desktop/main → core → schema`，`desktop/renderer` 只能通过 preload 暴露的类型化 IPC 访问 core。

## 4. Vault v2 数据模型

v1 的三份元数据（`sources.yml`、每个 `package.yml`、`install-targets.yml`）合并为一份 vault 配置加每个来源一份文件。

```text
vault.yml
vault.lock
sources/<name>.yml
skills/<name>/
packages/<pkg>/skills/<skill>/
plugins/<name>/
tools/<name>.yml
external-skills/<name>.yml
third_party/
build/skills/<name>/
build/tools.json
build/external-skills.json
.vault/state.json
.vault/operation.json
```

元数据永远位于 skill 内容之外。任何会随技能复制的内容目录里不放 VaultDesk 状态。

### 4.1 vault.yml

```yaml
schema: 1
name: AI资产
defaults:
  ref: main
  update_mode: review-before-apply
targets:
  - id: agents-shared
    dest: ~/.agents/skills
    names: [vaultdesk, ultra-research, find-skills]
    install_after_update: true
```

### 4.2 sources/<name>.yml

```yaml
schema: 1
name: baoyu-skills
shape: package            # standalone | package
kind: collection          # suite | collection；package 必填
origin: github            # github | local
repo: JimLiu/baoyu-skills
remote_url:               # 可选，私有或非标准 Git 地址
ref: main
content_path: packages/baoyu-skills
version: "0.1.0"          # 可选
description: ""           # 可选
skills:
  - name: baoyu-article-illustrator
    source_path: skills/baoyu-article-illustrator
    vendor_path: third_party/baoyu-skills/baoyu-article-illustrator
    user_invocable: true
script_deps: {}
```

规则：

- standalone 恰好一个 skill，`target_path: skills/<name>`。
- package 的 `content_path` 为 `packages/<name>`，技能工作副本固定为 `packages/<name>/skills/<skill>`。
- `origin: github` 必须提供 `repo`、`ref`、每个 skill 的 `source_path` 与 `vendor_path`。
- `origin: local` 不写 `repo`、`ref`、`source_path`、`vendor_path`，不参与上游更新。
- `kind: suite` 必须提供 `entrypoint`，且该名字在 skills 中声明。
- `kind: collection` 禁止 `entrypoint`。
- `shape: plugin` 的规则见 4.6 与 `docs/PLUGINS.md`，`skills` 固定为空。
- fork 记录：

```yaml
origin: local
forked_from:
  repo: owner/repo
  ref: main
  source_path: skills/x
  commit: <sha>
```

### 4.3 vault.lock

记录可复现事实，不记录时间戳。

```yaml
schema: 1
sources:
  find-skills:
    commit: a80e4c9...
    hash: sha256:...
    skills:
      find-skills: sha256:...
```

### 4.4 .vault/state.json

本机状态，不提交 Git。

```json
{
  "schema": 1,
  "last_checked_at": "2026-10-26T02:00:00.000Z",
  "last_applied_at": "2026-10-25T10:00:00.000Z",
  "sources": {
    "find-skills": { "checked_at": "...", "remote_commit": "..." }
  },
  "targets": {
    "agents-shared": {
      "last_installed_at": "...",
      "installed_hash": "sha256:...",
      "backup_path": "..."
    }
  }
}
```

`.vault/.gitignore` 忽略 `state.json`、`operation.json`，目录本身保留。

### 4.5 操作日志

多步写操作开始前写 `.vault/operation.json`，每一步更新状态，成功后删除。应用启动或 CLI 打开 vault 时若发现残留，显示恢复提示。不做自动回滚，依赖 Git 与安装备份恢复。

### 4.6 插件登记

插件是 `shape: plugin` 的 source，占用 `plugins/<name>/` 作为工作根；GitHub 插件另存一份 pristine 副本到 `third_party/<name>/`。成员技能在读取时从插件根发现，不写进 `skills` 字段。`vault.lock` 记录整根 hash，用于发现 commands、agents、hooks、MCP 等资产变化。GitHub 插件支持整根 diff 与 review-before-apply 更新：同步两份副本，更新 lock 与 source 元数据，纯插件更新不触发 build/install。

插件只进 vault，不进 `build/skills/`，不进入安装目标解析。manifest 是可选元数据：没有 manifest 时按 `skills/` 加 MCP/commands/agents/hooks 等组合识别，也可由用户显式强制或关闭。完整规则、插件识别、资产清单和校验项见 `docs/PLUGINS.md`。

### 4.7 工具卡

工具卡用于记录 VaultDesk 不托管源码的外部工具，例如 MCP 服务、CLI、桌面应用，以及 REA 这类内含多个工具、以插件形式分发的套件。`kind` 描述分发形态，不描述协议；协议信息放进 `tags`（如 `mcp`、`cli`）。

工具卡不是 source：没有 `origin`、`ref`、`vault.lock` 记录，不参与上游检查、diff、更新、build 或安装。工具卡也不写入 agent 配置。

```yaml
schema: 1
name: rea
kind: plugin                  # plugin | mcp | cli | app
title: REA · Reverse Engineer Anything
summary: 逆向工程工具箱，含 CLI 与 MCP 服务。
homepage: https://rea.tools/
docs: https://github.com/morluto/rea/blob/main/docs/installation.md
recorded_version: "6.8.0"
install:
  - label: 接入 agent
    command: npx rea-agents setup
run: rea --mcp
requirements:
  - Node.js ^22.23.4 || ^24.22.1 || >=26.12.1
related_skills: [reverse-engineer-anything]
tags: [mcp, cli, reverse-engineering]
notes: 技能版不会注册 MCP，需要运行安装命令并重启 agent。
```

规则：

- 必填：`name`、`kind`、`title`、`summary`、`homepage`、`install`；`install` 至少一项，每项为 `{label, command}`。
- 可选：`docs`、`recorded_version`、`run`、`requirements`、`related_skills`、`tags`、`notes`。
- `name` 必须是 slug，且与文件名一致；`homepage`、`docs` 只接受 http(s)。
- `tags` 为小写 slug；`related_skills` 指向 vault 内技能，缺失时只产生 warning。
- 非法 YAML 或字段错误会作为 snapshot warning 显示，并使 `vault validate` 报错。
- 工具卡是人工记录的快照，不检查新版本，也不代表本机已安装。禁止写入 token、密钥或私有 URL。
- `build/tools.json` 是可选的生成索引，内容为规范化后的卡片数组，不含时间戳。

接口：CLI 提供 `tool list [--kind <kind>]`、`tool show <name>`、`tool add <name>`（预览后 `--yes` 落盘）；桌面「工具」页只读展示并支持搜索。agent 通过 `tool show --json`、`build/tools.json` 和随 CLI 分发的 `vaultdesk` skill 读取卡片，再按自己的安装规则处理。

MCP 管理模块不引入独立数据模型：MCP 服务仍是 `kind: mcp` 的工具卡，与其他工具卡共用 `tools/`、`build/tools.json` 和搜索索引。桌面侧边栏「MCP」是工具页按 `kind` 过滤的只读视图，总览单列 MCP 卡数量；CLI 用 `tool list --kind mcp` 得到同一集合。MCP 卡用「连接 / 启动」呈现 `run`，复制按钮只复制命令文本，不检测端口、不启动进程，也不判断是否已注册到任何 agent。

### 4.8 外部技能

有些工具随包分发技能，并在 setup 或升级时改写或校验该目录。若 VaultDesk 同时把该路径当作受管技能，两个写入者会互相覆盖。外部技能卡只记录归属和路径，不接管内容。

```yaml
schema: 1
name: reverse-engineer-anything
owner: rea-agents
path: ~/.agents/skills/reverse-engineer-anything
version: "49"
expected_hash: sha256:...
related_tool: rea
description: REA 随包分发的逆向工程技能。
notes: 由 rea-agents 管理；工具升级后重新 pin。
```

规则：

- 必填：`name`、`owner`、`path`；`name` 为 slug，且不得与受管技能重名。
- `path` 为绝对路径或以 `~/` 开头，且必须位于 vault 之外。
- 可选：`title`、`version`、`expected_hash`（`sha256:` 加 64 位十六进制）、`related_tool`、`description`、`notes`。
- 一个路径只有一个所有者：路径已带任何 `.vault-managed` 标记时拒绝写入卡片。
- `related_tool` 指向工具卡；缺失时只产生 warning。工具卡的 `related_skills` 同时识别受管技能与外部技能名。
- 外部技能不进入 `snapshot.skills`，不参与 build、安装、target 解析、diff 或上游更新。

观察状态：

| 状态 | 条件 |
|---|---|
| `ok` | 已 pin 哈希且与目录一致 |
| `observed` | 路径可读、存在 `SKILL.md`，未 pin 哈希 |
| `drift` | 已 pin 哈希与当前目录不一致 |
| `missing` | 路径不存在 |
| `invalid` | 路径存在但没有 `SKILL.md` |
| `conflict` | 路径带 `.vault-managed` 标记，说明另一个所有者仍在管理 |

目录哈希忽略 VaultDesk 元数据、`.vault-managed`、`.DS_Store`、`.git`、`node_modules` 与 `.vault`，避免工具自身状态造成伪漂移。观察还读取 frontmatter 的 `description` 与 `metadata.version` 用于展示。

校验：

- `external.path-inside-vault` 是 error。
- 目标安装引用外部技能（`target.external-not-installable`）是 error。
- `external.invalid-yaml`、`schema.invalid`、`external.filename-mismatch`、`external.duplicate-name` 是 error。
- `external.path-name-mismatch`、`external.path-missing`、`external.skill-file-missing`、`external.vault-marker`、`external.hash-drift`、`external.related-tool-unknown` 是 warning。

接口：

- `external list`、`external show <name>`、`external add <name>`、`external remove <name>`、`external adopt <name>`。
- `add` 预览后 `--yes` 落盘；`--force` 覆盖同名卡片；`--pin` 要求路径存在并写入当前目录哈希；`--expected-hash` 与 `--pin` 互斥。
- `adopt` 把 vault 内的 standalone 单技能转给外部所有者：仅接受位于 vault 外、带 `SKILL.md`、且标记不存在或属于本 vault 的路径。写入顺序为先写外部卡，再删除 source 元数据、lock/state 条目、target 引用、受管内容与 vendor 副本，最后删除本 vault 标记，随后 build 与 validate。他库标记会阻止 adopt。
- `remove` 只删除卡片，绝不触碰外部路径。
- `build/external-skills.json` 输出 `{schema, vault, skills:[{name, owner, path, title?, version?, expected_hash?, related_tool?, description?, observed_hash, observed_version, status}]}`，不含时间戳。
- 桌面技能页按 `owner` 分组展示外部技能，提供「外部托管」筛选；inspector 只读展示观察结果、路径与哈希，并提供在 Finder 中显示与复制路径。

## 5. 更新与安装语义

### 5.1 检查

- 用 `git ls-remote <remote> <ref>` 解析远端 commit。
- 与 `vault.lock` 比较，得出 `current / update-available / not-downloaded / auth-failed / error`。
- 结果写入 state，不写仓库。
- 启动时若距上次成功检查超过 24 小时，自动检查一次；运行期间不设定时器。手动刷新始终可用。

### 5.2 预览与落盘

- 上游抓取到 `~/Library/Caches/VaultDesk/upstream/`，以 commit 为缓存键。
- 差异比较对象是抓取结果与工作副本，逐文件展示 unified diff，二进制文件只报大小变化。
- Apply 顺序：确认工作区干净 → 写 vendor → 同步工作副本 → 更新 lock → build → validate → 可选安装 → 可选 commit。
- 任一步失败即停止并保留操作日志；不回滚已写入文件。

### 5.3 安装

- 先 build，产物为 `build/skills/<name>/`。
- 目标槽位状态：`create / managed / symlink / unmanaged`。
- managed：原地替换。
- symlink：只删除链接，绝不触碰链接目标。
- unmanaged：先移动到备份根，再写入。
- 每个安装目录写 `.vault-managed` JSON，包含 vault、skill、installed_at、hash。
- 不自动删除目标中多余的技能。卸载必须显式调用。
- 每目标保留最近 10 份备份，更早的由用户手动清理。0.1 只读，备份功能从 0.3 生效。
- 验证只到文件层面：期望文件存在且哈希匹配，文案为「files in place」，不声称工具已识别。
- 插件不参与安装。`target install` 遇到插件 source 或插件内技能时返回 `plugin-not-installable`。
- 外部技能不参与安装。target 引用外部技能时校验报 `target.external-not-installable`；安装路径由归属工具负责。

### 5.4 编辑与 fork

- `origin: github` 的 skill 只读。
- 编辑时要求 fork，`origin` 变为 `local` 并记录 `forked_from`。包内技能 fork 为独立本地 standalone。
- 本地技能可直接编辑并保存。

### 5.5 导入

- 检测输入目录中的 `SKILL.md`：一个为 standalone，多个为 collection，suite 需用户显式指定入口。
- 检测到插件 manifest 或插件组合特征（skills + MCP/commands/hooks 等）时按插件登记导入，规则见 `docs/PLUGINS.md`，不构建、不安装。`--plugin` / `--no-plugin` 可覆盖自动识别。
- 预览分类、名称、目标路径、冲突项，用户确认后复制并写元数据。
- 不做 AI 推断，不静默改分类。
- 收录前先判定所有权：工具随包分发且会改写或校验该技能 → 外部技能卡；VaultDesk 应拥有编辑与安装 → 普通 source；需要独立改动 → fork 到新路径和新名称。两条所有权不得共用一个路径。
- 已经以受管技能存在、但路径实际由工具管理时，用 `external adopt` 转出，不做静默双写。

### 5.6 Git

- 只暂存应用本次变更涉及的路径，不使用 `git add -A`。
- 提交信息必填。
- push 与 commit 分离，使用 `GIT_TERMINAL_PROMPT=0`。
- 不做 pull、rebase、merge、force push。

## 6. CLI 契约

```text
vaultdesk vault status|init|migrate|validate
vaultdesk source list|show|check|diff|update|add|remove|fork
vaultdesk plugin list|show
vaultdesk tool list [--kind <kind>]|show|add
vaultdesk external list|show|add|remove|adopt
vaultdesk build
vaultdesk target list|install|remove|verify|restore
vaultdesk git status|commit|push
vaultdesk presets list|verify
vaultdesk agent skill
```

通用参数：

- `--vault <path>`，缺省为当前目录。
- `--json` 输出统一信封：

```json
{
  "schema": 1,
  "command": "source.check",
  "data": {},
  "warnings": [],
  "errors": []
}
```

- 退出码：0 成功；1 操作失败；2 用法或校验失败；3 网络或认证失败。
- 写操作必须带 `--yes`，否则只输出预览。
- 交互提示只写 stderr，stdout 保持可解析。

## 7. Electron 安全与进程边界

- main 持有全部文件系统、Git、网络能力。
- renderer 无 Node 集成，`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- preload 只暴露白名单方法与事件订阅。
- 所有 IPC 请求与响应经 zod 校验。
- 不启动本地 HTTP 服务。
- 外部链接交给系统浏览器，拒绝 `file://` 与未知协议。
- 多 vault 用 tab 打开，各自持有独立锁；同一 vault 不重复打开。
- 搜索为 Cmd+K 元数据搜索（名称、描述、来源、包、origin、插件 manifest、工具卡、外部技能），不做全文搜索。
- 打开、检查、diff 在 0.1 阶段全部只读。0.2 起新增写入口，但一律先预览、再显式确认，CLI 需要 `--yes`。

## 8. 版本路线

| 版本 | 内容 | 状态 |
|---|---|---|
| 0.1 | 只读：打开 v1/v2 vault、迁移 dry-run、来源/技能/目标状态、检查更新、上游 diff、只读校验；多 tab 与 Cmd+K；未签名 DMG | 已实现 |
| 0.2 | 迁移写盘（分支 `vault-v2`）+ 应用更新 | 已实现 |
| 0.3 | 安装、目标管理、备份/恢复、文件级验证 | 已实现 |
| 0.4 | 编辑、fork-to-local | 已实现 |
| 0.5 | 导入向导（本地目录与 GitHub 来源） | 已实现 |
| 0.6 | Git 提交/推送、跨 vault 搜索强化、SkillDeck 互操作 spike、preset verify_command、agent skill | 已实现：Git 与搜索在 0.6；两项延期能力与互操作结论在 1.0 前补齐 |
| 0.6.x | 技能页类型筛选与来源分组；suite 成员引用 warning | 已实现 |
| 0.7 | 插件登记：`shape: plugin` source、导入、存储、校验、`plugin list/show`、插件页、CLI JSON、`vaultdesk` skill 契约、fixture | 已实现 |
| 0.8 | 插件更新、整根 diff、搜索与总览、安装 guard、边界测试 | 已实现 |
| 0.9 | 插件 E2E、DMG、文档、硬化 | 已实现：插件 CLI/桌面 E2E、文档与硬化；DMG 已在 1.0 验收中重新打包并验证 |
| 1.0 | 收口、完成延期 0.6 项、稳定化、Homebrew、按需公证 | 已实现：版本 1.0.0，延期项补齐，DMG 通过本地验收；Homebrew 与公证结论见 `docs/RELEASE.md`，发布动作待批准 |
| 未发布（main） | 工具卡、MCP 视图、外部技能记录层 | 已实现并有测试，未创建 tag 或 Release |

### 0.1 验收

1. 只读打开现有 25 技能 v1 vault，正确显示来源、包、技能、origin、shape/kind、ref/commit、上次检查/应用/安装、安装位置。
2. 迁移 dry-run 生成确定性的 v2 差异，全程不写盘。
3. 三个上游来源均可检查，结果分类正确。
4. 任一有差异来源可查看逐文件 diff。
5. 校验规则与现有 Ruby 校验器对应，fixture 全部通过。
6. 同时打开两个 vault，Cmd+K 跨库搜索元数据。
7. 全程 `git status` 不变。
8. 未签名 DMG 在 macOS 上可启动，首次打开步骤写入文档。

### 0.2 迁移写盘

- 要求工作区干净。
- 创建分支 `vault-v2`。
- 写 `vault.yml`、`sources/*.yml`、`vault.lock`；删除 `sources.yml`、各 `package.yml`、`install-targets.yml`。
- 保留 `third_party/`，重建 `build/`，执行校验。
- 提交但不推送。

## 9. 测试与发布门槛

- core 单元测试：schema、路径、哈希、校验规则、迁移、安装槽位、fork、导入检测、搜索、Git 路径过滤、插件发现与校验、工具卡与 MCP 解析及产物、外部技能观察与 adopt。
- fixture 集成测试：v1 与 v2 各一套，覆盖 local/GitHub、standalone/package/suite/collection；插件 fixture 覆盖 Claude/Codex/Qoder/manifest 冲突/hooks/路径逃逸，以及无 manifest 的组合识别与显式强制导入。工具卡覆盖合法/非法字段、`tool list/show/add`、`tool list --kind` 过滤与非法 kind、重复写入与 `--force`、`build/tools.json`、搜索命中（含 `toolKind`）。外部技能覆盖只读观察、哈希 pin、drift/missing/marker 冲突、路径与命名冲突、目标引用拒绝、搜索索引、adopt 与 CLI 全命令。
- 迁移 golden：固定 fixture 的 dry-run 输出与 golden 文件一致，重复调用结果稳定。
- CLI 测试：JSON 信封、退出码、`--yes` 门禁、只读命令不写盘。
- Electron smoke：本地脚本启动生产构建，打开临时 fixture，校验渲染文本并截图；CI 的 macOS 任务运行同一脚本。
- 发布前关键路径 E2E：打开真实 v1 vault → 检查 → diff → 迁移预览，确认 git status 不变。2026-10-26 已对真实仓库执行。
- CI：`.github/workflows/ci.yml` 在 macOS + Ubuntu 跑 typecheck、test、build；macOS 额外运行 smoke 并打包 DMG。

## 10. 发布

- 1.0.0 提供有效 ad-hoc bundle 签名、未公证的 arm64 DMG；README 说明首次打开需右键或「隐私与安全性」放行。
- 版本遵循 SemVer；当前为 1.0.0。0.1 至 0.9 的功能已全部并入本次发布。
- 2026-10-27 已在本地完成构建与 DMG 验收，未创建 tag、GitHub release、Homebrew cask 或公证提交。产物哈希、发布清单、公证步骤与 cask 草案见 `docs/RELEASE.md`。
- 发布动作（commit/tag/push/GitHub release/cask/公证）逐项需要明确批准。

## 11. 关键决策记录

| 编号 | 决策 |
|---|---|
| 1 | 现有仓库只作为兼容对象与测试对象，不原地改造脚本；新工具独立仓库 |
| 2 | 双向重构：CLI 与桌面共用 core |
| 3 | 仅 macOS |
| 4 | 开源工具，个人技能资产不开源 |
| 5 | 名称 VaultDesk，许可证 Apache-2.0 |
| 6 | 多 vault 并行 |
| 7 | 数据模型重写为 v2，提供 v1 迁移 |
| 8 | 元数据外置，状态与本机数据分离 |
| 9 | 先预览后落盘，上游缓存放在 vault 外 |
| 10 | 锁文件只记 commit 与哈希 |
| 11 | GitHub 技能只读，编辑需 fork |
| 12 | 安装不自动删除、不越权清理 |
| 13 | 备份保留策略默认 10 份 |
| 14 | 工具发现规则不在应用中硬编码 |
| 15 | CLI JSON 信封与退出码固定 |
| 16 | Electron 主进程独占 IO，renderer 无 Node |
| 17 | 24 小时节流的启动检查，无运行期定时器 |
| 18 | 0.1 只读发布 |
| 19 | 迁移在独立分支完成，不推送 |
| 20 | 不做技能市场、云同步、原生重写 |
| 21 | 插件按 `shape: plugin` 的 source 存储，复用来源、更新和 lock 流程 |
| 22 | 插件完整复制进 vault，保证 vault 自包含 |
| 23 | 插件内技能可搜索、可展示，不可安装 |
| 24 | VaultDesk 不生成 marketplace、adapter manifest，不写 agent registry |
| 25 | 插件页不显示 agent 侧 installed/enabled |
| 26 | 插件安装交给 agent，随 CLI 提供的 `vaultdesk` skill 是接口 |
| 27 | OpenCode 不在插件适配范围 |
| 28 | suite 成员关系用校验 warning 维护，不生成额外技能 |
| 29 | 工具卡是独立记录，不是 source，不参与检查、更新、build 或安装 |
| 30 | 工具卡写入只走 CLI，桌面工具页只读；agent 自行安装，VaultDesk 不代劳 |
| 31 | MCP 模块复用工具卡，按 `kind: mcp` 过滤；不建独立存储，不注册、不启动 MCP 服务 |
| 32 | 一个路径只有一个所有者；工具自己改写或校验的技能记为外部技能，只观察不写入 |
| 33 | `external adopt` 把受管技能转出到工具路径；只删除本 vault 的元数据与标记，他库标记阻止操作 |

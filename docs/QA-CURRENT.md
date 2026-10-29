# v1.2.2 发布 QA 记录

> 日期：2026-10-30。v1.2.2 已完成本地、正式安装、GitHub CI 与公开发布验收；下方保留 v1.2.1 和更早版本的历史记录。

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4/4 workspace；26 个文件，141/141 项测试 |
| CLI 与桌面 E2E | 通过 | CLI 全场景；桌面 18/18 场景，新增关窗后单实例重开；axe 扫描无违规 |
| DMG 安装验证 | 通过 | hdiutil、严格签名、应用启动、编辑持久化 |
| /Applications 安装版 | 通过 | 版本 1.2.2；严格签名与 app.asar 哈希匹配；旧版有隐藏回滚副本 |
| 后台服务与界面重开 | 通过 | LaunchAgent 版本 1.2.2、worker 独立运行；GUI 退出后普通 open 恢复界面，重复打开仍只有一个 GUI 进程 |
| 真实 Personal Skills Vault | 通过 | 36/36 个主库技能、15/15 个受管目标复验通过；正式后台活动无错误，前次启动曾自动更新推送 vaultdesk 来源 |
| GitHub CI 与公开 Release | 通过 | 标签指向 177bc00；运行 40941505610 三项成功；公开非预发布，回下载 DMG 为 124,602,082 字节且 SHA-256 与本地一致 |

| v1.2.2 DMG 字段 | 值 |
| --- | --- |
| 文件 | release/VaultDesk-1.2.2-arm64.dmg |
| 大小 | 124,602,082 字节（约 118.8 MiB） |
| SHA-256 | c53bf4e2a3b4369645c834e553f1ef7396956ef7053539e53d9f3de840f81351 |
| app.asar SHA-256 | 2fbe9bf38625978602372488549eaf90710d0fad6a2298cb38c41dbdc2527de1 |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

# v1.2.1 发布 QA 记录

> 日期：2026-10-30。v1.2.1 已公开发布并通过 CI、DMG 回下载与后台服务实机验证；但普通重新打开时只有后台进程响应，界面未出现，已由 v1.2.2 修复。

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4/4 workspace；26 个文件，141/141 项测试 |
| CLI 与桌面 E2E | 通过 | CLI 全场景；桌面 17/17 场景，axe 扫描无违规 |
| DMG 安装验证 | 通过 | hdiutil、严格签名、应用启动、编辑持久化 |
| GitHub HTTPS 故障回退 | 通过 | 人为设无效 HTTPS 代理后，真实私有 Vault 的来源检查与克隆经 SSH 443 成功 |
| 真实 Personal Skills Vault | 通过 | 4 个上游来源已更新并自动推送，15/15 个受管目标校验通过；另有上游新技能待接纳 |
| GitHub CI、公开发布 | 通过 | 标签指向 cabe2a7；运行 40937666852 三项成功；公开非预发布，DMG 回下载大小与 SHA-256 一致 |
| 正式安装版 LaunchAgent 与 GUI 重开 | 部分通过 | 1.2.1 服务已加载并可自动更新私有 Vault；但 UI 退出后普通 open 被路由给 worker，需 1.2.2 修复 |

| v1.2.1 DMG 字段 | 值 |
| --- | --- |
| 文件 | release/VaultDesk-1.2.1-arm64.dmg |
| 大小 | 124,601,920 字节（约 118.8 MiB） |
| SHA-256 | e63079c64d1a01ee8b8048f58a4c047b7dc67d574ce0211900d002eaa86528ca |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

# v1.2.0 发布 QA 记录

> 日期：2026-10-30。v1.2.0 已公开发布并通过 CI 与回下载哈希核对；正式安装版 LaunchAgent 验收转入 v1.2.1。v1.1.0 和 v1.0.0 的记录保留在后文。

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 通过 | 5 个 workspace，锁文件兼容 |
| `pnpm typecheck`、`pnpm test` | 通过 | 4/4 workspace；25 个文件，139/139 项测试 |
| CLI、桌面 E2E | 通过 | CLI 全场景；桌面 17/17 场景，包含无窗口 worker、双 Vault 同步、待接纳后分发推送；axe 扫描 0 项违规 |
| `pnpm test:e2e:dmg` | 通过 | 挂载、`hdiutil verify`、严格签名、应用启动及编辑持久化 |
| 真实 Personal Skills Vault | 通过 | 36/36 个 Vault 技能已投影到 `~/.agents/skills`，15/15 个登记目标验证通过；未知归属内容保持原样 |
| GitHub Release、CI | 通过 | v1.2.0 标签指向 c1776f6；运行 40933175480 三项成功；公开非预发布，回下载 DMG 的大小与 SHA-256 均与本地一致 |
| 正式安装版 LaunchAgent | 转入 v1.2.1 验证 | v1.2.0 未替换本机应用；实机网络验证发现 GitHub HTTPS 直连不可用，故发布 1.2.1 补丁 |

| v1.2.0 DMG 字段 | 值 |
| --- | --- |
| 文件 | `release/VaultDesk-1.2.0-arm64.dmg` |
| 大小 | 124,602,245 字节（约 118.8 MiB） |
| SHA-256 | `ac1b8f1aa5adcf05ad9c65c34673eab67f3f494e9c77c28db87d61b5fabf9d57` |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

# v1.1.0 发布 QA 记录

> 日期：2026-10-29。v1.1.0 最终构建、本地验收、应用替换及公开发布均已完成。下方 1.0.0 数据是此前本地工作树的历史记录，不能用于当前发布产物。[RELEASE.md](RELEASE.md) 另保留 2026-10-27 的 1.0.0 本地 DMG 验收快照。

## v1.1.0 最终验收

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 通过 | 5 个 workspace，锁文件兼容 |
| `pnpm typecheck`、`pnpm test` | 通过 | 4/4 workspace；18 个文件，92/92 项单测 |
| `pnpm test:e2e` | 通过 | CLI 12/12、桌面 16/16；20 次 axe 扫描 0 项违规，含键盘、缩放及减少动效检查 |
| `pnpm test:e2e:dmg` | 通过 | `hdiutil verify`、严格签名、应用启动、fixture 校验及编辑持久化检查 |
| GitHub Actions CI | 通过 | `d9500ee` 对应运行 40814198894：Ubuntu、macOS 验证及桌面 smoke/DMG 构建全部通过 |
| `/Applications/VaultDesk.app` 替换与启动 | 通过 | 版本 1.1.0；签名有效；app.asar SHA-256 为 `0c2a2fd2b308cada5d3e877fd85babaf54f7b957b232c87a5cc81e6b588a6fb0`，与构建一致；旧版保留为隐藏回滚副本 |
| GitHub v1.1.0 Release | 通过 | 公开的非预发布版本；标签指向 `d9500ee`；DMG 和 SHA-256 文件均已上传，回下载大小与哈希和本地一致 |

| v1.1.0 DMG 字段 | 值 |
| --- | --- |
| 文件 | `release/VaultDesk-1.1.0-arm64.dmg` |
| 大小 | 125,215,804 字节（约 119.4 MiB） |
| SHA-256 | `e2e8dc508723bb8ccb449f691062e26b51f5f09f4ec3e21854a73b5fa044ca34` |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

上述大小与哈希已从最终上传的 v1.1.0 DMG 回下载确认，不沿用以下历史值。

## 历史记录：2026-10-29 的 v1.0.0 未发布工作树

以下验收结果对应当时的本地代码与 `1.0.0` DMG，并不证明
v1.1.0 的新 UI 或最终发布产物已经通过。

### 当时的验收结果

| 检查 | 结果 | 证据或备注 |
| --- | --- | --- |
| `pnpm typecheck` | 通过 | 4/4 workspace |
| `pnpm test` | 通过 | 18 个文件，92/92 项测试 |
| `pnpm test:e2e` | 通过 | CLI 12/12、桌面 16/16；axe 扫描九个视图，0 项违规；120 技能桌面渲染耗时 756 ms |
| `pnpm test:e2e:dmg` | 通过 | 完成 DMG 挂载、签名核验、应用启动、fixture 校验及编辑持久化检查 |
| 真实个人 vault 只读复验 | 通过 | 新 CLI 的 `vault validate` 通过；14/14 个目标通过 `target verify`；vault Git 工作区干净 |

### 当时的 DMG 产物

| 字段 | 值 |
| --- | --- |
| 文件 | `release/VaultDesk-1.0.0-arm64.dmg` |
| 大小 | 125,203,523 字节（约 119.4 MiB） |
| SHA-256 | `5e62c87160ff235fc4c0f672dddbf30012b087e8fee9835545fbec6162086bca` |
| 签名与公证 | Ad-hoc 签名；未公证 |

以上大小与哈希只对应 **2026-10-29 当时未发布的 v1.0.0 工作树** 本地构建；不是 v1.1.0 的哈希，也不替换 [RELEASE.md](RELEASE.md) 中较早的 1.0.0 本地验收产物。

### 当时的修复

- 上游来源：按稀疏检出的路径区分同提交缓存；技能来源更新前核对 pristine vendor 副本与 lock，防止已提交的本地修改被静默覆盖。
- 安装与恢复：安装标记加入 `target_id` 并兼容旧标记；备份目录按目标 ID 隔离，恢复时核对备份归属与目标技能。
- 交互与诊断：CLI 显示来源检查失败详情；桌面端修复键盘导航、缩放布局和状态提示，并收紧渲染页面来源校验及 IPC 输入错误反馈。

### 当时未覆盖

- 未运行依赖真实 GitHub 的可选场景；本轮 E2E 使用本地 Git fixture。
- 未进行 VoiceOver 人工操作验收，也未覆盖其他 macOS 版本。

### 核对边界

- 测试使用 fixture 或临时 vault；不要把个人技能库作为写入目标。
- `source check` 会更新被 Git 忽略的 `.vault/state.json`，不能作为“完全不写盘”的测试命令。
- `target verify` 只证明预期文件存在且哈希匹配，不证明 agent 已加载技能。
- 历史本地构建通过不等于 v1.1.0 已发布；本节不作为当前 tag、GitHub Release 或公证的证据。

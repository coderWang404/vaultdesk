# v1.1.0 发布 QA 记录

> 日期：2026-10-29。v1.1.0 最终构建、本地验收和应用替换已完成，公开发布待核验。下方 1.0.0 数据是此前本地工作树的历史记录，不能用于当前发布产物。[RELEASE.md](RELEASE.md) 另保留 2026-10-27 的 1.0.0 本地 DMG 验收快照。

## v1.1.0 最终验收

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 通过 | 5 个 workspace，锁文件兼容 |
| `pnpm typecheck`、`pnpm test` | 通过 | 4/4 workspace；18 个文件，92/92 项单测 |
| `pnpm test:e2e` | 通过 | CLI 12/12、桌面 16/16；20 次 axe 扫描 0 项违规，含键盘、缩放及减少动效检查 |
| `pnpm test:e2e:dmg` | 通过 | `hdiutil verify`、严格签名、应用启动、fixture 校验及编辑持久化检查 |
| `/Applications/VaultDesk.app` 替换与启动 | 通过 | 版本 1.1.0；签名有效；app.asar SHA-256 为 `0c2a2fd2b308cada5d3e877fd85babaf54f7b957b232c87a5cc81e6b588a6fb0`，与构建一致；旧版保留为隐藏回滚副本 |
| GitHub v1.1.0 Release | 待最终确认 | 核对 tag、资产及下载后哈希 |

| v1.1.0 DMG 字段 | 值 |
| --- | --- |
| 文件 | `release/VaultDesk-1.1.0-arm64.dmg` |
| 大小 | 125,215,804 字节（约 119.4 MiB） |
| SHA-256 | `e2e8dc508723bb8ccb449f691062e26b51f5f09f4ec3e21854a73b5fa044ca34` |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

请只从最终上传的 v1.1.0 DMG 填写上述大小与哈希，不得沿用以下历史值。

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

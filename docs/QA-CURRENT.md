# v1.2.9 发布 QA 记录

> 日期：2026-10-31。安装目标按实际目录分组，压缩重复信息，增加搜索、状态筛选和键盘折叠。已发布并安装。

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4 个 workspace；30 个测试文件，188/188 项通过 |
| CLI 与桌面 E2E | 通过 | CLI 全场景、桌面 22 个场景；24 次 axe 扫描零违规 |
| 分组与统计 | 通过 | 同目录多规则合并展示；保留独立规则 ID 和操作；组内与跨目录技能数去重；其他受管技能只显示一次 |
| 查询与筛选 | 通过 | agent/技能/来源/目标 ID/路径搜索；需处理覆盖缺失、修改和归属异常；暂停筛选；无结果清除筛选 |
| 折叠与窗口 | 通过 | 单组/全部折叠、Enter 操作与 aria-expanded；改变搜索/筛选后展开结果；1000×760 浅深主题无横向溢出，1440×1000 多组截图 |
| 验证状态 | 通过 | 外部修复后验证会刷新快照与筛选；重装刷新后清除旧验证结果；切换 Vault 通过 path key 隔离 |
| DMG CLI/MCP | 通过 | 镜像、严格签名、挂载包启动编辑持久化、独立 CLI 与 MCP 握手验收 |
| GitHub CI | 通过 | 41203860175，f34851d 的三个 job 全部通过 |
| 公开回下载 | 通过 | 发布 DMG 与本地验收包的 SHA-256 及逐字节 cmp 一致 |
| 正式安装 | 通过 | /Applications/VaultDesk.app、CLI、LaunchAgent 1.2.9；app.asar/CLI 哈希与最终 DMG 一致；单 GUI/worker；旧版移至废纸篓 |
| 真实页面 | 通过 | Personal Skills 显示共享/Qoder/Qoder CN/WorkBuddy 四组，共 17 条规则、11 个去重技能；实际路径只显示一次；保留 Qoder 展开供查看 |
| 真实 Vault | 通过 | 38 个主库技能、20 个目标条目 current；REA 外部归属正常；后台自更新并推送 e397b7e，工作树干净且 ahead/behind 为 0 |

| 产物 | 值 |
| --- | --- |
| 版本 / 发布提交 | v1.2.9 / f34851dadc6e3f8ee537e756c520a9d523c76e1d |
| DMG | release/VaultDesk-1.2.9-arm64.dmg，124,918,885 bytes |
| DMG SHA-256 | 0b04a6440b61d591aee125f85cdd494eef8ef83858d5ab555684461b1be3a559 |
| app.asar SHA-256 | 8f6d0b05d89a4aced0db5b551c772be83106b04de7b90609af7044d0a8af7b01 |
| CLI SHA-256 | cb02f66053c056765884aa783ed5692ddc7c302eeaeb357b7db1853fbfd2b93b |
| 签名 | Ad-hoc，未公证 |

# v1.2.8 发布 QA 记录

> 日期：2026-10-31。修复安装目标操作丢失上下文，以及同名来源导致选择范围扩大的问题。

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 30 个测试文件，188/188 项通过 |
| 上下文安装回归 | 通过 | 单/多技能目标固定重装；独立新增、搜索、暂停保留；详情安装与 CLI 精确选择在重载后不扩展 |
| 浅深主题与窄窗口 | 通过 | 1000×760 下重装弹窗截图；2 次 axe 扫描零违规 |
| CLI 与桌面 E2E | 通过 | CLI 全场景、21 个桌面场景；合计 22 次 axe 扫描零违规 |
| DMG CLI/MCP 验收 | 通过 | 镜像和严格签名校验；挂载包启动、编辑持久化；无源码依赖运行 CLI 和 MCP 握手 |
| GitHub CI | 通过 | 41185992856，5454d03 的三个 job 全部通过 |
| 公开回下载 | 通过 | 发布 DMG 与本地验收产物 SHA-256 和逐字节 cmp 均一致 |
| 正式安装 | 通过 | /Applications/VaultDesk.app 与 CLI 均为 1.2.8；app.asar/CLI 哈希与 DMG 一致；LaunchAgent 1.2.8，单 GUI/worker；旧版移至废纸篓 |
| 用户真实目标 | 通过 | qoder:paper-reading 弹窗固定原目录且仅列 paper-reading；预览也只有此技能，显示尚未写入，随后取消 |
| 真实 Vault 与后台同步 | 通过 | 38 个主库技能、20 个目标条目 current；REA 保持外部归属；后台自动更新 vaultdesk 并推送 c551fb0，工作树干净，ahead/behind 均为 0 |

| 产物 | 值 |
| --- | --- |
| 版本 / 发布提交 | v1.2.8 / 5454d03ed510bb85460b5b81acf36db1a888410e |
| DMG | release/VaultDesk-1.2.8-arm64.dmg，124,916,056 bytes |
| DMG SHA-256 | f8c540a6abc587c5ad1449acb16e3833233afba62eb4ba9f2baf563fd3a69f61 |
| app.asar SHA-256 | dc09e6e65e3b7d4d8980b2825e9a31aa4be78f1bc9508612251545df2d782022 |
| CLI SHA-256 | 87b6aed000c62a96cf1961ae831b9379fd1e72c10fbd7e094fd7b9d1c9629bd6 |
| 内置与主库 skill SHA-256 | 3e900b0b80cd9d2403e589fd40b38273c383bee7122f0a510195356770cd58cb |
| 签名 | Ad-hoc，未公证 |

# v1.2.7 发布 QA 记录

> 日期：2026-10-31。v1.2.7 在 v1.2.6 的管理与同步修复之上，补齐正式应用的独立 CLI/MCP 交付链；已发布并完成正式安装，公开下载校验记录见下表。

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4 个 workspace；29 个测试文件，179/179 项通过 |
| CLI/MCP 独立 bundle | 通过 | `Resources/cli/vaultdesk.cjs` 内联 core/schema/MCP SDK/yaml/zod；无源码、无 node_modules、仅 Electron Node 运行 |
| CLI 安装器 | 通过 | 9 项 launcher/MCP 测试；原子安装、同名冲突和手改保护、特殊路径、环境注入清理、幂等更新 |
| CLI 与桌面 E2E | 通过 | CLI 全场景、桌面 20 个场景；20 次 axe 扫描零违规；覆盖未打开 Vault 时进入设置 |
| DMG CLI/MCP 验收 | 通过 | 实际挂载 DMG 后使用 Electron binary + `ELECTRON_RUN_AS_NODE=1`，仅 `/usr/bin:/bin` 完成版本、技能读取和 MCP `initialize/tools/list` |
| 真实 Vault 与后台同步 | 通过 | 38 个主库技能、20 个登记目标条目 current；REA 外部归属正常；后台自更新无错误 |
| GitHub CI | 通过 | 41183040004，cff404d 的三个 job 全部通过 |
| 正式安装 | 通过 | /Applications/VaultDesk.app 1.2.7；app.asar 与最终 DMG 一致；LaunchAgent 1.2.7，单 GUI/worker |
| 实机 CLI 设置 | 通过 | 无 Vault 时通过设置按钮安装；选定 Personal Skills 后复制 MCP JSON；实际 launcher 在系统 PATH 下握手并列出 5 个 MCP tools |
| 后台启动批次 | 通过 | 1 updated / 7 current / 9 skipped，无错误；私有 Vault 提交 475a2d8 已推送，工作树干净 |
| 旧应用与命令 | 通过 | /Applications 只保留最新版；1.2.6 移至废纸篓；原源码 wrapper 已备份后通过应用设置迁移 |

| 产物 | 值 |
| --- | --- |
| 版本 / 发布提交 | v1.2.7 / cff404d81f6cf6875df9e56bb998cc70fb6b260a |
| DMG | release/VaultDesk-1.2.7-arm64.dmg，124,915,789 bytes |
| DMG SHA-256 | 9e1622bbac902d36bde9720092024526806a5065118fc3f55c537b9597235acd |
| app.asar SHA-256 | e5eaf0e7bf930b66b101fc390dfcf0ecc1abeafb51de48aa222f4024f8311b29 |
| CLI SHA-256 | 708cab69ee4309d8b66ab5183cd2ede573d714298a931535915204f8ac1266b6 |
| 公开回下载 | SHA-256 一致，逐字节 cmp 一致 |

新增 CLI 交付不会替代 Vault 的 owner 边界：技能仍通过 Vault source/target 分发，插件/MCP 启用仍由具体 agent 完成；应用只提供目录发现、只读 MCP 查询、官方安装说明和受控的 CLI 启动器安装。

# v1.2.6 发布 QA 记录

> 日期：2026-10-31。v1.2.6 已完成本地回归、GitHub CI、公开发布、回下载校验和正式安装。

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4 个 workspace；28 个测试文件，174/174 项通过 |
| CLI 与桌面 E2E | 通过 | CLI 全场景、19 个桌面场景；20 次 axe 扫描零违规 |
| DMG 验收 | 通过 | 镜像验证、严格签名、启动、编辑持久化 |
| 原生 MCP | 通过 | 独立 MCP 客户端连接真实 CLI stdio；5 个工具，真实 Vault 查询与外部所有者返回正确 |
| 真实分发状态 | 通过 | 38 个主库技能、20 个登记目标条目与 Vault 内容一致；REA 外部归属与固定 hash 正常 |
| 补分发与冲突 | 通过 | 手动仅更新 Vault 后自动补发；暂停/review/frozen 不动；插件手改保留；旧标记、共享主库、错误链接路径与 outdated 状态回归 |
| Python 环境 | 通过 | 默认验证选 Miniconda base 3.13.11；PPT Master 隔离环境 svg-pptx 7 项通过 |
| GitHub 与正式安装 | 通过 | 代码 4515ca5；CI 41173511182 三项成功；公开 DMG 回下载字节一致；安装版与测试包 app.asar、内置 skill 哈希一致 |
| 后台自更新与单实例 | 通过 | LaunchAgent 1.2.6；重复打开仍只有一个 GUI 和一个无 Dock worker；启动批次 1 updated / 7 current / 9 skipped，无错误 |
| 真实 Vault 提交推送 | 通过 | 后台自动更新并分发 vaultdesk 技能，提交 f421cb1 推送成功；工作区干净、ahead/behind 均为 0；受管主库 skill 与安装包哈希一致 |
| 旧应用清理 | 通过 | /Applications 仅保留 VaultDesk.app 1.2.6；1.2.4 和 1.2.5 回滚副本移至废纸篓 |

| 产物 | 值 |
| --- | --- |
| DMG | release/VaultDesk-1.2.6-arm64.dmg |
| 字节数 | 124,633,938 |
| SHA-256 | b3c20a0a0a563d177dddebe075aa0e02a90d50515e3c0207dcc9b6a43efaea19 |
| app.asar SHA-256 | f3d1f125d621b346046d54a57cbfcd2431b85a08def9759601f7413acd2c261a |
| 内置 skill SHA-256 | c77355329df43ff5e5f8b8cf1242c3d1ae23b8166b05b44ff79e4a923579913b |
| 签名 | Ad-hoc，未公证 |

能力和未覆盖边界见 [Agent 管理审计](AGENT-MANAGEMENT-AUDIT.md)。文件同步、依赖满足和 agent 激活分别验收；不宣称任意第三方工具可自动安装、启用或升级。

# v1.2.5 发布 QA 记录

> 日期：2026-10-31。v1.2.5 已完成本地回归、发布、CI、回下载和正式安装；真实 Vault 复验发现 catalog 对共享主库目标与旧 marker 的误报，后续由 v1.2.6 修复。

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| 类型检查 | 通过 | `pnpm typecheck`，4 个 workspace |
| 单元与集成测试 | 通过 | 28 个文件，169/169 项测试 |
| CLI 与桌面 E2E | 通过 | CLI 全场景；桌面 19 个场景、20 次 axe 扫描零违规 |
| DMG 安装验证 | 通过 | `hdiutil verify`、签名检查、启动、编辑和持久化 |
| Agent 发现 | 通过 | catalog / MCP tools/list 及真实 stdio 子进程工具调用测试通过；未知 agent 激活状态显式保留为 unknown |
| 自动更新安全 | 通过 | Git 只提交本轮路径、敏感文件拦截、插件目标漂移与手改保护回归通过 |
| DMG 哈希 | 通过 | `release/VaultDesk-1.2.5-arm64.dmg` SHA-256 `7744a3ef79a30bb79a969cbfbed3eb3923b0155177c4afa916922c47eb5d25df` |
| GitHub CI、公开 Release、正式安装 | 通过 | d85a92c；CI 41168361045 三个 job 通过；公开 DMG 回下载字节一致，安装版 1.2.5 GUI 与 worker 正常 |

| v1.2.5 DMG 字段 | 值 |
| --- | --- |
| 文件 | release/VaultDesk-1.2.5-arm64.dmg |
| 大小 | 124,630,440 字节（约 118.9 MiB） |
| app.asar SHA-256 | a973d5d8520c0c8efe9885834d2ca13c1328832a6391d1066b2db7a0b86df202 |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

# v1.2.4 发布 QA 记录

> 日期：2026-10-31。v1.2.4 已完成本地测试、DMG 验收、正式应用替换、GitHub CI、公开发布和回下载核对。

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4 个 workspace；26 个文件，154/154 项测试 |
| CLI 与桌面 E2E | 通过 | CLI 全场景；桌面 19/19 场景，axe 扫描零违规 |
| DMG 安装验证 | 通过 | hdiutil、严格签名、应用启动、编辑持久化 |
| Python 默认选择 | 通过 | Finder 式 PATH 不含 Conda 时优先 Miniconda base 3.13.11；显式系统 Python 路径可覆盖 |
| /Applications、后台服务 | 通过 | 版本 1.2.4；app.asar、内置技能哈希匹配构建产物；LaunchAgent 1.2.4；一个 GUI 和一个无 Dock worker |
| GitHub CI 与公开 Release | 通过 | 标签指向 6b04502；运行 41156645007 三项成功；公开 Release https://github.com/coderWang404/vaultdesk/releases/tag/v1.2.4；回下载 DMG 与本地字节一致 |

| v1.2.4 DMG 字段 | 值 |
| --- | --- |
| 文件 | release/VaultDesk-1.2.4-arm64.dmg |
| 大小 | 124,621,660 字节（约 118.8 MiB） |
| SHA-256 | 78c1791b5e3a7ff415d4ad915a4c98d8551a4925bea21ea5d3d9e098cdfa4e33 |
| app.asar SHA-256 | 7be035aa82ae992c1ac3bc4626937077d65452adc96112f5817dabbf386125fe |
| 内置技能 SHA-256 | bf3a0e9fc9710067433b51ade7bf13fae858e998bfc484477792957b2d035cec |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

# v1.2.3 发布 QA 记录

> 日期：2026-10-30。v1.2.3 已完成本地测试、DMG 验收、正式应用替换、GitHub CI 和公开发布回下载核对。

| 检查 | 状态 | 证据或备注 |
| --- | --- | --- |
| 类型检查与单测 | 通过 | 4 个 workspace；26 个文件，154/154 项测试 |
| CLI 与桌面 E2E | 通过 | CLI 12 个场景；桌面 19/19 场景，双主题 axe 无障碍检查通过 |
| DMG 安装验证 | 通过 | hdiutil、严格签名、应用启动、编辑持久化 |
| /Applications 安装版 | 通过 | 版本 1.2.3；app.asar、内置技能哈希匹配构建产物 |
| 后台服务与界面重开 | 通过 | LaunchAgent 1.2.3；重复打开仍只有一个 GUI 和一个无 Dock worker |
| 真实 Personal Skills Vault | 通过 | PPT Master SVG 转 PPTX 路线 7 项声明检查通过；REA Node 24.22.1 检查通过；Vault 校验零错误零警告；新版 vaultdesk 技能自动更新、分发、提交推送并复验通过 |
| GitHub CI 与公开 Release | 通过 | 标签指向 f58ebc4；运行 41077448416 三项成功；回下载 DMG 的大小与 SHA-256 和本地一致 |

| v1.2.3 DMG 字段 | 值 |
| --- | --- |
| 文件 | release/VaultDesk-1.2.3-arm64.dmg |
| 大小 | 124,621,883 字节（约 118.8 MiB） |
| SHA-256 | a590e36fe4b4303041316999d345b1a250086ec4b39a304686077826839ebda9 |
| app.asar SHA-256 | 572efa81414b15f9fe882f9fbd07ddc3529fab3bd3544da6471ea8ed560e8248 |
| 内置技能 SHA-256 | 43530813cd54b63d24897bd53624897171bc78120539adcfdddbc38b90f5a475 |
| 签名与公证 | Ad-hoc 签名，严格校验通过；未公证 |

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

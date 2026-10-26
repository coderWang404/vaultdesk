import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../shared/api.js";

const REPO_URL = "https://github.com/coderWang404/vaultdesk";

export function buildAppMenu(window: BrowserWindow): Menu {
  const send = (action: MenuAction): void => {
    if (!window.isDestroyed()) window.webContents.send("vaultdesk:menu", action);
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: "VaultDesk",
      submenu: [
        { role: "about", label: "关于 VaultDesk" },
        { type: "separator" },
        {
          label: "设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => send("settings"),
        },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: "隐藏 VaultDesk" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出 VaultDesk" },
      ],
    },
    {
      label: "文件",
      submenu: [
        {
          label: "新建仓库…",
          accelerator: "CmdOrCtrl+N",
          click: () => send("new-vault"),
        },
        {
          label: "打开仓库…",
          accelerator: "CmdOrCtrl+O",
          click: () => send("open-vault"),
        },
        {
          label: "关闭当前仓库",
          accelerator: "CmdOrCtrl+W",
          click: () => send("close-vault"),
        },
        { type: "separator" },
        {
          label: "刷新",
          accelerator: "CmdOrCtrl+R",
          click: () => send("refresh"),
        },
        {
          label: "检查上游更新",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => send("check"),
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        {
          label: "搜索",
          accelerator: "CmdOrCtrl+K",
          click: () => send("search"),
        },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" },
        ...(process.env.ELECTRON_RENDERER_URL
          ? ([{ type: "separator" }, { role: "toggleDevTools", label: "开发者工具" }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: "窗口",
      submenu: [{ role: "minimize", label: "最小化" }, { role: "zoom", label: "缩放" }, { role: "front", label: "前置全部窗口" }],
    },
    {
      role: "help",
      label: "帮助",
      submenu: [
        {
          label: "GitHub 仓库",
          click: () => void shell.openExternal(REPO_URL),
        },
        {
          label: "设计文档",
          click: () => void shell.openExternal(`${REPO_URL}/blob/main/docs/DESIGN.md`),
        },
        { type: "separator" },
        {
          label: `版本 ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

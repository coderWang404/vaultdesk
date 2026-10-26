import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import { VaultDeskError, serializeError } from "@vaultdesk/core";
import { ipcRequestSchema, type IpcCommand, type IpcResponse } from "@vaultdesk/schema";
import { knownCommands, runCommand, warningsOf } from "./commands.js";
import { buildAppMenu } from "./menu.js";
import type { DirectoryDialogOptions } from "../shared/api.js";

const dirname = __dirname;
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const isSmoke = process.env.VAULTDESK_SMOKE === "1";

let mainWindow: BrowserWindow | null = null;

app.setName("VaultDesk");

if (process.env.VAULTDESK_USER_DATA) {
  fs.mkdirSync(process.env.VAULTDESK_USER_DATA, { recursive: true });
  app.setPath("userData", process.env.VAULTDESK_USER_DATA);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function rendererUrl(): string {
  if (process.env.ELECTRON_RENDERER_URL) return process.env.ELECTRON_RENDERER_URL;
  return pathToFileURL(path.join(dirname, "../renderer/index.html")).toString();
}

function isTrustedUrl(url: string): boolean {
  const target = rendererUrl();
  if (process.env.ELECTRON_RENDERER_URL) return url.startsWith(target);
  try {
    const parsed = new URL(url);
    const expected = new URL(target);
    return parsed.protocol === "file:" && parsed.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) {
    throw new VaultDeskError("unsupported", "IPC calls must come from the main app frame.");
  }
  if (!isTrustedUrl(frame.url)) {
    throw new VaultDeskError("unsupported", `Untrusted IPC origin: ${frame.url}`);
  }
}

function registerIpc(): void {
  ipcMain.handle("vaultdesk:invoke", async (event, request: unknown): Promise<IpcResponse> => {
    try {
      assertTrustedSender(event);
      const parsed = ipcRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new VaultDeskError("invalid-input", "Malformed IPC request.", {
          details: parsed.error.issues,
        });
      }
      const command = parsed.data.command as IpcCommand;
      if (!knownCommands.includes(command)) {
        throw new VaultDeskError("unsupported", `Unknown command: ${command}`);
      }
      const data = await runCommand(command, parsed.data.payload, { version: app.getVersion() });
      return { ok: true, data, warnings: warningsOf(data) };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  });

  ipcMain.handle("vaultdesk:choose-directory", async (event, raw: unknown): Promise<string | null> => {
    assertTrustedSender(event);
    const testChoice = process.env.VAULTDESK_TEST_DIRECTORY_FILE;
    if (testChoice) {
      try {
        const selected = fs.readFileSync(testChoice, "utf8").trim();
        if (selected) return selected;
      } catch {
        // No queued test selection.
      }
    }
    const options = (raw && typeof raw === "object" ? raw : {}) as DirectoryDialogOptions;
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const dialogOptions: OpenDialogOptions = {
      title: typeof options.title === "string" ? options.title : "选择目录",
      defaultPath: typeof options.defaultPath === "string" ? options.defaultPath : undefined,
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "选择",
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

function hardenWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // ignore malformed URLs
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      if (!isSmoke) {
        try {
          const parsed = new URL(url);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            void shell.openExternal(parsed.toString());
          }
        } catch {
          // ignore malformed URLs
        }
      }
    }
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "VaultDesk",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: "#f4efe4",
    vibrancy: "under-window",
    visualEffectState: "followWindow",
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
      additionalArguments: [
        `--vaultdesk-version=${app.getVersion()}`,
        `--vaultdesk-initial-vault=${process.env.VAULTDESK_INITIAL_VAULT ?? ""}`,
      ],
    },
  });

  hardenWebContents(window);

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    if (!isSmoke) console.error("Renderer process gone:", details.reason);
  });

  const url = rendererUrl();
  if (isDev) {
    void window.loadURL(url);
  } else {
    void window.loadFile(path.join(dirname, "../renderer/index.html"));
  }

  if (isSmoke) {
    window.webContents.once("did-finish-load", () => {
      const delay = Number(process.env.VAULTDESK_SMOKE_DELAY ?? 1800);
      const out = process.env.VAULTDESK_SMOKE_OUT ?? path.join(dirname, "../../smoke.png");
      setTimeout(async () => {
        try {
          const text = String(await window.webContents.executeJavaScript("document.body.innerText"));
          console.log(`SMOKE_TEXT ${text.replace(/\s+/g, " ").trim().slice(0, 600)}`);
          if (!text.trim()) throw new Error("Renderer body is empty");
          const expected = process.env.VAULTDESK_SMOKE_EXPECT;
          if (expected && !text.includes(expected)) {
            throw new Error(`Renderer did not show expected text: ${expected}`);
          }
          const image = await window.webContents.capturePage();
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, image.toPNG());
          console.log(`SMOKE_SCREENSHOT ${out}`);
          app.exit(0);
        } catch (error) {
          console.error("SMOKE_FAILED", error);
          app.exit(1);
        }
      }, Number.isFinite(delay) ? delay : 1800);
    });
  }

  return window;
}

function installCsp(): void {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ],
      },
    });
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

app.whenReady().then(() => {
  installCsp();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpc();
  app.setAboutPanelOptions({
    applicationName: "VaultDesk",
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2026 coderWang404",
    credits: "本地优先的技能仓库管理器",
  });

  mainWindow = createWindow();
  Menu.setApplicationMenu(buildAppMenu(mainWindow));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      if (mainWindow) Menu.setApplicationMenu(buildAppMenu(mainWindow));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || isSmoke) app.quit();
});

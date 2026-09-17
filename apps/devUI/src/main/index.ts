import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { electronApp, is } from "@electron-toolkit/utils";
import { PackageManager, PackageCompiler, LocalPackageStore } from "@pragmatic-tech-ai/todl/package-manager";
import { TokenStore } from "./registry/token-store.js";
import { SettingsStore } from "./registry/settings-store.js";
import { RegistryBridge } from "./registry/registry-bridge.js";
import { RegistryIpc } from "./registry/register-ipc.js";
import { SafeStorageEncryptor } from "./registry/safe-storage-encryptor.js";
import { Updater } from "@pragmatic-tech-ai/plexus-core/main/updater";
import { registerWindowHandlers, registerFileSystemHandlers } from "@pragmatic-tech-ai/plexus-core/main";
import { TITLE_BAR_HEIGHT } from "@pragmatic-tech-ai/plexus-core/shared/window-api.js";

// Initial WCO colours (Windows/Linux). devUI boots on MaterialDark, so seed the
// native caption strip to that scheme's title-bar surface + glyph ink; the
// renderer's theme hook (attachTitleBar) re-tints on first paint + every swap.
const INITIAL_OVERLAY = { color: "#1C1B1F", symbolColor: "#CAC4D0" };

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: "#1C1B1F", // Mural dark @Surface — no white flash on load
    // Custom title bar (shared PragmaticWindowChrome): hide the OS title bar but
    // keep the native min/max/close buttons as a Window Controls Overlay on
    // Windows/Linux (macOS floats traffic lights). The renderer paints its own
    // draggable strip of TITLE_BAR_HEIGHT under it.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? {}
      : { titleBarOverlay: { ...INITIAL_OVERLAY, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on("ready-to-show", () => window.show());

  if (is.dev && process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.pragmatic-tech-ai.devui");

  const userData = app.getPath("userData");
  // One shared local compiled-package store: compileDir registers into it and
  // every per-call PackageManager resolves against it (local-first).
  const localStore = new LocalPackageStore();
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(userData, new SafeStorageEncryptor()),
    settingsStore: new SettingsStore(userData),
    createManager: (config) => new PackageManager(config, localStore),
    createCompiler: () => new PackageCompiler(),
    localStore,
    env: process.env,
  });
  RegistryIpc.register(
    ipcMain,
    bridge,
    async () => {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return result.canceled || result.filePaths.length === 0 ? "" : result.filePaths[0]!;
    },
    async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .map((e) => ({ name: e.name, path: join(dir, e.name), isDirectory: e.isDirectory() }))
        .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    },
  );
  // Shared IO seam: the FileSystemStorage renderer service (window.api.fs) talks
  // to these node:fs handlers. (The registry's own fs:readDir browse stays in
  // RegistryIpc.) WCO re-tint bridge for the shared title bar too.
  registerFileSystemHandlers();
  registerWindowHandlers();

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  Updater.init();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

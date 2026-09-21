import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { electronApp, is } from "@electron-toolkit/utils";
import { PackageCompiler, LocalPackageStore } from "@pragmatic-tech-ai/todl/package-manager";
import { NodeModulesPackageSource } from "./registry/node-modules-package-source.js";
import { TokenStore } from "./registry/token-store.js";
import { SettingsStore } from "./registry/settings-store.js";
import { ConnectionTokenStore } from "./registry/connection-token-store.js";
import { FileConnectionStore } from "./registry/engine/file-connection-store.js";
import { EncryptedSecretStore } from "./registry/engine/encrypted-secret-store.js";
import { ProcessEnvironmentVariables } from "./registry/engine/process-environment-variables.js";
import { PackageEngine } from "./registry/engine/package-engine.js";
import { LegacyRegistryMigration } from "./registry/engine/legacy-registry-migration.js";
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

function createWindow(): void
{
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

  if (is.dev && process.env["ELECTRON_RENDERER_URL"] !== undefined)
  {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  }
  else
  {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.pragmatic-tech-ai.devui");

  const userData = app.getPath("userData");
  // One shared local compiled-package store: compileDir registers into it and
  // every per-connection PackageRegistryClient resolves against it (local-first).
  const localStore = new LocalPackageStore();
  const encryptor = new SafeStorageEncryptor();
  // The TODL package engine is the connection authority. devUI supplies the three
  // host seams: connections persisted to connections.json, tokens encrypted per
  // connection, and the process environment for env-sourced tokens.
  const connectionStore = new FileConnectionStore(userData);
  const secretStore = new EncryptedSecretStore(new ConnectionTokenStore(userData, encryptor));
  const environment = new ProcessEnvironmentVariables(process.env);
  // On first run, migrate the legacy single registry-settings.json + registry-token.bin
  // into one "GitHub Packages" connection so existing installs keep working.
  await new LegacyRegistryMigration({
    connectionStore,
    secretStore,
    legacySettings: new SettingsStore(userData),
    legacyToken: new TokenStore(userData, encryptor),
  }).MigrateIfNeeded();
  const engine = new PackageEngine({ connectionStore, secretStore, environment });
  const bridge = new RegistryBridge({
    service: engine.Service,
    createCompiler: (dir) => new PackageCompiler(new NodeModulesPackageSource(join(dir, "node_modules"))),
    localStore,
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

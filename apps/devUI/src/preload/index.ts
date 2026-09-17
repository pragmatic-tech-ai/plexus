import { contextBridge, ipcRenderer } from "electron";
import { WindowChannel, type OverlayColors } from "@pragmatic-tech-ai/plexus-core/shared/window-api.js";
import { createFileSystemBridge } from "@pragmatic-tech-ai/plexus-core/preload/file-system";

/**
 * The single `contextBridge` surface (design §5). Every method is a thin
 * `ipcRenderer.invoke` over a `registry:*` / `connections:*` channel — no
 * `ipcRenderer` itself is exposed. The typed shape lives in `renderer/env.d.ts`.
 */
const bridge = {
  registry: {
    list: (connectionId?: string) => ipcRenderer.invoke("registry:list", connectionId),
    versions: (name: string) => ipcRenderer.invoke("registry:versions", name),
    getContent: (ref: unknown) => ipcRenderer.invoke("registry:getContent", ref),
    getPackage: (ref: unknown) => ipcRenderer.invoke("registry:getPackage", ref),
    getMeta: (name: string) => ipcRenderer.invoke("registry:getMeta", name),
    resolveClosure: (rootDeps: string[]) => ipcRenderer.invoke("registry:resolveClosure", rootDeps),
    publishDir: (dir: string) => ipcRenderer.invoke("registry:publishDir", dir),
    compileDir: (dir: string) => ipcRenderer.invoke("registry:compileDir", dir),
    resolvePackage: (ref: unknown, connectionId?: string) => ipcRenderer.invoke("registry:resolvePackage", ref, connectionId),
    packageVersions: (model: string, connectionId?: string) => ipcRenderer.invoke("registry:packageVersions", model, connectionId),
    getSources: (ref: unknown) => ipcRenderer.invoke("registry:getSources", ref),
    getPackageContents: (name: string, connectionId?: string) => ipcRenderer.invoke("registry:getPackageContents", name, connectionId),
    deleteVersion: (name: string, version: string, connectionId?: string) => ipcRenderer.invoke("registry:deleteVersion", name, version, connectionId),
    deleteAllVersions: (name: string, connectionId?: string) => ipcRenderer.invoke("registry:deleteAllVersions", name, connectionId),
    bumpVersion: (dir: string) => ipcRenderer.invoke("registry:bumpVersion", dir),
  },
  connections: {
    list: () => ipcRenderer.invoke("connections:list"),
    add: (input: unknown) => ipcRenderer.invoke("connections:add", input),
    update: (id: string, partial: unknown) => ipcRenderer.invoke("connections:update", id, partial),
    remove: (id: string) => ipcRenderer.invoke("connections:remove", id),
    setToken: (id: string, token: string) => ipcRenderer.invoke("connections:setToken", id, token),
    useEnvToken: (id: string, name: string) => ipcRenderer.invoke("connections:useEnvToken", id, name),
    setDefault: (id: string) => ipcRenderer.invoke("connections:setDefault", id),
    test: (id: string) => ipcRenderer.invoke("connections:test", id),
    listEnvVars: () => ipcRenderer.invoke("connections:envVars"),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  },
  // Registry directory-browse only (returns DirEntry with absolute paths for the
  // publish/compile picker). General file IO now lives in the shared
  // window.api.fs (createFileSystemBridge) — see below.
  fs: {
    readDir: (path: string) => ipcRenderer.invoke("fs:readDir", path),
  },
};

contextBridge.exposeInMainWorld("todl", bridge);

// The shared `window.api` surface: the file-system IO seam (window.api.fs, read by
// plexus-core's FileSystemService) built by the shared createFileSystemBridge, plus
// the window-chrome bits the shared PragmaticWindowChrome title bar reads
// (attachTitleBar → window.api.titlebar + window.api.environment). `titlebar.setOverlay`
// re-tints the native caption buttons on every scheme change; `environment.Platform`
// lets the title bar tag <body> on macOS.
const api = {
  fs: createFileSystemBridge(ipcRenderer),
  titlebar: {
    setOverlay: (colors: OverlayColors): void => ipcRenderer.send(WindowChannel.SetOverlay, colors),
  },
  environment: {
    Platform: process.platform,
  },
};

contextBridge.exposeInMainWorld("api", api);

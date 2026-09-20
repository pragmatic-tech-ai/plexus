/**
 * Map the `registry:*` / `connections:*` / `dialog:*` IPC channels onto
 * `RegistryBridge` methods + a native directory picker (design §5). Channel names
 * MUST match the preload surface (`preload/index.ts`).
 */
import type { IpcMain } from "electron";
import type { ConnectionSpec } from "@pragmatic-tech-ai/todl/package-manager";
import type { RegistryBridge } from "./registry-bridge.js";

// One entry in a directory listing (design: the compiler side-pane folder tree).
// `path` is the absolute child path (joined main-side) so the renderer never
// composes paths; `isDirectory` drives lazy branch vs. leaf.
export interface DirEntry
{
  name: string;
  path: string;
  isDirectory: boolean;
}

export class RegistryIpc
{
  static register(
    ipcMain: IpcMain,
    bridge: RegistryBridge,
    pickDirectory: () => Promise<string>,
    readDir: (path: string) => Promise<DirEntry[]>,
  ): void
  {
    ipcMain.handle("registry:list", (_e, connectionId?: string) => bridge.list(connectionId));
    ipcMain.handle("registry:versions", (_e, name: string) => bridge.versions(name));
    ipcMain.handle("registry:getContent", (_e, ref) => bridge.getContent(ref));
    ipcMain.handle("registry:getPackage", (_e, ref) => bridge.getPackage(ref));
    ipcMain.handle("registry:getMeta", (_e, name: string) => bridge.getMeta(name));
    ipcMain.handle("registry:resolveClosure", (_e, rootDeps: string[]) => bridge.resolveClosure(rootDeps));
    ipcMain.handle("registry:publishDir", (_e, dir: string) => bridge.publishDir(dir));
    ipcMain.handle("registry:compileDir", (_e, dir: string) => bridge.compileDir(dir));
    ipcMain.handle("registry:resolvePackage", (_e, ref, connectionId?: string) => bridge.resolvePackage(ref, connectionId));
    ipcMain.handle("registry:packageVersions", (_e, model: string, connectionId?: string) => bridge.packageVersions(model, connectionId));
    ipcMain.handle("registry:getSources", (_e, ref) => bridge.getSources(ref));
    ipcMain.handle("registry:getPackageContents", (_e, name: string, connectionId?: string) => bridge.getPackageContents(name, connectionId));
    ipcMain.handle("registry:deleteVersion", (_e, name: string, version: string, connectionId?: string) => bridge.deleteVersion(name, version, connectionId));
    ipcMain.handle("registry:deleteAllVersions", (_e, name: string, connectionId?: string) => bridge.deleteAllVersions(name, connectionId));
    ipcMain.handle("registry:bumpVersion", (_e, dir: string) => bridge.bumpVersion(dir));
    ipcMain.handle("connections:list", () => bridge.listConnections());
    ipcMain.handle("connections:add", (_e, spec: ConnectionSpec) => bridge.addConnection(spec));
    ipcMain.handle("connections:update", (_e, id: string, partial: Partial<ConnectionSpec>) => bridge.updateConnection(id, partial));
    ipcMain.handle("connections:remove", (_e, id: string) => bridge.removeConnection(id));
    ipcMain.handle("connections:setToken", (_e, id: string, token: string) => bridge.setConnectionToken(id, token));
    ipcMain.handle("connections:useEnvToken", (_e, id: string, name: string) => bridge.useConnectionEnvToken(id, name));
    ipcMain.handle("connections:setDefault", (_e, id: string) => bridge.setDefaultConnection(id));
    ipcMain.handle("connections:test", (_e, id: string) => bridge.testConnection(id));
    ipcMain.handle("connections:envVars", () => bridge.listEnvVars());
    ipcMain.handle("dialog:pickDirectory", () => pickDirectory());
    ipcMain.handle("fs:readDir", (_e, path: string) => readDir(path));
  }
}

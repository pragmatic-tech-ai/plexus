import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  FileSystemChannel,
  type FileEntry,
  type IFileSystemApi,
  type ImportedFile,
  type OpenFileOptions,
  type OpenFileResult,
  type OpenFolderOptions,
  type SaveFileOptions,
} from '../shared/file-system-api.js'
import { EnvironmentChannel, type EnvironmentInfo } from '../shared/environment-api.js'
import { SettingsChannel, type ISettingsBridge } from '../shared/settings-api.js'
import { AgentChannel, type ApprovalRule, type IAgentApi, type ProjectCatalog, type TaggedAgentEvent } from '../shared/agent-api.js'
import { TodlLspChannel, type ITodlLspApi } from '../shared/todl-lsp-api.js'
import { FileWatchChannel, type FileChangeEvent, type IFileWatchApi } from '../shared/file-watch-api.js'
import { WindowChannel, type IWindowApi, type OverlayColors } from '../shared/window-api.js'
import { McpClientChannel, type IMcpClientApi, type McpProbeResult, type McpServerEntry } from '../shared/mcp-client-api.js'

// Preload — the ONLY place renderer and main meet, across the context bridge.
// Exposes Plexus's native surface as a small typed `api`. The renderer wraps
// `api.fs` in an injected mural service (FileSystemService) so app/view/VM
// code stays host-agnostic. Each method is a thin ipcRenderer.invoke to the
// matching main-process handler (registered in main/filesystem.ts).
const fs: IFileSystemApi = {
  openFile: (options?: OpenFileOptions): Promise<OpenFileResult | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFile, options),
  openFiles: (options?: OpenFileOptions): Promise<ImportedFile[] | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFiles, options),
  openFolder: (options?: OpenFolderOptions): Promise<string | null> =>
    ipcRenderer.invoke(FileSystemChannel.OpenFolder, options),
  saveFileAs: (content: string, options?: SaveFileOptions): Promise<string | null> =>
    ipcRenderer.invoke(FileSystemChannel.SaveFileAs, content, options),
  readText: (path: string): Promise<string> =>
    ipcRenderer.invoke(FileSystemChannel.ReadText, path),
  readBytes: (path: string): Promise<Uint8Array> =>
    ipcRenderer.invoke(FileSystemChannel.ReadBytes, path),
  writeText: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.WriteText, path, content),
  writeBytes: (path: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.WriteBytes, path, bytes),
  exists: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(FileSystemChannel.Exists, path),
  delete: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.Delete, path),
  createDirectory: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.CreateDirectory, path),
  rename: (from: string, to: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.Rename, from, to),
  listDirectory: (path: string): Promise<readonly FileEntry[]> =>
    ipcRenderer.invoke(FileSystemChannel.ListDirectory, path),
  openExternal: (path: string): Promise<void> =>
    ipcRenderer.invoke(FileSystemChannel.OpenExternal, path),
}

// Environment snapshot — read ONCE, synchronously, at preload load time. The
// facts are static, so a single blocking round-trip here is simpler than async
// plumbing and lets the renderer's EnvironmentService expose plain getters.
// Frozen so renderer code can't mutate the shared object.
const environment: EnvironmentInfo = Object.freeze(
  ipcRenderer.sendSync(EnvironmentChannel.GetSnapshot) as EnvironmentInfo,
)

// Settings bridge — the persisted values are read ONCE, synchronously, at load
// (so ApplicationSettings has real values at construction); saves are async and
// fire-and-forget. Backs the renderer's ElectronSettingsStore.
const settings: ISettingsBridge = {
  snapshot: Object.freeze(
    ipcRenderer.sendSync(SettingsChannel.GetSnapshot) as Record<string, unknown>,
  ),
  save: (values: Record<string, unknown>): void => {
    void ipcRenderer.invoke(SettingsChannel.Save, values)
  },
}

// Agent runtime bridge. Commands are ipcRenderer.invoke round-trips; onEvent
// subscribes to the pushed AgentChannel.Event stream and returns an unsubscribe.
// sendTurn forwards the working directory + extra dirs + text + model (matching
// the SendTurn handler).
const agent: IAgentApi = {
  startSession: (sessionId: string, workingDirectory: string, addDirs: readonly string[], resumeToken?: string, model?: string): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.StartSession, sessionId, workingDirectory, addDirs, resumeToken, model),
  closeSession: (sessionId: string): Promise<void> => ipcRenderer.invoke(AgentChannel.CloseSession, sessionId),
  sendTurn: (sessionId: string, workingDirectory: string, addDirs: readonly string[], text: string, model?: string): Promise<void> =>
    ipcRenderer.invoke(AgentChannel.SendTurn, sessionId, workingDirectory, addDirs, text, model),
  abort: (sessionId: string): Promise<void> => ipcRenderer.invoke(AgentChannel.Abort, sessionId),
  isResumable: (): Promise<boolean> => ipcRenderer.invoke(AgentChannel.IsResumable),
  listAgentsAndSkills: (projectDir: string): Promise<ProjectCatalog> =>
    ipcRenderer.invoke(AgentChannel.ListAgentsAndSkills, projectDir),
  answerQuestion: (answer): Promise<void> => ipcRenderer.invoke(AgentChannel.AnswerQuestion, answer),
  refreshProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.RefreshProjectResult, result),
  createProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.CreateProjectResult, result),
  getProblemsResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.GetProblemsResult, result),
  answerToolApproval: (answer): Promise<void> => ipcRenderer.invoke(AgentChannel.AnswerToolApproval, answer),
  listApprovalRules: (projectKey): Promise<ApprovalRule[]> => ipcRenderer.invoke(AgentChannel.ListApprovalRules, projectKey),
  revokeApprovalRule: (projectKey, rule): Promise<void> => ipcRenderer.invoke(AgentChannel.RevokeApprovalRule, projectKey, rule),
  onEvent: (handler: (msg: TaggedAgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, msg: TaggedAgentEvent): void => handler(msg)
    ipcRenderer.on(AgentChannel.Event, listener)
    return () => {
      ipcRenderer.removeListener(AgentChannel.Event, listener)
    }
  },
}

// TODL language server pipe. An opaque bridge: send/receive already-framed
// JSON-RPC message objects (no LSP types), plus a server-restart signal. The
// renderer builds its vscode-jsonrpc MessageConnection over this.
const todlLsp: ITodlLspApi = {
  send: (msg: unknown): void => ipcRenderer.send(TodlLspChannel.ToServer, msg),
  onMessage: (cb: (msg: unknown) => void): (() => void) => {
    const listener = (_e: unknown, msg: unknown): void => cb(msg)
    ipcRenderer.on(TodlLspChannel.FromServer, listener)
    return () => { ipcRenderer.removeListener(TodlLspChannel.FromServer, listener) }
  },
  onServerRestart: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(TodlLspChannel.ServerRestart, listener)
    return () => { ipcRenderer.removeListener(TodlLspChannel.ServerRestart, listener) }
  },
}

// External file-change watcher bridge. watch/unwatch are invoke round-trips;
// onChanged subscribes to the pushed FileWatchChannel.Changed stream and returns
// an unsubscribe — same shape as agent.onEvent.
const fileWatch: IFileWatchApi = {
  watch: (root: string): Promise<void> => ipcRenderer.invoke(FileWatchChannel.Watch, root),
  unwatch: (root: string): Promise<void> => ipcRenderer.invoke(FileWatchChannel.Unwatch, root),
  onChanged: (cb: (e: FileChangeEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: FileChangeEvent): void => cb(event)
    ipcRenderer.on(FileWatchChannel.Changed, listener)
    return () => { ipcRenderer.removeListener(FileWatchChannel.Changed, listener) }
  },
}

// Window-chrome bridge — the renderer's theme hook pushes fresh WCO colours on
// every scheme change; fire-and-forget (main re-tints or no-ops per platform).
const titlebar: IWindowApi = {
  setOverlay: (colors: OverlayColors): void => ipcRenderer.send(WindowChannel.SetOverlay, colors),
}

// MCP-client bridge — manage external MCP servers the agent may use. Each method
// is a thin invoke to the matching McpClientChannel handler (register-mcp-client).
const mcp: IMcpClientApi = {
  listGlobal: (): Promise<McpServerEntry[]> => ipcRenderer.invoke(McpClientChannel.ListGlobal),
  saveGlobal: (entries: McpServerEntry[]): Promise<void> => ipcRenderer.invoke(McpClientChannel.SaveGlobal, entries),
  listProject: (projectRoot: string): Promise<McpServerEntry[]> => ipcRenderer.invoke(McpClientChannel.ListProject, projectRoot),
  saveProject: (projectRoot: string, entries: McpServerEntry[]): Promise<void> =>
    ipcRenderer.invoke(McpClientChannel.SaveProject, projectRoot, entries),
  probe: (entry: McpServerEntry): Promise<McpProbeResult> => ipcRenderer.invoke(McpClientChannel.Probe, entry),
  listTools: (entry: McpServerEntry): Promise<string[]> => ipcRenderer.invoke(McpClientChannel.ListTools, entry),
  importCandidates: (projectRoot?: string): Promise<McpServerEntry[]> => ipcRenderer.invoke(McpClientChannel.ImportCandidates, projectRoot),
}

const api = { fs, environment, settings, agent, todlLsp, fileWatch, titlebar, mcp }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (contextIsolation disabled)
  window.electron = electronAPI
  // @ts-ignore (contextIsolation disabled)
  window.api = api
}

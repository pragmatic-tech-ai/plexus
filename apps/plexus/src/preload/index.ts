import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { createFileSystemBridge } from '@pragmatic-tech-ai/plexus-core/preload/file-system'
import { EnvironmentChannel, type EnvironmentInfo } from '@pragmatic-tech-ai/plexus-core/shared/environment-api.js'
import { SettingsChannel, type ISettingsBridge } from '@pragmatic-tech-ai/plexus-core/shared/settings-api.js'
import { AgentChannel, type ApprovalRule, type IAgentApi, type ProjectCatalog, type TaggedAgentEvent } from '../shared/agent-api.js'
import { SkillChannel, type SkillDescriptor } from '../shared/skill-api.js'
import { SkillContextChannel, type SkillContext, type ISkillContextApi } from '../shared/skill-context-api.js'
import { ModelPatchChannel } from '../shared/model-patch-api.js'
import { FileWatchChannel, type FileChangeEvent, type IFileWatchApi } from '@pragmatic-tech-ai/plexus-core/shared/file-watch-api.js'
import { WindowChannel, type IWindowApi, type OverlayColors } from '@pragmatic-tech-ai/plexus-core/shared/window-api.js'
import { McpClientChannel, type IMcpClientApi, type McpProbeResult, type McpServerEntry } from '../shared/mcp-client-api.js'
import { ConnectionChannel, type IConnectionsApi } from '../shared/connections-api.js'
import { PreviewServerChannel, type IPreviewServerApi } from '../shared/preview-server-api.js'
import { EnvironmentPublishChannel, type IEnvironmentPublishBridge } from '../shared/environment-publish-api.js'
import { RunTestChannel, type IRunTestBridge } from '../shared/run-test-api.js'
import { DevSessionChannel, type IDevSessionBridge } from '../shared/dev-session-api.js'
import { EnvSolutionsChannel, type IEnvSolutionsBridge } from '../shared/env-solutions-api.js'
import { GraphContributeChannel, type IGraphContributeBridge, type ContributedPackage } from '../shared/graph-contribute-api.js'
import { UploadChannel, type IUploadBridge, type UploadContribution, type UploadEntry } from '../shared/upload-api.js'
import { EnvironmentsChannel, type IEnvironmentsBridge } from '../shared/environment-contents-api.js'
import { BundleChannel } from '@pragmatic-tech-ai/plexus-core/shared/bundle-api.js'
import { AccountChannel, type AccountReply, type AccountState, type IAccountBridge, type RelayReply, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { BundleAppRequest, BundleAppResult } from '@pragmatic-tech-ai/todl/build-system-core'
import { TypeCheckChannel } from '@pragmatic-tech-ai/plexus-core/shared/type-check-api.js'
import type { TypeCheckRequest, TypeCheckResult } from '@pragmatic-tech-ai/todl/build-system-core'

// Preload — the ONLY place renderer and main meet, across the context bridge.
// Exposes Plexus's native surface as a small typed `api`. The renderer wraps
// `api.fs` in an injected mural service (FileSystemService) so app/view/VM
// code stays host-agnostic. The bridge itself is built by the shared
// createFileSystemBridge (plexus-core) so main + preload never drift; each method
// is a thin ipcRenderer.invoke to the matching handler (main/filesystem.ts).
const fs = createFileSystemBridge(ipcRenderer)

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
  listSkills: (projectDir: string): Promise<SkillDescriptor[]> =>
    ipcRenderer.invoke(SkillChannel.ListSkills, projectDir),
  answerQuestion: (answer): Promise<void> => ipcRenderer.invoke(AgentChannel.AnswerQuestion, answer),
  refreshProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.RefreshProjectResult, result),
  createProjectResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.CreateProjectResult, result),
  getProblemsResult: (result): Promise<void> => ipcRenderer.invoke(AgentChannel.GetProblemsResult, result),
  answerToolApproval: (answer): Promise<void> => ipcRenderer.invoke(AgentChannel.AnswerToolApproval, answer),
  resolveModelPatch: (answer): Promise<void> => ipcRenderer.invoke(ModelPatchChannel.Resolve, answer),
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
  quit: (): void => ipcRenderer.send(WindowChannel.Quit),
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

const skillContext: ISkillContextApi = {
  set: (sessionId: string, context: SkillContext): Promise<void> => ipcRenderer.invoke(SkillContextChannel.SetContext, sessionId, context),
  clear: (sessionId: string): Promise<void> => ipcRenderer.invoke(SkillContextChannel.ClearContext, sessionId),
}

// Package-registry connections bridge — each method a thin invoke to the matching
// ConnectionChannel handler (register-connections-ipc). Tokens are write-only; a token is
// never returned across the bridge (only ConnectionView.HasToken).
const connections: IConnectionsApi = {
  List: () => ipcRenderer.invoke(ConnectionChannel.List),
  Add: (spec) => ipcRenderer.invoke(ConnectionChannel.Add, spec),
  Update: (id, partial) => ipcRenderer.invoke(ConnectionChannel.Update, id, partial),
  Remove: (id) => ipcRenderer.invoke(ConnectionChannel.Remove, id),
  SetToken: (id, token) => ipcRenderer.invoke(ConnectionChannel.SetToken, id, token),
  UseEnvToken: (id, varName) => ipcRenderer.invoke(ConnectionChannel.UseEnvToken, id, varName),
  SetDefault: (id) => ipcRenderer.invoke(ConnectionChannel.SetDefault, id),
  Test: (id) => ipcRenderer.invoke(ConnectionChannel.Test, id),
  Inspect: (id) => ipcRenderer.invoke(ConnectionChannel.Inspect, id),
  EnvVars: () => ipcRenderer.invoke(ConnectionChannel.EnvVars),
  Providers: () => ipcRenderer.invoke(ConnectionChannel.Providers),
  Resolve: (id, version, connectionId) => ipcRenderer.invoke(ConnectionChannel.Resolve, id, version, connectionId),
}

// Preview-server bridge — serves a project's built html-bundle output over a local static
// file server. Each method a thin invoke to the matching PreviewServerChannel handler
// (register-preview-server-ipc).
const previewServer: IPreviewServerApi = {
  Start: (root: string) => ipcRenderer.invoke(PreviewServerChannel.Start, root),
  Stop: (root: string) => ipcRenderer.invoke(PreviewServerChannel.Stop, root),
}

// Tenant-publish and graph-contribute bridges: the main process reaches the environment through the
// relay of the target's source with that source's session, so no credential is ever passed or
// returned here: a target is only its Name and Source (main checks it and refuses anything else).
// Each call resolves to the handler's RelayReply envelope (the context bridge would reduce a
// rejection to "Error invoking remote method ..." around the sentence); the renderer services
// unwrap it with RelayWire.Unwrap.
class RelayBridge
{
  public static Call<T>(channel: string, ...args: unknown[]): Promise<RelayReply<T>>
  {
    return ipcRenderer.invoke(channel, ...args) as Promise<RelayReply<T>>
  }
}
const environmentPublish: IEnvironmentPublishBridge = {
  Deploy: (target: TargetRef, outputDir: string) => RelayBridge.Call(EnvironmentPublishChannel.Deploy, target, outputDir),
}
const runTest: IRunTestBridge = {
  Run: (target: TargetRef, outputDir: string) => RelayBridge.Call(RunTestChannel.Run, target, outputDir),
}
const graphContribute: IGraphContributeBridge = {
  Contribute: (target: TargetRef, graphName: string, solutionId: string, packages: ContributedPackage[]) =>
    RelayBridge.Call(GraphContributeChannel.Contribute, target, graphName, solutionId, packages),
  ListGraphs: (target: TargetRef) => RelayBridge.Call(GraphContributeChannel.ListGraphs, target),
}
const envSolutions: IEnvSolutionsBridge = {
  ListSolutions: (target: TargetRef) => RelayBridge.Call(EnvSolutionsChannel.ListSolutions, target),
}
const upload: IUploadBridge = {
  Upload: (target: TargetRef, solutionName: string, tree: UploadEntry[], contribution?: UploadContribution) =>
    RelayBridge.Call(UploadChannel.Upload, target, solutionName, tree, contribution),
}
const devSession: IDevSessionBridge = {
  Open: (target: TargetRef) => RelayBridge.Call(DevSessionChannel.Open, target),
  Close: () => RelayBridge.Call(DevSessionChannel.Close),
  ReadText: (path: string) => RelayBridge.Call(DevSessionChannel.ReadText, path),
  ReadBytes: (path: string) => RelayBridge.Call(DevSessionChannel.ReadBytes, path),
  WriteText: (path: string, content: string) => RelayBridge.Call(DevSessionChannel.WriteText, path, content),
  WriteBytes: (path: string, bytes: Uint8Array) => RelayBridge.Call(DevSessionChannel.WriteBytes, path, bytes),
  Exists: (path: string) => RelayBridge.Call(DevSessionChannel.Exists, path),
  Delete: (path: string) => RelayBridge.Call(DevSessionChannel.Delete, path),
  CreateDirectory: (path: string) => RelayBridge.Call(DevSessionChannel.CreateDirectory, path),
  Rename: (from: string, to: string) => RelayBridge.Call(DevSessionChannel.Rename, from, to),
  List: (path: string) => RelayBridge.Call(DevSessionChannel.List, path),
  OnChanged: (cb): (() => void) => {
    const listener = (_e: unknown, change: Parameters<typeof cb>[0]): void => cb(change)
    ipcRenderer.on(DevSessionChannel.Changed, listener)
    return () => { ipcRenderer.removeListener(DevSessionChannel.Changed, listener) }
  },
  OnGraphChanged: (cb): (() => void) => {
    const listener = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on(DevSessionChannel.GraphChanged, listener)
    return () => { ipcRenderer.removeListener(DevSessionChannel.GraphChanged, listener) }
  },
  OnBuildStateChanged: (cb): (() => void) => {
    const listener = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on(DevSessionChannel.BuildStateChanged, listener)
    return () => { ipcRenderer.removeListener(DevSessionChannel.BuildStateChanged, listener) }
  },
  OnDiagnostics: (cb): (() => void) => {
    const listener = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on(DevSessionChannel.Diagnostics, listener)
    return () => { ipcRenderer.removeListener(DevSessionChannel.Diagnostics, listener) }
  },
  SelectAuthoring: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.SelectAuthoring, ...args),
  ListSolutions: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.ListSolutions, ...args),
  ActiveSolution: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.ActiveSolution, ...args),
  CompletionsAt: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.CompletionsAt, ...args),
  HoverAt: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.HoverAt, ...args),
  DefinitionAt: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.DefinitionAt, ...args),
  ReferencesAt: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.ReferencesAt, ...args),
  PrepareRename: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.PrepareRename, ...args),
  RenameEdits: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.RenameEdits, ...args),
  DocumentSymbols: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.DocumentSymbols, ...args),
  FoldingRanges: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.FoldingRanges, ...args),
  WorkspaceSymbols: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.WorkspaceSymbols, ...args),
  SemanticTokens: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.SemanticTokens, ...args),
  SignatureHelpAt: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.SignatureHelpAt, ...args),
  CodeActions: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.CodeActions, ...args),
  FormatDocument: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.FormatDocument, ...args),
  DiagnosticsFor: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.DiagnosticsFor, ...args),
  ModelView: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.ModelView, ...args),
  Resources: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.Resources, ...args),
  DidChange: (...args: unknown[]) => RelayBridge.Call(DevSessionChannel.DidChange, ...args),
}
const environments: IEnvironmentsBridge = {
  Contents: (target: TargetRef) => RelayBridge.Call(EnvironmentsChannel.Contents, target),
}

// Account bridge: sign in by email through the system browser. Every call resolves to the main
// handler's AccountReply envelope, never a rejection: the context bridge would strip a thrown
// AccountError down to its message, while the plain envelope crosses intact. The renderer seam
// rebuilds failures with AccountWire.Unwrap. No answer ever carries the session token.
class AccountBridge
{
  public static Call<T>(channel: AccountChannel, ...args: unknown[]): Promise<AccountReply<T>>
  {
    return ipcRenderer.invoke(channel, ...args) as Promise<AccountReply<T>>
  }
}
const account: IAccountBridge = {
  State: () => AccountBridge.Call(AccountChannel.State),
  Discover: (platformUrl, email) => AccountBridge.Call(AccountChannel.Discover, platformUrl, email),
  SignIn: (platformUrl, email, tenantId) => AccountBridge.Call(AccountChannel.SignIn, platformUrl, email, tenantId),
  SignInAtConsole: (consoleUrl, email) => AccountBridge.Call(AccountChannel.SignInAtConsole, consoleUrl, email),
  SignInAtPlatform: () => AccountBridge.Call(AccountChannel.SignInAtPlatform),
  CancelSignIn: () => AccountBridge.Call(AccountChannel.CancelSignIn),
  SignOut: () => AccountBridge.Call(AccountChannel.SignOut),
  Targets: () => AccountBridge.Call(AccountChannel.Targets),
  LastChoice: (kind) => AccountBridge.Call(AccountChannel.LastChoice, kind),
  RememberChoice: (kind, choice) => AccountBridge.Call(AccountChannel.RememberChoice, kind, choice),
  OnChanged: (cb: (s: AccountState) => void): (() => void) => {
    const listener = (_e: unknown, state: AccountState): void => cb(state)
    ipcRenderer.on(AccountChannel.Changed, listener)
    return () => { ipcRenderer.removeListener(AccountChannel.Changed, listener) }
  },
}

// Bundler bridge — the html-bundle esbuild bundle runs in main; the renderer's IpcBundler
// invokes this single channel.
const bundle = {
  Bundle: (request: BundleAppRequest): Promise<BundleAppResult> => ipcRenderer.invoke(BundleChannel.Bundle, request),
}

// Type-check bridge — the html-bundle tsc pass runs in main; the renderer's IpcTypeChecker
// invokes this single channel.
const typeCheck = {
  Check: (request: TypeCheckRequest): Promise<TypeCheckResult> => ipcRenderer.invoke(TypeCheckChannel.Check, request),
}

const api = { fs, environment, settings, agent, fileWatch, titlebar, mcp, skillContext, connections, previewServer, environmentPublish, runTest, graphContribute, envSolutions, upload, devSession, environments, account, bundle, typeCheck }

if (process.contextIsolated)
{
  try
  {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  }
  catch (error)
  {
    console.error(error)
  }
}
else
{
  // @ts-ignore (contextIsolation disabled)
  window.electron = electronAPI
  // @ts-ignore (contextIsolation disabled)
  window.api = api
}

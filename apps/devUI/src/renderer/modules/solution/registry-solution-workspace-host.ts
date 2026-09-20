import type {
  ISolutionWorkspaceHost,
  SolutionConnection,
  MemberCompileResult,
} from "@pragmatic-tech-ai/plexus-core/renderer/modules/solution-studio";
import type { RegistryClient } from "../../services/registry/registry-client.js";
import type { IpcPackageSource } from "./ipc-package-source.js";

// devUI's implementation of the Solution Explorer's app-specific seam, over the
// main-side registry IPC bridge. Folder picking, the connection list, and member
// compilation come from RegistryClient; connection routing points the shared
// IpcPackageSource (the same instance SolutionManagerService.Compose resolves) at
// the solution's assigned connection. This is the only place the plexus-core
// Solution presentation touches the registry — everything else stays generic.
export class RegistrySolutionWorkspaceHost implements ISolutionWorkspaceHost
{
  constructor(
    private readonly registry: RegistryClient,
    private readonly packageSource: IpcPackageSource,
  ) {}

  async PickSolutionFolder(): Promise<string | undefined>
  {
    const dir = await this.registry.pickDirectory();
    return dir.length === 0 ? undefined : dir;
  }

  async ListConnections(): Promise<readonly SolutionConnection[]>
  {
    const views = await this.registry.listConnections();
    return views.map((v) => ({ Id: v.Id, Name: v.DisplayName }));
  }

  async CompileMember(absDir: string): Promise<MemberCompileResult>
  {
    const view = await this.registry.compileDir(absDir);
    return { Ok: view.ok, Id: view.id, Version: view.version, DiagnosticCount: view.diagnostics.length };
  }

  SetActiveConnection(connectionId: string | undefined): void
  {
    this.packageSource.SetConnection(connectionId);
  }
}

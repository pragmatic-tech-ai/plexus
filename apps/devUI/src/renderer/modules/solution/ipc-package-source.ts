import type { PackageSource, PackageRef, ResolvedPackage } from "@pragmatic-tech-ai/todl/domain";
import type { RegistryClient } from "../../services/registry/registry-client.js";

// The renderer-side Domain backend: every resolve/versions call is served by the
// main process over the registry IPC (local store first, network fallback). This
// is what SolutionManagerService.Compose loads members through.
//
// Connection-aware: the active solution assigns a connection (SetConnection), so
// Compose resolves its members + dependencies from THAT registry. Undefined ⇒ the
// default connection.
export class IpcPackageSource implements PackageSource
{
  private connectionId: string | undefined = undefined;

  constructor(private readonly client: RegistryClient) {}

  /** Point subsequent resolve/versions calls at a specific connection (or the
   *  default when undefined). Called by SolutionExplorerService when the active
   *  solution's assigned connection changes. */
  SetConnection(connectionId: string | undefined): void
  {
    this.connectionId = connectionId;
  }

  resolve(ref: PackageRef): Promise<ResolvedPackage>
  {
    return this.client.resolvePackage(ref, this.connectionId);
  }

  versions(model: string): Promise<readonly string[]>
  {
    return this.client.packageVersions(model, this.connectionId);
  }
}

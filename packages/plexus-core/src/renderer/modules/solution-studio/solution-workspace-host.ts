import { ServiceKey } from "@pragmatic-tech-ai/mural/runtime";

// A registry connection a solution can compile/compose against — a stable id
// plus a display name. The panel persists the id (in solution.json) and shows
// the name; the host maps between them and the underlying registry.
export interface SolutionConnection {
  readonly Id: string;
  readonly Name: string;
}

// The outcome of compiling one solution member into the local package store:
// its resolved package id + version when it compiled, plus a diagnostic count.
export interface MemberCompileResult {
  readonly Ok: boolean;
  readonly Id: string | undefined;
  readonly Version: string | undefined;
  readonly DiagnosticCount: number;
}

// The app-specific operations the Solution Explorer needs but plexus-core can't
// implement itself — folder picking, the registry-connection list, member
// compilation, and routing the active connection to the package source. A host
// (e.g. devUI, over its registry IPC bridge) implements this and registers it
// under SolutionWorkspaceHostKey; the panel resolves it and stays free of any
// registry/IPC knowledge. This is the seam that lets the whole Solution presentation
// live in plexus-core.
export interface ISolutionWorkspaceHost {
  // Prompt for a solution folder (New / Open). Undefined when cancelled.
  PickSolutionFolder(): Promise<string | undefined>;

  // The registry connections a solution may be assigned to (empty ⇒ the picker
  // hides). The panel binds their names and persists the chosen id.
  ListConnections(): Promise<readonly SolutionConnection[]>;

  // Compile a member folder into the local package store, yielding its package
  // ref so the manager can compose the members into one Domain graph.
  CompileMember(absDir: string): Promise<MemberCompileResult>;

  // Point the package source at the solution's assigned connection (undefined ⇒
  // the default), so subsequent resolves read from that registry.
  SetActiveConnection(connectionId: string | undefined): void;
}

// DI token the panel resolves the host under, and a host registers its impl under.
export const SolutionWorkspaceHostKey = new ServiceKey<ISolutionWorkspaceHost>("SolutionWorkspaceHost");

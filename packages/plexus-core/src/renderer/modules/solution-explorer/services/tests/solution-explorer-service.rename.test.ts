import { describe, it, expect } from "vitest";
import { ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { NodeKey, type HierarchyItem } from "@pragmatic-tech-ai/mural/framework/hierarchy";
import { SolutionExplorerService } from "../solution-explorer-service.js";
import { SolutionCommandsService } from "../solution-commands-service.js";

// CommitRename is the host callback the TreeView fires when an inline (F2) rename commits.
// The Solution root is NOT a file member, so it must route to the solution commands service
// (RenameTo) rather than FileTreeContributor.RenameNode, which keys off a member and silently
// no-ops for the Solution node — the bug where renaming the solution from the tree did nothing.
function makeService(record: { renamedTo?: string; filesHit?: boolean }): SolutionExplorerService
{
  const commands = { RenameTo: (name: string) => { record.renamedTo = name; return Promise.resolve(); } };
  const provider = {
    get: (key: unknown) => (key === SolutionCommandsService.Key ? commands : undefined),
  } as unknown as ServiceProvider;
  return new SolutionExplorerService(provider);
}

describe("SolutionExplorerService.CommitRename", () =>
{
  it("routes a Solution-node inline rename to the solution commands service", () =>
  {
    const record: { renamedTo?: string } = {};
    const svc = makeService(record);
    svc.CommitRename({ Key: NodeKey.Solution } as unknown as HierarchyItem, "Renamed From Tree");
    expect(record.renamedTo).toBe("Renamed From Tree");
  });

  it("does not route a non-solution node to the solution commands service", () =>
  {
    const record: { renamedTo?: string } = {};
    const svc = makeService(record);
    // No active file-tree contributor (pre-rebuild) → the member path is a safe no-op; the key
    // check must not misroute a file node into the solution rename.
    svc.CommitRename({ Key: "file" } as unknown as HierarchyItem, "x.todl");
    expect(record.renamedTo).toBeUndefined();
  });
});

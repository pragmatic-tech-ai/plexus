import { describe, it, expect } from "vitest";
import { NodeKey, type HierarchyItem } from "@pragmatic-tech-ai/mural/framework/hierarchy";
import { SolutionExplorerService } from "../solution-explorer-service.js";

function node(key: string, caption: string): { Key: string; Caption: string }
{
  return { Key: key, Caption: caption };
}

describe("SolutionExplorerService.ApplySolutionCaption", () =>
{
  it("updates the visible Solution node's caption to the new name", () =>
  {
    const solution = node(NodeKey.Solution, "Default Solution");
    const other = node("other", "untouched");
    SolutionExplorerService.ApplySolutionCaption([other, solution] as unknown as HierarchyItem[], "My Solution");
    expect(solution.Caption).toBe("My Solution");
    expect(other.Caption).toBe("untouched");
  });

  it("falls back to 'Solution' when the new name is blank", () =>
  {
    const solution = node(NodeKey.Solution, "Default Solution");
    SolutionExplorerService.ApplySolutionCaption([solution] as unknown as HierarchyItem[], "");
    expect(solution.Caption).toBe("Solution");
  });

  it("does nothing (no throw) when there is no Solution node", () =>
  {
    const other = node("other", "x");
    expect(() => SolutionExplorerService.ApplySolutionCaption([other] as unknown as HierarchyItem[], "Y")).not.toThrow();
    expect(other.Caption).toBe("x");
  });
});

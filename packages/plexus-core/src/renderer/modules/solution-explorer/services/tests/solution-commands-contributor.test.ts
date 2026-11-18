import { describe, it, expect } from "vitest";
import { NodeKey } from "@pragmatic-tech-ai/mural/framework/hierarchy";
import type { CommandContext } from "@pragmatic-tech-ai/mural/framework";
import type { ICommand } from "@pragmatic-tech-ai/mural/runtime";
import SolutionCommandsContributor from "../solution-commands-contributor.js";
import type { SolutionCommandsService } from "../solution-commands-service.js";

const save = { id: "save" } as unknown as ICommand;
const saveAs = { id: "saveAs" } as unknown as ICommand;
const rename = { id: "rename" } as unknown as ICommand;

function contributor(): SolutionCommandsContributor
{
  const commands = { SaveCommand: save, SaveAsCommand: saveAs, RenameCommand: rename } as unknown as SolutionCommandsService;
  return new SolutionCommandsContributor(commands);
}

const ctx = {} as CommandContext;

describe("SolutionCommandsContributor", () =>
{
  it("contributes Save / Save As… / Rename… on the Solution row", () =>
  {
    const c = contributor();
    expect(c.ParentKeys).toEqual([NodeKey.Solution]);
    expect(c.Actions.map((a) => a.Id)).toEqual([
      SolutionCommandsContributor.SaveCommandId,
      SolutionCommandsContributor.SaveAsCommandId,
      SolutionCommandsContributor.RenameCommandId,
    ]);
    expect(c.Actions.map((a) => a.Title)).toEqual(["Save", "Save As…", "Rename…"]);
  });

  it("resolves each command id to the service's command", () =>
  {
    const c = contributor();
    expect(c.Resolve(SolutionCommandsContributor.SaveCommandId, ctx)).toBe(save);
    expect(c.Resolve(SolutionCommandsContributor.SaveAsCommandId, ctx)).toBe(saveAs);
    expect(c.Resolve(SolutionCommandsContributor.RenameCommandId, ctx)).toBe(rename);
  });

  it("resolves an unknown command id to undefined", () =>
  {
    expect(contributor().Resolve("solution.nope", ctx)).toBeUndefined();
  });
});

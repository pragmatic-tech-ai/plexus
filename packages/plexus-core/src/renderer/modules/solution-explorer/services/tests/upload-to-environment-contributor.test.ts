import { describe, it, expect } from "vitest";
import type { Solution, SolutionManagerService } from "@pragmatic-tech-ai/todl";
import type { IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import { UploadToEnvironmentContributor } from "../upload-to-environment-contributor.js";

class StubSolution
{
  constructor(public HasLocation: boolean, public Name = "S") {}
}

class StubManager
{
  public saved = 0;
  public throwOnSave = false;
  public ActiveSolution: StubSolution | undefined;
  constructor(private readonly rooted?: StubSolution) {}
  Save(): Promise<void>
  {
    if (this.throwOnSave) { return Promise.reject(new Error("disk full")); }
    this.saved++;
    if (this.rooted !== undefined) { this.ActiveSolution = this.rooted; }
    return Promise.resolve();
  }
}

class StubPrompts
{
  public confirms = 0;
  constructor(private readonly answer: boolean) {}
  Confirm(): Promise<boolean> { this.confirms++; return Promise.resolve(this.answer); }
}

class StubDialogs
{
  public shownTitle: string | undefined;
  Show<T>(options: { Title?: string }): Promise<T | undefined> { this.shownTitle = options.Title; return Promise.resolve(undefined as T); }
  Close(): void {}
}

function make(solution: StubSolution, manager?: StubManager, prompts?: StubPrompts, dialogs?: StubDialogs): UploadToEnvironmentContributor
{
  return new UploadToEnvironmentContributor(
    solution as unknown as Solution,
    undefined, undefined, undefined, undefined,
    dialogs as unknown as never,
    undefined,
    manager as unknown as SolutionManagerService,
    prompts as unknown as IPromptService,
  );
}

describe("UploadToEnvironmentContributor.EnsureSaved", () =>
{
  it("returns the solution unchanged when it already has a location (no offer)", async () =>
  {
    const sol = new StubSolution(true);
    const prompts = new StubPrompts(true);
    const c = make(sol, new StubManager(), prompts);
    expect(await c.EnsureSaved()).toBe(sol);
    expect(prompts.confirms).toBe(0);
  });

  it("offers to save an unsaved solution and returns the rooted active solution on confirm", async () =>
  {
    const unsaved = new StubSolution(false);
    const rooted = new StubSolution(true);
    const manager = new StubManager(rooted);
    const prompts = new StubPrompts(true);
    const result = await make(unsaved, manager, prompts).EnsureSaved();
    expect(prompts.confirms).toBe(1);
    expect(manager.saved).toBe(1);
    expect(result).toBe(rooted);
  });

  it("returns undefined and does not save when the offer is declined", async () =>
  {
    const unsaved = new StubSolution(false);
    const manager = new StubManager(new StubSolution(true));
    const c = make(unsaved, manager, new StubPrompts(false));
    expect(await c.EnsureSaved()).toBeUndefined();
    expect(manager.saved).toBe(0);
  });

  it("returns undefined when the save left the solution unsaved (folder pick cancelled)", async () =>
  {
    const unsaved = new StubSolution(false);
    const manager = new StubManager();
    manager.ActiveSolution = unsaved;
    const c = make(unsaved, manager, new StubPrompts(true));
    expect(await c.EnsureSaved()).toBeUndefined();
  });

  it("falls back to the solution (its enumerator surfaces the original error) with no save seam", async () =>
  {
    const unsaved = new StubSolution(false);
    expect(await make(unsaved).EnsureSaved()).toBe(unsaved);
  });

  it("surfaces a save failure in a dialog and aborts (does not throw)", async () =>
  {
    const unsaved = new StubSolution(false);
    const manager = new StubManager();
    manager.throwOnSave = true;
    const dialogs = new StubDialogs();
    const result = await make(unsaved, manager, new StubPrompts(true), dialogs).EnsureSaved();
    expect(result).toBeUndefined();
    expect(dialogs.shownTitle).toBeDefined();
  });
});

import { describe, it, expect } from "vitest";
import { ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService } from "@pragmatic-tech-ai/todl";
import type { IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import { FileSystemService } from "../../../storage/index.js";
import SolutionCommandsService from "../solution-commands-service.js";

interface ActiveStub { Name: string; HasLocation: boolean }

class StubManager
{
  public saved = 0;
  public savedAs: string | undefined;
  public renamed: string | undefined;
  public throwOnSave = false;
  public ActiveSolution: ActiveStub | undefined;
  constructor(active?: ActiveStub) { this.ActiveSolution = active; }
  Save(): Promise<void>
  {
    if (this.throwOnSave) { return Promise.reject(new Error("disk full")); }
    this.saved++;
    return Promise.resolve();
  }
  SaveAs(location: string): Promise<void> { this.savedAs = location; return Promise.resolve(); }
  Rename(name: string): Promise<void> { this.renamed = name; return Promise.resolve(); }
}

class StubFs
{
  constructor(private readonly folder: string | null) {}
  OpenFolder(): Promise<string | null> { return Promise.resolve(this.folder); }
}

class StubPrompts
{
  public lastLabel: string | undefined;
  public lastInitial: string | undefined;
  constructor(private readonly answer: string | undefined) {}
  PromptText(label: string, initial?: string): Promise<string | undefined>
  {
    this.lastLabel = label;
    this.lastInitial = initial;
    return Promise.resolve(this.answer);
  }
}

class StubDialogs
{
  public shownTitle: string | undefined;
  Show<T>(options: { Title?: string }): Promise<T | undefined>
  {
    this.shownTitle = options.Title;
    return Promise.resolve(undefined as T);
  }
  Close(): void {}
}

function build(opts: { active?: ActiveStub; folder?: string | null; rename?: string | undefined }): {
  svc: SolutionCommandsService; manager: StubManager; dialogs: StubDialogs; prompts: StubPrompts;
}
{
  const manager = new StubManager(opts.active);
  const fs = new StubFs(opts.folder ?? null);
  const prompts = new StubPrompts(opts.rename);
  const dialogs = new StubDialogs();
  const sp = new ServiceProvider();
  sp.register(SolutionManagerService.Key, () => manager as unknown as SolutionManagerService);
  sp.register(FileSystemService.Key, () => fs as unknown as FileSystemService);
  sp.register(SolutionManagerService.PromptServiceKey, () => prompts as unknown as IPromptService);
  sp.register(DialogService.Key, () => dialogs as unknown as DialogService);
  const svc = new SolutionCommandsService(sp);
  return { svc, manager, dialogs, prompts };
}

const active: ActiveStub = { Name: "Default Solution", HasLocation: false };

describe("SolutionCommandsService", () =>
{
  it("Save drives the engine's Save (which prompts for a folder when untitled)", async () =>
  {
    const { svc, manager } = build({ active });
    await svc.Save();
    expect(manager.saved).toBe(1);
  });

  it("Save As picks a folder and calls SaveAs with it", async () =>
  {
    const { svc, manager } = build({ active, folder: "C:/work/sol" });
    await svc.SaveAs();
    expect(manager.savedAs).toBe("C:/work/sol");
  });

  it("Save As does nothing when the folder pick is cancelled", async () =>
  {
    const { svc, manager } = build({ active, folder: null });
    await svc.SaveAs();
    expect(manager.savedAs).toBeUndefined();
  });

  it("Rename prompts seeded with the current name and renames to the typed name", async () =>
  {
    const { svc, manager, prompts } = build({ active, rename: "My Solution" });
    await svc.Rename();
    expect(prompts.lastInitial).toBe("Default Solution");
    expect(manager.renamed).toBe("My Solution");
  });

  it("Rename does nothing when the prompt is cancelled", async () =>
  {
    const { svc, manager } = build({ active, rename: undefined });
    await svc.Rename();
    expect(manager.renamed).toBeUndefined();
  });

  it("Rename does nothing when the name is unchanged", async () =>
  {
    const { svc, manager } = build({ active: { Name: "Same", HasLocation: true }, rename: "Same" });
    await svc.Rename();
    expect(manager.renamed).toBeUndefined();
  });

  it("commands cannot execute when there is no active solution", () =>
  {
    const { svc } = build({});
    expect(svc.SaveCommand.CanExecute()).toBe(false);
    expect(svc.SaveAsCommand.CanExecute()).toBe(false);
    expect(svc.RenameCommand.CanExecute()).toBe(false);
  });

  it("commands can execute when a solution is active", () =>
  {
    const { svc } = build({ active });
    expect(svc.SaveCommand.CanExecute()).toBe(true);
  });

  it("surfaces an engine failure through an info dialog", async () =>
  {
    const { svc, manager, dialogs } = build({ active });
    manager.throwOnSave = true;
    await svc.Save();
    expect(dialogs.shownTitle).toBeDefined();
  });
});

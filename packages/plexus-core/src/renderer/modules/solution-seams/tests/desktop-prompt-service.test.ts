import { describe, it, expect } from "vitest";
import type { IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import type { FileSystemService } from "../../storage/file-system-service.js";
import type { OpenFileResult } from "../../../../shared/file-system-api.js";
import { DesktopPromptService } from "../desktop-prompt-service.js";

// A FileSystemService stand-in: the two native pickers DesktopPromptService uses.
class StubFs
{
  public folderOptions: unknown;
  constructor(
    private readonly folder: string | null,
    private readonly file: OpenFileResult | null = null) {}
  OpenFolder(options?: unknown): Promise<string | null>
  {
    this.folderOptions = options;
    return Promise.resolve(this.folder);
  }
  OpenFile(): Promise<OpenFileResult | null>
  {
    return Promise.resolve(this.file);
  }
}

// An inner IPromptService that records the generic asks delegated to it.
class StubInner
{
  public confirmed = false;
  public prompted: { label: string; initial?: string } | undefined;
  Ask(): Promise<never> { throw new Error("unused"); }
  Confirm(): Promise<boolean> { this.confirmed = true; return Promise.resolve(true); }
  PickFolder(): Promise<string | undefined> { return Promise.resolve(undefined); }
  PickFile(): Promise<string | undefined> { return Promise.resolve(undefined); }
  PromptText(label: string, initial?: string): Promise<string | undefined>
  {
    this.prompted = { label, initial };
    return Promise.resolve("delegated");
  }
  Choose(): Promise<undefined> { return Promise.resolve(undefined); }
}

function make(fs: StubFs): { svc: DesktopPromptService; inner: StubInner }
{
  const inner = new StubInner();
  const svc = new DesktopPromptService(inner as unknown as IPromptService, fs as unknown as FileSystemService);
  return { svc, inner };
}

describe("DesktopPromptService", () =>
{
  it("PickFolder returns the native picker's chosen path", async () =>
  {
    const { svc } = make(new StubFs("C:/work/solution"));
    expect(await svc.PickFolder("Save solution to…")).toBe("C:/work/solution");
  });

  it("PickFolder returns undefined when the native picker is cancelled", async () =>
  {
    const { svc } = make(new StubFs(null));
    expect(await svc.PickFolder("Save solution to…")).toBeUndefined();
  });

  it("PickFile returns the chosen file's path", async () =>
  {
    const { svc } = make(new StubFs(null, { Path: "C:/work/a.txt", Content: "hi" }));
    expect(await svc.PickFile("Pick a file")).toBe("C:/work/a.txt");
  });

  it("PickFile returns undefined when cancelled", async () =>
  {
    const { svc } = make(new StubFs(null, null));
    expect(await svc.PickFile("Pick a file")).toBeUndefined();
  });

  it("delegates Confirm to the inner generic prompt service", async () =>
  {
    const { svc, inner } = make(new StubFs(null));
    await svc.Confirm("Sure?");
    expect(inner.confirmed).toBe(true);
  });

  it("delegates PromptText to the inner generic prompt service", async () =>
  {
    const { svc, inner } = make(new StubFs(null));
    expect(await svc.PromptText("Solution name", "Default Solution")).toBe("delegated");
    expect(inner.prompted).toEqual({ label: "Solution name", initial: "Default Solution" });
  });
});

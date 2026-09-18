import { describe, it, expect } from "vitest";
import type { DialogService } from "@pragmatic-tech-ai/mural/framework";
import { ConfirmAsk, PickFolderAsk } from "@pragmatic-tech-ai/todl-runtime";
import { DialogPromptService } from "../dialog-prompt-service.js";

// A DialogService stand-in: records the options it was shown and resolves a
// scripted result (true / false / undefined) — the three ways the real dialog
// closes (confirm / cancel / scrim dismiss).
class ScriptedDialogs {
  public shown: { Title?: string; Actions?: { Label?: string }[] } | undefined;
  constructor(private readonly resolved: boolean | undefined) {}
  Show<T>(options: unknown): Promise<T | undefined> {
    this.shown = options as { Title?: string; Actions?: { Label?: string }[] };
    return Promise.resolve(this.resolved as T);
  }
  Close(): void {}
}

function service(resolved: boolean | undefined): { svc: DialogPromptService; dialogs: ScriptedDialogs } {
  const dialogs = new ScriptedDialogs(resolved);
  return { svc: new DialogPromptService(dialogs as unknown as DialogService), dialogs };
}

describe("DialogPromptService", () => {
  it("resolves a ConfirmAsk to true when the dialog confirms", async () => {
    const { svc } = service(true);
    expect(await svc.Ask(new ConfirmAsk("Discard changes?", "Discard"))).toBe(true);
  });

  it("resolves a ConfirmAsk to false on cancel", async () => {
    const { svc } = service(false);
    expect(await svc.Ask(new ConfirmAsk("Discard changes?", "Discard"))).toBe(false);
  });

  it("treats a scrim dismiss (undefined) as not confirmed", async () => {
    const { svc } = service(undefined);
    expect(await svc.Ask(new ConfirmAsk("Discard changes?"))).toBe(false);
  });

  it("shows the ask's title and confirm label on the dialog", async () => {
    const { svc, dialogs } = service(true);
    await svc.Confirm("Discard changes?", "Discard");
    expect(dialogs.shown?.Title).toBe("Confirm");
    expect(dialogs.shown?.Actions?.map((a) => a.Label)).toEqual(["Cancel", "Discard"]);
  });

  it("throws for an ask it has no handler for (e.g. a folder pick)", async () => {
    const { svc } = service(true);
    await expect(svc.Ask(new PickFolderAsk("Pick a folder"))).rejects.toThrow(/no handler/);
  });
});

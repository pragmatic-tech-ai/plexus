import type { Ask, Choice, FileFilter, IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import type { FileSystemService } from "../storage/file-system-service.js";

// The DESKTOP host's IPromptService: the generic in-app asks (Confirm /
// PromptText / Choose, and the raw Ask dispatch) are delegated to the composed
// generic DialogPromptService, while the host-specific native pickers
// (PickFolder / PickFile) are served over the Electron FileSystemService bridge
// the generic shell deliberately leaves unimplemented. Registered under
// SolutionManagerService.PromptServiceKey for the Plexus app so the engine's
// Save-untitled / Save-As folder pick reaches a real OS dialog; the native
// `null` (cancel) is mapped to `undefined`, the engine's cancel contract.
export class DesktopPromptService implements IPromptService
{
  constructor(
    private readonly inner: IPromptService,
    private readonly fs: FileSystemService)
  {
  }

  Ask<R>(request: Ask<R>): Promise<R>
  {
    return this.inner.Ask(request);
  }

  Confirm(message: string, confirmLabel?: string): Promise<boolean>
  {
    return this.inner.Confirm(message, confirmLabel);
  }

  PromptText(label: string, initial?: string): Promise<string | undefined>
  {
    return this.inner.PromptText(label, initial);
  }

  Choose<T>(title: string, options: readonly Choice<T>[]): Promise<T | undefined>
  {
    return this.inner.Choose(title, options);
  }

  async PickFolder(title: string): Promise<string | undefined>
  {
    const path = await this.fs.OpenFolder({ Title: title });
    return path ?? undefined;
  }

  async PickFile(title: string, filters?: readonly FileFilter[]): Promise<string | undefined>
  {
    const result = await this.fs.OpenFile({ Title: title, Filters: filters });
    return result?.Path ?? undefined;
  }
}

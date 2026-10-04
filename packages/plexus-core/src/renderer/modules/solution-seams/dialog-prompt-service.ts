import { RelayCommand } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService, DialogAction, ButtonVariant } from "@pragmatic-tech-ai/mural/framework";
import { TextBlock, TextWrapping } from "@pragmatic-tech-ai/mural/basic";
import {
  Ask,
  ConfirmAsk,
  type IPromptService,
  type FileFilter,
  type Choice,
} from "@pragmatic-tech-ai/todl-runtime";

// The Mural-shell implementation of the engine's user-decision channel: it
// answers an engine `Ask` with an in-app Mural dialog on the shell's overlay
// layer — the presentation-band counterpart to the headless `IPromptService`
// the SolutionManagerService resolves under its PromptServiceKey.
//
// Only decisions a generic Mural shell can serve itself live here: a yes/no
// Confirm, built directly on DialogService (a TextBlock body + two actions) so
// it renders without any host-wired DataTemplate. Host-specific asks — native
// folder / file pickers that need an OS bridge — are NOT served here; a host
// that needs them registers a fuller IPromptService over its own bridge. An
// unhandled ask throws so a missing handler surfaces loudly rather than
// silently returning a wrong default.
export class DialogPromptService implements IPromptService
{
  constructor(private readonly dialogs: DialogService) {}

  async Ask<R>(request: Ask<R>): Promise<R>
  {
    if (request instanceof ConfirmAsk)
    {
      return (await this.confirm(request)) as R;
    }
    throw new Error(`DialogPromptService has no handler for ${request.constructor.name}`);
  }

  Confirm(message: string, confirmLabel?: string): Promise<boolean>
  {
    return this.Ask(new ConfirmAsk(message, confirmLabel));
  }
  PickFolder(): Promise<string | undefined>
  {
    return Promise.resolve(undefined);
  }
  PickFile(_title: string, _filters?: readonly FileFilter[]): Promise<string | undefined>
  {
    return Promise.resolve(undefined);
  }
  PromptText(): Promise<string | undefined>
  {
    return Promise.resolve(undefined);
  }
  Choose<T>(_title: string, _options: readonly Choice<T>[]): Promise<T | undefined>
  {
    return Promise.resolve(undefined);
  }

  // A modal yes/no built directly on DialogService, so it renders without any
  // host-wired DataTemplate. Resolves true only when the confirming action is
  // chosen; cancel / scrim / Escape → false.
  private async confirm(ask: ConfirmAsk): Promise<boolean>
  {
    const body = new TextBlock();
    body.Text = ask.Message;
    body.TextWrapping = TextWrapping.Wrap;
    const result = await this.dialogs.Show<boolean>({
      Title: ask.Title ?? "Confirm",
      Content: body,
      Width: 380,
      Actions: [
        new DialogAction("Cancel", new RelayCommand(() => this.dialogs.Close(false))),
        new DialogAction(ask.ConfirmLabel, new RelayCommand(() => this.dialogs.Close(true)), ButtonVariant.Filled),
      ],
    });
    return result === true;
  }
}

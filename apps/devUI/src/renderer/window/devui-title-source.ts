import { type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { NavigationService } from "@pragmatic-tech-ai/mural/framework";
import { type ITitleSource } from "@pragmatic-tech-ai/plexus-core/renderer/modules/window-chrome";

// devUI's window-title feed for the shared PragmaticWindowChrome TitleService: the
// active capability's label, else "TODL". devUI is a viewer (no open documents or
// projects), so the navigation selection is the meaningful title. Registered under
// TitleSourceKey in app.mu's .services: (the precedence itself lives in
// plexus-core's TitleService: activeDocumentTitle → firstProjectName → appName).
export class DevUiTitleSource implements ITitleSource
{
  public readonly appName = "TODL";

  constructor(private readonly provider: IServiceProvider) {}

  private nav(): NavigationService | undefined
  {
    return this.provider.get(NavigationService.Key);
  }

  public activeDocumentTitle(): string | undefined
  {
    const item = this.nav()?.SelectedItem as { Label?: string } | undefined;
    return item?.Label || undefined;
  }

  public firstProjectName(): string | undefined
  {
    return undefined;
  }

  public subscribe(onChange: () => void): () => void
  {
    const unsub = this.nav()?.PropertyChanged("SelectedItem").subscribe(onChange);
    return () => unsub?.();
  }
}

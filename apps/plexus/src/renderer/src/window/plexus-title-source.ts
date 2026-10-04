import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DocumentsContentHostService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { type ITitleSource } from '@pragmatic-tech-ai/plexus-core/renderer/modules/window-chrome'
import { ActiveSolutionMembers } from '../services/solution/active-solution-members.js'

// Plexus's window-title feed for the shared PragmaticWindowChrome TitleService:
// the active document's title, else the first open project's name, else "Plexus"
// (the precedence itself lives in plexus-core's TitleService). Registered under
// TitleSourceKey in the bootstrap. This is the old `shellTitleSource` factory,
// promoted to an app-owned class so the coupling to ContentHost + ProjectExplorer
// stays in Plexus, out of core. The open-project set is the engine's
// active-solution members (see ActiveSolutionMembers).
export class PlexusTitleSource implements ITitleSource
{
    public readonly appName = 'Plexus'

    constructor(private readonly provider: IServiceProvider) {}

    private host(): DocumentsContentHostService | undefined
    {
        return this.provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
    }

    public activeDocumentTitle(): string | undefined
    {
        return (this.host()?.ActiveDocument as IDocument | undefined)?.Title || undefined
    }

    public firstProjectName(): string | undefined
    {
        return ActiveSolutionMembers.From(this.provider).Resolved()[0]?.Name || undefined
    }

    public subscribe(onChange: () => void): () => void
    {
        this.host()?.PropertyChanged('ActiveDocument').subscribe(onChange)
        const sub = ActiveSolutionMembers.From(this.provider).Subscribe(onChange)
        return () => sub.dispose()
    }
}

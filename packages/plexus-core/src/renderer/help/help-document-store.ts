// help-document-store.ts — the lazy help resource dictionary.
import { ServiceBase, ServiceKey, ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'
import { FlowDocument, MarkdownRenderer } from '@pragmatic-tech-ai/mural/basic'

// Holds each feature's help markdown, split into scenario sections keyed by
// "<docId>#<anchor>". Sections render to FlowDocuments lazily (nothing parsed
// until first opened) and are memoised in a ResourceDictionary.
export class HelpDocumentStore extends ServiceBase
{
    public static readonly Key = new ServiceKey<HelpDocumentStore>('HelpDocumentStore')

    private static readonly ScenarioSeparator = '#'

    private readonly sections = new Map<string, string>()      // "docId#anchor" -> section markdown
    private readonly rendered = new ResourceDictionary()       // "docId#anchor" -> FlowDocument (lazy)

    // GitHub-style Slug: lowercase, non-alphanumerics → single hyphen, trimmed.
    public static Slug(heading: string): string
    {
        return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    }

    // Split markdown into H2 sections. Each "## Title" starts a section that runs
    // (heading line included) until the next H2. Content before the first H2 is
    // not a scenario.
    public RegisterDoc(docId: string, markdown: string): void
    {
        const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
        let anchor: string | undefined
        let buf: string[] = []
        const flush = (): void => {
            if (anchor !== undefined) this.sections.set(`${docId}${HelpDocumentStore.ScenarioSeparator}${anchor}`, buf.join('\n'))
        }
        for (const line of lines)
        {
            const m = /^##\s+(.+?)\s*$/.exec(line)
            if (m !== null) { flush(); anchor = HelpDocumentStore.Slug(m[1]); buf = [line] }
            else if (anchor !== undefined) buf.push(line)
        }
        flush()
    }

    public HasScenario(docId: string, anchor: string): boolean
    {
        return this.sections.has(`${docId}${HelpDocumentStore.ScenarioSeparator}${anchor}`)
    }

    public GetScenario(docId: string, anchor: string): FlowDocument | undefined
    {
        const key = `${docId}${HelpDocumentStore.ScenarioSeparator}${anchor}`
        const cached = this.rendered.Resolve(key) as FlowDocument | undefined
        if (cached !== undefined) return cached
        const md = this.sections.get(key)
        if (md === undefined) return undefined
        const doc = MarkdownRenderer.Render(md)
        this.rendered.Set(key, doc)
        return doc
    }
}

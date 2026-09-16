// help-document-store.ts — the lazy help resource dictionary.
import { ServiceBase, ServiceKey, ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import { renderMarkdown } from '../../services/markdown/marked-flow-renderer.js'
import skillsMd from './docs/skills.md?raw'

// Holds each feature's help markdown, split into scenario sections keyed by
// "<docId>#<anchor>". Sections render to FlowDocuments lazily (nothing parsed
// until first opened) and are memoised in a ResourceDictionary.
export class HelpDocumentStore extends ServiceBase
{
    public static readonly Key = new ServiceKey<HelpDocumentStore>('HelpDocumentStore')

    private readonly sections = new Map<string, string>()      // "docId#anchor" -> section markdown
    private readonly rendered = new ResourceDictionary()       // "docId#anchor" -> FlowDocument (lazy)

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.registerDoc('skills', skillsMd)
    }

    // GitHub-style slug: lowercase, non-alphanumerics → single hyphen, trimmed.
    public static slug(heading: string): string
    {
        return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    }

    // Split markdown into H2 sections. Each "## Title" starts a section that runs
    // (heading line included) until the next H2. Content before the first H2 is
    // not a scenario.
    public registerDoc(docId: string, markdown: string): void
    {
        const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
        let anchor: string | undefined
        let buf: string[] = []
        const flush = (): void => {
            if (anchor !== undefined) this.sections.set(`${docId}#${anchor}`, buf.join('\n'))
        }
        for (const line of lines) {
            const m = /^##\s+(.+?)\s*$/.exec(line)
            if (m !== null) { flush(); anchor = HelpDocumentStore.slug(m[1]); buf = [line] }
            else if (anchor !== undefined) buf.push(line)
        }
        flush()
    }

    public hasScenario(docId: string, anchor: string): boolean
    {
        return this.sections.has(`${docId}#${anchor}`)
    }

    public getScenario(docId: string, anchor: string): FlowDocument | undefined
    {
        const key = `${docId}#${anchor}`
        const cached = this.rendered.Resolve(key) as FlowDocument | undefined
        if (cached !== undefined) return cached
        const md = this.sections.get(key)
        if (md === undefined) return undefined
        const doc = renderMarkdown(md)
        this.rendered.Set(key, doc)
        return doc
    }
}

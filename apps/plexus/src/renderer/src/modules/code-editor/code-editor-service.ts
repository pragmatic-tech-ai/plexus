import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import type { DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { FileSystemService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { samePath } from '@pragmatic-tech-ai/plexus-core/renderer/file-watch/path-utils.js'
import { CodeDocument } from './code-document.js'
import { FileSystemCodeFile } from './code-file.js'

// Opens files as Monaco-backed code documents in the shell's content host.
// Dedupes by path so re-opening a file re-activates its existing tab rather than
// stacking duplicates (and preserves its editor + undo history).
export class CodeEditorService extends ServiceBase
{
    public static readonly Key = new ServiceKey<CodeEditorService>('CodeEditorService')

    private readonly open = new Map<string, CodeDocument>()

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService
    {
        return this.Provider.getRequired(FileSystemService.Key)
    }

    private get host(): DocumentsContentHostService
    {
        return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Open (or re-activate) `path` as a code-document tab.
    public OpenFile(path: string): void
    {
        this.OpenAndGet(path)
    }

    // Open (or re-activate) `path` and return its document — so callers that need
    // to bind to the exact buffer (e.g. the skills authoring form, which edits the
    // same Content the tab shows) get the instance directly, no round-trip.
    public OpenAndGet(path: string): CodeDocument
    {
        let doc = this.open.get(path)
        if (doc === undefined)
        {
            doc = new CodeDocument(new FileSystemCodeFile(this.fs, path))
            this.open.set(path, doc)
        }
        this.host.Open(doc)
        return doc
    }

    // The open out-of-project document whose absolute path matches `absPath`, if
    // any. Used by the file-watch editor-reload consumer to reload on external
    // change. The `open` map is keyed by the absolute path passed to OpenFile.
    public FindOpenByOsPath(absPath: string): CodeDocument | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        for (const [key, doc] of this.open) if (samePath(key, absPath, ci)) return doc
        return undefined
    }
}

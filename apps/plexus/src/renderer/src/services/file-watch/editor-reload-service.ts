// Reacts to external file changes for files OPEN in the editor: reload a clean
// buffer silently; prompt before discarding unsaved edits on a dirty buffer.
// Eagerly resolved at startup so it listens from boot.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { FileChangeKind, type FileChangeEvent } from '../../../../shared/file-watch-api.js'
import { FileWatchService } from './file-watch-service.js'
import { CodeEditorService } from '../../modules/code-editor/code-editor-service.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { CodeDocument } from '../../modules/code-editor/code-document.js'
import { ConfirmDialogModel } from '../dialogs/confirm-dialog-model.js'

export class EditorReloadService extends ServiceBase
{
    public static readonly Key = new ServiceKey<EditorReloadService>('EditorReloadService')

    private readonly unsubscribe: () => void

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const watch = this.Provider.getRequired(FileWatchService.Key)
        this.unsubscribe = watch.Subscribe((e) => void this.handle(e))
    }

    private async handle(e: FileChangeEvent): Promise<void>
    {
        if (e.kind === FileChangeKind.Removed) return
        const doc = this.find(e.path)
        if (doc === undefined) return
        if (!doc.IsDirty) { await doc.Reload(); return }

        const dialogs = this.Provider.getRequired(DialogService.Key)
        const vm = new ConfirmDialogModel(
            `"${doc.Id}" changed on disk. Reload and discard your unsaved edits?`,
            'Reload',
            (r) => dialogs.Close(r),
        )
        const confirmed = await dialogs.Show<boolean>({ Title: 'File changed on disk', Content: vm, Width: 420 })
        if (confirmed === true) await doc.Reload()
    }

    private find(absPath: string): CodeDocument | undefined
    {
        const editor = this.Provider.getRequired(CodeEditorService.Key)
        const fromEditor = editor.FindOpenByOsPath(absPath)
        if (fromEditor !== undefined) return fromEditor
        return this.Provider.getRequired(ProjectExplorerService.Key).FindOpenCodeDocByOsPath(absPath)
    }

    public dispose(): void { this.unsubscribe() }
}

export default EditorReloadService

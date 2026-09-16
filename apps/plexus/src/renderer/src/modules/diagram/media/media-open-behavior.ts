import { Application, Behavior, type PointerEventArgs, Visual } from '@pragmatic-tech-ai/mural/runtime'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import { MediaNodeVM } from './media-node-vm.js'

// Double-click a media node → open its target: http(s) URLs in the OS browser,
// everything else (files, file:// URIs, linked OS paths) via the OS default app.
// Attached to the MediaNodeVM template's root; reads the node off DataContext.
export class MediaOpenBehavior extends Behavior
{
    private _visual: Visual | undefined
    private _onDown: ((args: unknown) => void) | undefined

    public override OnAttached(visual: Visual): void
    {
        this._visual = visual
        const onDown = (args: unknown): void => {
            const e = args as PointerEventArgs
            if (!e.IsDoubleClick) return
            const vm = this._visual?.DataContext
            if (!(vm instanceof MediaNodeVM)) return
            const target = vm.HyperlinkUri ?? vm.Source
            if (target === undefined || target.length === 0) return
            openMediaTarget(target)
            e.Handled = true
        }
        this._onDown = onDown
        visual.AddRoutedEventListener('PointerDown', onDown)
    }

    public override OnDetached(visual: Visual): void
    {
        if (this._onDown !== undefined) visual.RemoveRoutedEventListener('PointerDown', this._onDown)
        this._onDown = undefined
        this._visual = undefined
    }
}

// Open a media target. URLs go to the browser (window.open → the host's
// setWindowOpenHandler → shell.openExternal); local paths go through the OS
// default app via FileSystemService.OpenExternal (shell.openPath).
function openMediaTarget(target: string): void
{
    if (/^https?:/i.test(target)) {
        if (typeof window !== 'undefined') window.open(target, '_blank', 'noopener')
        return
    }
    const path = target.startsWith('file://')
        ? decodeURI(target.slice('file://'.length).replace(/^\/+/, ''))
        : target
    void Application.current?.Services.get(FileSystemService.Key)?.OpenExternal(path)
}

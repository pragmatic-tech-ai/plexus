import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    ApplicationSettings, ContentHostService, Setting,
    type DocumentsContentHostService, type IDocument,
} from '@pragmatic-tech-ai/mural/framework'

export const AUTOSAVE_ENABLED_SETTING = 'documents.autosave.enabled'
export const AUTOSAVE_INTERVAL_SETTING = 'documents.autosave.intervalMinutes'

// Save every dirty open document. Isolated from timers/settings so it is
// unit-testable with a fake host, and so one document's failed Save can't abort
// the sweep (a transient write error must not skip the rest or kill the timer).
export function saveDirtyDocuments(
    host: { OpenDocuments: { ToArray(): IDocument[] }; Save(doc: IDocument): void | Promise<void> },
): void
{
    for (const doc of host.OpenDocuments.ToArray()) {
        if (!doc.IsDirty) continue
        try { void host.Save(doc) }
        catch { /* transient write failure — keep sweeping, retry next tick */ }
    }
}

// App-scoped background service: on an interval (default 5 min, from settings),
// save every dirty document. Reacts live to the enabled toggle and interval
// setting. Renderer-only — setInterval is fine here (the timer prohibition is
// main-process). Mirrors DiagramCameraService's provider/host wiring.
export class AutosaveService extends ServiceBase
{
    public static readonly Key = new ServiceKey<AutosaveService>('AutosaveService')

    private timer: ReturnType<typeof setInterval> | undefined
    private ticking = false

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const settings = this.Provider.get(ApplicationSettings.Key)
        const reschedule = (): void => this.reschedule()
        settings?.GetSetting(AUTOSAVE_ENABLED_SETTING)?.PropertyChanged(Setting.ValueKey).subscribe(reschedule)
        settings?.GetSetting(AUTOSAVE_INTERVAL_SETTING)?.PropertyChanged(Setting.ValueKey).subscribe(reschedule)
        this.reschedule()
    }

    private reschedule(): void
    {
        if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
        const settings = this.Provider.get(ApplicationSettings.Key)
        const enabled = settings?.Get(AUTOSAVE_ENABLED_SETTING)
        if (enabled === false) return
        const minutes = settings?.Get(AUTOSAVE_INTERVAL_SETTING)
        const ms = (typeof minutes === 'number' && minutes >= 1 ? minutes : 5) * 60_000
        this.timer = setInterval(() => this.tick(), ms)
    }

    private tick(): void
    {
        if (this.ticking) return
        this.ticking = true
        try {
            const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
            if (host !== undefined) saveDirtyDocuments(host)
        } finally { this.ticking = false }
    }
}

export default AutosaveService

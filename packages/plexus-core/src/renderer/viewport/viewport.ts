import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'

// The live window viewport (width/height) behind a lower-layer seam, so plexus-core
// renderer services can size UI to the window without reaching into the app layer.
// The Background Work dock uses it to span its popup across the window and cap its
// list height, exactly like the Problems dock does with the app's ViewportService —
// which implements this interface and registers under ViewportKey. The contract is
// free of app types (plain numbers + a subscribe thunk), so it is an allowed seam.
export interface IViewport
{
    readonly Width: number
    readonly Height: number
    // Fired on every resize (after Width/Height update). Returns an unsubscribe thunk.
    Subscribe(listener: () => void): () => void
}

export const ViewportKey = new ServiceKey<IViewport>('ViewportService')

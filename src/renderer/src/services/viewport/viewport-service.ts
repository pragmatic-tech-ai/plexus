import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

// The window-height feed behind a seam so ViewportService is testable without a
// real DOM. The default implementation (windowViewportSource) reads the renderer
// window; tests inject a fake that can push heights.
export interface IViewportSource
{
    height(): number
    width(): number
    subscribe(onChange: () => void): () => void
}

function windowViewportSource(): IViewportSource
{
    return {
        height: () => window.innerHeight,
        width: () => window.innerWidth,
        subscribe: (onChange) => {
            window.addEventListener('resize', onChange)
            return () => window.removeEventListener('resize', onChange)
        },
    }
}

// Tracks the live viewport (window) height as a bindable Height DP and notifies
// Subscribe listeners on every resize. Consumers that need a value derived from
// the window size (the Problems popup caps its list at 30% of Height) subscribe
// here rather than touching the DOM.
export class ViewportService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ViewportService>('ViewportService')

    private _height = 0
    private _width = 0

    private readonly listeners = new Set<() => void>()

    constructor(provider: IServiceProvider, source: IViewportSource = windowViewportSource())
    {
        super(provider)
        this.setHeight(source.height())
        this.setWidth(source.width())
        source.subscribe(() => {
            this.setHeight(source.height())
            this.setWidth(source.width())
            for (const l of this.listeners) l()
        })
    }

    public get Height(): number { return this._height }
    private setHeight(v: number): void { const old = this._height; if (old === v) return; this._height = v; this.RaisePropertyChanged('Height', old, v) }
    public get Width(): number { return this._width }
    private setWidth(v: number): void { const old = this._width; if (old === v) return; this._width = v; this.RaisePropertyChanged('Width', old, v) }

    // Fired on every resize (after Height is updated). Returns an unsubscribe thunk.
    public Subscribe(listener: () => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}

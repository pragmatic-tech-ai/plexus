import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { Inspector } from '@pragmatic-tech-ai/mural/framework'
import type { Board } from '@pragmatic-tech-ai/mural/framework'

// The right-region inspector entry for the layout pipeline builder.
// Modeled on BoardInspector: it carries the active Board as an
// observable View so the builder template can bind to it. The pipeline
// state, catalog, presets and Run command live on LayoutPipelineService,
// which the template resolves via $service(LayoutPipelineService).
export class LayoutInspector extends Inspector
{
    static readonly ViewKey = MuralBase.RegisterProperty<Board | undefined>(LayoutInspector, 'View', undefined, MetaData.None)

    constructor()
    {
        super('layout', 'Layout')
    }

    public get View(): Board | undefined { return this.get_property_value(LayoutInspector.ViewKey) }
    public set View(v: Board | undefined) { this.set_property_value(LayoutInspector.ViewKey, v) }
}

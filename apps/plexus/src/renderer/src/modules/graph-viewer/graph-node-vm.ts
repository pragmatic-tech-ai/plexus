import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { NodeViewModel } from '@pragmatic-tech-ai/mural/framework'

// A read-only content node for the graph viewer: identity (Id, from NodeViewModel) plus a display
// Label and the node's Concept. It carries NO geometry (its container Figure owns that; positions
// are seeded into the document's visual store by GraphLayout). Must extend NodeViewModel — the board
// generator/serializer expect that type for content nodes (the CLAUDE.md Observable default's one
// documented exception).
export class GraphNodeVM extends NodeViewModel
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(GraphNodeVM, 'Label', '', MetaData.None);
    public static readonly ConceptKey = MuralBase.RegisterProperty<string>(GraphNodeVM, 'Concept', '', MetaData.None);

    public get Label(): string
    {
        return this.get_property_value(GraphNodeVM.LabelKey);
    }

    public set Label(value: string)
    {
        this.set_property_value(GraphNodeVM.LabelKey, value);
    }

    public get Concept(): string
    {
        return this.get_property_value(GraphNodeVM.ConceptKey);
    }

    public set Concept(value: string)
    {
        this.set_property_value(GraphNodeVM.ConceptKey, value);
    }
}

import { MetaData, MuralBase, type ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxItem, type ToolboxVisualDescriptor, type IToolboxDropFactory } from '@pragmatic-tech-ai/mural/framework'
import type { EntityIconVM } from './entity-icon-vm.js'

// A Plexus toolbox item that also exposes Display (= the term label) so a class
// presentation template's $Display binds through the tile presenter's inherited
// DataContext. The mural base carries Id/Label/Descriptor/FactoryKey/BeginDragData.
export class ArchToolboxItem extends ToolboxItem
{
    public static readonly DisplayKey = MuralBase.RegisterProperty<string>(
        ArchToolboxItem, 'Display', '', MetaData.None)
    // The concept this tile drops + whether it has an openable wiki page. Drive
    // the shared "Open Wiki" context menu (Visibility via HasWiki, CommandParameter
    // via Concept). HasWiki is filled asynchronously by the contributor.
    public static readonly ConceptKey = MuralBase.RegisterProperty<string>(
        ArchToolboxItem, 'Concept', '', MetaData.None)
    public static readonly HasWikiKey = MuralBase.RegisterProperty<boolean>(
        ArchToolboxItem, 'HasWiki', false, MetaData.None)

    // The icon-presentation VM the (P3) tile ContentControl + TodlVisualSelector
    // binds ($Icon.IconKey). A plain readonly field (not a DP): a tile is recreated
    // on every toolbox refresh, so a fresh VM resolves the current key — no in-place
    // reactivity needed here (owner-driven refresh lives on the contributor, which
    // rebuilds items on registry.onChanged). Not consumed by templates yet (P3).
    public readonly Icon: EntityIconVM

    constructor(
        id: string,
        label: string,
        descriptor: ToolboxVisualDescriptor,
        factoryKey: ServiceKey<IToolboxDropFactory>,
        icon: EntityIconVM,
        concept = '',
    )
    {
        super(id, label, descriptor, factoryKey)
        this.Icon = icon
        this.set_property_value(ArchToolboxItem.DisplayKey, label)
        this.set_property_value(ArchToolboxItem.ConceptKey, concept)
    }

    public get Display(): string { return this.get_property_value(ArchToolboxItem.DisplayKey) }
    public get Concept(): string { return this.get_property_value(ArchToolboxItem.ConceptKey) }
    public get HasWiki(): boolean { return this.get_property_value(ArchToolboxItem.HasWikiKey) }
    public set HasWiki(v: boolean) { this.set_property_value(ArchToolboxItem.HasWikiKey, v) }
}

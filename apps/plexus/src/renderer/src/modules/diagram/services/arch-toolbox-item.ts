import { MetaData, MuralBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxItem, type ToolboxVisualDescriptor, type IToolboxVisualResolver, type IToolboxDropFactory } from '@pragmatic-tech-ai/mural/framework'
import type { EntityIconVM } from './entity-icon-vm.js'

// The resolver-key SLOT of every Plexus toolbox item's ToolboxVisualDescriptor.
// mural's ToolboxItem ctor requires a descriptor (ResolverKey + entity Key), and
// the descriptor's Key is the item's DROP IDENTITY — the drop factory reads
// context.Descriptor.Key to route id → repository → factory. Nothing resolves a
// VISUAL against this key anymore (the icon is rendered from the item's $Icon
// EntityIconVM via TodlVisualSelector, and Plexus no longer registers or uses
// mural's ToolboxVisualPresenter), so it is a pure identity tag: no service is
// registered against it. This replaces the retired TodlVisualResolverKey.
export const ArchToolboxVisualKey = new ServiceKey<IToolboxVisualResolver>('ArchToolboxVisual')

// A Plexus toolbox item that also exposes Display (= the term label) so a class
// presentation template's $Display binds through the tile's inherited DataContext.
// The mural base carries Id/Label/Descriptor/FactoryKey/BeginDragData; the
// Descriptor's Key is the DROP IDENTITY (the drop factory reads it), and its
// ResolverKey slot is ArchToolboxVisualKey (a pure identity tag).
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

    // The icon-presentation VM the tile ContentControl + TodlVisualSelector binds
    // ($Icon.IconKey). A plain readonly field (not a DP): a tile is recreated on
    // every toolbox refresh, so a fresh VM resolves the current key — no in-place
    // reactivity needed here (owner-driven refresh lives on the contributor, which
    // rebuilds items on registry.onChanged).
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

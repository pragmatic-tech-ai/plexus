import {
    MetaData,
    MuralBase,
    ObservableCollection,
} from '@pragmatic-tech-ai/mural/runtime'

import type { BaseRef } from './base-binding.js'

// One node in the consolidated "References" tree shared by the New-Project and
// Manage-References dialogs. A single type carries both roles, kept apart by
// IsGroup (mirrors ProjectNode's / LibraryTreeNode's single-type-plus-kind shape):
//   * a GROUP node ("Meta-models" / "Libraries") is a named header with Children
//     and starts expanded; it has no checkbox and no Ref.
//   * a LEAF node is one referenceable package — an `id @ version` Label, a two-way
//     IsSelected the row's Switch binds, and the underlying Ref the dialog reads
//     back on confirm.
// Rendered by a single HierarchicalDataTemplate[ReferenceNode] (itemsselector =
// Children); the Switch shows on leaves only (IsLeaf drives its visibility).
export class ReferenceNode extends MuralBase
{
    private static readonly RefLabelSeparator = ' @ '

    public static readonly LabelKey = MuralBase.RegisterProperty<string>(ReferenceNode, 'Label', '', MetaData.None)
    public static readonly IsGroupKey = MuralBase.RegisterProperty<boolean>(ReferenceNode, 'IsGroup', false, MetaData.None)
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(ReferenceNode, 'IsSelected', false, MetaData.None)
    // Group expansion, mirrored one-way onto the TreeViewItem container via the
    // tree's ItemContainerStyle (groups start expanded so both sections are open).
    public static readonly IsExpandedKey = MuralBase.RegisterProperty<boolean>(ReferenceNode, 'IsExpanded', false, MetaData.None)
    public static readonly ChildrenKey = MuralBase.RegisterProperty<ObservableCollection<ReferenceNode>>(
        ReferenceNode, 'Children', undefined as unknown as ObservableCollection<ReferenceNode>, MetaData.None)

    // The referenced package — set on leaves only, undefined on group nodes.
    private readonly ref?: BaseRef

    private constructor(ref?: BaseRef)
    {
        super()
        this.ref = ref
        this.set_property_value(ReferenceNode.ChildrenKey, new ObservableCollection<ReferenceNode>())
    }

    public get Label(): string { return this.get_property_value(ReferenceNode.LabelKey) }
    public get IsGroup(): boolean { return this.get_property_value(ReferenceNode.IsGroupKey) }
    // The Switch's visibility: a checkbox belongs to leaves, not group headers.
    public get IsLeaf(): boolean { return !this.IsGroup }
    public get IsSelected(): boolean { return this.get_property_value(ReferenceNode.IsSelectedKey) }
    public set IsSelected(v: boolean) { this.set_property_value(ReferenceNode.IsSelectedKey, v) }
    public get IsExpanded(): boolean { return this.get_property_value(ReferenceNode.IsExpandedKey) }
    public set IsExpanded(v: boolean) { this.set_property_value(ReferenceNode.IsExpandedKey, v) }
    public get Children(): ObservableCollection<ReferenceNode> { return this.get_property_value(ReferenceNode.ChildrenKey) }
    public get Ref(): BaseRef | undefined { return this.ref }

    // The checked leaves' refs, in row order. Empty for a leaf or an empty group.
    public get SelectedRefs(): readonly BaseRef[]
    {
        return this.Children.ToArray().filter((c) => c.IsSelected && c.Ref !== undefined).map((c) => c.Ref!)
    }

    // A named group header with its children, expanded by default.
    public static group(label: string, children: readonly ReferenceNode[]): ReferenceNode
    {
        const n = new ReferenceNode()
        n.set_property_value(ReferenceNode.LabelKey, label)
        n.set_property_value(ReferenceNode.IsGroupKey, true)
        n.set_property_value(ReferenceNode.IsExpandedKey, true)
        for (const c of children) n.Children.Add(c)
        return n
    }

    // A referenceable-package leaf: `id @ version` label + initial checked state.
    public static leaf(ref: BaseRef, checked: boolean): ReferenceNode
    {
        const n = new ReferenceNode(ref)
        n.set_property_value(ReferenceNode.LabelKey, `${ref.id}${ReferenceNode.RefLabelSeparator}${ref.version}`)
        n.set_property_value(ReferenceNode.IsSelectedKey, checked)
        return n
    }
}

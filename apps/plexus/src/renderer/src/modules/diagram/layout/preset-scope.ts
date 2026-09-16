import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'

// Where a named layout preset lives. A preset can be saved to any of three
// scopes, listed together in the inspector's preset combobox:
//  * Global  — user-data, visible in every project (LayoutPresetsStore).
//  * Project — the current project's storage, shared by all its diagrams
//    (ProjectLayoutPresetsStore over the diagram's FileDiagramStorage.ProjectStorage).
//  * Diagram — inside the one .diagram file's metadata (diagram-layout-store),
//    so it travels with that single diagram.
export enum PresetScope
{
    Global  = 'global',
    Project = 'project',
    Diagram = 'diagram',
}

// The short human label for a scope — used as the combobox-entry suffix and the
// save dialog's scope options ("flow — project").
export function scopeLabel(scope: PresetScope): string
{
    switch (scope)
    {
        case PresetScope.Global:  return 'global'
        case PresetScope.Project: return 'project'
        case PresetScope.Diagram: return 'diagram'
    }
}

// One entry in the preset combobox: a preset name plus the scope it lives in.
// Name is the load/delete key within that scope; Label is what the combobox
// shows ("flow — project") — the ComboBox's displayString convention picks up
// `Label` automatically, so no ItemTemplate is needed. Same-named presets in
// different scopes are distinct refs.
export class LayoutPresetRef extends MuralBase
{
    public static readonly NameKey  = MuralBase.RegisterProperty<string>(LayoutPresetRef, 'Name', '', MetaData.None)
    public static readonly ScopeKey = MuralBase.RegisterProperty<PresetScope>(LayoutPresetRef, 'Scope', PresetScope.Global, MetaData.None)
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(LayoutPresetRef, 'Label', '', MetaData.None)

    public constructor(name: string, scope: PresetScope)
    {
        super()
        this.set_property_value(LayoutPresetRef.NameKey, name)
        this.set_property_value(LayoutPresetRef.ScopeKey, scope)
        this.set_property_value(LayoutPresetRef.LabelKey, `${name} — ${scopeLabel(scope)}`)
    }

    public get Name(): string { return this.get_property_value(LayoutPresetRef.NameKey) }
    public get Scope(): PresetScope { return this.get_property_value(LayoutPresetRef.ScopeKey) }
    public get Label(): string { return this.get_property_value(LayoutPresetRef.LabelKey) }
}

// One option in the save dialog's "Save to" scope picker: a scope plus its
// capitalised display label. Like LayoutPresetRef, exposes `Label` for the
// ComboBox displayString convention.
export class ScopeOption extends MuralBase
{
    public static readonly ScopeKey = MuralBase.RegisterProperty<PresetScope>(ScopeOption, 'Scope', PresetScope.Global, MetaData.None)
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(ScopeOption, 'Label', '', MetaData.None)

    public constructor(scope: PresetScope)
    {
        super()
        const label = scopeLabel(scope)
        this.set_property_value(ScopeOption.ScopeKey, scope)
        this.set_property_value(ScopeOption.LabelKey, label.charAt(0).toUpperCase() + label.slice(1))
    }

    public get Scope(): PresetScope { return this.get_property_value(ScopeOption.ScopeKey) }
    public get Label(): string { return this.get_property_value(ScopeOption.LabelKey) }
}

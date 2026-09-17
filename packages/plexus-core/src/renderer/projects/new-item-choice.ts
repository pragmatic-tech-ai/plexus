import { MetaData, MuralBase, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// One entry in a project's / node's "Add New" submenu: a labelled command that
// creates a file of a specific declared format in the target container. The host
// (ProjectExplorerService) builds one per ProjectFileFormat; the submenu's item
// template binds $Label and $Command. A MuralBase (not a plain object) so those
// bindings resolve — bindings only walk dependency properties.
export class NewItemChoice extends MuralBase
{
    static readonly LabelKey = MuralBase.RegisterProperty<string>(NewItemChoice, 'Label', '', MetaData.None)
    static readonly CommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        NewItemChoice, 'Command', undefined, MetaData.None)

    constructor(label: string, command: ICommand)
    {
        super()
        this.set_property_value(NewItemChoice.LabelKey, label)
        this.set_property_value(NewItemChoice.CommandKey, command)
    }

    public get Label(): string { return this.get_property_value(NewItemChoice.LabelKey) }
    public get Command(): ICommand | undefined { return this.get_property_value(NewItemChoice.CommandKey) }
}

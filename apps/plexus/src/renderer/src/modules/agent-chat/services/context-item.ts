// One file or folder the user added to a conversation's context. `Dir` is the
// directory handed to the CLI as `--add-dir` (the folder itself, or a picked
// file's parent dir, since --add-dir is directory-scoped); `Name` is the
// basename shown on the composer chip. A per-conversation VM rendered by the
// DataTemplate[ContextItemVM] chip template.
import { MuralBase, MetaData, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// Split a path on its last '/' or '\\' separator — dependency-free (no node
// 'path') so it runs in the renderer against either separator.
function splitPath(path: string): { dir: string; name: string }
{
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    if (i < 0) return { dir: '', name: path }
    return { dir: path.slice(0, i), name: path.slice(i + 1) }
}

export class ContextItemVM extends MuralBase
{
    public static readonly PathKey     = MuralBase.RegisterProperty<string>(ContextItemVM, 'Path', '', MetaData.None)
    public static readonly NameKey     = MuralBase.RegisterProperty<string>(ContextItemVM, 'Name', '', MetaData.None)
    public static readonly IsFolderKey = MuralBase.RegisterProperty<boolean>(ContextItemVM, 'IsFolder', false, MetaData.None)
    public static readonly DirKey      = MuralBase.RegisterProperty<string>(ContextItemVM, 'Dir', '', MetaData.None)
    public static readonly RemoveCommandKey = MuralBase.RegisterProperty<ICommand>(
        ContextItemVM, 'RemoveCommand', undefined as unknown as ICommand, MetaData.None)

    // Build a chip VM from a picked path. `onRemove` is invoked (with this VM)
    // when the chip's ✕ is clicked — the owner drops it from its ContextItems.
    public static fromPath(path: string, isFolder: boolean, onRemove: (vm: ContextItemVM) => void): ContextItemVM
    {
        const { dir, name } = splitPath(path)
        const vm = new ContextItemVM()
        vm.set_property_value(ContextItemVM.PathKey, path)
        vm.set_property_value(ContextItemVM.NameKey, name)
        vm.set_property_value(ContextItemVM.IsFolderKey, isFolder)
        vm.set_property_value(ContextItemVM.DirKey, isFolder ? path : dir)
        vm.set_property_value(ContextItemVM.RemoveCommandKey, new RelayCommand(() => onRemove(vm)))
        return vm
    }

    public get Path(): string { return this.get_property_value(ContextItemVM.PathKey) }
    public get Name(): string { return this.get_property_value(ContextItemVM.NameKey) }
    public get IsFolder(): boolean { return this.get_property_value(ContextItemVM.IsFolderKey) }
    public get Dir(): string { return this.get_property_value(ContextItemVM.DirKey) }
    public get RemoveCommand(): ICommand { return this.get_property_value(ContextItemVM.RemoveCommandKey) }
}

export default ContextItemVM

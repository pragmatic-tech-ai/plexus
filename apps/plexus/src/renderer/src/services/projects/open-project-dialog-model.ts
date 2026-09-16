import {
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'

import type { FileSystemService } from '../file-system/file-system-service.js'
import type { RecentProject } from './recent-projects-service.js'

// The Open Project dialog's view-model + its recent-item model. Rendered by
// DataTemplate[OpenProjectDialogModel] / DataTemplate[RecentProjectItem].
// Selecting a recent (or Browse) closes the dialog with the folder to open.

export interface OpenProjectResult
{
    location: string
}

// One row in the recents list. OpenCommand (wired by the VM) closes the dialog
// with this project's path.
export class RecentProjectItem extends MuralBase
{
    static readonly NameKey = MuralBase.RegisterProperty<string>(RecentProjectItem, 'Name', '', MetaData.None)
    static readonly PathKey = MuralBase.RegisterProperty<string>(RecentProjectItem, 'Path', '', MetaData.None)
    static readonly OpenCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        RecentProjectItem, 'OpenCommand', undefined, MetaData.None)

    constructor(name: string, path: string)
    {
        super()
        this.set_property_value(RecentProjectItem.NameKey, name)
        this.set_property_value(RecentProjectItem.PathKey, path)
    }

    public get Name(): string { return this.get_property_value(RecentProjectItem.NameKey) }
    public get Path(): string { return this.get_property_value(RecentProjectItem.PathKey) }
    public get OpenCommand(): ICommand | undefined { return this.get_property_value(RecentProjectItem.OpenCommandKey) }
    public set OpenCommand(v: ICommand | undefined) { this.set_property_value(RecentProjectItem.OpenCommandKey, v) }
}

export class OpenProjectDialogModel extends MuralBase
{
    static readonly RecentsKey = MuralBase.RegisterProperty<ObservableCollection<RecentProjectItem>>(
        OpenProjectDialogModel, 'Recents', undefined as unknown as ObservableCollection<RecentProjectItem>, MetaData.None)
    static readonly EmptyLabelKey = MuralBase.RegisterProperty<string>(
        OpenProjectDialogModel, 'EmptyLabel', '', MetaData.None)
    static readonly BrowseCommandKey = MuralBase.RegisterProperty<ICommand>(
        OpenProjectDialogModel, 'BrowseCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        OpenProjectDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(
        recents: readonly RecentProject[],
        private readonly fs: FileSystemService,
        private readonly close: (result?: OpenProjectResult) => void,
    )
    {
        super()
        const items = new ObservableCollection<RecentProjectItem>()
        for (const r of recents) {
            const item = new RecentProjectItem(r.name, r.path)
            item.OpenCommand = new RelayCommand(() => this.close({ location: item.Path }))
            items.Add(item)
        }
        this.set_property_value(OpenProjectDialogModel.RecentsKey, items)
        this.set_property_value(
            OpenProjectDialogModel.EmptyLabelKey, items.Count === 0 ? 'No recent projects.' : '')
        this.set_property_value(OpenProjectDialogModel.BrowseCommandKey, new RelayCommand(() => void this.browse()))
        this.set_property_value(OpenProjectDialogModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
    }

    public get Recents(): ObservableCollection<RecentProjectItem> { return this.get_property_value(OpenProjectDialogModel.RecentsKey) }
    public get EmptyLabel(): string { return this.get_property_value(OpenProjectDialogModel.EmptyLabelKey) }
    public get BrowseCommand(): ICommand { return this.get_property_value(OpenProjectDialogModel.BrowseCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(OpenProjectDialogModel.CancelCommandKey) }

    private async browse(): Promise<void>
    {
        const folder = await this.fs.OpenFolder({ Title: 'Open Project Folder' })
        if (folder !== null) this.close({ location: folder })
    }
}

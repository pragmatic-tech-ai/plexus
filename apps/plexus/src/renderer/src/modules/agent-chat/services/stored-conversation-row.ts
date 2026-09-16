// One row in the Conversations panel's "Stored" (restorable) list: the stored
// record's title, a relative-time label, and Open / Rename / Delete affordances.
// A class (not the bare StoredConversation record) so the row renders through
// DataTemplate[DataType = StoredConversationRow] and carries its own commands +
// inline-rename state (IsEditing swaps a TextBox in for the title, mirroring the
// project-tree rename pattern).
import { Key, MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { StoredConversation } from './chat-store.js'
import { timeAgo } from './time-ago.js'

// The row's actions, injected by ChatSessionsService so the VM stays free of the
// store + dock. `rename` is fired only for a real, non-empty title change.
export interface ConversationRowCallbacks
{
    open(id: string): void
    rename(id: string, title: string): void
    delete(id: string): void
}

export class StoredConversationRow extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        StoredConversationRow, 'Title', '', MetaData.None)
    public static readonly TimeAgoKey = MuralBase.RegisterProperty<string>(
        StoredConversationRow, 'TimeAgo', '', MetaData.None)
    public static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(
        StoredConversationRow, 'IsEditing', false, MetaData.None)
    public static readonly EditTitleKey = MuralBase.RegisterProperty<string>(
        StoredConversationRow, 'EditTitle', '', MetaData.None)
    public static readonly OpenCommandKey = MuralBase.RegisterProperty<ICommand>(
        StoredConversationRow, 'OpenCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly BeginRenameCommandKey = MuralBase.RegisterProperty<ICommand>(
        StoredConversationRow, 'BeginRenameCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly RenameKeyCommandKey = MuralBase.RegisterProperty<ICommand>(
        StoredConversationRow, 'RenameKeyCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly DeleteCommandKey = MuralBase.RegisterProperty<ICommand>(
        StoredConversationRow, 'DeleteCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Record: StoredConversation
    private readonly cb: ConversationRowCallbacks

    constructor(record: StoredConversation, cb: ConversationRowCallbacks)
    {
        super()
        this.Record = record
        this.cb = cb
        this.set_property_value(StoredConversationRow.TitleKey, record.Title)
        this.set_property_value(StoredConversationRow.OpenCommandKey, new RelayCommand(() => cb.open(record.Id)))
        this.set_property_value(StoredConversationRow.BeginRenameCommandKey, new RelayCommand(() => this.beginRename()))
        this.set_property_value(StoredConversationRow.RenameKeyCommandKey, new RelayCommand((arg) => this.onRenameKey(arg)))
        this.set_property_value(StoredConversationRow.DeleteCommandKey, new RelayCommand(() => cb.delete(record.Id)))
    }

    public get Title(): string { return this.get_property_value(StoredConversationRow.TitleKey) }
    public get TimeAgo(): string { return this.get_property_value(StoredConversationRow.TimeAgoKey) }
    public get IsEditing(): boolean { return this.get_property_value(StoredConversationRow.IsEditingKey) }
    public get EditTitle(): string { return this.get_property_value(StoredConversationRow.EditTitleKey) }
    public set EditTitle(value: string) { this.set_property_value(StoredConversationRow.EditTitleKey, value) }
    public get OpenCommand(): ICommand { return this.get_property_value(StoredConversationRow.OpenCommandKey) }
    public get BeginRenameCommand(): ICommand { return this.get_property_value(StoredConversationRow.BeginRenameCommandKey) }
    public get RenameKeyCommand(): ICommand { return this.get_property_value(StoredConversationRow.RenameKeyCommandKey) }
    public get DeleteCommand(): ICommand { return this.get_property_value(StoredConversationRow.DeleteCommandKey) }

    // Recompute the "12h / 2d" label against a supplied clock (the service passes
    // Date.now() when it (re)builds the list — no live ticking).
    public RefreshTime(nowMs: number): void
    {
        this.set_property_value(StoredConversationRow.TimeAgoKey, timeAgo(nowMs, this.Record.UpdatedAt))
    }

    private beginRename(): void
    {
        this.set_property_value(StoredConversationRow.EditTitleKey, this.Title)
        this.set_property_value(StoredConversationRow.IsEditingKey, true)
    }

    // Return commits, Escape cancels (the single KeyDown → this command carries the
    // key, mirroring ChatSession.SubmitCommand and the project-tree TreeKeyCommand).
    private onRenameKey(arg: unknown): void
    {
        const key = (arg as { Key?: unknown } | undefined)?.Key
        if (key === Key.Return) this.commitRename()
        else if (key === Key.Escape) this.set_property_value(StoredConversationRow.IsEditingKey, false)
    }

    private commitRename(): void
    {
        this.set_property_value(StoredConversationRow.IsEditingKey, false)
        const next = this.EditTitle.trim()
        if (next === '' || next === this.Title) return
        this.set_property_value(StoredConversationRow.TitleKey, next)
        this.cb.rename(this.Record.Id, next)
    }
}

export default StoredConversationRow

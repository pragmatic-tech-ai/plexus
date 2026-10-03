import { RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { CommandDefinition } from '@pragmatic-tech-ai/mural/framework'

// The one shared idiom behind every lazy (async-filled) context submenu: a disabled
// "Loading…/discovering" row shown until a fire-and-forget fetch fills the cache, a disabled
// "nothing here" row when the fetch yields nothing, and the disabled ICommand that backs
// either row when the owning dispatcher's Resolve is asked for its id. Each owner keeps its
// own stable LoadingId / EmptyId command ids (so distinct submenus never collide) and its own
// user-facing labels; it hands those two ids to this helper once and reuses the instance.
// Replaces the three hand-rolled copies (connection active-connection, reference add/version,
// skill run) with a single OOP home.
export class LazySubmenuPlaceholder
{
    constructor(private readonly loadingId: string, private readonly emptyId: string)
    {
    }

    // The disabled row shown while the submenu's contents are still being fetched.
    public LoadingRow(label: string): CommandDefinition
    {
        return LazySubmenuPlaceholder.row(this.loadingId, label)
    }

    // The disabled row shown when the fetch completed with nothing to offer.
    public EmptyRow(label: string): CommandDefinition
    {
        return LazySubmenuPlaceholder.row(this.emptyId, label)
    }

    // The disabled command backing either placeholder row; undefined for any other id, so the
    // owning dispatcher's Resolve falls through to its real commands.
    public CommandFor(commandId: string): ICommand | undefined
    {
        if (commandId === this.loadingId || commandId === this.emptyId)
        {
            return new RelayCommand(() => {}, () => false)
        }
        return undefined
    }

    private static row(id: string, title: string): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        return def
    }
}

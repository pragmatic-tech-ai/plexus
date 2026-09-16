import { Observable, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// One entry in a "Go to Definition ▸" submenu: a display name + the command that
// navigates to its target. Immutable — built once per resolved NavTarget by
// ArchNodeVM.ApplyNavTargets — so it extends the lightweight Observable INPC root
// rather than MuralBase (it needs no dependency-property system; the menu binds
// $Name / $GoCommand one-way and never mutates them).
export class ArchNavItemVM extends Observable
{
    public constructor(
        public readonly Name: string,
        public readonly GoCommand: ICommand,
    )
    {
        super()
    }
}

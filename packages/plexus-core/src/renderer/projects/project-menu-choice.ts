import type { ICommand } from '@pragmatic-tech-ai/mural/runtime'

// One extra project-header menu row contributed by the host (e.g. the app's
// "Run Agent / Skill" entries). A plain immutable value — a label plus the
// command to run — rendered by a DataTemplate[ProjectMenuChoice]
// (Header = $Label, Command = $Command).
//
// This is the host-agnostic shape the Project Explorer renders; a host supplies
// the choices through the IProjectMenuSource capability (see capabilities/), so
// the explorer never depends on any concrete feature module (skills/agent-chat).
export class ProjectMenuChoice
{
    constructor(
        public readonly Label: string,
        public readonly Command: ICommand,
    ) { }
}

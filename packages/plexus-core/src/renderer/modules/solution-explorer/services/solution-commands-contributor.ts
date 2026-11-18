import { type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import type { SolutionCommandsService } from './solution-commands-service.js'

// Contributes Save / Save As… / Rename… to the Solution root row's context menu,
// resolving each to the shared SolutionCommandsService command (the same commands the
// window menu and keyboard shortcuts bind). No logic of its own — only the menu surface.
export class SolutionCommandsContributor implements IHierarchyContributor
{
    public static readonly SaveCommandId = 'solution.save'
    public static readonly SaveAsCommandId = 'solution.saveAs'
    public static readonly RenameCommandId = 'solution.rename'

    private static readonly SaveLabel = 'Save'
    private static readonly SaveAsLabel = 'Save As…'
    private static readonly RenameLabel = 'Rename…'
    // Distinct from the neighbouring Solution-row contributors (build 51, html 52-53,
    // publish 54, contribute 56, upload 57 / rows 23-24).
    private static readonly RowOrder = 25
    private static readonly SaveOrder = 58
    private static readonly SaveAsOrder = 59
    private static readonly RenameOrder = 60

    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = SolutionCommandsContributor.RowOrder
    public readonly Actions: readonly CommandDefinition[]

    public constructor(private readonly commands: SolutionCommandsService)
    {
        this.Actions = [
            SolutionCommandsContributor.Def(SolutionCommandsContributor.SaveCommandId, SolutionCommandsContributor.SaveLabel, SolutionCommandsContributor.SaveOrder),
            SolutionCommandsContributor.Def(SolutionCommandsContributor.SaveAsCommandId, SolutionCommandsContributor.SaveAsLabel, SolutionCommandsContributor.SaveAsOrder),
            SolutionCommandsContributor.Def(SolutionCommandsContributor.RenameCommandId, SolutionCommandsContributor.RenameLabel, SolutionCommandsContributor.RenameOrder),
        ]
    }

    private static Def(id: string, title: string, order: number): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Order = order
        def.Context = HierarchyContext.For(NodeKey.Solution)
        return def
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        if (commandId === SolutionCommandsContributor.SaveCommandId) return this.commands.SaveCommand
        if (commandId === SolutionCommandsContributor.SaveAsCommandId) return this.commands.SaveAsCommand
        if (commandId === SolutionCommandsContributor.RenameCommandId) return this.commands.RenameCommand
        return undefined
    }
}

export default SolutionCommandsContributor

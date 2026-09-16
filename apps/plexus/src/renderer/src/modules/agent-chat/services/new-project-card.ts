import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import type { NewProjectDialogModel } from '../../../services/projects/new-project-dialog-model.js'
import type { CreateOutcome } from '../../project-explorer/services/project-explorer-service.js'

// The in-chat New Project card: hosts the reused NewProjectDialogModel form while
// pending, then collapses to a one-line recap once the project is created or the
// user cancels. The orchestration (build form, create, post back to the agent)
// lives in AgentService; this is a pure view-model.
export class NewProjectCard extends MuralBase
{
    public static readonly FormKey = MuralBase.RegisterProperty<NewProjectDialogModel | undefined>(
        NewProjectCard, 'Form', undefined, MetaData.None)
    public static readonly IsPendingKey = MuralBase.RegisterProperty<boolean>(NewProjectCard, 'IsPending', true, MetaData.None)
    // Complement of IsPending (no inverse Visibility converter — bind the form to
    // $IsPending and the recap to $IsDone).
    public static readonly IsDoneKey = MuralBase.RegisterProperty<boolean>(NewProjectCard, 'IsDone', false, MetaData.None)
    public static readonly ResultSummaryKey = MuralBase.RegisterProperty<string>(NewProjectCard, 'ResultSummary', '', MetaData.None)

    public readonly Id: string

    constructor(id: string) { super(); this.Id = id }

    public get Form(): NewProjectDialogModel | undefined { return this.get_property_value(NewProjectCard.FormKey) }
    public set Form(v: NewProjectDialogModel | undefined) { this.set_property_value(NewProjectCard.FormKey, v) }
    public get IsPending(): boolean { return this.get_property_value(NewProjectCard.IsPendingKey) }
    public get IsDone(): boolean { return this.get_property_value(NewProjectCard.IsDoneKey) }
    public get ResultSummary(): string { return this.get_property_value(NewProjectCard.ResultSummaryKey) }

    public showResult(outcome: CreateOutcome): void
    {
        const summary = outcome.created
            ? `Created ${outcome.name} at ${outcome.folder}`
            : `Could not create the project: ${outcome.error ?? 'unknown error'}`
        this.done(summary)
    }

    public showCancelled(): void { this.done('Cancelled.') }

    private done(summary: string): void
    {
        this.set_property_value(NewProjectCard.ResultSummaryKey, summary)
        this.set_property_value(NewProjectCard.IsPendingKey, false)
        this.set_property_value(NewProjectCard.IsDoneKey, true)
    }
}

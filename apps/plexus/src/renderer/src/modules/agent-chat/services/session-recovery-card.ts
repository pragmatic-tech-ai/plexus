// A transcript card shown when the CLI has lost a reopened conversation's session
// (see AgentEventKind.SessionLost). It offers two choices: start fresh (clear the
// stored history) or continue by replaying the stored transcript to the CLI as
// context. Blocks the composer until the user picks (tracked like a QuestionCard).
//
// Every view-bound property is a registered DP so `$Path` bindings resolve through
// get_property_value. After a choice the buttons collapse ($IsPending) and a short
// summary line shows ($IsDone / $Choice).
import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

export type RecoveryMode = 'fresh' | 'replay'

export class SessionRecoveryCard extends MuralBase
{
    public static readonly MessageKey           = MuralBase.RegisterProperty<string>(SessionRecoveryCard, 'Message', '', MetaData.None)
    // IsPending (buttons shown) and its complement IsDone (summary shown) — no
    // inverse Visibility converter, so each branch binds its own bool.
    public static readonly IsPendingKey         = MuralBase.RegisterProperty<boolean>(SessionRecoveryCard, 'IsPending', true, MetaData.None)
    public static readonly IsDoneKey            = MuralBase.RegisterProperty<boolean>(SessionRecoveryCard, 'IsDone', false, MetaData.None)
    public static readonly ChoiceKey            = MuralBase.RegisterProperty<string>(SessionRecoveryCard, 'Choice', '', MetaData.None)
    public static readonly StartFreshCommandKey = MuralBase.RegisterProperty<ICommand>(
        SessionRecoveryCard, 'StartFreshCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ReplayCommandKey     = MuralBase.RegisterProperty<ICommand>(
        SessionRecoveryCard, 'ReplayCommand', undefined as unknown as ICommand, MetaData.None)

    // Correlation id for the reducer's pending-card gate (not view-bound).
    public readonly Id: string = crypto.randomUUID()

    constructor(onChoose: (mode: RecoveryMode) => void)
    {
        super()
        this.set_property_value(SessionRecoveryCard.MessageKey,
            "This conversation's session was lost — the agent no longer has its history. " +
            'Start fresh (clears this conversation), or continue by replaying the stored ' +
            'history back to the agent as context.')
        this.set_property_value(SessionRecoveryCard.StartFreshCommandKey,
            new RelayCommand(() => this.choose('fresh', 'Started fresh — history cleared.', onChoose)))
        this.set_property_value(SessionRecoveryCard.ReplayCommandKey,
            new RelayCommand(() => this.choose('replay', 'Continuing — replaying history as context.', onChoose)))
    }

    public get Message(): string { return this.get_property_value(SessionRecoveryCard.MessageKey) }
    public get IsPending(): boolean { return this.get_property_value(SessionRecoveryCard.IsPendingKey) }
    public get IsDone(): boolean { return this.get_property_value(SessionRecoveryCard.IsDoneKey) }
    public get Choice(): string { return this.get_property_value(SessionRecoveryCard.ChoiceKey) }
    public get StartFreshCommand(): ICommand { return this.get_property_value(SessionRecoveryCard.StartFreshCommandKey) }
    public get ReplayCommand(): ICommand { return this.get_property_value(SessionRecoveryCard.ReplayCommandKey) }

    private choose(mode: RecoveryMode, summary: string, onChoose: (mode: RecoveryMode) => void): void
    {
        if (!this.IsPending) return // one-shot: ignore a second click
        this.set_property_value(SessionRecoveryCard.ChoiceKey, summary)
        this.set_property_value(SessionRecoveryCard.IsDoneKey, true)
        this.set_property_value(SessionRecoveryCard.IsPendingKey, false)
        onChoose(mode)
    }
}

export default SessionRecoveryCard

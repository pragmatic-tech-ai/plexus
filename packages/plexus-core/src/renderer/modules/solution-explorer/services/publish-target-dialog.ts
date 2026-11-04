import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IAccountService } from '../../account/account-service.js'
import {
    TargetKind, type AccountTargets, type EnvironmentTarget, type TargetChoice,
} from '../../../../shared/account-api.js'
import { TargetDialog } from './target-dialog.js'

// The bindable property name the publish picker adds.
enum PublishTargetProperty
{
    CanPublish = 'CanPublish',
}

// "Publish to tenant": one of the account's Runtime environments.
export class PublishTargetDialog extends TargetDialog
{
    private static readonly DialogTitle = 'Publish to tenant'
    private static readonly SignIn = 'Sign in to publish to an environment.'
    private static readonly NoEnvironments = 'Your account has no runtime environments to publish to.'

    public constructor(account: IAccountService, dialogs: DialogService)
    {
        super(account, dialogs)
    }

    protected get Title(): string { return PublishTargetDialog.DialogTitle }
    protected get Kind(): TargetKind { return TargetKind.Publish }
    protected get SignInSentence(): string { return PublishTargetDialog.SignIn }
    protected get NoEnvironmentsSentence(): string { return PublishTargetDialog.NoEnvironments }

    // Signed in and a running environment chosen.
    public get CanPublish(): boolean { return this.IsReady() }

    protected override RefreshCanConfirm(): void
    {
        super.RefreshCanConfirm()
        this.RaisePropertyChanged(PublishTargetProperty.CanPublish, undefined, this.CanPublish)
    }

    protected TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]
    {
        return targets.Publish
    }

    protected ChoiceFor(environment: EnvironmentTarget): TargetChoice | undefined
    {
        return { Environment: environment.Name }
    }
}

export default PublishTargetDialog

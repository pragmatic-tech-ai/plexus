import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IAccountService } from '../../account/account-service.js'
import {
    TargetKind, type AccountTargets, type EnvironmentTarget, type TargetChoice,
} from '../../../../shared/account-api.js'
import { TargetDialog, type EnvironmentChoice } from './target-dialog.js'

// "Publish to tenant": one of the account's Runtime environments. ConfirmCommand can execute once
// signed in with a running environment chosen (TargetDialog.IsReady).
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

    protected TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]
    {
        return targets.Publish
    }

    protected ChoiceFor(environment: EnvironmentChoice): TargetChoice | undefined
    {
        return { Environment: environment.Name }
    }
}

export default PublishTargetDialog

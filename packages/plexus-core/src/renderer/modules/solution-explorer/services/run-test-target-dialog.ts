import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { IAccountService } from '../../account/account-service.js'
import {
    TargetKind, type AccountTargets, type EnvironmentTarget, type TargetChoice,
} from '../../../../shared/account-api.js'
import { TargetDialog, type EnvironmentChoice } from './target-dialog.js'

// "Run/Test in environment": one of the account's Development environments (the server loads a run/test
// build only into a dev environment's own runtime). Lists the develop targets, falling back to the
// Development environments the console lists for contributing, exactly as OpenFromEnvDialog does.
export class RunTestTargetDialog extends TargetDialog
{
    private static readonly DialogTitle = 'Run/Test in environment'
    private static readonly SignIn = 'Sign in to run and test in an environment.'
    private static readonly NoEnvironments = 'Your account has no development environments to run and test in.'

    public constructor(account: IAccountService, dialogs: DialogService)
    {
        super(account, dialogs)
    }

    protected get Title(): string { return RunTestTargetDialog.DialogTitle }
    protected get Kind(): TargetKind { return TargetKind.Develop }
    protected get SignInSentence(): string { return RunTestTargetDialog.SignIn }
    protected get NoEnvironmentsSentence(): string { return RunTestTargetDialog.NoEnvironments }

    protected TargetsFor(targets: AccountTargets): readonly EnvironmentTarget[]
    {
        return targets.Develop ?? targets.Contribute
    }

    protected ChoiceFor(environment: EnvironmentChoice): TargetChoice | undefined
    {
        return { Environment: environment.Name, Source: environment.Ref.Source }
    }
}

export default RunTestTargetDialog

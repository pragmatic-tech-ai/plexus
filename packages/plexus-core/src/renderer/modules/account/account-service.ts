import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { Signal } from '@pragmatic-tech-ai/todl-runtime'
import type { AccountState, AccountTargets, DiscoveredTenant, TargetChoice, TargetKind } from '../../../shared/account-api.js'

// Host-agnostic account capability: the signed-in state, email sign-in through the system browser,
// and the environments the account may contribute or publish to. The desktop host (apps/plexus)
// supplies the impl over its preload bridge; the session token never reaches the renderer.
export interface IAccountService
{
    readonly State: AccountState;
    // Raised once whenever State changes.
    readonly Changed: Signal<void>;
    // Raised when some UI asks the user to sign in; the account module opens its dialog.
    readonly SignInRequested: Signal<void>;
    Refresh(): Promise<void>;
    RequestSignIn(): void;
    Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>;
    SignIn(platformUrl: string, email: string, tenantId: string): Promise<void>;
    CancelSignIn(): Promise<void>;
    SignOut(): Promise<void>;
    Targets(): Promise<AccountTargets>;
    LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>;
    RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>;
}

export const AccountServiceKey = new ServiceKey<IAccountService>('AccountService')

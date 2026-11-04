import type { AccountState } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// How the signed-in account reads on screen: "<email> (<tenant>)", or just the email when the
// tenant name is unknown. Shared by the status cell and the account dialog so they cannot drift.
export class AccountLabel
{
    public static Of(state: AccountState): string
    {
        const email = state.Email ?? ''
        return state.TenantName === undefined || state.TenantName === '' ? email : `${email} (${state.TenantName})`
    }
}

export default AccountLabel

// Where the account dialog is in the sign-in flow. In a module of its own (no imports) so the e2e
// scripted sign-in, which runs in node outside the renderer bundle, can use the same values.
export enum AccountDialogStep
{
    Email = 'email',
    ChooseTenant = 'choose-tenant',
    Waiting = 'waiting',
    SignedIn = 'signed-in',
}

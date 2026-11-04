// A composition module that gives IAccountService.SignInRequested its listener when the module loads.
//
// WHY A MODULE: a picker's Sign in raises SignInRequested and waits for the account dialog. The
// listener used to be the status-bar cell (AccountStatusItem), so a request only worked once the
// status bar had been realized; otherwise it resolved false and Sign in did nothing. This module
// registers AccountDialogHost and constructs it in RegisterServices, which runs synchronously when
// app.mu's .modules: block adds it (after .services: has registered IpcAccountService under
// AccountServiceKey), so the subscription exists from boot regardless of what the shell builds.
import { ShellModule } from '@pragmatic-tech-ai/mural/framework/shell/module.js'
import { ServiceLifetime, type IServiceContainer, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { AccountDialogHost } from './account-dialog-host.js'

export class AccountSignInModuleDefinition extends ShellModule
{
    private static readonly ModuleName = 'AccountSignIn'
    private static readonly NotAProvider = 'AccountSignInModule: the container cannot resolve services, so the account dialog host cannot be built at module load.'

    public constructor()
    {
        super()
        this.set_property_value(ShellModule.NameKey, AccountSignInModuleDefinition.ModuleName)
    }

    // Registers imperatively in RegisterServices (it must also resolve), so it advertises that it
    // has services to register.
    public override get HasServiceRegistrations(): boolean
    {
        return true
    }

    public override RegisterServices(container: IServiceContainer): void
    {
        container.register(AccountDialogHost.Key, (p) => new AccountDialogHost(p), ServiceLifetime.Singleton)
        if (!AccountSignInModuleDefinition.IsProvider(container)) throw new Error(AccountSignInModuleDefinition.NotAProvider)
        container.getRequired(AccountDialogHost.Key)
    }

    // The composition root hands modules its ServiceProvider, which both registers and resolves.
    private static IsProvider(container: IServiceContainer): container is IServiceContainer & IServiceProvider
    {
        return typeof (container as Partial<IServiceProvider>).getRequired === 'function'
    }
}

export const AccountSignInModule = new AccountSignInModuleDefinition()

export default AccountSignInModule

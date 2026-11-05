import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, DialogService, type DialogOptions } from '@pragmatic-tech-ai/mural/framework'
import { AccountServiceKey } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import { Deferred, FakeAccountService } from './fake-account-service.js'

// A DialogService double: records each Show and holds it open on Pending until Close (or the test).
export class FakeDialogs
{
    public readonly Shown: DialogOptions[] = []
    public Pending = new Deferred<unknown>()
    public CloseCount = 0

    public Show<T>(options: DialogOptions): Promise<T | undefined>
    {
        this.Shown.push(options)
        return this.Pending.Promise as Promise<T | undefined>
    }

    public Close(): void
    {
        this.CloseCount++
        this.Pending.Resolve(undefined)
    }
}

export class FakeSettings
{
    public readonly Values = new Map<string, unknown>()

    public Get<T>(key: string): T | undefined
    {
        return this.Values.get(key) as T | undefined
    }

    public Set(key: string, value: unknown): void
    {
        this.Values.set(key, value)
    }
}

// The services the account area resolves: the account, DialogService and ApplicationSettings.
export class AccountShellHarness
{
    public readonly Account = new FakeAccountService()
    public readonly Dialogs = new FakeDialogs()
    public readonly Settings = new FakeSettings()
    public readonly Provider = new ServiceProvider()

    public constructor()
    {
        this.Provider.registerInstance(AccountServiceKey, this.Account)
        this.Provider.registerInstance(DialogService.Key, this.Dialogs as unknown as DialogService)
        this.Provider.registerInstance(ApplicationSettings.Key, this.Settings as unknown as ApplicationSettings)
    }

    // Lets queued promise continuations run.
    public static async Flush(): Promise<void>
    {
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }
}

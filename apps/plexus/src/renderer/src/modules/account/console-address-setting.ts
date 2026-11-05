import type { ApplicationSettings } from '@pragmatic-tech-ai/mural/framework'

// The tenant console address the user last signed in at, remembered across launches.
export interface IConsoleAddressSetting
{
    // '' when unset or blank.
    readonly Value: string
    Remember(address: string): void
    Forget(): void
}

// IConsoleAddressSetting over the application settings. Without a settings service the value is
// always '' and Remember/Forget do nothing.
export class ConsoleAddressSetting implements IConsoleAddressSetting
{
    // Mirrors the SettingDefinition key in account.module.mu; change them together.
    public static readonly Key = 'account.consoleAddress'

    private readonly settings: ApplicationSettings | undefined

    public constructor(settings: ApplicationSettings | undefined)
    {
        this.settings = settings
    }

    public get Value(): string
    {
        const value = this.settings?.Get<unknown>(ConsoleAddressSetting.Key)
        return typeof value === 'string' ? value.trim() : ''
    }

    public Remember(address: string): void
    {
        this.settings?.Set(ConsoleAddressSetting.Key, address)
    }

    public Forget(): void
    {
        this.settings?.Set(ConsoleAddressSetting.Key, '')
    }
}

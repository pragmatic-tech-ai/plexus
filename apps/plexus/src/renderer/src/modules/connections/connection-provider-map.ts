import type { ConnectionProvider } from '@pragmatic-tech-ai/todl/package-manager/connections'

/**
 * Pure label <-> provider-preset mapping for the connection editor's provider dropdown.
 * Deliberately mural-free so it can be unit-tested directly.
 */
export class ConnectionProviderMap
{
    public static readonly CustomLabel = 'Custom'

    private static readonly RegistryKey = 'registry'
    private static readonly DirectoryKey = 'directory'
    private static readonly SuffixOpen = ' ('
    private static readonly SuffixClose = ')'

    private readonly labelled: { label: string; provider: ConnectionProvider }[] = []

    public constructor(providers: readonly ConnectionProvider[])
    {
        const used = new Set<string>([ConnectionProviderMap.CustomLabel])
        for (const provider of providers)
        {
            let label = provider.DisplayName
            for (let n = 2; used.has(label); n++)
            {
                label = provider.DisplayName + ConnectionProviderMap.SuffixOpen + n + ConnectionProviderMap.SuffixClose
            }
            used.add(label)
            this.labelled.push({ label, provider })
        }
    }

    public Labels(): readonly string[]
    {
        return [...this.labelled.map(l => l.label), ConnectionProviderMap.CustomLabel]
    }

    public SettingsFor(label: string): Record<string, string> | undefined
    {
        const match = this.labelled.find(l => l.label === label)
        return match ? { ...match.provider.Settings } : undefined
    }

    public LabelForSettings(settings: Record<string, string>): string
    {
        const keys = [ConnectionProviderMap.RegistryKey, ConnectionProviderMap.DirectoryKey]
        for (const key of keys)
        {
            const value = settings[key]
            if (value === undefined || value === '')
            {
                continue
            }
            const match = this.labelled.find(l => l.provider.Settings[key] === value)
            if (match)
            {
                return match.label
            }
        }
        return ConnectionProviderMap.CustomLabel
    }
}

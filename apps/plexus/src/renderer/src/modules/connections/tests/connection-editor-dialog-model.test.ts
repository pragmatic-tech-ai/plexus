import { describe, it, expect } from 'vitest'
import { TokenSource, type ConnectionProvider, type ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
import { ConnectionEditorDialogModel, type ConnectionEditorResult } from '../connection-editor-dialog-model.js'

// Captures the close(result) call so a test can assert what Confirm/Cancel emitted.
function capture(): { close: (r: ConnectionEditorResult | undefined) => void; readonly result: ConnectionEditorResult | undefined | 'unset' }
{
    let value: ConnectionEditorResult | undefined | 'unset' = 'unset'
    return { close: (r) => { value = r }, get result() { return value } }
}

describe('ConnectionEditorDialogModel', () =>
{
    it('is not confirmable until a name and registry are entered', () =>
    {
        const vm = new ConnectionEditorDialogModel(undefined, [], [], () => {})
        expect(vm.CanConfirm).toBe(false)
        vm.DisplayName = 'GitHub'
        expect(vm.CanConfirm).toBe(false)
        vm.Registry = 'https://npm.pkg.github.com'
        expect(vm.CanConfirm).toBe(true)
    })

    it('confirm produces a stored-token npm spec with the secret and scope', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, [], [], cap.close)
        vm.DisplayName = 'GitHub'
        vm.Registry = 'https://npm.pkg.github.com'
        vm.Scope = '@acme'
        vm.Secret = 'ghp_x'

        vm.ConfirmCommand.Execute(undefined)

        expect(cap.result).toEqual({
            displayName: 'GitHub',
            registryType: 'npm',
            settings: { registry: 'https://npm.pkg.github.com', scope: '@acme' },
            tokenSource: TokenSource.Stored,
            secret: 'ghp_x',
        })
    })

    it('env-token mode requires an env var and omits the secret', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, [], [], cap.close)
        vm.DisplayName = 'GH'
        vm.Registry = 'https://r'
        vm.UseEnvToken = true
        expect(vm.CanConfirm).toBe(false)
        vm.EnvVar = 'NPM_TOKEN'
        expect(vm.CanConfirm).toBe(true)

        vm.ConfirmCommand.Execute(undefined)

        expect(cap.result).toEqual({
            displayName: 'GH',
            registryType: 'npm',
            settings: { registry: 'https://r' },
            tokenSource: TokenSource.Env,
            tokenEnvVar: 'NPM_TOKEN',
        })
    })

    it('edit seeds fields from an existing view and carries its id (no secret echoed)', () =>
    {
        const cap = capture()
        const view: ConnectionView = {
            Id: 'gh', DisplayName: 'GitHub', RegistryType: 'npm',
            Settings: { registry: 'https://r', scope: '@acme' },
            TokenSource: TokenSource.Stored, TokenEnvVar: '', HasToken: true, IsDefault: false,
        }
        const vm = new ConnectionEditorDialogModel(view, [], [], cap.close)
        expect(vm.DisplayName).toBe('GitHub')
        expect(vm.Registry).toBe('https://r')
        expect(vm.Scope).toBe('@acme')

        vm.ConfirmCommand.Execute(undefined)

        expect(cap.result).toMatchObject({ id: 'gh', displayName: 'GitHub', tokenSource: TokenSource.Stored })
        expect((cap.result as ConnectionEditorResult).secret).toBeUndefined()
    })

    it('cancel closes with undefined', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, [], [], cap.close)
        vm.CancelCommand.Execute(undefined)
        expect(cap.result).toBeUndefined()
    })
})

// The button binds Command only (mural >= 0.66.2 disables a button whose command cannot run), so
// the command's CanExecute carries the rule and raises CanExecuteChanged when it flips.
describe('ConnectionEditorDialogModel ConfirmCommand', () =>
{
    it('CanExecute follows CanConfirm and raises CanExecuteChanged on each flip', () =>
    {
        const vm = new ConnectionEditorDialogModel(undefined, [], [], () => {})
        let raised = 0
        vm.ConfirmCommand.AddCanExecuteChangedListener(() => { raised++ })
        expect(vm.ConfirmCommand.CanExecute(undefined)).toBe(false)
        vm.DisplayName = 'GitHub'
        vm.Registry = 'https://npm.pkg.github.com'
        expect(vm.ConfirmCommand.CanExecute(undefined)).toBe(true)
        expect(raised).toBe(1)
        vm.Registry = ''
        expect(vm.ConfirmCommand.CanExecute(undefined)).toBe(false)
        expect(raised).toBe(2)
    })
})

class ProviderFixtures
{
    public static readonly GithubUrl = 'https://npm.pkg.github.com'
    public static readonly GithubApi = 'https://api.github.com'

    public static Providers(): ConnectionProvider[]
    {
        return [
            { RegistryType: 'npm', PresetId: 'github', DisplayName: 'GitHub Packages', Settings: { registry: ProviderFixtures.GithubUrl, githubApi: ProviderFixtures.GithubApi } },
        ]
    }
}

describe('ConnectionEditorDialogModel provider presets', () =>
{
    it('new defaults to GitHub Packages, prefills the registry and carries githubApi into the result', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, ProviderFixtures.Providers(), [], cap.close)
        expect(vm.ProviderLabels).toEqual(['GitHub Packages', 'Custom'])
        expect(vm.SelectedProvider).toBe('GitHub Packages')
        expect(vm.Registry).toBe(ProviderFixtures.GithubUrl)
        vm.DisplayName = 'GH'
        vm.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).settings).toEqual({ registry: ProviderFixtures.GithubUrl, githubApi: ProviderFixtures.GithubApi })
    })

    it('switching to Custom clears the stash and keeps the fields', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, ProviderFixtures.Providers(), [], cap.close)
        vm.DisplayName = 'GH'
        vm.SelectedProvider = 'Custom'
        vm.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).settings).toEqual({ registry: ProviderFixtures.GithubUrl })
    })

    it('edit keeps the existing registry URL and non-displayed keys (no preset clobber)', () =>
    {
        const cap = capture()
        const view: ConnectionView = {
            Id: 'x', DisplayName: 'Mine', RegistryType: 'npm',
            Settings: { registry: 'https://custom.example', scope: '@a' },
            TokenSource: TokenSource.Stored, TokenEnvVar: '', HasToken: false, IsDefault: false,
        }
        const vm = new ConnectionEditorDialogModel(view, ProviderFixtures.Providers(), [], cap.close)
        expect(vm.SelectedProvider).toBe('Custom')
        expect(vm.Registry).toBe('https://custom.example')
        const gh: ConnectionView = { ...view, Settings: { registry: ProviderFixtures.GithubUrl, githubApi: ProviderFixtures.GithubApi, org: 'o' } }
        const vm2 = new ConnectionEditorDialogModel(gh, ProviderFixtures.Providers(), [], cap.close)
        expect(vm2.SelectedProvider).toBe('GitHub Packages')
        vm2.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).settings).toEqual({ registry: ProviderFixtures.GithubUrl, githubApi: ProviderFixtures.GithubApi, org: 'o' })
    })

    it('an empty provider write-back after an Edit seed leaves the registry and stashed keys intact', () =>
    {
        const cap = capture()
        const gh: ConnectionView = {
            Id: 'x', DisplayName: 'Mine', RegistryType: 'npm',
            Settings: { registry: ProviderFixtures.GithubUrl, githubApi: ProviderFixtures.GithubApi, org: 'o' },
            TokenSource: TokenSource.Stored, TokenEnvVar: '', HasToken: false, IsDefault: false,
        }
        const vm = new ConnectionEditorDialogModel(gh, ProviderFixtures.Providers(), [], cap.close)
        vm.SelectedProvider = ''
        expect(vm.Registry).toBe(ProviderFixtures.GithubUrl)
        vm.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).settings).toEqual({ registry: ProviderFixtures.GithubUrl, githubApi: ProviderFixtures.GithubApi, org: 'o' })
    })

    it('edit of a Custom-matched connection round-trips its extra keys', () =>
    {
        const cap = capture()
        const view: ConnectionView = {
            Id: 'x', DisplayName: 'Mine', RegistryType: 'npm',
            Settings: { registry: 'https://custom.example', org: 'acme' },
            TokenSource: TokenSource.Stored, TokenEnvVar: '', HasToken: false, IsDefault: false,
        }
        const vm = new ConnectionEditorDialogModel(view, ProviderFixtures.Providers(), [], cap.close)
        expect(vm.SelectedProvider).toBe('Custom')
        vm.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).settings).toEqual({ registry: 'https://custom.example', org: 'acme' })
    })
})

describe('ConnectionEditorDialogModel env-var picker', () =>
{
    const vars = ['GITHUB_TOKEN', 'NPM_TOKEN', 'CI']

    it('exposes the discovered environment variables as the picker list', () =>
    {
        const vm = new ConnectionEditorDialogModel(undefined, [], vars, () => {})
        expect(vm.EnvVars).toEqual(vars)
    })

    it('a picked variable round-trips into the env-token result', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, [], vars, cap.close)
        vm.DisplayName = 'GH'
        vm.Registry = 'https://r'
        vm.UseEnvToken = true
        vm.EnvVar = 'NPM_TOKEN'   // as picking from the ComboBox would set Text/EnvVar
        expect(vm.CanConfirm).toBe(true)
        vm.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).tokenEnvVar).toBe('NPM_TOKEN')
    })

    it('still accepts a free-typed variable name that is not in the discovered list', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, [], vars, cap.close)
        vm.DisplayName = 'GH'
        vm.Registry = 'https://r'
        vm.UseEnvToken = true
        vm.EnvVar = 'PROD_ONLY_TOKEN'   // not present locally, but valid for CI/prod
        vm.ConfirmCommand.Execute(undefined)
        expect((cap.result as ConnectionEditorResult).tokenEnvVar).toBe('PROD_ONLY_TOKEN')
    })

    it('edit seeds the env-var field from the existing connection', () =>
    {
        const view: ConnectionView = {
            Id: 'gh', DisplayName: 'GitHub', RegistryType: 'npm',
            Settings: { registry: 'https://r' },
            TokenSource: TokenSource.Env, TokenEnvVar: 'GITHUB_TOKEN', HasToken: true, IsDefault: false,
        }
        const vm = new ConnectionEditorDialogModel(view, [], vars, () => {})
        expect(vm.UseEnvToken).toBe(true)
        expect(vm.EnvVar).toBe('GITHUB_TOKEN')
    })
})

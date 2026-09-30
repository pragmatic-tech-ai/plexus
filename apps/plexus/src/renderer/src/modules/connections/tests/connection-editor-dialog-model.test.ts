import { describe, it, expect } from 'vitest'
import { TokenSource, type ConnectionView } from '@pragmatic-tech-ai/todl/package-manager/connections'
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
        const vm = new ConnectionEditorDialogModel(undefined, () => {})
        expect(vm.CanConfirm).toBe(false)
        vm.DisplayName = 'GitHub'
        expect(vm.CanConfirm).toBe(false)
        vm.Registry = 'https://npm.pkg.github.com'
        expect(vm.CanConfirm).toBe(true)
    })

    it('confirm produces a stored-token npm spec with the secret and scope', () =>
    {
        const cap = capture()
        const vm = new ConnectionEditorDialogModel(undefined, cap.close)
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
        const vm = new ConnectionEditorDialogModel(undefined, cap.close)
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
        const vm = new ConnectionEditorDialogModel(view, cap.close)
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
        const vm = new ConnectionEditorDialogModel(undefined, cap.close)
        vm.CancelCommand.Execute(undefined)
        expect(cap.result).toBeUndefined()
    })
})

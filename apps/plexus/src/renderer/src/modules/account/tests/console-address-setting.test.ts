import { describe, expect, it } from 'vitest'
import type { ApplicationSettings } from '@pragmatic-tech-ai/mural/framework'
import { ConsoleAddressSetting } from '../console-address-setting.js'
import { FakeSettings } from './account-shell-harness.js'

class Maker
{
    public static Over(settings: FakeSettings): ConsoleAddressSetting
    {
        return new ConsoleAddressSetting(settings as unknown as ApplicationSettings)
    }
}

describe('ConsoleAddressSetting', () =>
{
    it('without a settings service the value is empty and Remember/Forget do nothing', () =>
    {
        const setting = new ConsoleAddressSetting(undefined)
        expect(setting.Value).toBe('')
        expect(() => setting.Remember('https://c.example')).not.toThrow()
        expect(() => setting.Forget()).not.toThrow()
        expect(setting.Value).toBe('')
    })

    it('a blank or non-string stored value reads as empty', () =>
    {
        const settings = new FakeSettings()
        const setting = Maker.Over(settings)
        settings.Values.set(ConsoleAddressSetting.Key, '   ')
        expect(setting.Value).toBe('')
        settings.Values.set(ConsoleAddressSetting.Key, 42)
        expect(setting.Value).toBe('')
    })

    it('Remember writes the key and Forget clears it', () =>
    {
        const settings = new FakeSettings()
        const setting = Maker.Over(settings)
        setting.Remember('https://c.example')
        expect(settings.Values.get('account.consoleAddress')).toBe('https://c.example')
        expect(setting.Value).toBe('https://c.example')
        setting.Forget()
        expect(settings.Values.get('account.consoleAddress')).toBe('')
        expect(setting.Value).toBe('')
    })
})

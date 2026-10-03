import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, type DialogOptions } from '@pragmatic-tech-ai/mural/framework'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { OperatingSystem, type IEnvironment } from '@pragmatic-tech-ai/todl-runtime'
import { WindowService, type IWindowService } from '../../window/window-service.js'
import { HelpCommandsService } from '../help-commands-service.js'
import { AboutDialogVm } from '../about-dialog.js'
import { ShortcutsDialogVm } from '../shortcuts-dialog.js'

// Records every Show() call instead of actually mounting a dialog — the real
// seam HelpCommandsService depends on (DialogService.Show), kept minimal.
class FakeDialogService
{
    public readonly calls: DialogOptions[] = []

    public Show<T>(options: DialogOptions): Promise<T | undefined>
    {
        this.calls.push(options)
        return Promise.resolve(undefined)
    }
}

// A fixed, real IEnvironment — the host snapshot HelpCommandsService reads
// version fields from (never mutates it).
class FakeEnvironment implements IEnvironment
{
    public readonly CurrentDirectory = 'C:/work'
    public readonly HomeDirectory = 'C:/Users/test'
    public readonly TempDirectory = 'C:/tmp'
    public readonly UserDataDirectory = 'C:/Users/test/AppData/Roaming/Plexus'
    public readonly DocumentsDirectory = 'C:/Users/test/Documents'
    public readonly DownloadsDirectory = 'C:/Users/test/Downloads'
    public readonly Platform = OperatingSystem.Windows
    public readonly Architecture = 'x64'
    public readonly PathSeparator = '\\'
    public readonly IsWindows = true
    public readonly AppVersion = '1.2.3'
    public readonly ElectronVersion = '33.0.0'
    public readonly ChromeVersion = '130.0.0'
    public readonly NodeVersion = '22.0.0'
    public readonly IsDevelopment = false
    public readonly IsPackaged = true
}

// Records Quit() calls instead of reaching window.api — the real seam
// HelpCommandsService.QuitCommand depends on (WindowService.Key).
class FakeWindowService implements IWindowService
{
    public quitCalls = 0

    public Quit(): void
    {
        this.quitCalls += 1
    }
}

function buildService(): { svc: HelpCommandsService; dialogs: FakeDialogService; environment: FakeEnvironment; windowService: FakeWindowService }
{
    const provider = new ServiceProvider()
    const dialogs = new FakeDialogService()
    const environment = new FakeEnvironment()
    const windowService = new FakeWindowService()
    provider.registerInstance(DialogService.Key, dialogs as never)
    provider.registerInstance(EnvironmentService.Key, environment as never)
    provider.registerInstance(WindowService.Key, windowService as never)
    const svc = new HelpCommandsService(provider)
    return { svc, dialogs, environment, windowService }
}

test('ShowAboutCommand is always enabled', () => {
    const { svc } = buildService()
    expect(svc.ShowAboutCommand.CanExecute()).toBe(true)
})

test('ShowAboutCommand opens a dialog titled "About Plexus" with a content VM exposing the host version fields', async () => {
    const { svc, dialogs, environment } = buildService()

    svc.ShowAboutCommand.Execute()
    await Promise.resolve()

    expect(dialogs.calls.length).toBe(1)
    expect(dialogs.calls[0].Title).toBe('About Plexus')
    const content = dialogs.calls[0].Content as AboutDialogVm
    expect(content).toBeInstanceOf(AboutDialogVm)
    expect(content.AppName).toBe('Plexus')
    expect(content.AppVersion).toBe(environment.AppVersion)
    expect(content.ElectronVersion).toBe(environment.ElectronVersion)
    expect(content.ChromeVersion).toBe(environment.ChromeVersion)
    expect(content.NodeVersion).toBe(environment.NodeVersion)
    expect(content.Platform).toBe(environment.Platform)
    expect(content.Architecture).toBe(environment.Architecture)
})

test('ShowShortcutsCommand is always enabled', () => {
    const { svc } = buildService()
    expect(svc.ShowShortcutsCommand.CanExecute()).toBe(true)
})

test('ShowShortcutsCommand opens a dialog titled "Keyboard Shortcuts" with the shortcuts VM, including Save', async () => {
    const { svc, dialogs } = buildService()

    svc.ShowShortcutsCommand.Execute()
    await Promise.resolve()

    expect(dialogs.calls.length).toBe(1)
    expect(dialogs.calls[0].Title).toBe('Keyboard Shortcuts')
    const content = dialogs.calls[0].Content as ShortcutsDialogVm
    expect(content).toBeInstanceOf(ShortcutsDialogVm)
    const saveEntry = content.Entries.find((e) => e.Description === 'Save')
    expect(saveEntry).toBeDefined()
    expect(saveEntry?.Gesture).toBe('Ctrl/⌘+S')
})

test('QuitCommand is always enabled', () => {
    const { svc } = buildService()
    expect(svc.QuitCommand.CanExecute()).toBe(true)
})

test('QuitCommand.Execute() calls the injected WindowService.Quit()', () => {
    const { svc, windowService } = buildService()

    svc.QuitCommand.Execute()

    expect(windowService.quitCalls).toBe(1)
})

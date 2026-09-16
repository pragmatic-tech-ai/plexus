import { test, expect } from 'vitest'
import { AiProviderService } from '../ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from '../ai-provider.js'

function fakeProvider(id: string): IAiProvider {
    return {
        Id: id, Resumable: true,
        listAgentsAndSkills: () => Promise.resolve({ agents: [], skills: [] }),
        listSkills: () => Promise.resolve([]),
        start: (): AiProviderSession => ({ send: () => {}, abort: () => {}, dispose: () => Promise.resolve() }),
    }
}

test('the first registered provider becomes active by default', () => {
    const svc = new AiProviderService()
    const claude = fakeProvider('claude-cli')
    svc.register(claude)
    expect(svc.active()).toBe(claude)
})

test('setActive switches the active provider by id', () => {
    const svc = new AiProviderService()
    const a = fakeProvider('a'); const b = fakeProvider('b')
    svc.register(a); svc.register(b)
    expect(svc.active()).toBe(a)
    svc.setActive('b')
    expect(svc.active()).toBe(b)
})

test('active throws when no provider is registered', () => {
    expect(() => new AiProviderService().active()).toThrow()
})

test('setActive to an unknown id throws', () => {
    const svc = new AiProviderService()
    svc.register(fakeProvider('a'))
    expect(() => svc.setActive('nope')).toThrow()
})

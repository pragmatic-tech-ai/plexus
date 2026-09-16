import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { LibraryRegistry } from '../../../library/services/library-registry.js'
import { registerArchToolboxAdapters } from '../register-arch-toolbox-adapters.js'
import { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'

function providerWithRegistry(): ServiceProvider {
  const p = new ServiceProvider()
  p.registerInstance(LibraryRegistry.Key, { discover: async () => [] } as never)
  return p
}

describe('registerArchToolboxAdapters', () => {
  it('registers the drop factory, constructs TodlPresentationRegistry if absent, idempotent', () => {
    const p = providerWithRegistry()
    registerArchToolboxAdapters(p)
    expect(p.get(ArchInstanceDropFactoryKey)).toBeDefined()
    const registry = p.get(TodlPresentationRegistry.Key)
    expect(registry).toBeDefined()
    // Both sources registered (idempotency checked by calling twice)
    registerArchToolboxAdapters(p)
    expect(p.get(ArchInstanceDropFactoryKey)).toBeDefined()
    expect(p.get(TodlPresentationRegistry.Key)).toBe(registry) // same instance
  })
})

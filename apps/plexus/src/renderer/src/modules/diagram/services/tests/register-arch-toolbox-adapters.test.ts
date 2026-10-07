import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { registerArchToolboxAdapters } from '../register-arch-toolbox-adapters.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'

describe('registerArchToolboxAdapters', () => {
  it('registers the toolbox drop factories and is idempotent (registry lifecycle is not its concern)', () => {
    const p = new ServiceProvider()
    registerArchToolboxAdapters(p)
    const factory = p.get(ArchInstanceDropFactoryKey)
    expect(factory).toBeDefined()
    // Safe to call again — existing registrations are left in place.
    registerArchToolboxAdapters(p)
    expect(p.get(ArchInstanceDropFactoryKey)).toBe(factory)
  })
})

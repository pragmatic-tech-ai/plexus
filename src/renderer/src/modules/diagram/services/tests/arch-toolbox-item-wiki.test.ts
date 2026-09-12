import { test, expect } from 'vitest'
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ArchToolboxItem } from '../arch-toolbox-item.js'
import { EntityIconVM } from '../entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'

test('ArchToolboxItem carries Concept and a settable HasWiki', () => {
    const desc = new ToolboxVisualDescriptor(new ServiceKey('x'), 'k')
    const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
    const item = new ArchToolboxItem('instance:a', 'A', desc, new ServiceKey('f'), new EntityIconVM(reg, 'k'), 'service')
    expect(item.Concept).toBe('service')
    expect(item.HasWiki).toBe(false)
    item.HasWiki = true
    expect(item.HasWiki).toBe(true)
})

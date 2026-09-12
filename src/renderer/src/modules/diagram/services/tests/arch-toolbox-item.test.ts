import { describe, it, expect } from 'vitest'
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT, type IToolboxVisualResolver, type IToolboxDropFactory } from '@pragmatic-tech-ai/mural/framework'
import { ArchToolboxItem } from '../arch-toolbox-item.js'
import { EntityIconVM } from '../entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'

// A registry stub exposing iconKeyFor (EntityIconVM's only surface).
const reg = (index: Map<string, string>) =>
  ({ iconKeyFor: (k: string) => index.get(k) }) as unknown as TodlPresentationRegistry

describe('ArchToolboxItem', () => {
  const rk = new ServiceKey<IToolboxVisualResolver>('R')
  const fk = new ServiceKey<IToolboxDropFactory>('F')

  it('exposes Display = label, the base item surface, and the passed Icon VM', () => {
    const desc = new ToolboxVisualDescriptor(rk, 'Stack.AzureOpenAI')
    const icon = new EntityIconVM(reg(new Map([['Stack.AzureOpenAI', 'icon-aoai']])), 'Stack.AzureOpenAI')
    const item = new ArchToolboxItem('term:Stack.AzureOpenAI', 'Azure OpenAI', desc, fk, icon)
    expect(item.Id).toBe('term:Stack.AzureOpenAI')
    expect(item.Label).toBe('Azure OpenAI')
    expect(item.Display).toBe('Azure OpenAI')
    expect(item.Descriptor).toBe(desc)
    expect(item.FactoryKey).toBe(fk)
    expect(item.Icon).toBe(icon)
    expect(item.Icon.IconKey).toBe('icon-aoai')
  })

  it('BeginDragData carries the Id under TOOLBOX_ITEM_FORMAT', () => {
    const icon = new EntityIconVM(reg(new Map()), 'x')
    const item = new ArchToolboxItem('term:x', 'X', new ToolboxVisualDescriptor(rk, 'x'), fk, icon)
    const payload = item.BeginDragData!()
    expect(payload.data.Get(TOOLBOX_ITEM_FORMAT)).toBe('term:x')
  })
})

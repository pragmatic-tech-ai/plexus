import { describe, it, expect } from 'vitest'
import { DimmedNames } from '../dot-name-opacity.js'

describe('DimmedNames', () =>
{
    it('dims a dot-prefixed name to 40%', () =>
    {
        expect(DimmedNames.OpacityFor('.claude')).toBe(0.4)
        expect(DimmedNames.OpacityFor('.git')).toBe(0.4)
    })

    it('leaves an ordinary name at full opacity', () =>
    {
        expect(DimmedNames.OpacityFor('concepts')).toBe(1)
        expect(DimmedNames.OpacityFor('Connections')).toBe(1)
    })

    it('does not dim a name that merely contains a dot', () =>
    {
        expect(DimmedNames.OpacityFor('model.todl')).toBe(1)
    })

    it('tolerates an undefined caption (full opacity, no throw)', () =>
    {
        expect(() => DimmedNames.OpacityFor(undefined as unknown as string)).not.toThrow()
        expect(DimmedNames.OpacityFor(undefined as unknown as string)).toBe(1)
    })
})

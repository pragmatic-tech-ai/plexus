import { describe, expect, it } from 'vitest'
import { DisplayPlacement, type DisplayBounds } from '../display-placement'

const PRIMARY: DisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 }
const SECONDARY: DisplayBounds = { x: 2560, y: 0, width: 2560, height: 1440 }

describe('DisplayPlacement.TargetOrigin', () =>
{
    it('returns the override when it parses as "x,y"', () =>
    {
        expect(DisplayPlacement.TargetOrigin([PRIMARY, SECONDARY], '3000,120')).toEqual({ x: 3000, y: 120 })
    })

    it('falls back to the first non-primary display when no override is set', () =>
    {
        expect(DisplayPlacement.TargetOrigin([PRIMARY, SECONDARY])).toEqual({ x: 2560, y: 0 })
    })

    it('returns the origin when the only display is primary', () =>
    {
        expect(DisplayPlacement.TargetOrigin([PRIMARY])).toEqual({ x: 0, y: 0 })
    })

    it('returns the origin when there are no displays at all', () =>
    {
        expect(DisplayPlacement.TargetOrigin([])).toEqual({ x: 0, y: 0 })
    })

    it('ignores a malformed override and falls back to the non-primary display', () =>
    {
        expect(DisplayPlacement.TargetOrigin([PRIMARY, SECONDARY], 'abc')).toEqual({ x: 2560, y: 0 })
        expect(DisplayPlacement.TargetOrigin([PRIMARY, SECONDARY], '100')).toEqual({ x: 2560, y: 0 })
        expect(DisplayPlacement.TargetOrigin([PRIMARY, SECONDARY], '1.5,20')).toEqual({ x: 2560, y: 0 })
    })

    it('tolerates whitespace around the override numbers', () =>
    {
        expect(DisplayPlacement.TargetOrigin([PRIMARY], ' 3000 , 120 ')).toEqual({ x: 3000, y: 120 })
    })

    it('accepts negative coordinates in the override (monitors left of primary)', () =>
    {
        expect(DisplayPlacement.TargetOrigin([PRIMARY], '-1920,0')).toEqual({ x: -1920, y: 0 })
    })
})

describe('DisplayPlacement.ChromiumWindowPositionArg', () =>
{
    it('formats the origin as a chromium --window-position flag', () =>
    {
        expect(DisplayPlacement.ChromiumWindowPositionArg({ x: 2560, y: 0 })).toBe('--window-position=2560,0')
    })
})

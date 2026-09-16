import { test, expect } from 'vitest'
import { timeAgo } from '../time-ago.js'

const now = 1_000_000_000_000   // fixed reference instant (ms)
const ago = (ms: number) => now - ms
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H, W = 7 * D

test('a zero/absent timestamp has no label', () => {
    expect(timeAgo(now, 0)).toBe('')
    expect(timeAgo(now, -5)).toBe('')
})

test('the last three-quarters of a minute reads as "now"', () => {
    expect(timeAgo(now, now)).toBe('now')
    expect(timeAgo(now, ago(30 * S))).toBe('now')
})

test('minutes, hours, days, and weeks each get a compact suffix', () => {
    expect(timeAgo(now, ago(90 * S))).toBe('1m')
    expect(timeAgo(now, ago(5 * M))).toBe('5m')
    expect(timeAgo(now, ago(3 * H))).toBe('3h')
    expect(timeAgo(now, ago(2 * D))).toBe('2d')
    expect(timeAgo(now, ago(3 * W))).toBe('3w')
})

test('a future timestamp clamps to "now" rather than going negative', () => {
    expect(timeAgo(now, now + 10 * S)).toBe('now')
})

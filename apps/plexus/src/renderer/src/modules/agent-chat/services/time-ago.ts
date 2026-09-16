// Compact relative-time label for the Conversations list — "now", "5m", "3h",
// "2d", "3w". Pure (takes both instants) so it stays deterministic and testable;
// callers pass Date.now() as `now` (renderer-only — the no-Date.now rule is
// main-process). A zero/absent `then` yields '' — records persisted before the
// UpdatedAt field existed carry no time and render no label.
export function timeAgo(nowMs: number, thenMs: number): string
{
    if (thenMs <= 0) return ''
    const secs = Math.max(0, Math.floor((nowMs - thenMs) / 1000))
    if (secs < 45) return 'now'
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${Math.max(1, mins)}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    return `${Math.floor(days / 7)}w`
}

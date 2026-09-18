// Pure path helpers for the file-watch feature. Kept dependency-free so both
// services and the FileWatchService can import it without an import cycle.

// Absolute-path compare that tolerates separator + case differences (Windows
// filesystems are case-insensitive; POSIX ones are not).
export function samePath(a: string, b: string, caseInsensitive: boolean): boolean
{
    return normalizePath(a, caseInsensitive) === normalizePath(b, caseInsensitive)
}

// Canonical form for comparison: unify separators to '/', drop a trailing slash,
// and lowercase when case-insensitive.
export function normalizePath(p: string, caseInsensitive: boolean): string
{
    const unified = (caseInsensitive ? p.toLowerCase() : p).replace(/[\\/]+/g, '/').replace(/\/+$/, '')
    return unified
}

import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'
import { EnvironmentService } from '../environment/environment-service.js'

// A mural value converter that shortens a filesystem path for display, replacing
// each intermediate directory name with `..` while keeping the root, the first
// directory, and the final segment:
//
//   C:\test\tes2\test3\project.plexus  →  C:\test\..\..\project.plexus
//
// Markup binds the converter object itself (`$Path << ShortenPath`) and mural
// calls `.convert` on it, so the converter is a stateless instance implementing
// ValueConverter — not a class referenced by name (its `convert` would live on
// the prototype, unreachable through the class object).
export class ShortenPathConverter implements ValueConverter
{
    // How the host's path separator is obtained. Defaults to the running app's
    // EnvironmentService (the host-agnostic seam for platform values); unit tests
    // inject a fixed separator so the pure formatting is exercised without a host.
    public constructor(
        private readonly separator: () => string =
            () => Application.current?.Services.get(EnvironmentService.Key)?.PathSeparator ?? '/',
    )
    {}

    // Shorten `value` (coerced to string). Paths with three or fewer segments —
    // root + one directory + leaf, or shorter — have no intermediate directory to
    // hide and are returned unchanged. Split AND rejoin use the host's own
    // separator: a recent path is a host path in that separator, so this is
    // correct on every platform (and never mis-splits a POSIX name that legally
    // contains a backslash, which a `[\\/]` regex would).
    // Signature mirrors ValueConverter.convert(value: any): any.
    public convert(value: any): any
    {
        const sep = this.separator()
        const path = typeof value === 'string' ? value : String(value ?? '')
        const segments = path.split(sep)
        if (segments.length <= 3) return path
        const head = segments.slice(0, 2)                    // root + first directory
        const middle = segments.slice(2, -1).map(() => '..') // each hidden directory → ..
        const tail = segments[segments.length - 1]
        return [...head, ...middle, tail].join(sep)
    }
}

// The shared, stateless converter instance markup binds against.
export const ShortenPath: ValueConverter = new ShortenPathConverter()

// Browser stand-in for Node's `node:module`, aliased in ONLY for the renderer
// (see electron.vite.config.ts). The mural compiler statically does
// `import { createRequire } from 'node:module'` (compiler.js) to lazily load its
// Material-theme class bundle. In the Chromium renderer there is no Node require;
// Vite externalises `node:module` to a proxy that throws on any property access,
// so merely BINDING that named import crashes the renderer at module load —
// before any template is compiled. mural's compiler runs in-process here because
// LibraryRegistry compiles `.mural` visual templates at runtime via `instantiate`.
//
// The compiler wraps the createRequire call in try/catch and tolerates an empty
// Material bundle (no `.mu` references a Material class by NAME — theme values are
// `@key` resource lookups, resolved elsewhere), so a no-op that yields an empty
// module keeps the import resolvable and the compiler fully functional for the
// framework/library classes it actually needs.
export function createRequire() {
    return () => ({})
}

export default { createRequire }

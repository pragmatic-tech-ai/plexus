// Ambient declaration for Vite's `?worker` imports (Monaco's web worker). Vite
// bundles these as same-origin worker files; the default export is a zero-arg
// Worker constructor. Kept local (rather than referencing vite/client) so it
// resolves regardless of how the renderer tsconfig is configured.
declare module '*?worker' {
    const workerConstructor: { new (): Worker }
    export default workerConstructor
}

// Vite's `?raw` imports — the file's contents as a string. Used to embed
// scaffold/template assets (e.g. the meta-model project's CLAUDE.md + manual)
// without escaping them into TS string literals.
declare module '*?raw' {
    const content: string
    export default content
}

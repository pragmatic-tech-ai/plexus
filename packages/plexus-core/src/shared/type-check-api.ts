// Type-check wire contract — the html-bundle tsc pass runs in the Electron main
// process; the renderer resolves ITypeChecker to an IpcTypeChecker that invokes this
// channel. TypeCheckRequest / TypeCheckResult are plain todl types (plain-
// serializable), imported directly where used, so they cross IPC unchanged.

export enum TypeCheckChannel
{
    Check = 'type-check:project',
}

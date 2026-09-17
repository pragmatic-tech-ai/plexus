// Public surface of the relocated Project Explorer module: the ProjectExplorerService
// plus its exported helpers/types (applyPrefill, importFilters, uniqueStorageName,
// ReloadableDocument, CreateOutcome). App code resolves these via
// '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'; the .mu module
// and resources are imported by their deep paths (…/project-explorer/*).
export * from './services/project-explorer-service.js'

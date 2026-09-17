// Public surface of plexus-core's Project Explorer substrate. Grows as the
// explorer's model, factory contract, capability interfaces, and the module
// itself relocate here (see the plexus-core migration plan). Consumers import
// from '@pragmatic-tech-ai/plexus-core/renderer/projects'.
export { ProjectMenuChoice } from './project-menu-choice.js'
export { ProjectTreeHostKey, isProjectTreeHost } from './project-tree-host.js'
export type { IProjectTreeHost, MoveArg } from './project-tree-host.js'
export * from './capabilities/index.js'

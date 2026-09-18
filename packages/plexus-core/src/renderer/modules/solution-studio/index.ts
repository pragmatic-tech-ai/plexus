// SolutionServicesStudio — the presentation-band solution capability for the
// solution engine (`@pragmatic-tech-ai/todl`'s SolutionServicesEngine), packaged as
// a shell module. A Mural/Plexus app lists `SolutionStudioModule` in its `.modules:`
// block (the Solution Explorer panel + rail capability), merges SolutionStudioResources,
// calls `SolutionStudioSeams.Register` to bind the generic engine host seams (prompt +
// storage), and supplies an `ISolutionWorkspaceHost` impl (folder pick, connections,
// member compile) under SolutionWorkspaceHostKey.
export { SolutionStudioModule } from './solution-studio.module.mu.js';
export { SolutionStudioSeams } from './solution-studio-seams.js';
export { SolutionExplorerService } from './solution-explorer-service.js';
export { DialogPromptService } from './dialog-prompt-service.js';
export {
  type ISolutionWorkspaceHost,
  type SolutionConnection,
  type MemberCompileResult,
  SolutionWorkspaceHostKey,
} from './solution-workspace-host.js';

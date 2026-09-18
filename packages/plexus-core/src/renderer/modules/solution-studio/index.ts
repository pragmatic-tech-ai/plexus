// SolutionServicesStudio — the presentation-band host services for the solution
// engine (`@pragmatic-tech-ai/todl`'s SolutionServicesEngine), packaged as a shell
// module. A Mural/Plexus app lists `SolutionStudioModule` in its `.modules:` block
// to bind the prompt-service + storage-registry seams the engine resolves; the
// app loads the engine module (services) imperatively alongside. `DialogPromptService`
// is exported for hosts that compose the prompt seam themselves.
export { SolutionStudioModule } from './solution-studio-module.js';
export { DialogPromptService } from './dialog-prompt-service.js';

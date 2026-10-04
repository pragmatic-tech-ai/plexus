// Solution-engine host seams — the generic DI glue a Mural/Plexus shell supplies
// for the solution engine (`@pragmatic-tech-ai/todl`'s SolutionServicesEngine).
// `SolutionSeams.Register` binds the prompt service (over DialogService) and the
// storage-provider registry (aliasing the composed StorageService). No presentation
// lives here — the shell owns its own Solution Explorer.
export { SolutionSeams } from './solution-seams.js';
export { DialogPromptService } from './dialog-prompt-service.js';

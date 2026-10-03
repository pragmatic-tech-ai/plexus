// Public surface of the relocated Background Work module: the manager service
// (BackgroundWorkService + its BackgroundWorkServiceKey), the pluggable-executor
// seam (TaskKind/BackgroundTask/ITaskContext/ITaskExecutor/TaskExecutorRegistry),
// the built-in InlineExecutor, the per-task view-model (TaskHandle/TaskStatus),
// and the output-document (TaskOutputDocument). App code resolves these via
// '@pragmatic-tech-ai/plexus-core/renderer/modules/background-work'; the app's
// own background-work.module.mu (StatusBar ShellControl registration) and
// background-work.resources.mu (the dock templates) stay app-side — they merge
// an app-shell StatusBar region, not a portable mural concern — and import the
// service classes from this barrel.
export { BackgroundWorkService, BackgroundWorkServiceKey, type SubmitResult } from './services/background-work-service.js'
export { TaskExecutorRegistry, TaskKind, type BackgroundTask, type ITaskContext, type ITaskExecutor } from './services/task-executor.js'
export { TaskHandle, TaskStatus } from './services/task-handle.js'
export { InlineExecutor, type InlineJob } from './services/inline-executor.js'
export { TaskOutputDocument } from './services/task-output-document.js'

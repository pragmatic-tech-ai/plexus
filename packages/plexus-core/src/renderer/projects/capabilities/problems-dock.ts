import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'

// The workspace "Problems" dock. The explorer expands it after an action that
// may surface diagnostics (e.g. a publish); the impl (app-side) owns the panel.
export interface IProblemsDock
{
    expand(): void
}

export const ProblemsDockKey = new ServiceKey<IProblemsDock>('IProblemsDock')

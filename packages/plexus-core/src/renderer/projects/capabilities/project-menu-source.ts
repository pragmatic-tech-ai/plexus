import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../open-project.js'
import type { ProjectMenuChoice } from '../project-menu-choice.js'

// Contributes the extra project-header menu rows (e.g. the app's "Run Agent /
// Skill" entries) for a given project. The explorer renders whatever choices the
// host returns; a host with nothing to add simply isn't registered.
export interface IProjectMenuSource
{
    menuFor(op: OpenProject): Promise<readonly ProjectMenuChoice[]>
}

export const ProjectMenuSourceKey = new ServiceKey<IProjectMenuSource>('IProjectMenuSource')

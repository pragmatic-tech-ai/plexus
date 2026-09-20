import type { BindingSource } from './skill-api.js'

export enum BindingPayloadKind { Project = 'project', Selection = 'selection', Document = 'document', Entity = 'entity', Path = 'path', Empty = 'empty' }
export enum SkillContextChannel { SetContext = 'skill-context:set', ClearContext = 'skill-context:clear' }

export interface ResolvedInput { key: string; value: string | number | boolean }
export interface ResolvedBinding { source: BindingSource; as?: string; kind: BindingPayloadKind; data: unknown }
export interface SkillContext { skillName: string; inputs: ResolvedInput[]; bindings: ResolvedBinding[] }

// The renderer→main bridge for pushing a run's structured context to the
// per-session store the get_skill_context MCP tool reads.
export interface ISkillContextApi
{
    set(sessionId: string, context: SkillContext): Promise<void>
    clear(sessionId: string): Promise<void>
}

// Factory home (OOP: no free functions).
export class SkillContexts
{
    static empty(skillName: string): SkillContext { return { skillName, inputs: [], bindings: [] } }
}

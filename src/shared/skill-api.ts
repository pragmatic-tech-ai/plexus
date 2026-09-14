import { AgentSkillKind } from './agent-api.js'

export enum InputKind { Text = 'text', Number = 'number', Bool = 'bool', Enum = 'enum', Selection = 'selection', Entity = 'entity' }
export enum BindingSource { CurrentProject = 'currentProject', DiagramSelection = 'diagramSelection', ActiveDocument = 'activeDocument', EntityRef = 'entityRef', WorkspaceRoot = 'workspaceRoot' }
export enum OutputKind { Conversation = 'conversation', File = 'file', ModelPatch = 'modelPatch' }
export enum SkillScope { Project = 'project', Global = 'global', Packaged = 'packaged' }
export enum SkillSourceKind { ClaudeCode = 'claudeCode', PlexusSuperset = 'plexusSuperset' }
export enum ProjectType { Architecture = 'architecture', MetaModel = 'metaModel', Library = 'library' }
export enum SkillProblemSeverity { Error = 'error', Warning = 'warning' }
export enum SkillChannel { ListSkills = 'skill:list-skills' }

export interface SkillInput { key: string; label: string; type: InputKind; options?: string[]; required?: boolean; default?: string | number | boolean }
export interface SkillBinding { source: BindingSource; as?: string }
export interface SkillOutput { kind: OutputKind; target?: string }
export interface SkillDeprecation { replacedBy?: string; note?: string }
export interface SkillProblem { message: string; severity: SkillProblemSeverity }

export interface SkillDescriptor {
    kind: AgentSkillKind
    name: string
    title: string
    description: string
    scope: SkillScope
    sourceKind: SkillSourceKind
    category?: string
    icon?: string
    model?: string
    tags: string[]
    requiresProjectType: ProjectType[]
    allowedTools: string[]
    deprecation?: SkillDeprecation
    inputs: SkillInput[]
    bindings: SkillBinding[]
    outputs: SkillOutput[]
    folderPath: string
    problems: SkillProblem[]
}

// Factory home for descriptor construction (OOP: no free functions).
export class SkillDescriptorFactory {
    // A plain Claude Code entry (no x-plexus): empty superset fields, base behavior.
    static claudeCode(kind: AgentSkillKind, name: string, description: string, scope: SkillScope, folderPath: string): SkillDescriptor {
        return {
            kind, name, title: name, description, scope,
            sourceKind: SkillSourceKind.ClaudeCode,
            tags: [], requiresProjectType: [], allowedTools: [],
            inputs: [], bindings: [], outputs: [], problems: [], folderPath,
        }
    }
}

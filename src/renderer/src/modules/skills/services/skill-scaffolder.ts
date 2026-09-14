import { SkillScope } from '../../../../../shared/skill-api.js'

export enum SkillTemplateKind { Blank = 'blank', Superset = 'superset' }

export interface NewSkillRequest { name: string; description: string; scope: SkillScope; template: SkillTemplateKind }

// Minimal fs seam so the scaffolder unit-tests without Electron; production wires
// FileSystemService (Exists / CreateDirectory / WriteText).
export interface ScaffoldFs {
    exists(path: string): Promise<boolean>
    createDirectory(path: string): Promise<void>
    writeText(path: string, content: string): Promise<void>
}

// The two writable scope roots' base dirs (project dir + the user's home).
export interface ScaffoldRoots { projectDir: string; homeDir: string }

// SKILL.md template text. Blank = a plain Claude Code skill (no x-plexus). Superset
// = a schema-valid x-plexus starter the author trims. Both must parse clean through
// SkillFileCodec (asserted by tests). const strings only (house style).
export class SkillTemplates {
    static blank(name: string, description: string): string {
        return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDescribe what this skill does and when to use it.\n`
    }

    static superset(name: string, description: string): string {
        return `---\nname: ${name}\ndescription: ${description}\n`
            + `x-plexus:\n`
            + `  version: 1\n`
            + `  title: ${name}\n`
            + `  category: General\n`
            + `  tags: []\n`
            + `  inputs:\n`
            + `    - key: viewpoint\n`
            + `      label: Viewpoint\n`
            + `      type: enum\n`
            + `      options: [context, container, component]\n`
            + `      required: true\n`
            + `      default: context\n`
            + `  bindings:\n`
            + `    - source: currentProject\n`
            + `  outputs:\n`
            + `    - kind: conversation\n`
            + `---\n\n# ${name}\n\nDescribe what this skill does and when to use it.\n`
    }
}

// Creates a new skill folder + SKILL.md under the chosen writable scope.
export class SkillScaffolder {
    private readonly fs: ScaffoldFs
    private readonly roots: ScaffoldRoots

    constructor(fs: ScaffoldFs, roots: ScaffoldRoots) { this.fs = fs; this.roots = roots }

    async create(req: NewSkillRequest): Promise<string> {
        const folder = `${this.rootFor(req.scope)}/${this.slug(req.name)}`
        if (await this.fs.exists(folder)) throw new Error(`A skill folder "${folder}" already exists.`)
        await this.fs.createDirectory(folder)
        const text = req.template === SkillTemplateKind.Superset
            ? SkillTemplates.superset(this.slug(req.name), req.description)
            : SkillTemplates.blank(this.slug(req.name), req.description)
        await this.fs.writeText(`${folder}/SKILL.md`, text)
        return folder
    }

    private rootFor(scope: SkillScope): string {
        if (scope === SkillScope.Project) return `${this.roots.projectDir}/.claude/skills`
        if (scope === SkillScope.Global) return `${this.roots.homeDir}/.claude/skills`
        throw new Error('Packaged skills cannot be scaffolded.')
    }

    private slug(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    }
}

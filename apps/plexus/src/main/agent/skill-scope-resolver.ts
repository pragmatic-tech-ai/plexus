import { join } from 'node:path'
import { SkillScope } from '../../shared/skill-api.js'

export interface ScopePaths { home: string; userData: string }

// A skills root to scan. For packaged scope, skillsDir is a package BACKEND root
// (<userData>/libraries|meta-models); the scanner descends <id>/<version>/skills.
export interface ScopeRoot { scope: SkillScope; skillsDir: string; agentsDir?: string; nested: boolean }

// Resolves the three skill scope roots. Base directories are injected (home,
// userData) so the resolver is testable without Electron `app`; the main wiring
// passes app.getPath('home') / app.getPath('userData').
export class SkillScopeResolver {
    private readonly paths: ScopePaths
    constructor(paths: ScopePaths) { this.paths = paths }

    rootsFor(projectDir: string): ScopeRoot[] {
        const claude = join(projectDir, '.claude')
        const homeClaude = join(this.paths.home, '.claude')
        return [
            { scope: SkillScope.Project, skillsDir: join(claude, 'skills'), agentsDir: join(claude, 'agents'), nested: false },
            { scope: SkillScope.Global, skillsDir: join(homeClaude, 'skills'), agentsDir: join(homeClaude, 'agents'), nested: false },
            { scope: SkillScope.Packaged, skillsDir: join(this.paths.userData, 'libraries'), nested: true },
            { scope: SkillScope.Packaged, skillsDir: join(this.paths.userData, 'meta-models'), nested: true },
        ]
    }
}

import { test, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { ClaudeCliProvider } from '../claude-cli-provider.js'
import { SkillScope } from '../../../shared/skill-api.js'

test('listSkills discovers a project skill from disk', async () => {
    const proj = await mkdtemp(join(tmpdir(), 'plexus-skills-'))
    const skillDir = join(proj, '.claude', 'skills', 'demo')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: A demo skill.\nx-plexus:\n  version: 1\n  category: Demo\n---\n# body')

    const provider = new ClaudeCliProvider()
    const skills = await provider.listSkills(proj)
    const demo = skills.find(s => s.name === 'demo')
    expect(demo).toBeDefined()
    expect(demo!.scope).toBe(SkillScope.Project)
    expect(demo!.category).toBe('Demo')
})

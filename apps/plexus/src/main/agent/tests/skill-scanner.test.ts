import { test, expect } from 'vitest'
import { join } from 'node:path'
import { SkillScanner } from '../skill-scanner.js'
import { SkillScopeResolver } from '../skill-scope-resolver.js'
import { SkillFrontmatterParser } from '../skill-frontmatter-parser.js'
import { SkillScope } from '../../../shared/skill-api.js'
import type { CatalogIo } from '../claude-catalog.js'

// Fake fs: dirs maps a path to its entries; files maps a path to contents.
function fakeIo(dirs: Record<string, string[]>, files: Record<string, string>): CatalogIo
{
    return {
        exists: (p) => Promise.resolve(p in dirs || p in files),
        readDir: (p) => Promise.resolve(dirs[p] ?? []),
        readFile: (p) => Promise.resolve(files[p] ?? ''),
    }
}

const md = (name: string): string => `---\nname: ${name}\ndescription: ${name} desc\n---`

test('scans project + global skills and tags them by scope', async () => {
    const resolver = new SkillScopeResolver({ home: '/home', userData: '/data' })
    const projSkills = join('/proj', '.claude', 'skills')
    const globalSkills = join('/home', '.claude', 'skills')
    const io = fakeIo(
        {
            [projSkills]: ['a'],
            [globalSkills]: ['b'],
        },
        {
            [join(projSkills, 'a', 'SKILL.md')]: md('a'),
            [join(globalSkills, 'b', 'SKILL.md')]: md('b'),
        },
    )
    const found = await new SkillScanner(resolver, new SkillFrontmatterParser(), io).scan('/proj')
    const byName = Object.fromEntries(found.map(d => [d.name, d.scope]))
    expect(byName['a']).toBe(SkillScope.Project)
    expect(byName['b']).toBe(SkillScope.Global)
})

test('scans packaged skills under <backend>/<id>/<version>/skills', async () => {
    const resolver = new SkillScopeResolver({ home: '/home', userData: '/data' })
    const libs = join('/data', 'libraries')
    const skillsDir = join(libs, 'acme', '1.0.0', 'skills')
    const io = fakeIo(
        {
            [libs]: ['acme'],
            [join(libs, 'acme')]: ['1.0.0'],
            [join(libs, 'acme', '1.0.0')]: ['skills', 'model.json'],
            [skillsDir]: ['pkg-skill'],
        },
        { [join(skillsDir, 'pkg-skill', 'SKILL.md')]: md('pkg-skill') },
    )
    const found = await new SkillScanner(resolver, new SkillFrontmatterParser(), io).scan('/proj')
    expect(found.find(d => d.name === 'pkg-skill')?.scope).toBe(SkillScope.Packaged)
})

test('missing roots yield no entries and never throw', async () => {
    const resolver = new SkillScopeResolver({ home: '/home', userData: '/data' })
    const found = await new SkillScanner(resolver, new SkillFrontmatterParser(), fakeIo({}, {})).scan('/proj')
    expect(found).toEqual([])
})

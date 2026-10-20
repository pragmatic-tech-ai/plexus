import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compilePackage, type CompileOutcome } from '@pragmatic-tech-ai/todl'
import { ContosoFixture, NorthwindFixture, type IFixtureDescriptor, type IFixtureManifest } from '../fixture-manifest.js'

interface ICompiledNode
{
    id: string
    metaKind?: string
    fields?: { name: string }[]
}

class FixtureCase
{
    private static readonly ManifestFile = 'project.plexus'
    private static readonly Utf8 = 'utf8'
    private static readonly TodlExtension = '.todl'
    private static readonly ConceptKind = 'concept'
    private static readonly RegexSpecials = /[.*+?^${}()|[\]\\]/g
    private static readonly RegexEscape = '\\$&'

    public constructor(public readonly Descriptor: IFixtureDescriptor)
    {
    }

    /** By convention the .todl file is named after the project id. */
    private get TodlFile(): string
    {
        return this.Descriptor.appId + FixtureCase.TodlExtension
    }

    public ReadManifest(): IFixtureManifest
    {
        return JSON.parse(readFileSync(join(this.Descriptor.folder, FixtureCase.ManifestFile), FixtureCase.Utf8)) as IFixtureManifest
    }

    public ReadTodl(): string
    {
        return readFileSync(join(this.Descriptor.folder, this.TodlFile), FixtureCase.Utf8)
    }

    public Compile(): CompileOutcome
    {
        const manifest = this.ReadManifest()
        return compilePackage([], [{ uri: this.TodlFile, text: this.ReadTodl() }], { id: manifest.id, version: manifest.packageVersion })
    }

    /** Matches `<assertField> = "<assertValue>"` so the value is bound to its field. */
    public get AssertBinding(): RegExp
    {
        const esc = (t: string): string => t.replace(FixtureCase.RegexSpecials, FixtureCase.RegexEscape)
        return new RegExp(`\\b${esc(this.Descriptor.assertField)}\\s*=\\s*"${esc(this.Descriptor.assertValue)}"`)
    }

    public FindEntrypointNode(outcome: CompileOutcome): ICompiledNode | undefined
    {
        const nodes = (outcome.package?.document.nodes ?? []) as unknown as ICompiledNode[]
        const suffix = '.' + this.Descriptor.entrypointConcept
        return nodes.find(n => n.metaKind === FixtureCase.ConceptKind && n.id.endsWith(suffix))
    }
}

class FixturesCompileSuite
{
    private static readonly Cases = [new FixtureCase(ContosoFixture), new FixtureCase(NorthwindFixture)]
    private static readonly CompilesTitle = 'compiles with zero errors under its manifest id'
    private static readonly SeededTitle = 'assertValue is bound to assertField in the .todl'
    private static readonly AppIdTitle = 'descriptor appId matches manifest id'
    private static readonly ModelTitle = 'compiled package contains entrypointConcept and assertField'

    public static Register(): void
    {
        for (const c of FixturesCompileSuite.Cases)
        {
            describe(c.Descriptor.appId, () =>
            {
                test(FixturesCompileSuite.CompilesTitle, () =>
                {
                    const outcome = c.Compile()
                    expect(outcome.errors.map(e => e.message)).toEqual([])
                    expect(outcome.ok).toBe(true)
                    expect(outcome.package?.id).toBe(c.ReadManifest().id)
                })
                test(FixturesCompileSuite.AppIdTitle, () =>
                {
                    expect(c.Descriptor.appId).toBe(c.ReadManifest().id)
                })
                test(FixturesCompileSuite.SeededTitle, () =>
                {
                    expect(c.ReadTodl()).toMatch(c.AssertBinding)
                })
                test(FixturesCompileSuite.ModelTitle, () =>
                {
                    const node = c.FindEntrypointNode(c.Compile())
                    expect(node).toBeDefined()
                    expect((node?.fields ?? []).map(f => f.name)).toContain(c.Descriptor.assertField)
                })
            })
        }
    }
}

FixturesCompileSuite.Register()

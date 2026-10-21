import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compilePackage, type CompileOutcome } from '@pragmatic-tech-ai/todl'
import { CatalogFixture, ContosoFixture, NorthwindFixture, type IFixtureDescriptor, type IFixtureManifest } from '../fixture-manifest.js'

interface ICompiledNode
{
    id: string
    metaKind?: string
    name?: string
    attrs?: Record<string, unknown>
    fields?: { name: string }[]
}

class FixtureCase
{
    private static readonly ManifestFile = 'project.plexus'
    private static readonly Utf8 = 'utf8'
    private static readonly TodlExtension = '.todl'
    private static readonly ConceptKind = 'concept'
    private static readonly ConnectorKind = 'connector'
    private static readonly PopulationKind = 'population'
    public static readonly NameAttr = 'name'
    public static readonly KindAttr = 'kind'
    public static readonly ConceptAttr = 'concept'
    public static readonly ConnectorAttr = 'connector'
    public static readonly ConnectorName = 'appdb'
    public static readonly SqlKind = 'sql'
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

    public get HasConnectorPlan(): boolean
    {
        return this.Descriptor.appId === CatalogFixture.appId
    }

    public NodesOfKind(outcome: CompileOutcome, metaKind: string): ICompiledNode[]
    {
        const nodes = (outcome.package?.document.nodes ?? []) as unknown as ICompiledNode[]
        return nodes.filter(n => n.metaKind === metaKind)
    }

    public Connectors(outcome: CompileOutcome): ICompiledNode[]
    {
        return this.NodesOfKind(outcome, FixtureCase.ConnectorKind)
    }

    public Populations(outcome: CompileOutcome): ICompiledNode[]
    {
        return this.NodesOfKind(outcome, FixtureCase.PopulationKind)
    }

    public FindEntrypointNode(outcome: CompileOutcome): ICompiledNode | undefined
    {
        const nodes = (outcome.package?.document.nodes ?? []) as unknown as ICompiledNode[]
        // entrypointConcept is a fully-qualified id (e.g. "contoso.Product"); match either the
        // whole id or its local segment so the lookup is independent of how it is qualified.
        const concept = this.Descriptor.entrypointConcept
        const local = concept.substring(concept.lastIndexOf('.') + 1)
        return nodes.find(n => n.metaKind === FixtureCase.ConceptKind && (n.id === concept || n.id.endsWith('.' + local)))
    }
}

class FixturesCompileSuite
{
    private static readonly Cases = [new FixtureCase(ContosoFixture), new FixtureCase(NorthwindFixture), new FixtureCase(CatalogFixture)]
    private static readonly CompilesTitle = 'compiles with zero errors under its manifest id'
    private static readonly SeededTitle = 'assertValue is bound to assertField in the .todl'
    private static readonly AppIdTitle = 'descriptor appId matches manifest id'
    private static readonly PlanTitle = 'compiled package contains one sql connector appdb and a catalog.Product binding'
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
                if (!c.HasConnectorPlan)
                {
                    // Connector-backed fixtures keep the asserted row in Postgres, not in the .todl.
                    test(FixturesCompileSuite.SeededTitle, () =>
                    {
                        expect(c.ReadTodl()).toMatch(c.AssertBinding)
                    })
                }
                if (c.HasConnectorPlan)
                {
                    test(FixturesCompileSuite.PlanTitle, () =>
                    {
                        const outcome = c.Compile()
                        const connectors = c.Connectors(outcome)
                        expect(connectors).toHaveLength(1)
                        expect(connectors[0]?.attrs?.[FixtureCase.NameAttr]).toBe(FixtureCase.ConnectorName)
                        expect(connectors[0]?.attrs?.[FixtureCase.KindAttr]).toBe(FixtureCase.SqlKind)
                        const populations = c.Populations(outcome)
                        expect(populations).toHaveLength(1)
                        expect(populations[0]?.attrs?.[FixtureCase.ConceptAttr]).toBe(c.Descriptor.entrypointConcept)
                        expect(populations[0]?.attrs?.[FixtureCase.ConnectorAttr]).toBe(connectors[0]?.id)
                    })
                }
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

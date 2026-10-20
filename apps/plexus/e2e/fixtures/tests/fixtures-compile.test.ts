import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compilePackage } from '@pragmatic-tech-ai/todl'
import { ContosoFixture, NorthwindFixture, type IFixtureDescriptor } from '../fixture-manifest.js'

class FixtureCase
{
    private static readonly ManifestFile = 'project.plexus'
    private static readonly Utf8 = 'utf8'
    private static readonly TodlExtension = '.todl'

    public constructor(private readonly Descriptor: IFixtureDescriptor, private readonly TodlFile: string)
    {
    }

    public get Name(): string
    {
        return this.Descriptor.appId
    }

    public ReadManifest(): { id: string; packageVersion: string }
    {
        return JSON.parse(readFileSync(join(this.Descriptor.folder, FixtureCase.ManifestFile), FixtureCase.Utf8))
    }

    public ReadTodl(): string
    {
        return readFileSync(join(this.Descriptor.folder, this.TodlFile + FixtureCase.TodlExtension), FixtureCase.Utf8)
    }

    public Compile()
    {
        const manifest = this.ReadManifest()
        const uri = this.TodlFile + FixtureCase.TodlExtension
        return compilePackage([], [{ uri, text: this.ReadTodl() }], { id: manifest.id, version: manifest.packageVersion })
    }

    public get Descriptor_(): IFixtureDescriptor
    {
        return this.Descriptor
    }
}

class FixturesCompileSuite
{
    private static readonly Cases = [
        new FixtureCase(ContosoFixture, 'contoso'),
        new FixtureCase(NorthwindFixture, 'northwind'),
    ]
    private static readonly CompilesTitle = 'compiles with zero errors under its manifest id'
    private static readonly SeededTitle = 'assertValue is verbatim in the .todl'
    private static readonly AppIdTitle = 'descriptor appId matches manifest id'

    public static Register(): void
    {
        for (const c of FixturesCompileSuite.Cases)
        {
            describe(c.Name, () =>
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
                    expect(c.Descriptor_.appId).toBe(c.ReadManifest().id)
                })
                test(FixturesCompileSuite.SeededTitle, () =>
                {
                    expect(c.ReadTodl()).toContain(c.Descriptor_.assertValue)
                })
            })
        }
    }
}

FixturesCompileSuite.Register()

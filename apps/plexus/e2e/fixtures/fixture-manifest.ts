import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface IFixtureDescriptor
{
    /** Absolute path to the openable Architecture project folder. */
    folder: string
    /** The project manifest id (also the package id). */
    appId: string
    /** The entrypoint concept the generated UI is built around. */
    entrypointConcept: string
    /** The field of the entrypoint concept the e2e reads. */
    assertField: string
    /** The exact seeded string the generated UI renders and the e2e asserts. */
    assertValue: string
}

/** The parsed shape of a fixture's project.plexus manifest. */
export interface IFixtureManifest
{
    type: string
    name: string
    version: number
    id: string
    packageVersion: string
}

class FixtureLocator
{
    private static readonly ContosoFolder = 'contoso'
    private static readonly NorthwindFolder = 'northwind'

    public static ContosoPath(): string
    {
        return FixtureLocator.Resolve(FixtureLocator.ContosoFolder)
    }

    public static NorthwindPath(): string
    {
        return FixtureLocator.Resolve(FixtureLocator.NorthwindFolder)
    }

    private static Resolve(name: string): string
    {
        return join(dirname(fileURLToPath(import.meta.url)), name)
    }
}

class FixtureNames
{
    public static readonly ContosoAppId = 'contoso'
    public static readonly ContosoEntrypoint = 'Product'
    public static readonly ContosoField = 'name'
    public static readonly ContosoValue = 'Contoso Aurora Espresso Machine'
    public static readonly NorthwindAppId = 'northwind'
    public static readonly NorthwindEntrypoint = 'Customer'
    public static readonly NorthwindField = 'company'
    public static readonly NorthwindValue = 'Fixture Trading Co. of Reykjavik'
}

export const ContosoFixture: IFixtureDescriptor = {
    folder: FixtureLocator.ContosoPath(),
    appId: FixtureNames.ContosoAppId,
    entrypointConcept: FixtureNames.ContosoEntrypoint,
    assertField: FixtureNames.ContosoField,
    assertValue: FixtureNames.ContosoValue,
}

export const NorthwindFixture: IFixtureDescriptor = {
    folder: FixtureLocator.NorthwindPath(),
    appId: FixtureNames.NorthwindAppId,
    entrypointConcept: FixtureNames.NorthwindEntrypoint,
    assertField: FixtureNames.NorthwindField,
    assertValue: FixtureNames.NorthwindValue,
}

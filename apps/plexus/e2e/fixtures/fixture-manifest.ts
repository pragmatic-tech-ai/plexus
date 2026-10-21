import { join } from 'node:path'

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
    private static readonly CatalogFolder = 'catalog'

    public static ContosoPath(): string
    {
        return FixtureLocator.Resolve(FixtureLocator.ContosoFolder)
    }

    public static NorthwindPath(): string
    {
        return FixtureLocator.Resolve(FixtureLocator.NorthwindFolder)
    }

    public static CatalogPath(): string
    {
        return FixtureLocator.Resolve(FixtureLocator.CatalogFolder)
    }

    private static Resolve(name: string): string
    {
        return join(__dirname, name)
    }
}

class FixtureNames
{
    public static readonly ContosoAppId = 'contoso'
    public static readonly ContosoEntrypoint = 'contoso.Product'
    public static readonly ContosoField = 'name'
    public static readonly ContosoValue = 'Contoso Aurora Espresso Machine'
    public static readonly NorthwindAppId = 'northwind'
    public static readonly NorthwindEntrypoint = 'northwind.Customer'
    public static readonly NorthwindField = 'company'
    public static readonly NorthwindValue = 'Fixture Trading Co. of Reykjavik'
    public static readonly CatalogAppId = 'catalog'
    public static readonly CatalogEntrypoint = 'catalog.Product'
    public static readonly CatalogField = 'name'
    public static readonly CatalogValue = 'Live Postgres Widget'
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

export const CatalogFixture: IFixtureDescriptor = {
    folder: FixtureLocator.CatalogPath(),
    appId: FixtureNames.CatalogAppId,
    entrypointConcept: FixtureNames.CatalogEntrypoint,
    assertField: FixtureNames.CatalogField,
    assertValue: FixtureNames.CatalogValue,
}

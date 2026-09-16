import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { compilePackage, checkAgainst, PackageKind, Severity, type PackageRef } from '@pragmatic-tech-ai/todl'

import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../modules/library/services/libraries-backend.js'
import { resolveBases } from '../base-resolver.js'

// End-to-end acceptance for own-content-only packages: publish a meta-model and a
// library as OWN-ONLY documents, then resolve their closure TRANSITIVELY and
// validate an architecture source against it — with zero undefined references.
// This is the integration claim the unit tests don't cover on their own: the
// dangling cross-references in own-only docs reassemble correctly at consume time.

const META = 'namespace ea { concept Location { label : string; } concept Technology { label : string; } }'
const LIB = `namespace lib {
  import ea;
  taxonomy Microsoft : represents Location, Technology {
    Location azure { label = "Azure"; }
    Technology azureOpenai { label = "Azure OpenAI"; }
  }
}`
// An architecture-shaped source referencing BOTH a base concept (Location) and a
// library term (Microsoft.azure) — the cross-package references that must resolve
// through the transitively-reassembled closure.
const ARCH = `namespace sys {
  import ea; import lib;
  taxonomy Deployment : represents Location {
    Location prod { parent = Microsoft.azure; }
  }
}`

function env(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage } {
  const provider = new ServiceProvider()
  const registry = new StorageProviderRegistry(provider)
  const meta = new FakeStorage('fake://meta-models')
  const libs = new FakeStorage('fake://libraries')
  registry.Register(META_MODELS_BACKEND_ID, () => meta)
  registry.Register(LIBRARIES_BACKEND_ID, () => libs)
  provider.registerInstance(StorageProviderRegistry.Key, registry)
  return { provider, meta, libs }
}

const errors = (ds: readonly { severity: Severity }[]) => ds.filter((d) => d.severity === Severity.Error)

describe('own-content packages: publish own-only → resolve transitively → validate', () => {
  it('an architecture source validates clean against own-only bases pulled in transitively', async () => {
    const { provider, meta, libs } = env()

    // Publish the meta-model own-only.
    const metaOut = compilePackage([], [{ uri: 'ea.todl', text: META }], { id: 'ea', version: '1.0.0' })
    expect(metaOut.ok).toBe(true)
    const metaDoc = metaOut.package!.document
    expect(metaDoc.nodes.some((n) => n.id === 'identifier')).toBe(false) // own-only: no prelude
    await meta.WriteText('ea/1.0.0/model.json', JSON.stringify(metaDoc))

    // Publish the library own-only against the (own-only) meta-model, recording it
    // as a dependency.
    const deps: PackageRef[] = [{ kind: PackageKind.MetaModel, id: 'ea', version: '1.0.0' }]
    const libOut = compilePackage([metaDoc], [{ uri: 'lib.todl', text: LIB }], { id: 'lib', version: '0.1.0' }, deps)
    expect(libOut.ok).toBe(true)
    const libDoc = libOut.package!.document
    expect(libDoc.nodes.some((n) => n.id === 'Location')).toBe(false)   // own-only: no base nodes
    expect(libDoc.dependencies).toEqual(deps)
    await libs.WriteText('lib/0.1.0/model.json', JSON.stringify(libDoc))

    // The architecture project binds ONLY the library — its meta-model is pulled in
    // transitively via the library's recorded dependency.
    const { bases, problems } = await resolveBases(provider, { libraries: [{ id: 'lib', version: '0.1.0' }] })
    expect(problems).toEqual([])
    // Both own-only docs reassembled.
    const ids = bases.flatMap((b) => b.nodes.map((n) => n.id))
    expect(ids).toContain('Microsoft.azure')
    expect(ids).toContain('Location')

    // Validate the architecture source against the reassembled closure — the
    // dangling cross-references resolve, so no undefined references.
    const { diagnostics } = checkAgainst(bases, [{ uri: 'sys.todl', text: ARCH }])
    expect(errors(diagnostics)).toEqual([])
  })
})

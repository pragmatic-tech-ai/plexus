import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectSystemComposer, BuildSystemRegistryKey, BuildStorageProviderKey, PackageStoreKey, BuildService } from '@pragmatic-tech-ai/todl'
import { BundlerKey } from '@pragmatic-tech-ai/todl/build-system-core'
import { EnvironmentService } from '../../../environment/environment-service.js'
import { FileSystemService } from '../../storage/file-system-service.js'
import { RendererBuildStorageProvider } from '../renderer-build-storage-provider.js'
import { IpcBundler } from '../ipc-bundler.js'
import { BuildComposition } from '../build-composition.js'

class Fixture
{
    public static Compose(): ServiceProvider
    {
        const p = new ServiceProvider()
        p.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/userdata', PathSeparator: '/' } as never)
        p.registerInstance(FileSystemService.Key, {} as never)
        ProjectSystemComposer.Compose(p)
        BuildComposition.Compose(p)
        return p
    }
}

test('BuildComposition binds the three seams', () =>
{
    const p = Fixture.Compose()
    assert.ok(p.get(BundlerKey) instanceof IpcBundler)
    assert.ok(p.get(BuildStorageProviderKey) instanceof RendererBuildStorageProvider)
    assert.notEqual(p.get(PackageStoreKey), undefined)
})

test('BuildComposition registers html-bundle alongside npm-package', () =>
{
    const p = Fixture.Compose()
    const systems = p.getRequired(BuildSystemRegistryKey).For({ type: 'architecture', name: 'a', version: 1 } as never)
    assert.equal(systems.some(s => s.Id === 'html-bundle'), true)
    assert.equal(systems.some(s => s.Id === 'npm-package'), true)
})

test('BuildService constructs over the composed container', () =>
{
    const p = Fixture.Compose()
    assert.ok(new BuildService(p))
})

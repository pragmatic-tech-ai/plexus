import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness, FakeLanguageService } from './fake-language-service.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

// The "Unresolved base" project-level diagnostic is now sourced from the service's
// ResolveBasesFor(storage).problems rather than a client-side base push.
test('AttachProject surfaces unresolved-base problems as a project-level diagnostic', async () =>
{
  const service = new FakeLanguageService()
  const storage = new FakeStorage('C:/arch')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  service.BaseProblems.set(storage, ['ea-core@1.0.0'])
  const { provider, diagnostics } = FakeServiceHarness.Provider(service)
  const client = new TodlLanguageClient(provider)

  await client.AttachProject('C:/arch', 'Arch', storage)

  const projectLevel = [...diagnostics.All].filter((d) => d.uri === null)
  expect(projectLevel).toHaveLength(1)
  expect(projectLevel[0]!.projectId).toBe('C:/arch')
  expect(projectLevel[0]!.message).toContain('Unresolved base')
  expect(projectLevel[0]!.message).toContain('ea-core@1.0.0')
})

test('no unresolved-base diagnostic when the service reports no base problems', async () =>
{
  const service = new FakeLanguageService()
  const storage = new FakeStorage('C:/arch')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  const { provider, diagnostics } = FakeServiceHarness.Provider(service)
  const client = new TodlLanguageClient(provider)

  await client.AttachProject('C:/arch', 'Arch', storage)

  expect([...diagnostics.All].filter((d) => d.uri === null)).toHaveLength(0)
})

import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { WorkspaceBaseResolver } from '../../projects/workspace-base-resolver.js'
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

function fakeConn() {
  let handler: ((p: unknown) => void) | undefined
  return {
    conn: {
      sendNotification: () => Promise.resolve(),
      sendRequest: () => Promise.resolve(null),
      onNotification: (m: string, cb: (p: unknown) => void) => {
        if (m === 'textDocument/publishDiagnostics') handler = cb
        return { dispose() {} }
      },
      listen: () => {},
    },
    publish: (p: unknown) => handler?.(p),
  }
}

async function setup() {
  const provider = new ServiceProvider()
  provider.registerInstance(WorkspaceBaseResolver.Key, {
    ResolveForStorage: async () => ({ bases: [], problems: [] }),
  } as unknown as WorkspaceBaseResolver)
  const diagnostics = new DiagnosticsService(provider)
  provider.registerInstance(DiagnosticsService.Key, diagnostics)
  const storage = new FakeStorage('proj')
  const client = new TodlLanguageClient(provider)
  const { conn, publish } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  return { client, diagnostics, publish }
}

test('a published LSP diagnostic reaches DiagnosticsService as canonical (1-based, relpath)', async () => {
  const { client, diagnostics, publish } = await setup()
  publish({
    uri: client.uriFor('C:\\proj', 'a.todl'),
    diagnostics: [{ range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, message: 'boom', severity: 1 }],
  })
  const forFile = diagnostics.ForUri('a.todl')
  expect(forFile).toHaveLength(1)
  expect(forFile[0]!.projectId).toBe('C:\\proj')
  expect(forFile[0]!.projectName).toBe('Proj')
  expect(forFile[0]!.span).toEqual({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 6 })
})

test('an empty publish clears a file’s diagnostics', async () => {
  const { client, diagnostics, publish } = await setup()
  const uri = client.uriFor('C:\\proj', 'a.todl')
  publish({ uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x', severity: 1 }] })
  expect(diagnostics.ForUri('a.todl')).toHaveLength(1)
  publish({ uri, diagnostics: [] })
  expect(diagnostics.ForUri('a.todl')).toHaveLength(0)
})

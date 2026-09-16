import { test, expect } from 'vitest'
import { TodlLspChannel } from '../todl-lsp-api.js'

test('channel names are stable and namespaced', () => {
  expect(TodlLspChannel.ToServer).toBe('todl-lsp:to-server')
  expect(TodlLspChannel.FromServer).toBe('todl-lsp:from-server')
  expect(TodlLspChannel.ServerRestart).toBe('todl-lsp:server-restart')
})

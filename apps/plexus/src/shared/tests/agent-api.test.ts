import { test, expect } from 'vitest'
import {
  AgentChannel,
  AgentEventKind,
  MCP_SERVER_KEY,
  REFRESH_TOOL_QUALIFIED,
  REFRESH_TOOL_NAME,
  CREATE_PROJECT_TOOL_NAME,
  CREATE_PROJECT_TOOL_QUALIFIED,
} from '../agent-api.js'

test('channel ids are namespaced under agent:', () => {
  expect(AgentChannel.StartSession).toBe('agent:start-session')
  expect(AgentChannel.SendTurn).toBe('agent:send-turn')
  expect(AgentChannel.Abort).toBe('agent:abort')
  expect(AgentChannel.Event).toBe('agent:event')
})

test('every event kind has a distinct string value', () => {
  const values = Object.values(AgentEventKind)
  expect(new Set(values).size).toBe(values.length)
})

test('both tools are qualified under the single plexus server key', () => {
  expect(MCP_SERVER_KEY).toBe('plexus')
  expect(REFRESH_TOOL_NAME).toBe('refresh_project')
  expect(REFRESH_TOOL_QUALIFIED).toBe('mcp__plexus__refresh_project')
})

test('the workspace channel and event-kind members exist', () => {
  expect(AgentChannel.RefreshProjectResult).toBe('agent:refresh-project-result')
  expect(AgentEventKind.RefreshProject).toBe('refresh-project')
})

test('create_project tool is qualified under the single plexus server key', () => {
  expect(CREATE_PROJECT_TOOL_NAME).toBe('create_project')
  expect(CREATE_PROJECT_TOOL_QUALIFIED).toBe('mcp__plexus__create_project')
})

test('the create-project channel and event kind exist and are distinct', () => {
  expect(AgentChannel.CreateProjectResult).toBe('agent:create-project-result')
  expect(AgentEventKind.CreateProject).toBe('create-project')
  const kinds = Object.values(AgentEventKind)
  expect(new Set(kinds).size).toBe(kinds.length)
})

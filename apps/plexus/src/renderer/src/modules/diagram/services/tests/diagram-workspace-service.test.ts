import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramWorkspaceService } from '../diagram-workspace-service.js'

test('the workspace document opens empty — no seeded demo canvas', () => {
    const svc = new DiagramWorkspaceService(new ServiceProvider())
    expect(svc.Document.Nodes.Count).toBe(0)
    expect(svc.Document.Connectors.Count).toBe(0)
})

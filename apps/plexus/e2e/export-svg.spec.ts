// E2E coverage for SVG export: the DiagramExportService resolves from the
// running renderer, DiagramSvgRenderer renders the active diagram, and the result
// is a valid, non-degenerate '<svg'. The save dialog is stubbed (the real
// Electron dialog cannot be driven headlessly) so the test asserts on the SVG
// string itself rather than a written file.
//
// Requires: `npm run build` to be current; the PLEXUS_TEST_CORPUS env var (or
// the default path) to point at a corpus containing at least one diagram with
// ≥1 node so `canExportActive()` returns true.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  launchPlexus, seedSession, appErrors, rectsForCtor, clickCenter,
  type Launched,
} from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'c:/Users/Eugene/Projects/architecture-agent/plexus_test_projects'
const PROJECT_RELS = [
  'meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture',
]

function makeCopy(): string {
  const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-export-svg-'))
  for (const rel of PROJECT_RELS) {
    fs.cpSync(path.join(CORPUS, rel), path.join(copyRoot, rel), { recursive: true })
  }
  return copyRoot
}

// Open `diagram-2.diagram` from the arch project (it has nodes, so
// `canExportActive` will be true once the diagram is loaded).
async function openDiagram(l: Launched): Promise<void> {
  await l.win.evaluate(async () => {
    const S = Symbol.for('mural:visual-backref')
    let explorer: any
    for (const el of document.querySelectorAll('*')) {
      const dc = (el as any)[S]?.DataContext
      if (dc && typeof dc.OpenFileInProject === 'function') { explorer = dc; break }
    }
    if (!explorer) return
    const proj = explorer.OpenProjects.ToArray()
      .find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
    if (proj) await explorer.OpenFileInProject(proj.Folder, 'diagram-2.diagram', 0, 0)
  })
  await l.win.waitForTimeout(5000)
}

// Resolve a service by its ServiceKey description. The ServiceProvider resolves
// by token (ServiceKey object / constructor), not by string, so there is no
// `getByKey`; instead we scan the provider's registrations for a token whose
// `.description` matches, then `get(token)`. Runs inside the page.
// Locate a service by its ServiceKey description without a string-keyed lookup
// API. Walks EVERY visual carrying a .Services provider, and for each walks the
// provider's parent chain scanning registration tokens (the token is Ctor.Key, a
// ServiceKey). get() itself walks parents, so a found token resolves correctly.
const RESOLVE_BY_DESC = `
  (desc) => {
    const S = Symbol.for('mural:visual-backref')
    const matches = (token) => token && (token.description === desc || token.name === desc || String(token) === 'ServiceKey(' + desc + ')')
    for (const el of document.querySelectorAll('*')) {
      const services = (el[S] || {}).Services
      if (!services || typeof services.get !== 'function') continue
      for (let p = services; p; p = p._parent) {
        const regs = p._registrations
        if (!regs || typeof regs.forEach !== 'function') continue
        let found
        regs.forEach((_v, token) => { if (!found && matches(token)) found = token })
        if (found) { const svc = services.get(found); if (svc) return svc }
      }
    }
    return undefined
  }
`

// Resolve DiagramExportService from the running renderer and call its test hook
// (bypassing the save dialog) to get the SVG string.
async function callRenderDiagramSvg(l: Launched): Promise<string | null> {
  return l.win.evaluate((resolveSrc) => {
    const resolveByDesc = (0, eval)(resolveSrc) as (d: string) => any
    const svc: any = resolveByDesc('DiagramExportService')
    if (!svc) return '__unresolved__'
    if (!svc.canExportActive()) return '__cannot_export__'
    if (typeof svc._renderSvgForTest !== 'function') return '__no_test_hook__'
    try { return svc._renderSvgForTest() }
    catch (e: unknown) { return '__error__: ' + String(e) }
  }, RESOLVE_BY_DESC)
}

// Check whether any diagram node is present in the active diagram.
async function diagramHasNodes(l: Launched): Promise<boolean> {
  return l.win.evaluate(() => {
    const S = Symbol.for('mural:visual-backref')
    for (const el of document.querySelectorAll('*')) {
      const v = (el as any)[S]
      if (v?.constructor?.name === 'Diagram')
        return (v.DataContext?.Nodes?.Count ?? 0) > 0
    }
    return false
  })
}

test.describe.serial('export-svg', () => {
  let l: Launched
  let restoreSession: () => void
  let copyRoot: string

  test.beforeAll(async () => {
    copyRoot = makeCopy()
    restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
    l = await launchPlexus()
    await l.win.waitForTimeout(12_000)
    // Click the second navigation item (Projects panel).
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1500)
    await openDiagram(l)
  })

  test.afterAll(async () => {
    restoreSession?.()
    await l?.app.close()
    if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
  })

  test('diagram is loaded with at least one node', async () => {
    expect(await diagramHasNodes(l), 'diagram-2 has nodes').toBe(true)
  })

  test('DiagramExportService.canExportActive() is true once a diagram is open', async () => {
    const canExport = await l.win.evaluate((resolveSrc) => {
      const resolveByDesc = (0, eval)(resolveSrc) as (d: string) => any
      const svc: any = resolveByDesc('DiagramExportService')
      if (!svc) return '__unresolved__'
      return svc.canExportActive?.() ?? false
    }, RESOLVE_BY_DESC)
    expect(canExport, 'canExportActive (or resolution)').toBe(true)
  })

  test('_renderSvgForTest returns a valid, non-degenerate SVG', async () => {
    const svg = await callRenderDiagramSvg(l)
    expect(svg, '_renderSvgForTest result').not.toBeNull()
    expect(svg, 'service should resolve').not.toBe('__unresolved__')
    expect(svg, 'should not fall back to __no_test_hook__').not.toBe('__no_test_hook__')
    expect(svg!.startsWith('<svg'), 'svg starts with <svg').toBe(true)

    // Regression guard for the "renders nothing" bug: the whole-diagram export
    // took bounds from geometry-less content VMs (doc.Nodes) → a 1×1 viewBox →
    // a blank SVG. A real diagram must be many times larger than a pixel.
    const w = Number(/width="(\d+)"/.exec(svg!)?.[1] ?? '0')
    const h = Number(/height="(\d+)"/.exec(svg!)?.[1] ?? '0')
    expect(w, `svg width (${w}) must be non-degenerate`).toBeGreaterThan(10)
    expect(h, `svg height (${h}) must be non-degenerate`).toBeGreaterThan(10)
  })

  test('no app errors', async () => {
    expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
  })
})

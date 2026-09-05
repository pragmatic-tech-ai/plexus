// E2E coverage for the export PREVIEW dialog (SP3): invoking the single "Export…"
// command (DiagramExportService.OpenExportDialogCommand) opens a modal whose body
// is the DiagramExportPreviewModel, and that VM produces a live SVG-data-URL
// preview. The real Electron save dialog can't be driven headlessly, so — like
// export-svg.spec.ts — this asserts on the in-app dialog/VM state rather than a
// written file, then dismisses via the VM's CancelCommand.
//
// Requires: `npm run build` current; PLEXUS_TEST_CORPUS (or the default) pointing
// at a corpus with a diagram that has ≥1 node.
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
  const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-export-preview-'))
  for (const rel of PROJECT_RELS) {
    fs.cpSync(path.join(CORPUS, rel), path.join(copyRoot, rel), { recursive: true })
  }
  return copyRoot
}

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

// Resolve a service by its ServiceKey description (same walk export-svg.spec uses).
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

// Walk the visual tree for the mounted preview VM (a DataContext whose ctor is
// DiagramExportPreviewModel) and report its live preview state.
function findPreviewVm(l: Launched) {
  return l.win.evaluate(() => {
    const S = Symbol.for('mural:visual-backref')
    for (const el of document.querySelectorAll('*')) {
      const dc = (el as any)[S]?.DataContext
      if (dc?.constructor?.name === 'DiagramExportPreviewModel') {
        return {
          found: true,
          previewUri: dc.Preview?.Uri ?? null,
          previewSize: dc.PreviewSize ?? null,
          hasExport: typeof dc.ExportCommand?.Execute === 'function',
          formatsCount: dc.Formats?.length ?? 0,
          foregroundChoicesCount: dc.ForegroundChoices?.length ?? 0,
        }
      }
    }
    return { found: false, previewUri: null, previewSize: null, hasExport: false }
  })
}

test.describe.serial('diagram-export-preview', () => {
  let l: Launched
  let restoreSession: () => void
  let copyRoot: string

  test.beforeAll(async () => {
    copyRoot = makeCopy()
    restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
    l = await launchPlexus()
    await l.win.waitForTimeout(12_000)
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

  test('OpenExportDialogCommand can execute with a diagram open', async () => {
    const canExport = await l.win.evaluate((resolveSrc) => {
      const resolveByDesc = (0, eval)(resolveSrc) as (d: string) => any
      const svc: any = resolveByDesc('DiagramExportService')
      if (!svc) return '__unresolved__'
      return svc.OpenExportDialogCommand?.CanExecute?.() ?? false
    }, RESOLVE_BY_DESC)
    expect(canExport).toBe(true)
  })

  test('Export… opens the preview dialog with a live SVG preview', async () => {
    // Fire the command (opens a modal that stays until closed) and poll for the VM.
    await l.win.evaluate((resolveSrc) => {
      const resolveByDesc = (0, eval)(resolveSrc) as (d: string) => any
      const svc: any = resolveByDesc('DiagramExportService')
      svc?.OpenExportDialogCommand?.Execute?.(undefined)
    }, RESOLVE_BY_DESC)
    await l.win.waitForTimeout(1500)

    const vm = await findPreviewVm(l)
    expect(vm.found, 'preview VM mounted').toBe(true)
    expect(vm.hasExport, 'VM exposes ExportCommand').toBe(true)
    expect(typeof vm.previewUri === 'string' && vm.previewUri.startsWith('data:image/svg+xml'),
      `preview is an SVG data URL (got ${vm.previewUri})`).toBe(true)
    expect(vm.previewSize, 'preview size readout is populated').toBeTruthy()
    // The ComboBox ItemsSource DPs must be populated (getter-backed lists bind empty).
    expect(vm.formatsCount, 'Formats item list populated').toBe(3)
    expect(vm.foregroundChoicesCount, 'ForegroundChoices item list populated').toBe(3)

    // Dismiss the modal via the VM's CancelCommand so the app returns to rest.
    await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'DiagramExportPreviewModel') { dc.CancelCommand?.Execute?.(undefined); return }
      }
    })
    await l.win.waitForTimeout(500)
    expect((await findPreviewVm(l)).found, 'dialog dismissed').toBe(false)
  })

  test('no app errors', async () => {
    expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
  })
})

// E2E: the .svg document type, exercised end to end in the running app. Opens a
// sample .svg in the test-architecture project and validates the real integration
// risks Phase 1 carries: the extension routes to SvgDocumentFactory (a SvgDocument
// opens); the visual tab mounts the parsed <svg> as live, in-DOM content inside a
// <foreignObject> (not a bitmap); the bottom-tab view swap works (via the same
// ShowVisual/ShowText commands the tab buttons bind); a markup edit re-renders the
// scene; and dirty/save persist the edit to disk.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, cloneCorpus, rectsForCtor, clickCenter, MAIN, corpusAvailable, type Launched } from './plexus-app'

// A sample SVG with a uniquely-tagged rect so we can find the mounted scene in
// the DOM unambiguously (Monaco also renders <svg>s of its own).
const SAMPLE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
    + '  <rect data-e2e="marker" x="10" y="10" width="60" height="40" fill="tomato"/>\n'
    + '</svg>\n'

test.describe.serial('svg-document', () => {
  test.skip(!corpusAvailable() || !fs.existsSync(MAIN), 'requires built app + test corpus')

  let l: Launched
  let clone: { root: string; projects: string[]; archDir: string }
  let restore: () => void
  let svgPath: string

  test.beforeAll(async () => {
    clone = cloneCorpus()
    svgPath = path.join(clone.archDir, 'sample.svg')
    fs.writeFileSync(svgPath, SAMPLE_SVG)
    restore = seedSession(clone.projects)
    l = await launchPlexus()
    await l.win.waitForTimeout(12_000)
    // Reveal the project explorer so its service (OpenFileInProject) is in the
    // live tree, then open the .svg through it (routes by extension to the SVG
    // document factory).
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1500)
    await l.win.evaluate(async () => {
      const S = Symbol.for('mural:visual-backref')
      let ex: any
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc && typeof dc.OpenFileInProject === 'function') { ex = dc; break }
      }
      const proj = ex?.OpenProjects?.ToArray?.().find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
      if (proj) await ex.OpenFileInProject(proj.Folder, 'sample.svg', 0, 0)
    })
    await l.win.waitForTimeout(4000)
  })

  test.afterAll(async () => {
    restore?.()
    await l?.app.close()
    if (clone?.root) fs.rmSync(clone.root, { recursive: true, force: true })
  })

  // Locate the open SvgDocument's DataContext in the live tree.
  async function svgDocState(): Promise<any> {
    return l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') {
          return {
            title: String(dc.Title),
            activeVisual: !!dc.IsVisualActive,
            activeText: !!dc.IsTextActive,
            dirty: !!dc.IsDirty,
            language: String(dc.Language),
          }
        }
      }
      return null
    })
  }

  test('opening a .svg yields an SvgDocument, visual-first, XML language', async () => {
    const s = await svgDocState()
    expect(s, 'an SvgDocument is open').not.toBeNull()
    expect(s.title).toBe('sample.svg')
    expect(s.activeVisual).toBe(true)
    expect(s.activeText).toBe(false)
    expect(s.language).toBe('xml')
  })

  test('the visual tab mounts the parsed <svg> as live in-DOM content', async () => {
    const marker = await l.win.evaluate(() => {
      const rect = document.querySelector('rect[data-e2e="marker"]')
      if (rect === null) return null
      // It must be inside a <foreignObject> (the DomHost host), i.e. real inline
      // SVG we can reach — not an <img>/bitmap.
      const inForeign = rect.closest('foreignObject') !== null
      return { inForeign }
    })
    expect(marker, 'the tagged rect is present in the DOM').not.toBeNull()
    expect(marker.inForeign).toBe(true)
  })

  test('the bottom-tab commands swap views', async () => {
    await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') { dc.ShowText(); return }
      }
    })
    await l.win.waitForTimeout(500)
    let s = await svgDocState()
    expect(s.activeText).toBe(true)
    expect(s.activeVisual).toBe(false)

    await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') { dc.ShowVisual(); return }
      }
    })
    await l.win.waitForTimeout(500)
    s = await svgDocState()
    expect(s.activeVisual).toBe(true)
  })

  // Clicking the real bottom-tab buttons (not just invoking the commands) — the
  // button's Command binding must resolve, which needs the command exposed as a DP.
  test('clicking the XML / Visual tab buttons switches the view', async () => {
    const labelCenter = (label: string) => l.win.evaluate((t) => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const v = (el as any)[S]
        if (v && v.constructor?.name === 'TextBlock' && String(v.Text) === t) {
          const r = (el as Element).getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
      }
      return null
    }, label)

    const xml = await labelCenter('XML')
    expect(xml, 'XML tab button on screen').not.toBeNull()
    await l.win.mouse.click(xml!.x, xml!.y)
    await l.win.waitForTimeout(500)
    expect((await svgDocState()).activeText).toBe(true)

    const vis = await labelCenter('Visual')
    await l.win.mouse.click(vis!.x, vis!.y)
    await l.win.waitForTimeout(500)
    expect((await svgDocState()).activeVisual).toBe(true)
  })

  test('editing the markup re-renders the scene, dirties, and saves to disk', async () => {
    // Simulate the text tab's two-way edit by writing Content (what Monaco does),
    // then switch to visual so the scene re-parses.
    await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') {
          dc.Content = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            + '<rect data-e2e="marker" x="10" y="10" width="60" height="40" fill="tomato"/>'
            + '<circle data-e2e="added" cx="80" cy="80" r="10" fill="royalblue"/></svg>'
          dc.ShowVisual()
          return
        }
      }
    })
    await l.win.waitForTimeout(800)

    const added = await l.win.evaluate(() => document.querySelector('circle[data-e2e="added"]') !== null)
    expect(added, 'the added circle is rendered after the edit').toBe(true)

    const s = await svgDocState()
    expect(s.dirty, 'the document is dirty after the edit').toBe(true)

    // Save through the document and confirm the edit hit disk.
    await l.win.evaluate(async () => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') { await dc.Save(); return }
      }
    })
    await l.win.waitForTimeout(500)

    const afterSave = await svgDocState()
    expect(afterSave.dirty, 'clean after save').toBe(false)
    const onDisk = fs.readFileSync(svgPath, 'utf8')
    expect(onDisk).toContain('data-e2e="added"')
  })
})

// Phase 2: direct-manipulation editing in the visual tab — select, move, resize,
// delete, undo. Assertions are on the resulting markup (doc.Content), which is
// robust to exact pixel positions. A fresh clone/open isolates this from Phase 1.
test.describe.serial('svg-document editing', () => {
  test.skip(!corpusAvailable() || !fs.existsSync(MAIN), 'requires built app + test corpus')

  let l: Launched
  let clone: { root: string; projects: string[]; archDir: string }
  let restore: () => void

  test.beforeAll(async () => {
    clone = cloneCorpus()
    fs.writeFileSync(path.join(clone.archDir, 'edit.svg'), SAMPLE_SVG)
    restore = seedSession(clone.projects)
    l = await launchPlexus()
    await l.win.waitForTimeout(12_000)
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1500)
    await l.win.evaluate(async () => {
      const S = Symbol.for('mural:visual-backref')
      let ex: any
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc && typeof dc.OpenFileInProject === 'function') { ex = dc; break }
      }
      const proj = ex?.OpenProjects?.ToArray?.().find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
      if (proj) await ex.OpenFileInProject(proj.Folder, 'edit.svg', 0, 0)
    })
    await l.win.waitForTimeout(4000)
  })

  test.afterAll(async () => {
    restore?.()
    await l?.app.close()
    if (clone?.root) fs.rmSync(clone.root, { recursive: true, force: true })
  })

  // The open document's Content (source of truth) + dirty flag.
  async function docContent(): Promise<{ content: string; dirty: boolean }> {
    return l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') return { content: String(dc.Content), dirty: !!dc.IsDirty }
      }
      return { content: '', dirty: false }
    })
  }

  // On-screen center of the first element matching `sel` (null if absent).
  async function centerOf(sel: string): Promise<{ x: number; y: number } | null> {
    return l.win.evaluate((s) => {
      const e = document.querySelector(s)
      if (e === null) return null
      const b = (e as Element).getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }, sel)
  }

  test('drag on the rect selects and moves it — writes a transform, dirties', async () => {
    const c = await centerOf('rect[data-e2e="marker"]')
    expect(c, 'marker rect on screen').not.toBeNull()
    await l.win.mouse.move(c!.x, c!.y)
    await l.win.mouse.down()
    await l.win.mouse.move(c!.x + 60, c!.y + 40, { steps: 6 })
    await l.win.mouse.up()
    await l.win.waitForTimeout(400)

    const s = await docContent()
    expect(s.content, 'the moved rect gained a transform').toMatch(/data-e2e="marker"[^>]*transform="matrix\(/)
    expect(s.dirty).toBe(true)
  })

  test('ctrl+z undoes the move', async () => {
    await l.win.keyboard.press('Control+z')
    await l.win.waitForTimeout(400)
    const s = await docContent()
    expect(s.content).not.toMatch(/transform="matrix\(/)
  })

  test('delete removes the selected element; ctrl+z restores it', async () => {
    const c = await centerOf('rect[data-e2e="marker"]')
    await l.win.mouse.click(c!.x, c!.y)   // select
    await l.win.waitForTimeout(200)
    await l.win.keyboard.press('Delete')
    await l.win.waitForTimeout(400)
    let s = await docContent()
    expect(s.content).not.toContain('data-e2e="marker"')

    await l.win.keyboard.press('Control+z')
    await l.win.waitForTimeout(400)
    s = await docContent()
    expect(s.content).toContain('data-e2e="marker"')
  })

  test('dragging the SE handle resizes (scale factor > 1)', async () => {
    const c = await centerOf('rect[data-e2e="marker"]')
    await l.win.mouse.click(c!.x, c!.y)   // select → handles render
    await l.win.waitForTimeout(300)
    const h = await centerOf('rect[data-handle="se"]')
    expect(h, 'SE handle on screen').not.toBeNull()
    await l.win.mouse.move(h!.x, h!.y)
    await l.win.mouse.down()
    await l.win.mouse.move(h!.x + 60, h!.y + 40, { steps: 6 })
    await l.win.mouse.up()
    await l.win.waitForTimeout(400)

    const s = await docContent()
    const m = s.content.match(/data-e2e="marker"[^>]*transform="matrix\(([^)]+)\)/)
    expect(m, 'marker rect has a matrix transform').not.toBeNull()
    const sx = Number(m![1].split(',')[0])
    expect(sx).toBeGreaterThan(1)
  })

  // Reads/writes the document's SelectionStyle VM — exactly what the panel's
  // ColorPicker/TextBox two-way bindings do.
  async function selectionStyle(): Promise<any> {
    return l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') {
          const st = dc.SelectionStyle
          const fill = st.Fill && st.Fill.Color && typeof st.Fill.Color.ToHex === 'function' ? String(st.Fill.Color.ToHex()) : undefined
          return { has: !!dc.HasSelection, fill }
        }
      }
      return null
    })
  }

  test('selecting populates the properties panel with the element fill', async () => {
    // Undo the prior resize so the rect is back to its clean fill; then select it.
    await l.win.keyboard.press('Control+z')
    await l.win.waitForTimeout(300)
    const c = await centerOf('rect[data-e2e="marker"]')
    await l.win.mouse.click(c!.x, c!.y)
    await l.win.waitForTimeout(300)
    const st = await selectionStyle()
    expect(st, 'sink present').not.toBeNull()
    expect(st.has).toBe(true)
    expect(st.fill).toBe('#ff6347')   // tomato resolved to a Brush hex
  })

  test('the ShapeFormatControl inspector is actually visible when a part is selected', async () => {
    const vis = await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      let hasSel = false; let ctrl: { w: number; h: number } | null = null
      for (const el of document.querySelectorAll('*')) {
        const v = (el as any)[S]
        const dc = v?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') hasSel = hasSel || !!dc.HasSelection
        if (v?.constructor?.name === 'ShapeFormatControl') { const r = (el as Element).getBoundingClientRect(); ctrl = { w: Math.round(r.width), h: Math.round(r.height) } }
      }
      return { hasSel, ctrl }
    })
    expect(vis.hasSel, 'document HasSelection').toBe(true)
    expect(vis.ctrl, 'ShapeFormatControl present in the tree').not.toBeNull()
    expect(vis.ctrl!.w, 'inspector has width').toBeGreaterThan(0)
    expect(vis.ctrl!.h, 'inspector has height').toBeGreaterThan(0)
  })

  test('editing Fill / Stroke via the sink writes back to the markup', async () => {
    // Drive the sink the way the ShapeFormatControl's two-way Fill(Brush)/Stroke(Pen)
    // bindings do — constructing new values from the live classes (no imports needed).
    await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') {
          const st = dc.SelectionStyle
          const ColorCls = st.Fill.Color.constructor
          st.Fill = new st.Fill.constructor(ColorCls.FromHex('#00cc00'))   // → Edited(Fill)
          const pen = st.Stroke
          st.Stroke = new pen.constructor(pen.Brush, 4)                     // → Edited(Stroke)
          return
        }
      }
    })
    await l.win.waitForTimeout(400)
    const s = await docContent()
    expect(s.content).toMatch(/data-e2e="marker"[^>]*fill="#00cc00"/)
    expect(s.content).toContain('stroke-width="4"')
    expect(s.dirty).toBe(true)
  })

  test('the inspector selection persists when switching to the XML tab', async () => {
    // A selection is still active from the prior test; switch to the XML tab and
    // confirm HasSelection stays true (the inspector rail persists across tabs).
    await l.win.evaluate(() => {
      const S = Symbol.for('mural:visual-backref')
      for (const el of document.querySelectorAll('*')) {
        const dc = (el as any)[S]?.DataContext
        if (dc?.constructor?.name === 'SvgDocument') { dc.ShowText(); return }
      }
    })
    await l.win.waitForTimeout(400)
    const st = await selectionStyle()
    expect(st.has, 'selection (and inspector) persists on the XML tab').toBe(true)
  })
})

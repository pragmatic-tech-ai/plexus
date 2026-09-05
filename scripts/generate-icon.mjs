// Regenerate the Plexus raster app icons from build/icon.svg (the SolariaMark
// boot-splash mark on its near-black ground). Renders the SVG with Chromium
// (via Playwright — the same engine that paints the splash, so the icon is
// pixel-identical) at every icon size, writes build/icon.png (512, for Linux /
// electron-builder) and packs build/icon.ico (multi-resolution, for Windows).
//
// Run: npm run generate:icon
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = join(HERE, '..', 'build')

class IconGenerator {
    // The .ico carries the classic Windows shell sizes; 256 is required to be a
    // PNG payload and the rest ride along as PNG too (Vista+ supports it).
    static ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
    // Standalone PNG electron-builder consumes for Linux (must be >= 256).
    static PNG_SIZE = 512

    constructor() {
        this._svg = ''
    }

    async run() {
        this._svg = await readFile(join(BUILD, 'icon.svg'), 'utf8')
        const browser = await chromium.launch()
        try {
            const page = await browser.newPage()
            const sizes = [...new Set([...IconGenerator.ICO_SIZES, IconGenerator.PNG_SIZE])]
            const bySize = new Map()
            for (const size of sizes) bySize.set(size, await this.rasterize(page, size))

            await writeFile(join(BUILD, 'icon.png'), bySize.get(IconGenerator.PNG_SIZE))
            const ico = this.packIco(IconGenerator.ICO_SIZES.map((s) => bySize.get(s)))
            await writeFile(join(BUILD, 'icon.ico'), ico)
            console.log(`icon.png (${IconGenerator.PNG_SIZE}px) + icon.ico [${IconGenerator.ICO_SIZES.join(', ')}] written to build/`)
        } finally {
            await browser.close()
        }
    }

    // Render the SVG filling a size×size viewport and screenshot the PNG. The
    // ground is opaque, so no alpha handling is needed — Chromium downscales the
    // vector cleanly at each target size.
    async rasterize(page, size) {
        const scaled = this._svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)
        await page.setViewportSize({ width: size, height: size })
        await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0">${scaled}</body></html>`,
            { waitUntil: 'networkidle' })
        return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } })
    }

    // Pack PNG buffers into a Windows .ico (ICONDIR + ICONDIRENTRY[] + PNG
    // payloads). Each entry stores the PNG blob verbatim; width/height byte is 0
    // for 256 per the format.
    packIco(pngs) {
        const count = pngs.length
        const header = Buffer.alloc(6)
        header.writeUInt16LE(0, 0)      // reserved
        header.writeUInt16LE(1, 2)      // type: icon
        header.writeUInt16LE(count, 4)  // image count

        const dir = Buffer.alloc(16 * count)
        let offset = 6 + 16 * count
        pngs.forEach((png, i) => {
            const size = png.readUInt32BE(16) // PNG IHDR width == our square edge
            const e = 16 * i
            dir.writeUInt8(size >= 256 ? 0 : size, e + 0)  // width  (0 => 256)
            dir.writeUInt8(size >= 256 ? 0 : size, e + 1)  // height (0 => 256)
            dir.writeUInt8(0, e + 2)                        // palette colors
            dir.writeUInt8(0, e + 3)                        // reserved
            dir.writeUInt16LE(1, e + 4)                     // color planes
            dir.writeUInt16LE(32, e + 6)                    // bits per pixel
            dir.writeUInt32LE(png.length, e + 8)            // bytes in resource
            dir.writeUInt32LE(offset, e + 12)               // offset to payload
            offset += png.length
        })

        return Buffer.concat([header, dir, ...pngs])
    }
}

await new IconGenerator().run()

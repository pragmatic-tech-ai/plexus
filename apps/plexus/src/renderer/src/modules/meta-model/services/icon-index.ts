import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

const ICON_INDEX = 'presentation/icon-index.json'

// Read a published package's icon-index.json (entityKey → icon resource key) from
// `<base>/presentation/icon-index.json`. Missing or unparseable → an empty map, so
// a pre-change package (no sidecar) simply contributes no icon keys and its
// entities fall to the default glyph.
export async function readIconIndex(storage: IStorage, base: string): Promise<Map<string, string>>
{
    let raw: string
    try { raw = await storage.ReadText(`${base}/${ICON_INDEX}`) }
    catch { return new Map() }
    try {
        const obj = JSON.parse(raw) as Record<string, string>
        return new Map(Object.entries(obj))
    } catch { return new Map() }
}

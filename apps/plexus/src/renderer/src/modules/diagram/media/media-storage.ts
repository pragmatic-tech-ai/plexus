import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { bytesToDataUri, mimeForPath } from '../../../services/markdown/markdown-image'
import { MediaKind } from './media-kind'

export const MEDIA_INLINE_LIMIT_BYTES = 1024 * 1024

export enum LargeFileChoice { Embed = 'embed', Link = 'link' }

export interface DroppedPayload { name: string; kind: MediaKind; bytes: Uint8Array; osPath?: string }
export interface ResolvedMediaSource { source: string; label: string }
export interface MediaStorageDeps
{
    storage: IStorage
    promptLargeFile: (name: string) => Promise<LargeFileChoice>
    mediaDir?: string
}

const DEFAULT_MEDIA_DIR = 'media'

function splitExt(name: string): { stem: string; ext: string }
{
    const dot = name.lastIndexOf('.')
    return dot < 0 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

// Copy bytes into the project media folder under a collision-free name; returns
// the project-relative path (forward slashes, IStorage's convention).
export async function writeMedia(
    storage: IStorage, name: string, bytes: Uint8Array, mediaDir: string = DEFAULT_MEDIA_DIR,
): Promise<string>
{
    await storage.CreateDirectory(mediaDir)
    const { stem, ext } = splitExt(name)
    let candidate = `${mediaDir}/${stem}${ext}`
    let n = 0
    while (await storage.Exists(candidate)) { n += 1; candidate = `${mediaDir}/${stem}-${n}${ext}` }
    await storage.WriteBytes(candidate, bytes)
    return candidate
}

// Decide how a dropped file's bytes are stored and return the source string a
// MediaNodeVM will carry: a data URI (inlined), a project-relative media/ path
// (embedded copy), or the original OS path (linked).
export async function resolveDroppedFile(
    payload: DroppedPayload, deps: MediaStorageDeps,
): Promise<ResolvedMediaSource>
{
    const { name, kind, bytes, osPath } = payload
    const label = name

    if (bytes.byteLength < MEDIA_INLINE_LIMIT_BYTES)
        return { source: bytesToDataUri(bytes, mimeForPath(name)), label }

    // >= 1 MB. Images always embed; arbitrary files prompt Embed vs Link.
    if (kind === MediaKind.Image)
        return { source: await writeMedia(deps.storage, name, bytes, deps.mediaDir), label }

    const choice = await deps.promptLargeFile(name)
    if (choice === LargeFileChoice.Link && osPath !== undefined) return { source: osPath, label }
    return { source: await writeMedia(deps.storage, name, bytes, deps.mediaDir), label }
}

// compiled-presentation.ts — shared eval kernel for pre-compiled presentation
// artifacts. Both meta-model and library loaders delegate here; each passes its
// own ctxExtra (e.g. { MetaModelEntity } or { LibraryClassData }) so the eval'd
// body can reference those symbols via destructuring without hard-coding them here.
import * as MuralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as MuralBasic from '@pragmatic-tech-ai/mural/basic'
import * as MuralFramework from '@pragmatic-tech-ai/mural/framework'
import * as MuralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { CompiledPresentation } from './presentation-publisher.js'

const COMPILED = 'presentation/presentation.compiled.json'

// Reads `<base>/presentation/presentation.compiled.json`, JSON-parses it, and
// evaluates the compiled resources class with the mural runtime plus any caller-
// supplied symbols (`ctxExtra`) injected via a `new Function` context. Returns
// undefined when the file is absent or unreadable (the caller decides whether
// that is an error or a soft fallback).
export async function loadCompiledPresentation(
    storage: IStorage,
    base: string,
    ctxExtra: Record<string, unknown> = {},
): Promise<ResourceDictionary | undefined>
{
    let raw: string
    try { raw = await storage.ReadText(`${base}/${COMPILED}`) }
    catch { return undefined }

    const { body, symbols, className } = JSON.parse(raw) as CompiledPresentation
    const ctx: Record<string, unknown> = {
        ...MuralRuntime, ...MuralEngine, ...MuralBasic, ...MuralFramework, ...ctxExtra,
    }
    const destructure = symbols.length > 0 ? `const { ${symbols.join(', ')} } = _ctx;\n` : ''
    const bodyR = body.replace(/^export class /gm, 'class ')
    const fn = new Function('_ctx', `${destructure}${bodyR}\nreturn ${className}.Clone();`)
    return fn(ctx) as ResourceDictionary
}

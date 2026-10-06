import { describe, test, expect } from 'vitest'
import { ModelDraft } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { WikiOriginKind, WikiLocator, type WikiOrigin } from '../../../../services/projects/wiki-origin.js'
import { ArchModel } from '../arch-model.js'

const SRC = `namespace mm { concept service { annotate wiki { path = "wiki/service.md"; } } }`
const storage = { Root: '/proj' } as unknown as IStorage

function model(originOf: Map<string, WikiOrigin>): ArchModel
{
    const draft = ModelDraft.fromSources([], [{ uri: 'm.todl', text: SRC }], { namespace: 'mm' })
    return new ArchModel(draft, storage, 'mm', undefined, originOf)
}

describe('ArchModel.wikiOriginOf', () => {
    test('returns the tagged origin for a base concept', () => {
        const origin = WikiLocator.PackageOrigin('mm', '1.0.0')
        expect(model(new Map([['mm.service', origin]])).wikiOriginOf('mm.service')).toBe(origin)
    })

    test('a resolvable but untagged concept defaults to this project (open source)', () => {
        const o = model(new Map()).wikiOriginOf('mm.service')
        expect(o?.kind).toBe(WikiOriginKind.OpenProject)
    })

    test('an unknown concept has no origin', () => {
        expect(model(new Map()).wikiOriginOf('nope')).toBeUndefined()
    })
})

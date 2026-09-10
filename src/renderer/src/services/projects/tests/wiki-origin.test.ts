import { describe, test, expect } from 'vitest'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProducerKind } from '../project-factory.js'
import {
    WikiOriginKind, openProjectOrigin, packageOrigin, locateWikiFile, packageWikiPath,
} from '../wiki-origin.js'

const fakeStorage = { Root: '/proj' } as unknown as IStorage

describe('origin constructors', () => {
    test('openProjectOrigin carries the storage', () => {
        expect(openProjectOrigin(fakeStorage)).toEqual({ kind: WikiOriginKind.OpenProject, storage: fakeStorage })
    })
    test('packageOrigin carries backend/id/version', () => {
        expect(packageOrigin(ProducerKind.Library, 'microsoft', '1.2.0'))
            .toEqual({ kind: WikiOriginKind.Package, backend: ProducerKind.Library, id: 'microsoft', version: '1.2.0' })
    })
})

describe('packageWikiPath', () => {
    test('composes <id>/<version>/<relPath>', () => {
        expect(packageWikiPath('microsoft', '1.2.0', 'wiki/service.md')).toBe('microsoft/1.2.0/wiki/service.md')
    })
})

describe('locateWikiFile', () => {
    test('an open-project origin reads relPath from the project storage', () => {
        const loc = locateWikiFile({} as never, openProjectOrigin(fakeStorage), 'wiki/service.md')
        expect(loc).toEqual({ storage: fakeStorage, path: 'wiki/service.md' })
    })
    // The Package branch resolves a backend via the provider; its path composition
    // is covered by packageWikiPath above (backend wiring is integration-tested).
})

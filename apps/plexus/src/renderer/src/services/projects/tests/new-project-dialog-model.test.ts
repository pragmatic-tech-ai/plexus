import { test, expect } from 'vitest'

import type { FileSystemService } from '../../file-system/file-system-service.js'
import type { BaseRef } from '../base-binding.js'
import {
    NewProjectDialogModel,
    ProjectTypeChoice,
    type NewProjectResult,
} from '../new-project-dialog-model.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

function choices(): ProjectTypeChoice[]
{
    return [
        new ProjectTypeChoice('architecture', 'Architecture Project', 'A node-and-connector model.'),
        new ProjectTypeChoice('flow', 'Flow Project', 'A flow model.'),
    ]
}

// A FileSystemService stub whose OpenFolder returns a preset folder (or null).
function stubFs(folder: string | null): FileSystemService
{
    return { OpenFolder: () => Promise.resolve(folder) } as unknown as FileSystemService
}

function build(opts: { fs?: FileSystemService; validate?: (r: NewProjectResult) => Promise<string | null> } = {})
{
    let result: NewProjectResult | undefined | 'uncalled' = 'uncalled'
    const vm = new NewProjectDialogModel(
        choices(),
        opts.fs ?? stubFs('/picked'),
        opts.validate ?? (() => Promise.resolve(null)),
        (r) => { result = r },
    )
    return { vm, closed: () => result }
}

test('defaults to the first type, marked selected', () => {
    const { vm } = build()
    expect(vm.SelectedType?.Type).toBe('architecture')
    expect(vm.Types.ToArray().map((c) => c.Marker)).toEqual(['●', '○'])
})

test('selecting a type moves the marker and SelectedType', () => {
    const { vm } = build()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)
    expect(vm.SelectedType?.Type).toBe('flow')
    expect(vm.Types.ToArray().map((c) => c.Marker)).toEqual(['○', '●'])
})

test('CanConfirm requires a name and a location', () => {
    const { vm } = build()
    expect(vm.CanConfirm).toBe(false)
    vm.Name = 'Acme'
    expect(vm.CanConfirm).toBe(false)
    vm.Location = '/work/acme'
    expect(vm.CanConfirm).toBe(true)
})

test('Browse sets the location from the folder picker', async () => {
    const { vm } = build({ fs: stubFs('/work/acme') })
    vm.BrowseCommand.Execute(undefined)
    await flush()
    expect(vm.Location).toBe('/work/acme')
})

test('confirm blocked by validation shows the error and does not close', async () => {
    const { vm, closed } = build({ validate: () => Promise.resolve('Folder already contains a project.') })
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(vm.Error).toBe('Folder already contains a project.')
    expect(closed()).toBe('uncalled')
})

test('confirm success closes with the result', async () => {
    const { vm, closed } = build()
    vm.Name = '  Acme  '
    vm.Location = '/work/acme'
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({ type: 'flow', name: 'Acme', location: '/work/acme' })
})

test('cancel closes with undefined', () => {
    const { vm, closed } = build()
    vm.CancelCommand.Execute(undefined)
    expect(closed()).toBeUndefined()
})

// ── meta-model picker (library projects) ──

const META_REFS: readonly BaseRef[] = [{ id: 'ea', version: '5' }]

// The architecture choice does not require a meta-model; the library choice does.
function metaChoices(): ProjectTypeChoice[]
{
    return [
        new ProjectTypeChoice('architecture', 'Architecture Project', 'A node-and-connector model.'),
        new ProjectTypeChoice('library', 'Library Project', 'A taxonomy.', true),
    ]
}

function buildLib(metaModels: readonly BaseRef[] = META_REFS)
{
    let result: NewProjectResult | undefined | 'uncalled' = 'uncalled'
    const vm = new NewProjectDialogModel(
        metaChoices(),
        stubFs('/picked'),
        () => Promise.resolve(null),
        (r) => { result = r },
        metaModels,
    )
    return { vm, closed: () => result }
}

test('selecting a meta-model-requiring type shows the picker; a plain type hides it', () => {
    const { vm } = buildLib()
    expect(vm.ShowMetaModelPicker).toBe(false)               // architecture selected by default
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // library
    expect(vm.ShowMetaModelPicker).toBe(true)
    vm.Types.ToArray()[0].SelectCommand!.Execute(undefined)  // back to architecture
    expect(vm.ShowMetaModelPicker).toBe(false)
})

test('a meta-model-requiring type blocks CanConfirm until a meta-model is chosen', () => {
    const { vm } = buildLib()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // library
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    expect(vm.CanConfirm).toBe(false)                        // no meta-model chosen yet
    vm.SelectedMetaModel = vm.MetaModels.ToArray()[0]
    expect(vm.CanConfirm).toBe(true)
})

test('confirm on a library type includes the chosen meta-model ref', async () => {
    const { vm, closed } = buildLib()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // library
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    vm.SelectedMetaModel = vm.MetaModels.ToArray()[0]
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({ type: 'library', name: 'Acme', location: '/work/acme', metaModel: { id: 'ea', version: '5' } })
})

test('a non-requiring type never blocks on, nor includes, a meta-model', async () => {
    const { vm, closed } = buildLib()
    vm.Name = 'Acme'                                         // architecture selected by default
    vm.Location = '/work/acme'
    expect(vm.CanConfirm).toBe(true)
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({ type: 'architecture', name: 'Acme', location: '/work/acme' })
})

test('selecting a requiring type with no published meta-models shows an error', () => {
    const { vm } = buildLib([])
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // library
    expect(vm.Error).toMatch(/Publish a meta-model first/)
})

test('the meta-model choices carry an id @ version label', () => {
    const { vm } = buildLib()
    expect(vm.MetaModels.ToArray()[0].Label).toBe('ea @ 5')
})

// ── libraries multi-select (architecture projects) ──

const LIB_REFS: readonly BaseRef[] = [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '2' }]

// An architecture-like choice: requires a meta-model AND offers libraries.
function archChoices(): ProjectTypeChoice[]
{
    return [
        new ProjectTypeChoice('diagram', 'Diagram Project', 'A plain diagram.'),
        new ProjectTypeChoice('architecture', 'Architecture Project', 'An instance model.', true, true),
    ]
}

function buildArch(metaModels: readonly BaseRef[] = META_REFS, libraries: readonly BaseRef[] = LIB_REFS)
{
    let result: NewProjectResult | undefined | 'uncalled' = 'uncalled'
    const vm = new NewProjectDialogModel(
        archChoices(),
        stubFs('/picked'),
        () => Promise.resolve(null),
        (r) => { result = r },
        metaModels,
        libraries,
    )
    return { vm, closed: () => result }
}

test('selecting an offersLibraries type shows the libraries picker; a plain type hides it', () => {
    const { vm } = buildArch()
    expect(vm.ShowLibrariesPicker).toBe(false)               // diagram selected by default
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // architecture
    expect(vm.ShowLibrariesPicker).toBe(true)
    expect(vm.Libraries.ToArray().map((l) => l.Label)).toEqual(['microsoft @ 0.1.0', 'aws @ 2'])
    vm.Types.ToArray()[0].SelectCommand!.Execute(undefined)  // back to diagram
    expect(vm.ShowLibrariesPicker).toBe(false)
})

test('checked libraries flow into confirm().libraries; meta-model still required', async () => {
    const { vm, closed } = buildArch()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // architecture
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    expect(vm.CanConfirm).toBe(false)                        // meta-model not chosen yet
    vm.SelectedMetaModel = vm.MetaModels.ToArray()[0]
    vm.Libraries.ToArray()[0].IsSelected = true              // check "microsoft"
    expect(vm.CanConfirm).toBe(true)
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({
        type: 'architecture', name: 'Acme', location: '/work/acme',
        metaModel: { id: 'ea', version: '5' },
        libraries: [{ id: 'microsoft', version: '0.1.0' }],
    })
})

test('confirming an architecture with zero libraries yields an empty libraries array', async () => {
    const { vm, closed } = buildArch()
    vm.Types.ToArray()[1].SelectCommand!.Execute(undefined)  // architecture
    vm.Name = 'Acme'
    vm.Location = '/work/acme'
    vm.SelectedMetaModel = vm.MetaModels.ToArray()[0]
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect((closed() as NewProjectResult).libraries).toEqual([])
})

test('a non-offering type omits libraries from the result', async () => {
    const { vm, closed } = buildArch()
    vm.Name = 'Plain'                                        // diagram selected by default
    vm.Location = '/work/plain'
    vm.ConfirmCommand.Execute(undefined)
    await flush()
    expect('libraries' in (closed() as NewProjectResult)).toBe(false)
})

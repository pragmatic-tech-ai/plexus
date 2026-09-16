import type { Element, Scalar } from '@pragmatic-tech-ai/todl'

// Bindable view-model over an Element. The concrete subclass TYPE is what mural
// resolves a DataTemplate against; its getters flatten Element facets into clean
// binding targets so markup needs no converters.
export class ElementViewModel
{
    public readonly id: string
    public readonly concept: string
    public readonly label: string
    public readonly icon: string | null
    protected readonly element: Element

    public constructor(element: Element)
    {
        this.element = element
        this.id = element.id
        this.concept = element.concept
        this.label = element.presentation.label
        this.icon = element.presentation.iconKey ?? null
    }

    protected field(name: string): Scalar | undefined { return this.element.fields[name] }

    protected ref(member: string): ElementViewModel | undefined
    {
        const t = this.element.refs[member]?.[0]
        return t !== undefined ? toViewModel(t) : undefined
    }

    protected refs(member: string): ElementViewModel[]
    {
        return (this.element.refs[member] ?? []).map(toViewModel)
    }
}

export type ElementViewModelCtor = new (e: Element) => ElementViewModel

const registered = new Map<string, ElementViewModelCtor>()
const generated = new Map<string, ElementViewModelCtor>()

// Register a hand-authored typed VM class for a concept.
export function registerElementViewModel(concept: string, ctor: ElementViewModelCtor): void
{
    registered.set(concept, ctor)
}

// A distinct class whose .name === concept, so mural's findDataTemplateForType
// sees a per-concept type even without a hand-written class.
function generatedClassFor(concept: string): ElementViewModelCtor
{
    let ctor = generated.get(concept)
    if (ctor === undefined) {
        ctor = { [concept]: class extends ElementViewModel {} }[concept] as ElementViewModelCtor
        generated.set(concept, ctor)
    }
    return ctor
}

// Build the bindable VM for an Element: the registered class if any, else a
// generated per-concept class. Children are built lazily via ref()/refs().
export function toViewModel(element: Element): ElementViewModel
{
    const Ctor = registered.get(element.concept) ?? generatedClassFor(element.concept)
    return new Ctor(element)
}

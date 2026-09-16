import { ElementViewModel, registerElementViewModel } from './element-view-model.js'

// Typed, bindable view-models for the tech-architecture concepts. Their getters
// flatten Element facets so markup binds directly (no converters). Concepts not
// covered here still get a generated per-concept VM from toViewModel.
export class Technology extends ElementViewModel
{
    public get name(): string { return String(this.field('label') ?? this.label) }
}

export class Category extends ElementViewModel
{
    public get name(): string { return String(this.field('label') ?? this.label) }
}

export class Component extends ElementViewModel
{
    public get name(): string { return String(this.field('name') ?? this.label) }
    public get implementedBy(): Technology[] { return this.refs('implementedBy') as Technology[] }
    public get cat(): Category | undefined { return this.ref('categorisedAs') as Category | undefined }
    public get hostedIn(): Technology | undefined { return this.ref('hostedIn') as Technology | undefined }
}

// Register the architecture VMs. Called by tests now; a future widget-host task
// calls it at app startup once a consumer exists (deferred — nothing renders
// these yet, so no startup wiring here).
export function registerArchViewModels(): void
{
    registerElementViewModel('component', Component)
    registerElementViewModel('technology', Technology)
    registerElementViewModel('category', Category)
}

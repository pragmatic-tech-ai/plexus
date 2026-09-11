// Dev-only Template Gallery — a dock panel that renders one of every agent
// transcript/tool card (from gallery-fixtures) through the SAME implicit
// DataTemplates the chat uses. It lets you iterate on the card .mu templates and
// see the visuals immediately (edit → compile:mu → reload), without driving the
// real agent. Seeded as a tab in main.js ONLY when EnvironmentService.IsDevelopment,
// so it never appears in packaged builds.
import {
    MetaData, MuralBase, ObservableCollection, ServiceBase, ServiceKey, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import type { IDockPanel } from '@pragmatic-tech-ai/mural/framework'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { NewProjectCard } from './new-project-card.js'
import { galleryCards } from './gallery-fixtures.js'

export class TemplateGalleryService extends ServiceBase implements IDockPanel
{
    public static readonly Key = new ServiceKey<TemplateGalleryService>('TemplateGalleryService')

    // IDockPanel: identify + label the Gallery tab in the right panel dock.
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        TemplateGalleryService, 'Id', 'template-gallery', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        TemplateGalleryService, 'Title', 'Card Gallery', MetaData.None)
    // The cards rendered by DataTemplate[TemplateGalleryService] via an ItemsControl.
    public static readonly CardsKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase>>(
        TemplateGalleryService, 'Cards', undefined as unknown as ObservableCollection<MuralBase>, MetaData.None)

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const cards = new ObservableCollection<MuralBase>()
        for (const card of galleryCards()) cards.Add(card)
        this.set_property_value(TemplateGalleryService.CardsKey, cards)

        // The New Project card hosts the real New-Project form, which is built
        // asynchronously and needs the explorer. Skipped when it isn't available
        // (e.g. unit tests) so the gallery still renders the rest.
        const explorer = provider.get(ProjectExplorerService.Key)
        if (explorer !== undefined)
        {
            const card = new NewProjectCard('gallery-new-project')
            void explorer.NewProjectFormFor(() => card.showCancelled()).then((form) =>
            {
                card.Form = form
                cards.Add(card)
            })
        }
    }

    public get Id(): string { return this.get_property_value(TemplateGalleryService.IdKey) }
    public get Title(): string { return this.get_property_value(TemplateGalleryService.TitleKey) }
    public get Cards(): ObservableCollection<MuralBase> { return this.get_property_value(TemplateGalleryService.CardsKey) }

    // Stop any live card timers (the approval card's countdown) when the tab is
    // torn down; harmless if it isn't.
    public dispose(): void
    {
        for (const card of this.Cards) (card as { dispose?: () => void }).dispose?.()
    }
}

export default TemplateGalleryService

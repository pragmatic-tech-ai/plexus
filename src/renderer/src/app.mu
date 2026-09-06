// app.mu — the Plexus application root.
//
// An `Application` block compiles to `export const app` (an initialized
// Application whose `x:root` element is the mounted root visual). The
// renderer bootstrap (main.js) hands `app` an HtmlTarget to paint into.
//
// The root is an EditorShell — the framework's app-frame control. Its
// default template lays out six regions: Header (top), Commands (top),
// Navigation (left), Content (fill), Inspector (right), Status (bottom).
// Each body child picks its region via the `Shell.Region` attached
// property; an unpopulated region collapses. This is the same shell the
// demo platform uses, mapped to a diagram editor's frame:
//
//   Header      brand bar
//   Commands    editing toolbar
//   Navigation  shape toolbox (left)
//   Content     the canvas surface
//   Inspector   format / properties pane (right)
//   Status      status bar (bottom)
//
// Regions are populated with a real-but-minimal skeleton; each grows into
// its full control (a data-driven toolbox, DiagramDocument-backed canvas,
// live ShapeFormatControl, etc.) as the editor fills in.

// Theme / Scheme are real class references (the no-string-proxies rule);
// Shell owns the `Region` attached property. All other controls resolve
// through the compiler's default symbol table.
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialDark from "@pragmatic-tech-ai/mural/resources/material"
import Shell from "@pragmatic-tech-ai/mural/framework/shell/shell.js"

// The app's modules — each a `module NAME { … }` const from its own file.
// Listed in the `.modules:` block below, they compose onto the shell:
// every capability's Name (and, later, Icon) becomes a root-nav entry, and
// the NavigationService surfaces the active capability's Panel.
import DiagramModule from "./modules/diagram/diagram.module.mu.js"
import DiagramExportModule from "./modules/diagram-export/diagram-export.module.mu.js"
import ArchitectureProjectsModule from "./modules/architecture-projects/architecture-projects.module.mu.js"
import ProjectExplorerModule from "./modules/project-explorer/project-explorer.module.mu.js"
import MetaModelModule from "./modules/meta-model/meta-model.module.mu.js"
import LibraryModule from "./modules/library/library.module.mu.js"
import AgentChatModule from "./modules/agent-chat/agent-chat.module.mu.js"
import ProblemsModule from "./modules/problems/problems.module.mu.js"
import CodeEditorModule from "./modules/code-editor/code-editor.module.mu.js"
import MarkdownViewerModule from "./modules/markdown-viewer/markdown-viewer.module.mu.js"

// Shared icon dictionary — one Geometry per capability, merged into the app's
// Resources (via `merge` below) so each module's `Icon = @<Key>` resolves.
import PlexusIcons from "./plexus-icons.mu.js"

// Services live under ./services/<service>/, each folder carrying the service
// (and, where it has view resources, a *.resources.mu dictionary merged below).
// app.mu only COMPOSES: it registers services in `.services:` and merges each
// service's resource dictionary — the templates themselves live with the service.

// Native file-system capability (open/save dialogs, read/write, directory
// listing). Resolved via FileSystemService.Key; no view resources.
import FileSystemService from "./services/file-system/file-system-service.js"

// Static host environment (dirs, platform, versions, flags). No view resources.
import EnvironmentService from "./services/environment/environment-service.js"

// Live window-height feed (ViewportService.Height) — the Problems popup caps its
// list at 30% of it. No view resources.
import ViewportService from "./services/viewport/viewport-service.js"

// System-clipboard seam — the Problems popup's copy actions write through it.
import ClipboardService from "./services/clipboard/clipboard-service.js"

// Storage-provider seam: maps a backend id → a rooted IStorage factory (seeded
// with the local-FS backend over FileSystemService). The Project Explorer builds
// a project's storage through this; remote backends (cloud/REST) register here.
import StorageProviderRegistry from "./services/storage/storage-provider-registry.js"

// Recent-projects MRU — persists opened/created projects to a JSON file under
// userData (via FileSystemService), surfaced by the Open Project dialog.
import RecentProjectsService from "./services/projects/recent-projects-service.js"

// Open-projects set — persists which projects are open to a JSON file under
// userData, so the workspace restores on launch (ProjectExplorer.RestoreSession).
import OpenProjectsStore from "./services/projects/open-projects-store.js"

// Window title service: computes the app title (active document → open project →
// "Plexus") as a bindable Title DP, which the mural-painted header binds. Also
// mirrors document.title. Replaces title-bar.ts's old imperative HTML-band sync.
import TitleService from "./window/title-service.js"

// Background work: a pluggable-executor manager that runs background operations
// and surfaces each as a live entry in the status bar (progress, cancel, output
// document). Root-registered so any service can submit; its status-bar dock is
// contributed by BackgroundWorkModule and rendered by BackgroundWorkResources.
import BackgroundWorkService from "./modules/background-work/services/background-work-service.js"
import BackgroundWorkModule from "./modules/background-work/background-work.module.mu.js"
import SaveModule from "./modules/save/save.module.mu.js"
import BackgroundWorkResources from "./modules/background-work/background-work.resources.mu.js"

// The mural-painted app title bar (EditorShell.HeaderContent = @PlexusTitleBar):
// a 32dp strip with the rail-coloured logo box + brand mark on the left and the
// bound title text. Merged below; set on the shell root at the bottom.
import PlexusTitleBar from "./window/title-bar.resources.mu.js"

// Capability content services + their side-pane templates.
import PanelsResources from "./services/panels/panels.resources.mu.js"

// Diagram editor (ported from the Diagrammer demo, distributed across the shell
// regions). DiagramWorkspaceService owns the seeded DiagramDocument + the live
// Diagram control and presents the canvas in the Content region; DiagramResources
// carries the icons, toolbar/tile templates, and the ToolBox shapes panel.
import DiagramWorkspaceService from "./modules/diagram/services/diagram-workspace-service.js"
import DiagramResources from "./modules/diagram/diagram.resources.mu.js"

// Layout pipeline inspector: composes a Fresco layout pipeline and runs it on
// the active diagram. Root-registered so the shell Inspector region reaches
// the same instance the canvas menu opens.
import LayoutPipelineService from "./modules/diagram/layout/layout-pipeline-service.js"
import LayoutInspectorResources from "./modules/diagram/layout/layout-inspector.resources.mu.js"

// Project Explorer view — the generic project tree + command bar
// (DataTemplate[ProjectExplorerService] + recursive DataTemplate[ProjectNode]).
import ProjectExplorerResources from "./modules/project-explorer/project-explorer.resources.mu.js"

// Meta-models capability panel: the published-meta-models virtualized tree
// (DataTemplate[MetaModelsService] + HierarchicalDataTemplate[MetaModelTreeNode]).
import MetaModelResources from "./modules/meta-model/meta-model.resources.mu.js"

// Libraries capability panel (DataTemplate[LibrariesPanelService] + rows).
import LibraryResources from "./modules/library/library.resources.mu.js"

// Agent chat panel (DataTemplate[ChatSession] + transcript item templates).
import AgentChatResources from "./modules/agent-chat/agent-chat.resources.mu.js"

// Conversations nav panel (DataTemplate[ChatSessionsService] + row templates). The
// manager/persistence services are registered by AgentChatModule's .services block
// (root-scoped, like the other module services), so main.js + the panel share one
// instance; only the view resources are merged here.
import ConversationsResources from "./modules/agent-chat/conversations.resources.mu.js"

// Problems dock (DataTemplate[ProblemsService] + ProblemsRow rows).
import ProblemsResources from "./modules/problems/problems.resources.mu.js"

// Code editor: opens files as Monaco-backed CodeDocuments (a DomHost carries
// Monaco's DOM into the SVG surface via <foreignObject>). CodeEditorService
// opens/dedupes tabs; CodeEditorResources carries DataTemplate[CodeDocument].
import CodeEditorService from "./modules/code-editor/code-editor-service.js"

// Document tab strip — overrides the framework's DataTemplate[DocumentsContentHostService]
// with an ExtendedTabControl that adds a top-right overflow dropdown (Close All +
// the open-tabs list). No service; view resources only.
import DocumentTabsResources from "./services/document-tabs/document-tabs.resources.mu.js"

// Right-dock tab strip override — shadows the framework's DataTemplate[PanelDockService]
// with a title-only header (no per-tab close), a clean navigation-style strip.
import DockTabsResources from "./services/dock-tabs/dock-tabs.resources.mu.js"

// Shared TODL live-validation service (base-aware): validates any authoring
// project's .todl files against its declared bases via checkAgainst. Root-scoped
// like ProjectFactoryRegistry so every module's editor can attach documents.
import TodlLanguageClient from "./services/todl/todl-language-client.js"
import WorkspaceBaseResolver from "./services/projects/workspace-base-resolver.js"
import ArchitectureModelService from "./modules/architecture-projects/services/architecture-model-service.js"
import ArchDiagramBindingService from "./modules/architecture-projects/services/arch-diagram-binding-service.js"
import DropCandidateChooserService from "./modules/architecture-projects/services/drop-candidate-chooser-service.js"
import ChooserResources from "./modules/architecture-projects/services/chooser.resources.mu.js"
import ViewpointPickerResources from "./modules/architecture-projects/services/viewpoint-picker.resources.mu.js"
import DiagramViewpointsEditor from "./modules/architecture-projects/services/diagram-viewpoints-editor.js"
import DiagnosticsService from "./services/diagnostics/diagnostics-service.js"
import WorkspaceRefreshService from "./services/workspace/workspace-refresh-service.js"
import FileWatchService from "./services/file-watch/file-watch-service.js"
import EditorReloadService from "./services/file-watch/editor-reload-service.js"
import ProjectRescanService from "./services/file-watch/project-rescan-service.js"
import CodeEditorResources from "./modules/code-editor/code-editor.resources.mu.js"
import MarkdownViewerResources from "./modules/markdown-viewer/markdown-viewer.resources.mu.js"

// Services formerly registered imperatively in the renderer bootstrap (main.js),
// moved here so ALL service registration is declarative in one place. The diagram
// persistence trio + close-guard + autosave keep their eager `.get()` in main.js
// (they must construct at boot); the three architecture contributors are
// alias-registered under the generic framework/document extension keys (the same
// `Impl -> Key` form as ElectronSettingsStore / PlexusDocumentHost above).
import DiagramCameraService from "./modules/diagram/services/diagram-camera-service.js"
import DiagramGuidesService from "./modules/diagram/services/diagram-guides-service.js"
import DiagramCanvasService from "./modules/diagram/services/diagram-canvas-service.js"
import DocumentCloseGuard from "./services/documents/document-close-guard.js"
import AutosaveService from "./services/autosave/autosave-service.js"
import ArchNewDiagramParticipant from "./modules/architecture-projects/services/arch-new-diagram-participant.js"
import NewFileParticipantKey from "./services/documents/new-file-participant.js"
import ArchEditViewpointsCommand from "./modules/architecture-projects/services/arch-edit-viewpoints-command.js"
import DiagramCommandExtensionKey from "./modules/diagram/services/diagram-command-extension.js"
import ArchNodeCommandContributor from "./modules/architecture-projects/services/arch-node-command-contributor.js"
import NodeCommandContributorKey from "./services/documents/node-command-contributor.js"

// Wiki: an "Open Wiki" action on concept surfaces that opens the concept's
// declared markdown page (resolved from its open project) in a Monaco tab.
import WikiLocator from "./services/wiki/wiki-locator.js"
import WikiService from "./services/wiki/wiki-service.js"
import WikiResources from "./services/wiki/wiki.resources.mu.js"


// Settings: persistence store, the footer-gear launcher, and the settings-page
// view resources. ApplicationSettings (framework, auto-provided by EditorShell)
// + the store under SettingsStoreKey turn on persistence to userData/settings.json.
import ElectronSettingsStore from "./services/settings/settings-store.js"
import PlexusSettingsContribution from "./services/settings/settings-contribution.js"
import SettingsResources from "./services/settings/settings.resources.mu.js"
import SavePromptResources from "./services/dialogs/save-prompt.resources.mu.js"
import DiagramExportPreviewResources from "./modules/diagram-export/diagram-export-preview.resources.mu.js"
import PlexusDocumentHost from "./services/documents/plexus-document-host.js"
// Framework tokens registered at the app ROOT below (see `.services:`).
import SettingsStoreKey from "@pragmatic-tech-ai/mural/framework"
import ApplicationSettings from "@pragmatic-tech-ai/mural/framework"
import SettingsContributionKey from "@pragmatic-tech-ai/mural/framework"

// The Navigation region's service is provided by EditorShell itself: a base
// NavigationService whose destinations flatten from the modules listed below.
// No app-level `.services:` registration is needed — the shell supplies the
// default (an app wanting custom navigation would register its own against
// NavigationService.Key to override it).
Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        FileSystemService
        EnvironmentService
        // Live viewport (window) height, bindable + resize-reactive. The Problems
        // popup derives its 30% list cap from this.
        ViewportService
        // System clipboard seam for the Problems popup's copy-all + per-row copy.
        ClipboardService
        // Window title feed (active document → open project → "Plexus") as a
        // bindable Title DP; the mural header binds $service(TitleService).Title.
        // Eagerly resolved in main.js so document.title tracks from boot.
        TitleService
        // Background-work manager — root-registered so any service can submit work;
        // its status-bar dock binds $service(BackgroundWorkService). Eagerly
        // resolved in main.js.
        BackgroundWorkService
        // Storage backends, keyed by id; the Project Explorer resolves this to
        // build a project's rooted IStorage. Root singleton so every consumer
        // shares the same registration set.
        StorageProviderRegistry
        // Recent-projects MRU (persisted under userData) — the Open Project
        // dialog lists it; open/create push to it.
        RecentProjectsService
        // Open-projects set (persisted under userData) — the explorer updates it
        // on open/close and restores it at launch.
        OpenProjectsStore
        // Persistence backend for ApplicationSettings, bound to the framework's
        // SettingsStoreKey (a different token than the impl class itself).
        ElectronSettingsStore -> SettingsStoreKey
        // Settings contribution: supplies the framework's settings seam with the
        // rail gear icon (@Settings) + the settings view (SettingsPage). EditorShell
        // pins a footer RailAction wired to the framework SettingsLauncherService,
        // which presents CreateView() in the content region. Bound to the framework
        // token so the shell resolves it.
        PlexusSettingsContribution -> SettingsContributionKey
        // Diagram editor hub: owns the seeded diagram DOCUMENT (an IDocument).
        // Root-registered so the ToolBox panel and the startup opener (main.js)
        // resolve the SAME instance. It no longer holds a control — the canvas is
        // materialized by DataTemplate[DiagramDocument] in the content region.
        DiagramWorkspaceService
        // Layout pipeline inspector service — reachable shell-wide (the Inspector
        // region template and the canvas "Layout" menu resolve this instance).
        LayoutPipelineService
        // Content region host — a DocumentsContentHostService (TDI: open-set +
        // ActiveDocument + Close) bound to the framework's ContentHostService.Key.
        // The shell's content region, the tab strip, the settings launcher, and
        // main.js all resolve THIS instance through that key. Root-registered so
        // the root-scoped launcher reaches the same instance the shell uses
        // (otherwise EditorShell registers it shell-scoped, unreachable from root).
        // PlexusDocumentHost: the framework DocumentsContentHostService with its
        // user-initiated close commands routed through DocumentCloseGuard (dirty →
        // Save/Don't-Save/Cancel prompt). Bound to the framework's ContentHostService
        // key, so the tab strip, settings launcher, and main.js resolve THIS instance.
        PlexusDocumentHost -> ContentHostService
        // Right-dock region host — the tabbed panel service. Same root-scope
        // reason as the content host: main.js seeds the Chat tab (dock.Add(agent))
        // and routes inspectors here at startup, resolving this instance via
        // app.Services.get(PanelDockService.Key) from the ROOT. EditorShell
        // otherwise registers it shell-scoped — unreachable from root — so the
        // bootstrap gets undefined, no Chat tab is added, and the panel starts
        // collapsed. Root-registering makes EditorShell's has() guard share this
        // instance the shell region binds via $service(PanelDockService).
        PanelDockService
        // Project-type registry (module .projectFactories → factories). Same
        // root-scope reason as the content host: the generic ProjectExplorerService
        // is a module (root-scoped) service, so it must reach the registry from
        // root. EditorShell otherwise registers it shell-scoped — unreachable from
        // root — which silently breaks New/Open Project (getRequired throws before
        // any dialog shows). Registering here makes EditorShell's `has()` guard
        // skip its shell registration and share this one.
        ProjectFactoryRegistry
        // Document-type registry (module .documents → editors). Root-registered
        // for the same reason as ProjectFactoryRegistry: the root-scoped
        // ProjectExplorerService resolves a file's editor (by extension) through
        // it. Its constructor populates from module .documents: blocks.
        DocumentTypeRegistry
        ApplicationSettings
        // Code editor: opens files as Monaco-backed document tabs. Resolves the
        // content host + FileSystemService lazily, so registration order is free.
        CodeEditorService
        // Source-agnostic diagnostics store — the single sink the TODL validator
        // publishes to and the Problems dock + editor consume from.
        DiagnosticsService
        // Out-of-process TODL language client (replaces the in-renderer validator):
        // owns the LSP connection, the project source/base feed, diagnostics
        // routing, and the Monaco provider adapters.
        TodlLanguageClient
        // Local-first base resolution: a consuming project resolves a base from
        // an open sibling producer's live source instead of the published
        // registry. Eagerly resolved in main.js so its OpenProjects subscription
        // (dependent refresh on open/close) is live before session restore.
        WorkspaceBaseResolver
        // One live architecture model per open architecture project (keyed by
        // RootPath): composes the project's bases + .todl files via
        // ModelDraft.fromSources. Built lazily on first modelFor; its
        // OpenProjects subscription drops a model when its project closes.
        ArchitectureModelService
        // Observes opened documents and binds architecture-project diagrams to
        // their ArchModel (label sync + orphan removal); eagerly resolved in
        // main.js so its OpenDocuments subscription is live from boot.
        ArchDiagramBindingService
        // (ArchModelToolboxContributor retired — the ToolboxService now owns the
        // Model/Scenario pages via ModelToolboxPage/ScenarioToolboxPage.)
        // Popup for ambiguous term-drops: lists candidate (X,m) actions and
        // completes the drop with the chosen one. Mounted as a diagram-canvas
        // overlay (see DiagramResources); resolved on demand by the drop factory.
        DropCandidateChooserService
        // Shared "edit governing viewpoints" flow (pick → confirm removals →
        // re-scope) for the diagram toolbar command + explorer context menu.
        DiagramViewpointsEditor
        // Agent workspace tools: subscribes to the agent event stream and services
        // refresh_project (re-scan + re-validate + reply). Eagerly resolved in
        // main.js so it's listening before the first turn.
        WorkspaceRefreshService
        // External file-change watcher: watches open project roots and broadcasts
        // changes. Eagerly resolved in main.js so it listens from boot.
        FileWatchService
        // Reloads editor buffers on external change (prompts on dirty conflict).
        EditorReloadService
        // Re-scans + re-validates the owning project on external change (debounced).
        ProjectRescanService
        // Wiki: resolve a concept → its declaring open project's markdown page
        // (WikiLocator) and open it (WikiService.OpenWikiCommand, shared by the
        // four concept surfaces via the @OpenWikiMenu context menu).
        WikiLocator
        WikiService
        // ── Moved from the renderer bootstrap (main.js) ──────────────────────
        // Diagram persistence trio (camera zoom/pan, ruler guides, canvas page +
        // grid) — generic to every .diagram. Eagerly resolved in main.js so each
        // one's document + settings subscriptions are live from boot.
        DiagramCameraService
        DiagramGuidesService
        DiagramCanvasService
        // Document close guard: prompts Save / Don't Save / Cancel before a dirty
        // tab closes. PlexusDocumentHost (above) routes its user-initiated close
        // commands through this instance; eagerly resolved in main.js.
        DocumentCloseGuard
        // Autosave: periodically saves every dirty document (interval + on/off from
        // the "Documents" settings). Eagerly resolved in main.js so its timer starts
        // from boot.
        AutosaveService
        // Architecture-project contributions, alias-registered under the generic
        // framework/document extension keys: prompt for governing viewpoints when a
        // new .diagram is created (NewFileParticipant), the "Edit Viewpoints…"
        // toolbar command (DiagramCommandExtension), and the explorer node
        // context-menu action (NodeCommandContributor).
        ArchNewDiagramParticipant -> NewFileParticipantKey
        ArchEditViewpointsCommand -> DiagramCommandExtensionKey
        ArchNodeCommandContributor -> NodeCommandContributorKey
    }

    .modules: {
        DiagramModule
        DiagramExportModule
        ArchitectureProjectsModule
        ProjectExplorerModule
        MetaModelModule
        LibraryModule
        AgentChatModule
        ProblemsModule
        CodeEditorModule
        MarkdownViewerModule
        BackgroundWorkModule
        SaveModule
    }

    resources: {
        merge PlexusIcons

        // A vertical-stack items panel. A bare ItemsControl has no default
        // ItemsPanel in mural (unlike WPF), so without one it renders nothing —
        // the merged service dictionaries reference this as their ItemsPanel. Kept
        // here (not in a service folder) as a genuinely app-level shared helper.
        ItemsPanelTemplate x:key="VerticalStackPanel" {
            StackPanel [ Orientation = Vertical ]
        }

        // The status bar keeps the framework default @Surface chrome tone (with
        // the title bar + activity rail), so it is NOT restyled here — the side
        // pane, right dock, and document area are the @SurfaceContainer work
        // surfaces; the status bar is chrome.

        // Round the left side pane's corners (@ShapeSmall) to match the right
        // dock + document area. CornerRadius is a themeable DP on
        // ShellSideContentPane (mural 0.41.4, defaults to square); the framework
        // template binds it and clips the pane content to the rounded bounds.
        //
        // Template + Fill are re-declared DELIBERATELY: an app-level IMPLICIT
        // Style shadows the theme Style in Application.Resources, so mural's
        // Seal() resolves the implicit BasedOn to THIS style, trips the
        // self-reference guard, and inherits no Template — the pane would vanish.
        // Naming the framework Template (@DefaultShellSideContentPane) + the
        // @SurfaceContainer Fill here makes the style self-contained.
        Style [ TargetType = ShellSideContentPane ] {
            Template     = @DefaultShellSideContentPane;
            Fill         = @SurfaceContainer;
            CornerRadius = @ShapeSmall;
            // 1dp inset so the pane floats off the window/splitter edges (matches
            // the document area + right dock).
            Margin       = (1);
        }

        // Resize splitters between the panels: paint the resting divider with the
        // window chrome tone (@Surface) so it's visually invisible in the gap the
        // panel margins open up, while hover/drag still tint it to @Primary and
        // thicken (imperative chrome in splitter.ts). RestBrush is mural 0.43.0.
        // Self-contained (re-declares Template + PreviewBrush) so the app-level
        // implicit Style doesn't trip mural's Seal() self-reference guard and drop
        // the framework Template — same pattern as the ShellSideContentPane style.
        Style [ TargetType = Splitter ] {
            Template     = @DefaultSplitter;
            PreviewBrush = @Primary;
            RestBrush    = @Surface;
        }

        // VSCode-style scrollbars: hidden until the pointer is over the scroll
        // region (or it's actively scrolling), then fade in as an overlay (no
        // layout width). App-wide via an implicit Style; self-contained
        // (re-declares Template) to avoid mural's Seal() self-reference guard
        // dropping the framework Template. mural 0.44.0 hover-to-show.
        Style [ TargetType = ScrollViewer ] {
            Template             = @DefaultScrollViewer;
            IsAutoHideScrollBars = true;
        }

        // The mural-painted app title bar (@PlexusTitleBar), set as the shell's
        // HeaderContent below.
        merge PlexusTitleBar

        // Background-work status-bar dock (@BackgroundWorkDock) + task row + output
        // document templates.
        merge BackgroundWorkResources

        // Each service's view resources live with the service, merged app-global
        // here (see ./services/<service>/*.resources.mu).
        merge PanelsResources
        merge SettingsResources
        merge SavePromptResources
        merge DiagramExportPreviewResources

        // Diagram editor: icons + canvas/toolbar-tile/shapes templates. The shell
        // chrome (command toolbar, document tabs, Format-Shape inspector) is now
        // the framework EditorShell default, data-driven from the app's declared
        // commands + the active document — so no per-app shell template override.
        merge DiagramResources

        // Layout pipeline builder view (DataTemplate[LayoutInspector]).
        merge LayoutInspectorResources

        // Project Explorer tree + command bar (DataTemplate[ProjectExplorerService]).
        merge ProjectExplorerResources

        // Meta-models capability panel (DataTemplate[MetaModelsService] + rows).
        merge MetaModelResources

        // Libraries capability panel (DataTemplate[LibrariesPanelService] + rows).
        merge LibraryResources

        // Agent chat panel (DataTemplate[ChatSession] + transcript item templates).
        merge AgentChatResources

        // Conversations nav panel (DataTemplate[ChatSessionsService] + row templates).
        merge ConversationsResources

        // Problems dock (StatusBar DataTemplate[ProblemsService] + ProblemsRow rows).
        merge ProblemsResources

        // Drop-candidate chooser popup (DataTemplate[DropCandidateChooserService] +
        // ChooserRow rows), overlaid on the diagram canvas.
        merge ChooserResources

        // Diagram-viewpoints picker dialog (DataTemplate[ViewpointPickerModel] +
        // PickerRow checkbox rows), shown modally via DialogService at diagram
        // creation and when editing the diagram's governing viewpoints.
        merge ViewpointPickerResources

        // Code editor (DataTemplate[CodeDocument] declares a CodeEditor — a
        // DomHost subclass hosting Monaco, self-bound to the document's Content).
        merge CodeEditorResources

        // Rendered Markdown viewer (DataTemplate[MarkdownDocument] — a RichTextBlock
        // over the parsed FlowDocument). Opens .md/.markdown files read-only.
        merge MarkdownViewerResources

        // Shared "Open Wiki" context menu (@OpenWikiMenu), attached by the four
        // concept surfaces when their row's $HasWiki is true.
        merge WikiResources

        // Document tab strip override: ExtendedTabControl with a top-right
        // overflow dropdown (Close All + open-tabs list). Shadows the framework's
        // DocumentsContentHostService template from Application.Resources.
        merge DocumentTabsResources

        // Right-dock tab strip override: a title-only, close-less navigation strip.
        // Shadows the framework's DataTemplate[PanelDockService] from Application.Resources.
        merge DockTabsResources

        // The app root — the framework's default EditorShell. Regions are
        // data-driven (services + the active document); the one piece of app
        // chrome is the title bar, painted by mural into the Header region via
        // HeaderContent (the OS frame is hidden; see window/title-bar.resources.mu).
        EditorShell x:root [ HeaderContent = @PlexusTitleBar ] { }
    }
}

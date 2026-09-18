// app.mu — the TODL app composition root (Plexus architecture, ViewerShell).
//
// An `Application` block compiles to `export const app`. The root is the
// framework ViewerShell carrying a custom template (@TodlAppShell): a header, a
// left navigation rail built from the modules' capabilities, and a titled side
// panel that hosts the active capability's service (NavigationService.
// ActiveService), rendered by DataTemplate[ServiceType].
//
// This is the bare shell scaffold: one placeholder Home capability. Real
// capabilities are added as modules, each contributing a rail entry + a service
// + its DataTemplate.
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialDark from "@pragmatic-tech-ai/mural/resources/material"

// Shared registry client (window.todl bridge wrapper) — a root service.
import RegistryClient from "./services/registry/registry-client.ts"

// The shared window chrome — PragmaticWindowChrome (plexus-core) — owns the title
// bar strip, the menu-bar look, and TitleService. devUI supplies its brand mark +
// File-menu items (@WindowBrand / @WindowMenuItems) and a title source
// (DevUiTitleSource, registered under TitleSourceKey in .services: below so it is
// available before the header ControlTemplate resolves $service(TitleService)).
import PragmaticWindowChrome from "@pragmatic-tech-ai/plexus-core/renderer/modules/window-chrome"
import TitleSourceKey from "@pragmatic-tech-ai/plexus-core/renderer/modules/window-chrome"

// Shared storage — the Storage module (plexus-core) registers FileSystemService
// (native file system via window.api.fs) + StorageService (the universal storage
// front door, seeded with the local-FS provider). Resolved via StorageService.Key.
import Storage from "@pragmatic-tech-ai/plexus-core/renderer/modules/storage"
// Solution Studio (plexus-core) — the presentation-band host seams for the
// solution engine: the DialogService-backed prompt service + the StorageService
// storage-registry alias, bound to the SolutionManagerService keys. The engine
// services themselves are added imperatively in main.ts (SolutionServicesEngine).
import SolutionStudioModule from "@pragmatic-tech-ai/plexus-core/renderer/modules/solution-studio"
import DevUiTitleSource from "./window/devui-title-source.ts"
import DevUiWindowCommands from "./window/devui-window-commands.ts"
import DevUiWindowChrome from "./window/devui-window.resources.mu"

// Modules — each a `module NAME { … }` const contributing a rail capability.
import HomeModule from "./modules/home/home.module.mu"
import PackageManagerModule from "./modules/package-manager/package-manager.module.mu"
import PackageCompilerModule from "./modules/package-compiler/package-compiler.module.mu"
import ConnectionsManagerModule from "./modules/connections/connections.module.mu"

// Shell chrome (custom ViewerShell template) + shared icon dictionary + per-
// module view resources.
import AppShell from "./shell.resources.mu"
import AppIcons from "./app-icons.mu"
import HomeResources from "./modules/home/home.resources.mu"
import PackageManagerResources from "./modules/package-manager/package-manager.resources.mu"
import PackageCompilerResources from "./modules/package-compiler/package-compiler.resources.mu"
import ConnectionsResources from "./modules/connections/connections.resources.mu"

Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        RegistryClient
        // devUI's title feed (active capability → "TODL"), bound to the shared
        // TitleSourceKey so it is registered during app compose — before the header
        // ControlTemplate resolves $service(TitleService), whose ctor getRequired()s
        // the source. TitleService itself is registered by PragmaticWindowChrome.
        DevUiTitleSource -> TitleSourceKey
        // Commands for the title-bar File menu (@WindowMenuItems).
        DevUiWindowCommands
    }

    .modules: {
        // Shared storage: registers FileSystemService (native file system via
        // window.api.fs) + StorageService (universal front door, local-FS provider
        // seeded). Consumers resolve StorageService for rooted IStorage.
        Storage
        HomeModule
        PackageManagerModule
        PackageCompilerModule
        // Solution Studio (plexus-core): the Solution Explorer panel + rail
        // capability. Its engine seams come from SolutionStudioSeams.Register (main.ts)
        // + SolutionServicesRegistration; the engine itself from SolutionServicesEngine.
        // The module carries its own view resources (auto-merged on compose).
        SolutionStudioModule
        // The registry connections manager (create/edit/remove/test connections).
        ConnectionsManagerModule
        // Shared window chrome: registers TitleService + merges the title-bar
        // strip templates (@PragmaticTitleBar, the File-menu look, …).
        PragmaticWindowChrome
    }

    resources: {
        merge AppShell
        merge AppIcons
        merge HomeResources
        merge PackageManagerResources
        merge PackageCompilerResources
        merge ConnectionsResources
        // devUI's brand mark + File-menu items, filled into the shared strip.
        merge DevUiWindowChrome

        // Local Template value wins over the framework's default ViewerShell style,
        // so the shell renders the rail + side-panel layout above. The shared title
        // bar is mounted inside @TodlAppShell's header host (ViewerShell has no
        // HeaderContent DP — unlike EditorShell — so the template owns the header
        // content directly); the OS frame is hidden.
        ViewerShell x:root [ Template = @TodlAppShell ] { }
    }
}

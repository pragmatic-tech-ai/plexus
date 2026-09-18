// Renderer bootstrap — a thin entry (mural convention: bootstraps stay thin).
// `app` is the initialized Application compiled from app.mu; handing it an
// HtmlTarget mounts the ViewerShell (rail + side panel) into #app.
// @ts-expect-error compiled by vitePluginMural
import { app } from "./app.mu";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { NavigationService, ContentHostService, DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionServicesEngine } from "@pragmatic-tech-ai/todl";
import { SolutionStudioSeams } from "@pragmatic-tech-ai/plexus-core/renderer/modules/solution-studio";
import { SolutionServicesRegistration } from "./modules/solution/solution-services.js";
import { attachTitleBar, removeSplash, TitleService } from "@pragmatic-tech-ai/plexus-core/renderer/modules/window-chrome";

// ViewerShell (unlike EditorShell) does not register a NavigationService, so
// the app supplies one at the root. Registered under NavigationService.Key so
// the shell's `$service(NavigationService)` resolves up-chain to this single
// instance. Its factory flattens the modules' capabilities into the rail and
// auto-selects the first (PopulateFromModules), so the side panel opens showing
// content. Registered BEFORE initialize; the lazy factory runs when the rail
// first binds, by which point the modules are composed.
app.Services.register(NavigationService.Key, (p) => {
  const nav = new NavigationService(p);
  nav.PopulateFromModules();
  return nav;
});

// The shell's central content host — the region a capability drives via
// View(x). Registered at the root under ContentHostService.Key so the shell's
// `$service(ContentHostService)` and the capabilities resolve the same instance.
app.Services.register(ContentHostService.Key, (p) => new ContentHostService(p));

// The modal-dialog service — EditorShell auto-registers + hosts this, but this
// app runs a ViewerShell, so register it at the root (like the services above)
// and hand it the shell root as its overlay anchor after the tree mounts.
app.Services.register(DialogService.Key, (p) => new DialogService(p));

// The solution ENGINE — a plain Module (SolutionManagerService + settings
// registry), authored in .mu and exported as a composed module instance.
// ShellCompositionRoot routes a plain Module straight through to RegisterServices
// (it never enters app.Modules), so this registers the engine services into the
// root container. The generic host seams come from the SolutionServicesStudio
// module (in app.mu's .modules block); the app-specific ones from
// SolutionServicesRegistration below. Added before initialize so the manager
// resolves whenever it is first constructed.
app.AddModule(SolutionServicesEngine);

// The GENERIC engine host seams a Plexus shell supplies — the prompt service
// (over DialogService) + the storage-provider registry (aliasing StorageService).
// The Solution Studio module (in app.mu's .modules) owns the panel + capability.
SolutionStudioSeams.Register(app.Services);

// The APP-SPECIFIC seams the SolutionManagerService + the panel resolve by key —
// the project factory, the Domain package source, and the workspace host (folder
// pick / connections / member compile) — the host knowledge only this app has.
SolutionServicesRegistration.Register(app.Services);

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));

// SetHost after initialize so the shell root Visual (the dialog's overlay anchor)
// exists. DialogService owns no Visual; it reaches the overlay layer through this.
const shellRoot = app.Resources.Root;
if (shellRoot !== undefined) app.Services.get(DialogService.Key)?.SetHost(shellRoot);

// Custom frame (shared PragmaticWindowChrome): re-tint the native caption buttons
// (WCO) to the mural header's @Surface on every scheme change (+ tag <body> on mac).
// The title strip itself is painted by mural (ViewerShell header → @PragmaticTitleBar).
attachTitleBar(app);

// Title feed: construct TitleService now so its NavigationService subscription is
// live and document.title tracks from boot — even before the header view first
// binds $service(TitleService).Title.
app.Services.get(TitleService.Key);

// The shell chrome (title strip + @Surface) has mounted; drop the boot splash once
// the browser has flushed a real frame. Double-rAF: the first callback runs before
// paint, the second after — so we never reveal a blank frame between the splash
// fading and mural's first render.
requestAnimationFrame(() => requestAnimationFrame(() => removeSplash()));

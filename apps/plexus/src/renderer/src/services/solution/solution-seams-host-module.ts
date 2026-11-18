// A composition module that registers the SolutionManagerService host seams.
//
// WHY A MODULE (not imperative registration in main.js): mounting the shell
// resolves the services the chrome binds — the header's TitleService (whose
// PlexusTitleSource subscribes to ActiveSolutionMembers) and the Tool Box
// capability's ToolboxService — and BOTH resolve SolutionManagerService, whose
// ctor getRequired's its host seams. That resolution happens while app.mu's
// generated composition IIFE builds the EditorShell — i.e. at import time, BEFORE
// any line of main.js runs. So registering the seams in main.js is always too
// late: the manager is already being built, and its ctor throws "no
// SolutionStorageProviderRegistry". A ShellModule's RegisterServices runs
// synchronously when app.mu's .modules: block AddModule's it, which is before the
// EditorShell is built in that same IIFE — so the seams are in place in time.
//
// The seams: StorageRegistry + Prompt (SolutionSeams, over StorageService /
// DialogService), the durable session-bag store (DurableStoreRegistration), and
// the app-specific package source (RendererPackageSource). ProjectFactoryRegistry
// comes from TodlProjectSystemModule; SolutionManagerService.Key from
// SolutionServicesEngine — both already in .modules:.
import { ShellModule } from "@pragmatic-tech-ai/mural/framework/shell/module.js";
import { type IServiceContainer, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService } from "@pragmatic-tech-ai/todl";
import { SolutionSeams, DialogPromptService, DesktopPromptService } from "@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams";
import { FileSystemService } from "@pragmatic-tech-ai/plexus-core/renderer/modules/storage";
import { DurableStoreRegistration } from "@pragmatic-tech-ai/plexus-core/renderer/modules/bags";
import { RendererPackageSource } from "../projects/renderer-package-source.js";

class SolutionSeamsHost extends ShellModule
{
    private static readonly ModuleName = "SolutionSeamsHost";

    constructor()
    {
        super();
        this.set_property_value(ShellModule.NameKey, SolutionSeamsHost.ModuleName);
    }

    // The base reports registrations by counting AddRegistration() entries; this
    // module registers imperatively in RegisterServices instead (to reuse the
    // existing Register helpers, which alias already-composed singletons), so it
    // must advertise that it has services to register.
    public override get HasServiceRegistrations(): boolean
    {
        return true;
    }

    public override RegisterServices(container: IServiceContainer): void
    {
        // Engine host seams (PromptServiceKey, StorageRegistryKey over StorageService) —
        // alias already-composed singletons. The desktop host supplies DesktopPromptService
        // (native folder/file pickers over FileSystemService) as the prompt, so the engine's
        // Save-untitled / Save-As folder pick reaches a real OS dialog.
        SolutionSeams.Register(
            container,
            (p: IServiceProvider) => new DesktopPromptService(
                new DialogPromptService(p.getRequired(DialogService.Key)),
                p.getRequired(FileSystemService.Key)));
        // Durable application store + global bag persister (the manager ctor registers
        // its recent/last-solution session bag with DurableApplicationStoreKey).
        DurableStoreRegistration.Register(container);
        // App-specific package backend the composition engine loads members through.
        container.register(SolutionManagerService.PackageSourceKey, (p) => new RendererPackageSource(p));
    }
}

export const SolutionSeamsHostModule = new SolutionSeamsHost();

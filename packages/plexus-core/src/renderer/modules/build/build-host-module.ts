// A composition module that binds the renderer build seams (IBundler over IPC, the
// build storage provider, the package store) and registers the html-bundle system, so
// todl's BuildService runs Build/Publish in-renderer. Composes after
// TodlProjectSystemModule (registry seeded), Storage and SolutionServicesEngine.
import { ShellModule } from "@pragmatic-tech-ai/mural/framework/shell/module.js";
import { type IServiceContainer } from "@pragmatic-tech-ai/mural/runtime";
import { BuildComposition } from "./build-composition.js";

class BuildHost extends ShellModule
{
    private static readonly ModuleName = "BuildHost";

    constructor()
    {
        super();
        this.set_property_value(ShellModule.NameKey, BuildHost.ModuleName);
    }

    // Registers imperatively in RegisterServices, so it must advertise that it has services.
    public override get HasServiceRegistrations(): boolean
    {
        return true;
    }

    public override RegisterServices(container: IServiceContainer): void
    {
        BuildComposition.Compose(container);
    }
}

export const BuildHostModule = new BuildHost();
export default BuildHostModule;

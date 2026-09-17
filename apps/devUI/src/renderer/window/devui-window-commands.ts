import { ServiceBase, ServiceKey, RelayCommand, type ICommand, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

// Commands for devUI's title-bar File menu (@WindowMenuItems). devUI is a viewer
// with no document/file operations, so the menu carries the one genuinely useful
// dev action: reload the window. Kept as a service so the menu can bind it via
// $service(DevUiWindowCommands).ReloadCommand.
export class DevUiWindowCommands extends ServiceBase {
  public static readonly Key = new ServiceKey<DevUiWindowCommands>("DevUiWindowCommands");

  public readonly ReloadCommand: ICommand;

  constructor(provider: IServiceProvider) {
    super(provider);
    this.ReloadCommand = new RelayCommand(() => {
      if (typeof location !== "undefined") location.reload();
    });
  }
}

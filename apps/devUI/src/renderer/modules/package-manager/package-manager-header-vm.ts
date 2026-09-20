import { Observable, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";

// Commands for the Package Manager side panel — presented as a local ToolBar
// pinned atop the pane body (rendered by DataTemplate[PackageManagerHeaderVM],
// bound via the service's Commands property). A lightweight Observable so the
// affordances render through the template instead of Visuals built in code.
export class PackageManagerHeaderVM extends Observable
{
  readonly Refresh: ICommand;
  // Delete the selected published package. Kept as the concrete RelayCommand so
  // the service can pulse CanExecuteChanged when the selection changes; `canDelete`
  // gates it to package rows (undefined selection / non-package rows disable it).
  readonly Delete: RelayCommand;

  constructor(onRefresh: () => void, onDelete: () => void, canDelete: () => boolean)
  {
    super();
    this.Refresh = new RelayCommand(onRefresh, undefined, {
      Text: "Refresh",
      Description: "Reload the package list from the registry.",
    });
    this.Delete = new RelayCommand(onDelete, canDelete, {
      Text: "Delete",
      Description: "Delete the selected published package — all versions or a specific one.",
    });
  }

  /** Re-evaluate the Delete command's enabled state — the service calls this when
   *  the tree selection changes. */
  notifyDeletableChanged(): void
  {
    this.Delete.RaiseCanExecuteChanged();
  }
}

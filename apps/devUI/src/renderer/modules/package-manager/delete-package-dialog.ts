import { MuralBase, RelayCommand, ObservableCollection } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService, DialogAction, ButtonVariant } from "@pragmatic-tech-ai/mural/framework";

/** Whether to delete every published version of a package or just one. */
export enum DeleteScope
{
  // String values double as the RadioButtonGroup row labels the user reads.
  AllVersions = "All versions",
  SpecificVersion = "A specific version",
}

/** The user's delete choice; `version` is set only for `DeleteScope.SpecificVersion`. */
export interface DeleteChoice
{
  scope: DeleteScope;
  version?: string;
}

/** What the dialog needs to present: the package name plus its published versions
 *  and the latest dist-tag (used to preselect the version picker). */
export interface DeletePackageRequest
{
  name: string;
  versions: readonly string[];
  latest: string;
}

// The body VM of the Delete-package dialog: a scope RadioButtonGroup (all vs. a
// specific version) with a version ComboBox revealed only for the specific case.
// Extends MuralBase — DialogService.Content is typed `MuralBase | Visual`, so a
// template-rendered dialog body must be a MuralBase (the reserved case for the
// DP root); MuralBase is-a Observable, so plain getters + RaisePropertyChanged
// drive the bindings the same way a VM does.
export class DeletePackageDialogVM extends MuralBase
{
  readonly Name: string;
  readonly Versions = new ObservableCollection<string>();
  private _selectedScope: DeleteScope = DeleteScope.AllVersions;
  private _selectedVersion: string;

  constructor(request: DeletePackageRequest)
  {
    super();
    this.Name = request.name;
    for (const v of request.versions) this.Versions.Add(v);
    // Preselect the latest (falling back to the first) so a specific-version
    // delete never starts on an empty picker.
    this._selectedVersion = request.latest.length > 0 ? request.latest : (request.versions[0] ?? "");
  }

  get Scopes(): DeleteScope[] { return [DeleteScope.AllVersions, DeleteScope.SpecificVersion]; }
  get SelectedScope(): DeleteScope { return this._selectedScope; }
  set SelectedScope(v: DeleteScope)
  {
    const old = this._selectedScope;
    if (old === v) return;
    this._selectedScope = v;
    this.RaisePropertyChanged("SelectedScope", old, v);
    this.RaisePropertyChanged("IsSpecific", old === DeleteScope.SpecificVersion, v === DeleteScope.SpecificVersion);
  }
  /** True when a single version is being targeted — drives the picker's visibility. */
  get IsSpecific(): boolean { return this._selectedScope === DeleteScope.SpecificVersion; }

  get SelectedVersion(): string { return this._selectedVersion; }
  set SelectedVersion(v: string)
  {
    const old = this._selectedVersion;
    if (old === v) return;
    this._selectedVersion = v;
    this.RaisePropertyChanged("SelectedVersion", old, v);
  }

  /** The current selection as a result value (undefined when a specific version is
   *  chosen but none is selected — a guard against an empty picker). */
  choice(): DeleteChoice | undefined
  {
    if (this._selectedScope === DeleteScope.SpecificVersion)
    {
      if (this._selectedVersion.length === 0) return undefined;
      return { scope: DeleteScope.SpecificVersion, version: this._selectedVersion };
    }
    return { scope: DeleteScope.AllVersions };
  }
}

// Opens the modal and resolves to the user's DeleteChoice, or undefined if they
// cancel (or dismiss via the scrim / Escape). The "Delete" action IS the
// destructive confirmation — its warning caption and Filled styling stand in for
// a second yes/no step.
export class DeletePackageDialog
{
  static async show(dialogs: DialogService, request: DeletePackageRequest): Promise<DeleteChoice | undefined>
  {
    const vm = new DeletePackageDialogVM(request);
    const result = await dialogs.Show<DeleteChoice>({
      Title: `Delete ${request.name}`,
      Content: vm,
      Width: 420,
      Actions: [
        new DialogAction("Cancel", new RelayCommand(() => dialogs.Close(undefined))),
        new DialogAction("Delete", new RelayCommand(() => dialogs.Close(vm.choice())), ButtonVariant.Filled),
      ],
    });
    return result ?? undefined;
  }
}

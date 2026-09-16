import {
    type ICommand,
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
} from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, Setting, SettingKind } from '@pragmatic-tech-ai/mural/framework'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { FileSystemService } from '../file-system/file-system-service.js'

// View-models for the settings editor shown in the center content region (the
// VSCode-style Settings page). ApplicationSettings holds a flat list of live
// Settings; these VMs group them by Category and wrap each in a per-Kind row so
// a `DataTemplate [DataType = <Row>]` can pick the right editor (Switch, SpinEdit,
// TextBox, ComboBox, BrushPicker, path+Browse). Every editor binds TwoWay to
// `$Setting.Value` (a DP on the framework Setting), so edits write straight back
// through ApplicationSettings (and persist via its store).

// Base row — wraps one live Setting. `Setting`, `Label`, and `Description` are
// DPs so a row template can bind `$Setting.Value`, `$Label`, `$Description`: a
// `$path` binding's first segment MUST be a DP or it silently resolves to
// undefined (a plain getter would leave the label column blank). The subclass
// type is what selects the editor template.
export abstract class SettingRow extends MuralBase
{
    public static readonly SettingKey = MuralBase.RegisterProperty<Setting>(
        SettingRow, 'Setting', undefined as unknown as Setting, MetaData.None)
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        SettingRow, 'Label', '', MetaData.None)
    public static readonly DescriptionKey = MuralBase.RegisterProperty<string>(
        SettingRow, 'Description', '', MetaData.None)

    constructor(setting: Setting)
    {
        super()
        this.set_property_value(SettingRow.SettingKey, setting)
        // Snapshot the label column from the definition into DPs the template
        // binds (the definition's own fields aren't the row's DataContext).
        this.set_property_value(SettingRow.LabelKey, setting.Label)
        this.set_property_value(SettingRow.DescriptionKey, setting.Definition.Description)
    }

    public get Setting(): Setting { return this.get_property_value(SettingRow.SettingKey) }
    public get Label(): string       { return this.get_property_value(SettingRow.LabelKey) }
    public get Description(): string  { return this.get_property_value(SettingRow.DescriptionKey) }
}

// Boolean → Switch [ IsChecked = $Setting.Value ].
export class BooleanSettingRow extends SettingRow { }

// Number → SpinEdit [ Value = $Setting.Value, Minimum/Maximum from the definition ].
// Minimum/Maximum are DPs so the SpinEdit's `$Minimum`/`$Maximum` bindings resolve.
export class NumberSettingRow extends SettingRow
{
    public static readonly MinimumKey = MuralBase.RegisterProperty<number>(
        NumberSettingRow, 'Minimum', -Number.MAX_VALUE, MetaData.None)
    public static readonly MaximumKey = MuralBase.RegisterProperty<number>(
        NumberSettingRow, 'Maximum', Number.MAX_VALUE, MetaData.None)

    constructor(setting: Setting)
    {
        super(setting)
        this.set_property_value(NumberSettingRow.MinimumKey, setting.Definition.Min)
        this.set_property_value(NumberSettingRow.MaximumKey, setting.Definition.Max)
    }

    public get Minimum(): number { return this.get_property_value(NumberSettingRow.MinimumKey) }
    public get Maximum(): number { return this.get_property_value(NumberSettingRow.MaximumKey) }
}

// String → TextBox [ Text = $Setting.Value ].
export class StringSettingRow extends SettingRow { }

// Color → BrushPicker [ Brush = $Setting.Value ] (the value IS a SolidColorBrush,
// so it binds directly — no conversion).
export class ColorSettingRow extends SettingRow { }

// Choice → ComboBox [ ItemsSource = $Choices, SelectedItem = $Setting.Value ].
// Choices is a DP so the ComboBox's `$Choices` binding resolves.
export class ChoiceSettingRow extends SettingRow
{
    public static readonly ChoicesKey = MuralBase.RegisterProperty<ObservableCollection<string> | undefined>(
        ChoiceSettingRow, 'Choices', undefined, MetaData.None)

    constructor(setting: Setting)
    {
        super(setting)
        this.set_property_value(ChoiceSettingRow.ChoicesKey, setting.Definition.Choices)
    }

    public get Choices(): ObservableCollection<string> | undefined { return this.get_property_value(ChoiceSettingRow.ChoicesKey) }
}

// FilePath → TextBox [ Text = $Setting.Value ] + a Browse button that opens the
// native file dialog (via the injected FileSystemService) and writes the picked
// path back to the value.
export class FilePathSettingRow extends SettingRow
{
    public static readonly BrowseCommandKey = MuralBase.RegisterProperty<ICommand>(
        FilePathSettingRow, 'BrowseCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(setting: Setting, files: FileSystemService | undefined)
    {
        super(setting)
        this.set_property_value(FilePathSettingRow.BrowseCommandKey, new RelayCommand(() => {
            void files?.OpenFile({ Title: `Choose ${setting.Label}` }).then((opened) => {
                if (opened !== null && opened !== undefined) setting.Value = opened.Path
            })
        }))
    }

    public get BrowseCommand(): ICommand { return this.get_property_value(FilePathSettingRow.BrowseCommandKey) }
}

function createRow(setting: Setting, files: FileSystemService | undefined): SettingRow
{
    switch (setting.Kind)
    {
        case SettingKind.Boolean:  return new BooleanSettingRow(setting)
        case SettingKind.Number:   return new NumberSettingRow(setting)
        case SettingKind.Color:    return new ColorSettingRow(setting)
        case SettingKind.Choice:   return new ChoiceSettingRow(setting)
        case SettingKind.FilePath: return new FilePathSettingRow(setting, files)
        case SettingKind.String:
        default:                   return new StringSettingRow(setting)
    }
}

// One category section (grouping bucket) with its rows.
export class SettingsCategory extends MuralBase
{
    public static readonly NameKey = MuralBase.RegisterProperty<string>(
        SettingsCategory, 'Name', '', MetaData.None)
    public static readonly RowsKey = MuralBase.RegisterProperty<ObservableCollection<SettingRow>>(
        SettingsCategory, 'Rows', undefined as unknown as ObservableCollection<SettingRow>, MetaData.None)

    constructor(name: string)
    {
        super()
        this.set_property_value(SettingsCategory.NameKey, name)
        this.set_property_value(SettingsCategory.RowsKey, new ObservableCollection<SettingRow>())
    }

    public get Name(): string { return this.get_property_value(SettingsCategory.NameKey) }
    public get Rows(): ObservableCollection<SettingRow> { return this.get_property_value(SettingsCategory.RowsKey) }
}

// The settings page: every ApplicationSettings entry grouped into category
// sections (definition Category, or "General" when blank), preserving encounter
// order. Rendered by `DataTemplate [DataType = SettingsPage]` in the content host.
//
// Modeled as an IDocument so the framework SettingsLauncherService can open it
// into the editor's DocumentsContentHostService — settings shows as a closeable
// tab alongside diagrams, not a bespoke overlay. Its Id is constant ('settings')
// so re-opening the gear dedupes to the one page rather than stacking tabs.
// Never dirty (edits persist live through ApplicationSettings' store), so Save
// is a no-op.
export class SettingsPage extends MuralBase implements IDocument
{
    public static readonly CategoriesKey = MuralBase.RegisterProperty<ObservableCollection<SettingsCategory>>(
        SettingsPage, 'Categories', undefined as unknown as ObservableCollection<SettingsCategory>, MetaData.None)

    public readonly Id = 'settings'
    public readonly Title = 'Settings'
    public readonly IsDirty = false
    public Save(): void { /* settings persist live via ApplicationSettings' store */ }

    constructor(settings: ApplicationSettings, files?: FileSystemService)
    {
        super()
        const categories = new ObservableCollection<SettingsCategory>()
        const byName = new Map<string, SettingsCategory>()
        for (const setting of settings.Settings)
        {
            const name = setting.Definition.Category || 'General'
            let category = byName.get(name)
            if (category === undefined)
            {
                category = new SettingsCategory(name)
                byName.set(name, category)
                categories.Add(category)
            }
            category.Rows.Add(createRow(setting, files))
        }
        this.set_property_value(SettingsPage.CategoriesKey, categories)
    }

    public get Categories(): ObservableCollection<SettingsCategory> { return this.get_property_value(SettingsPage.CategoriesKey) }
}

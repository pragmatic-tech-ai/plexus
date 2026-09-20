import { SettingDefinition, SettingKind } from "@pragmatic-tech-ai/mural/framework";
import { SettingBagDefinition, SolutionSettingsRegistry } from "@pragmatic-tech-ai/todl";
import { CONNECTION_BAG_ID, CONNECTION_BAG_TITLE, CONNECTION_ID_KEY, CONNECTION_FIELDS } from "./connection-fields.js";

// The solution's cross-project CONNECTION assignment: which registry connection
// its members compile / compose / publish against. Stored as a single
// connection-ID reference (the connection's URL/scope/token live in the
// Connections manager). Persisted in solution.json via the SolutionSettingsRegistry.
export class ConnectionBag
{
  static readonly Id = CONNECTION_BAG_ID;
  static readonly ConnectionIdKey = CONNECTION_ID_KEY;

  static definition(): SettingBagDefinition
  {
    return new SettingBagDefinition(
      CONNECTION_BAG_ID,
      CONNECTION_BAG_TITLE,
      CONNECTION_FIELDS.map((f) => ConnectionBag.toDefinition(f.key, f.label)),
    );
  }

  static contribute(registry: SolutionSettingsRegistry): void
  {
    registry.Contribute(ConnectionBag.definition());
  }

  private static toDefinition(key: string, label: string): SettingDefinition
  {
    const d = new SettingDefinition();
    d.Key = key;
    d.Label = label;
    d.Category = CONNECTION_BAG_TITLE;
    d.Default = "";
    d.Kind = SettingKind.String;
    // Not rendered in a PropertyGrid — the Connections ComboBox in the pane drives
    // this value; the bag is purely the persistence vehicle (solution.json).
    return d;
  }
}

// Pure label builder for the solution's connection picker: unique display labels
// (disambiguating duplicate connection names with a numeric suffix) plus the
// label↔id maps. No Mural dependency, so it is unit-testable in isolation. A
// mural ComboBox renders string items (object items realize empty), so the picker
// binds these labels and maps the selection back to the stable connection id.

export interface ConnectionLike {
  id: string;
  name: string;
}

export class ConnectionLabels {
  readonly labels: readonly string[];
  private readonly labelToId = new Map<string, string>();
  private readonly idToLabel = new Map<string, string>();

  constructor(connections: readonly ConnectionLike[]) {
    const labels: string[] = [];
    const used = new Set<string>();
    for (const c of connections) {
      let label = c.name;
      for (let n = 2; used.has(label); n += 1) label = `${c.name} (${n})`;
      used.add(label);
      labels.push(label);
      this.labelToId.set(label, c.id);
      this.idToLabel.set(c.id, label);
    }
    this.labels = labels;
  }

  /** The display label for a connection id (undefined if unknown/omitted). */
  labelForId(id: string | undefined): string | undefined {
    return id === undefined ? undefined : this.idToLabel.get(id);
  }

  /** The connection id for a display label (undefined if unknown/omitted). */
  idForLabel(label: string | undefined): string | undefined {
    return label === undefined ? undefined : this.labelToId.get(label);
  }
}

// Pure field SPECS for the solution's connection setting bag — no Mural
// dependency, so this stays unit-testable in isolation.
// SECURITY: the bag stores only a connection-ID reference — never registry
// credentials. The connection itself (URL, scope, and its encrypted token) lives
// in the Connections manager; a solution just points at one by id.

export interface ConnectionFieldSpec
{
  key: string;
  label: string;
}

export const CONNECTION_BAG_ID = "solution-connection";
export const CONNECTION_BAG_TITLE = "Connection";
export const CONNECTION_ID_KEY = "connectionId";

export const CONNECTION_FIELDS: readonly ConnectionFieldSpec[] = [
  { key: CONNECTION_ID_KEY, label: "Connection" },
];

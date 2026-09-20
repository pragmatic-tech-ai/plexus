import { MCP_SERVER_KEY } from './agent-api.js'

// The structured model-patch wire contract shared across IPC (Skills #4). A running
// skill proposes an ordered list of ops; each maps 1:1 to an ArchModel mutator. The
// user previews + Accept/Reject; on Accept Plexus validates against the meta-model
// and applies undoably. See skills-subproject-4-spec.md §5.1.

export enum PatchOpKind
{
    CreateEntity = 'createEntity',
    SetField = 'setField',
    AddRef = 'addRef',
    RemoveRef = 'removeRef',
    RemoveEntity = 'removeEntity',
}

export interface CreateEntityOp { kind: PatchOpKind.CreateEntity; concept: string; id: string; homeUri?: string }
export interface SetFieldOp { kind: PatchOpKind.SetField; id: string; field: string; value: string }
export interface AddRefOp { kind: PatchOpKind.AddRef; from: string; member: string; to: string }
export interface RemoveRefOp { kind: PatchOpKind.RemoveRef; from: string; member: string; to: string }
export interface RemoveEntityOp { kind: PatchOpKind.RemoveEntity; id: string }
export type PatchOp = CreateEntityOp | SetFieldOp | AddRefOp | RemoveRefOp | RemoveEntityOp

export interface ModelPatch { summary?: string; ops: PatchOp[] }

export enum ModelPatchDecision { Accept = 'accept', Reject = 'reject' }

export interface ProposedModelPatchRequest { id: string; projectPath: string; patch: ModelPatch }
export interface ModelPatchAnswer { id: string; decision: ModelPatchDecision }

// Renderer → main IPC channel carrying the user's accept/reject decision.
export enum ModelPatchChannel { Resolve = 'model-patch:resolve' }

export const PROPOSE_MODEL_PATCH_TOOL_NAME = 'propose_model_patch'
export const PROPOSE_MODEL_PATCH_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${PROPOSE_MODEL_PATCH_TOOL_NAME}`

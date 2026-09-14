import { describe, it, expect } from 'vitest'
import { PatchOpKind, ModelPatchDecision, PROPOSE_MODEL_PATCH_TOOL_NAME, PROPOSE_MODEL_PATCH_TOOL_QUALIFIED } from '../model-patch-api.js'

describe('model-patch-api', () => {
    it('exposes the op kinds and decision enum as string enums', () => {
        expect(PatchOpKind.SetField).toBe('setField')
        expect(PatchOpKind.CreateEntity).toBe('createEntity')
        expect(ModelPatchDecision.Accept).toBe('accept')
    })
    it('qualifies the tool name under the plexus MCP server', () => {
        expect(PROPOSE_MODEL_PATCH_TOOL_NAME).toBe('propose_model_patch')
        expect(PROPOSE_MODEL_PATCH_TOOL_QUALIFIED).toBe(`mcp__plexus__${PROPOSE_MODEL_PATCH_TOOL_NAME}`)
    })
})

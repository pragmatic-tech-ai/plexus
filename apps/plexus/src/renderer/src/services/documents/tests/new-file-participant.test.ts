import { test, expect } from 'vitest'
import { NewFileParticipantKey, type INewFileParticipant } from '../new-file-participant.js'

test('the seam key is a ServiceKey and a participant satisfies the interface', () => {
    const p: INewFileParticipant = { OnCreated: async () => true }
    expect(NewFileParticipantKey.description).toBe('NewFileParticipant')
    expect(typeof p.OnCreated).toBe('function')
})

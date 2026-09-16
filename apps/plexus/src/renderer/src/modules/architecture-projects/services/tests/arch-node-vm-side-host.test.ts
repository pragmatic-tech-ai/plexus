import { test, expect } from 'vitest'
import { ArchNodeVM } from '../arch-node-vm.js'

// Post-container-owned-geometry: the side-endpoint host is the container Figure,
// NOT the content VM. ArchNodeVM is content + Id only — connector endpoints
// resolve to its container Figure (which carries GetSideSlot/Ports and the
// side-slot distribution). This pins that the VM itself is no longer a host, so
// nothing re-adds a duplicate registry to it. (Figure-host side-slot behavior is
// covered by mural's m4-vm-ports / side-connectable-optimize tests.)

test('ArchNodeVM is NOT a side-endpoint host (no GetSideSlot)', () => {
    const vm = new ArchNodeVM() as unknown as { GetSideSlot?: unknown; Ports?: unknown }
    expect(typeof vm.GetSideSlot).toBe('undefined')
    expect(vm.Ports).toBeUndefined()
})

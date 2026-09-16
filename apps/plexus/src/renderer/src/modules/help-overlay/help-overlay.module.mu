// help-overlay.module.mu — the Help capability: a lazy help-document store whose
// scenarios back the hover "?" overlay. The overlay behavior itself is attached
// to the shell root in main.js (attachHelpOverlay), mirroring the other
// attach* bootstrap wiring; this module contributes the store service.

import HelpDocumentStore from "./help-document-store.js"

module HelpOverlayModule [ Name = "Help" ] {
    .services: {
        HelpDocumentStore
    }
}

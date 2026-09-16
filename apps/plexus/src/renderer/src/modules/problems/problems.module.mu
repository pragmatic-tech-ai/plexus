// problems.module.mu — the Problems dock module.
//
// Registers the ProblemsService and contributes a StatusBar-region ShellControl
// that renders it via the keyed @ProblemsDock template (problems.resources.mu).
// The cell is always-visible and document-independent: the shell resolves the
// DataContext service via provider.get(token) in SyncStatusItems, regardless of
// the active document. DataContext must be the ServiceKey INSTANCE
// (ProblemsServiceKey), not the ProblemsService class — provider.get does no
// class→Key normalization, so a class token would miss and drop the control.

import ProblemsService from "./problems-service.js"
import ProblemsServiceKey from "./problems-service.js"

module ProblemsModule [ Name = "Problems" ] {
    .services: {
        ProblemsService
    }

    .ShellControls: {
        ShellControlDefinition
            [ Template    = @ProblemsDock,
              DataContext = ProblemsServiceKey,
              Region      = StatusBar ]
    }
}

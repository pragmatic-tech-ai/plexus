// Registers the BackgroundWorkService status-bar dock as a StatusBar ShellControl.
// DataContext must be the ServiceKey INSTANCE (BackgroundWorkServiceKey), not the
// class — provider.get does no class->Key normalization.

import BackgroundWorkService from "./services/background-work-service.js"
import BackgroundWorkServiceKey from "./services/background-work-service.js"

module BackgroundWorkModule [ Name = "Background Work" ] {
    .ShellControls: {
        ShellControlDefinition
            [ Template    = @BackgroundWorkDock,
              DataContext = BackgroundWorkServiceKey,
              Region      = StatusBar ]
    }
}

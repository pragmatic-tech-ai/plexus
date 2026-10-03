// Registers the BackgroundWorkService status-bar dock as a StatusBar ShellControl.
// DataContext must be the ServiceKey INSTANCE (BackgroundWorkServiceKey), not the
// class — provider.get does no class->Key normalization.

import BackgroundWorkService from "@pragmatic-tech-ai/plexus-core/renderer/modules/background-work"
import BackgroundWorkServiceKey from "@pragmatic-tech-ai/plexus-core/renderer/modules/background-work"

shell module BackgroundWorkModule [ Name = "Background Work" ] {
    .ShellControls: {
        ShellControlDefinition
            [ Template    = @BackgroundWorkDock,
              DataContext = BackgroundWorkServiceKey,
              Region      = StatusBar ]
    }
}

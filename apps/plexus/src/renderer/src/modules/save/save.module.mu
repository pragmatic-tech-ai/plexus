// save.module.mu — the Save capability's settings.
//
// A settings-only module: it contributes the two autosave SettingDefinitions to
// the app's ApplicationSettings (they auto-render in the Settings page under the
// "Documents" category). The behaviour that reads them — AutosaveService and
// DocumentCloseGuard — is registered and eagerly resolved in main.js (the same
// boot-observer pattern as DiagramCameraService/DiagramGuidesService), so it runs
// from launch without anyone resolving it.

module SaveModule [ Name = "Save" ] {
    .settings: {
        SettingDefinition
            [ Key         = "documents.autosave.enabled",
              Label       = "Autosave",
              Description = "Periodically save documents with unsaved changes.",
              Kind        = Boolean,
              Default     = true,
              Category    = "Documents" ]
        SettingDefinition
            [ Key         = "documents.autosave.intervalMinutes",
              Label       = "Autosave interval (minutes)",
              Description = "How often autosave runs, in minutes.",
              Kind        = Number,
              Default     = 5,
              Min         = 1,
              Max         = 120,
              Category    = "Documents" ]
    }
}

// account.module.mu -- the account area.
//
// Registers the AccountStatusItem (the StatusBar cell: "Sign in" or the signed-in email and
// tenant; it opens the account dialog on click and whenever some UI calls
// IAccountService.RequestSignIn) and contributes the "Platform address" setting the dialog
// reads to find which tenant an email belongs to. DataContext must be the ServiceKey INSTANCE
// (AccountStatusItemKey), not the class -- provider.get does no class->Key normalization.

import AccountStatusItem from "./account-status-item.js"
import AccountStatusItemKey from "./account-status-item.js"

shell module AccountModule [ Name = "Account" ] {
    .services: {
        AccountStatusItem
    }

    .ShellControls: {
        ShellControlDefinition
            [ Template    = @AccountStatusCell,
              DataContext = AccountStatusItemKey,
              Region      = StatusBar ]
    }

    .settings: {
        SettingDefinition
            [ Key         = "account.platformAddress",
              Label       = "Platform address",
              Description = "Where Plexus asks which tenant your email belongs to when you sign in.",
              Kind        = String,
              Default     = "http://localhost:7000",
              Category    = "Account" ]
    }
}

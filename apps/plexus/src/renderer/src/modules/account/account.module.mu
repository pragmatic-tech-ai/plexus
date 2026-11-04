// account.module.mu -- the account area.
//
// Registers the AccountStatusItem (the StatusBar cell: "Sign in" or the signed-in email and
// tenant; it opens the account dialog on click) and contributes the "Platform address" setting the dialog
// reads to find which tenant an email belongs to. IAccountService.RequestSignIn (a picker's
// Sign in) is answered by AccountDialogHost, which AccountSignInModule (account-sign-in-module.ts,
// listed next to this module in app.mu) builds at module load. DataContext must be the ServiceKey INSTANCE
// (AccountStatusItemKey), not the class -- provider.get does no class->Key normalization.

import AccountStatusItem from "./account-status-item.js"
import AccountStatusItemKey from "./account-status-item.js"

// The setting Key mirrors AccountDialogHost.PlatformAddressSetting (account-dialog-host.ts) and
// the Default mirrors PlatformAddress.Default (plexus-core shared/account-api.ts); change them
// together.

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

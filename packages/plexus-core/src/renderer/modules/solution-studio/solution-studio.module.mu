// Solution Studio — the solution capability as a shell module: a rail entry backed
// by SolutionExplorerService, which projects the active solution into the side panel
// via DataTemplate[SolutionExplorerService]. The module carries its own view
// resources (auto-merged app-global when composed), so a host only lists it in
// `.modules:`.
//
// The engine services (SolutionManagerService + settings registry) come from
// SolutionServicesEngine (@pragmatic-tech-ai/todl, added imperatively). The engine's
// generic host seams (prompt service, storage-provider registry) are registered by
// SolutionStudioSeams.Register — the storage alias can't be expressed in .mu, so it
// stays TS. The app supplies the ISolutionWorkspaceHost seam impl (folder pick,
// connections, member compile) + the package source + project-factory registry, and
// provides the @Solutions rail icon.
import SolutionExplorerService from "./solution-explorer-service.js"
import SolutionCommandsVM from "./solution-commands-vm.js"
import SolutionMemberNodeVM from "@pragmatic-tech-ai/todl"

shell module SolutionStudioModule [ Name = "Solutions" ] {
    .services: {
        SolutionExplorerService
    }

    Capability [
        Name       = "Solutions",
        Icon       = @Solutions,
        ServiceKey = SolutionExplorerService
    ]

    resources: {
        // Side panel body — a local command ToolBar pinned across the top (New/Open/
        // Save/Compose), the cross-project CONNECTION picker docked below it (shown
        // only when a solution is open), and the member/folder tree filling the rest.
        DataTemplate [DataType = SolutionExplorerService] {
            DockPanel [ LastChildFill = true ] {
                TextBlock [ DockPanel.Dock = Top, Text = $Title, FontWeight = Bold, Margin = (12,10,12,2) ]
                ContentControl [ DockPanel.Dock = Top, Content = $Commands, Margin = (8,4,8,4) ]
                TextBlock [ DockPanel.Dock = Top, Text = $ComposeStatus, Margin = (12,0,12,4), TextWrapping = Wrap, Visibility = $HasSolution << ToVisibility ]
                StackPanel [ DockPanel.Dock = Top, Orientation = Vertical, Margin = (8,4,8,6), Visibility = $HasSolution << ToVisibility ] {
                    TextBlock [ Text = "Connection", FontWeight = Bold, Margin = (4,2,4,4) ]
                    ComboBox [ ItemsSource = $Connections, SelectedItem = $SelectedConnection, HorizontalAlignment = Stretch ]
                }
                TreeView [ ItemsSource = $TreeRoots, ItemTemplate = @SolutionNodeTemplate ]
            }
        }

        // One tree row — a member root or a folder/file beneath it. Both node kinds
        // expose Title + Children, so a single recursive template covers every level.
        HierarchicalDataTemplate x:key="SolutionNodeTemplate" [DataType = SolutionMemberNodeVM, itemsselector = Children] {
            TextBlock [ Text = $Title, Margin = (4,0,4,0) ]
        }

        // The command ToolBar for the side pane.
        DataTemplate [DataType = SolutionCommandsVM] {
            ToolBar {
                ToolBarButton [ Command = $New,  Text = "New",  ShowText = true ]
                ToolBarButton [ Command = $Open, Text = "Open", ShowText = true ]
                ToolBarButton [ Command = $Save, Text = "Save", ShowText = true ]
                ToolBarButton [ Command = $Compose, Text = "Compose", ShowText = true ]
            }
        }
    }
}

// panels.resources.mu — view resources for the capability panel services
// (panel-services.ts). Merged app-global by app.mu (`merge PanelsResources`) so
// the shell's side pane resolves these implicit-by-type templates.
//
// @VerticalStackPanel is an app-level shared resource (defined in app.mu); it
// resolves at render time from the merged app resources.

import PlexusPanelService from "./panel-services.js"
import PanelSection from "./panel-services.js"

resources PanelsResources {

    // The left side pane's control template (referenced by the app-level
    // Style [ TargetType = ShellSideContentPane ] in app.mu). We supply our OWN
    // template rather than the framework's @DefaultShellSideContentPane so the pane
    // header carries a visible 1dp divider below its title — the same @OutlineVariant
    // header rule the document tab strip (@ExtendedTabControlTemplate) and the right
    // dock (@DockRailTemplate) draw, so all three work surfaces match. (This lives in
    // a standalone resource dictionary, not app.mu's inline resources: block, because
    // a ControlTemplate's x:name parts need an enclosing NameScope.)
    //
    // Structure mirrors mural's default pane: the capability body fills row 1
    // (PART_ContentHost), the header sits in row 0 with the title + optional command
    // area + the …/✕ actions over the divider. PART_ContentHost is declared FIRST
    // because ContentControl binds its Content to the first ContentPresenter in tree
    // order (so PART_Commands must follow it). `$$Prop` = TemplateBinding to the pane;
    // @CompactHeader{Menu,Icon}Button are the shared compact header-button chromes the
    // tab strip + dock reuse.
    Template x:key="PlexusSideContentPane" [ TargetType = ShellSideContentPane ] {
        Border [ Fill = @SurfaceContainer, CornerRadius = @ShapeSmall, ClipToBounds = true ] {
            Grid {
                RowDefinitions {
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Star ]
                }
                ContentPresenter x:name="PART_ContentHost" [ Grid.Row = 1 ]
                Border x:name="PART_Header" [ Grid.Row = 0, Padding = (12,8,8,8) ] {
                    DockPanel [ LastChildFill = true ] {
                        // A docked 1dp Border (not an oriented Line) is the reliable
                        // full-width rule here — the framework pane's own Line in this
                        // header context doesn't lay out. @Outline (vs the fainter
                        // @OutlineVariant) keeps it clearly visible against the pane fill.
                        Border [ DockPanel.Dock = Bottom, Height = 1, Fill = @Outline ]
                        StackPanel x:name="PART_HeaderBar"
                            [ DockPanel.Dock   = Right,
                              Orientation       = Horizontal,
                              VerticalAlignment = Center,
                              Margin            = (8,0,0,0) ] {
                            MenuButton x:name="PART_Overflow"
                                [ TriggerTemplate = @CompactHeaderMenuButton,
                                  Icon            = Shape [ Geometry = @MoreHoriz, Fill = @OnSurfaceVariant, Width = 12, Height = 12 ] ]
                            IconButton x:name="PART_Close"
                                [ Template          = @CompactHeaderIconButton,
                                  Command           = $$CloseCommand,
                                  VerticalAlignment = Center,
                                  Margin            = (4,0,0,0) ] {
                                Shape [ Geometry = @IconClose, Fill = @OnSurfaceVariant, Width = 12, Height = 12 ]
                            }
                        }
                        ContentPresenter x:name="PART_Commands"
                            [ DockPanel.Dock = Right, Content = $$Commands, VerticalAlignment = Center ]
                        TextBlock x:name="PART_Title"
                            [ Style             = @TitleSmall,
                              Text              = $$Header,
                              Foreground        = @OnSurfaceVariant,
                              VerticalAlignment = Center ]
                    }
                }
            }
        }
    }

    // Left-panel content for the active capability. The shell shows
    // NavigationService.ActiveService (resolved from the selected capability's
    // ServiceKey) in the side pane through this implicit-by-type template; the
    // base DataType matches every concrete PlexusPanelService subclass via the
    // resource-chain prototype walk. The pane header already shows the capability
    // name, so the body is just the section list.
    DataTemplate [ DataType = PlexusPanelService ] {
        ItemsControl [ ItemsSource = $Sections, ItemsPanel = @VerticalStackPanel, Margin = (12,12,12,12) ]
    }

    // One section row inside a panel.
    DataTemplate [ DataType = PanelSection ] {
        TextBlock [ Style = @BodyMedium, Text = $Label, Foreground = @OnSurfaceVariant, Margin = (0,3,0,3) ]
    }
}

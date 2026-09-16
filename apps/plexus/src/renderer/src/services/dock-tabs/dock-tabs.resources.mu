// dock-tabs.resources.mu — the Plexus right-dock panel switcher.
//
// Overrides the framework's DataTemplate[PanelDockService] (mural's plain
// TabControl) with a horizontal, TEXT-label navigation rail over the selected
// panel's body — a slim VSCode-style switcher rather than tabs. The rail is a
// Selector, so SelectedItem TwoWay-binds to SelectedPanel: clicking a label
// switches panels, and Add()/Close() re-select. No icons, no per-tab close;
// the selected destination carries a 2dp @Primary bottom accent (the same
// active-indicator the tab underline gave).
//
// Merged app-global by app.mu (`merge DockTabsResources`); it lives in
// Application.Resources so it shadows the framework theme's implicit
// DataTemplate[PanelDockService] (same mechanism as DocumentTabsResources).

resources DockTabsResources {

    // Horizontal, left-aligned destination row — vs the M3 rail's vertical
    // stack (@DefaultNavigationRailPanel) and the bar's even UniformGrid.
    ItemsPanelTemplate x:key="DockRailPanel" {
        StackPanel [ Orientation = Horizontal ]
    }

    // One dock destination: a text label ($Title, bound through the item's
    // DataContext — the IDockPanel) with a 2dp bottom accent that lights
    // @Primary when selected. No icon slot. Ink is @OnSurfaceVariant at rest,
    // @Primary when selected (matching the accent), @OnSurface on hover. The
    // NavigationRail wraps each panel into a NavigationItem whose DataContext is
    // the panel, so $Title resolves even though the panel also carries a
    // full-body DataTemplate (rendered below, not here).
    Template x:key="DockRailItemTemplate" [ TargetType = NavigationItem ] {
        Border x:name="PART_Outer" [ Fill = #00000000 ] {
            DockPanel {
                // 2dp selection accent at the very bottom edge (transparent at
                // rest, @Primary when selected). The label carries the former
                // Border padding as a margin so the rule stays flush to the edge.
                Line x:name="PART_Indicator"
                    [ DockPanel.Dock = Bottom,
                      Orientation    = Horizontal,
                      Stroke         = (#00000000, 2) ]
                TextBlock x:name="PART_Label"
                    [ Style             = @TitleSmall,
                      Text              = $Title,
                      Foreground        = @OnSurfaceVariant,
                      VerticalAlignment = Center,
                      Margin            = (12,8,12,8) ]
            }
        }
        when ( IsSelected ) {
            PART_Indicator.Stroke = (@Primary, 2);
            PART_Label.Foreground  = @Primary;
        }
        when ( IsMouseOver ) { PART_Label.Foreground = @OnSurface; }
    }

    // Keyed (not implicit-by-type) so only the dock rail adopts it — ordinary
    // NavigationItems keep the M3 icon+label row.
    Style x:key="DockRailItem" [ TargetType = NavigationItem ] {
        Template = @DockRailItemTemplate;
    }

    // Horizontal text-rail chrome — the destinations row over a 1dp bottom rule
    // (the strip divider). A VSCode-style header button bar is pinned rightmost:
    // an overflow menu (…) for future per-panel actions + a close (✕) that closes
    // the ACTIVE inspector (ClosePanelCommand with the SelectedPanel's Id — the
    // dock only renders while HasPanels, so a panel is always selected). No
    // Header / Footer slots (the dock has none).
    Template x:key="DockRailTemplate" [ TargetType = NavigationRail ] {
        Border x:name="PART_Border" [ Fill = @SurfaceContainer ] {
            DockPanel [ LastChildFill = true ] {
                Line [ DockPanel.Dock = Bottom,
                       Orientation    = Horizontal,
                       Stroke         = (@OutlineVariant, 1) ]
                StackPanel x:name="PART_HeaderBar"
                    [ DockPanel.Dock  = Right,
                      Orientation       = Horizontal,
                      VerticalAlignment = Center,
                      Margin            = (8,0,8,0) ] {
                    MenuButton x:name="PART_Overflow"
                        [ TriggerTemplate = @CompactHeaderMenuButton,
                          Icon            = Shape [ Geometry = @MoreHoriz, Fill = @OnSurfaceVariant, Width = 12, Height = 12 ] ]
                    IconButton x:name="PART_Close"
                        [ Template          = @CompactHeaderIconButton,
                          Command           = $service(PanelDockService).ClosePanelCommand,
                          CommandParameter  = $service(PanelDockService).SelectedPanel.Id,
                          VerticalAlignment = Center,
                          Margin            = (4,0,0,0) ] {
                        Shape [ Geometry = @IconClose, Fill = @OnSurfaceVariant, Width = 12, Height = 12 ]
                    }
                }
                ItemsPresenter x:name="PART_ItemsPresenter"
            }
        }
    }

    // Keyed dock-rail Style: swaps in the horizontal template + panel. mural's
    // Style.Seal() splices the theme NavigationRail style in as this style's
    // implicit BasedOn base, so these own setters override the vertical M3
    // Template / ItemsPanel while the rest of the base is inherited.
    Style x:key="DockRail" [ TargetType = NavigationRail ] {
        Template   = @DockRailTemplate;
        ItemsPanel = @DockRailPanel;
    }

    // Right-dock host: the horizontal text rail (panel switcher) docked over the
    // selected panel's body. The body is a ContentPresenter bound through a
    // SERVICE binding ($service(...).SelectedPanel), NOT a DataContext binding
    // ($SelectedPanel): a ContentPresenter re-points its OWN DataContext to
    // whatever it presents, so a $SelectedPanel source would be clobbered after
    // the first render and never update on the next switch (see the shell
    // template's ContentHostService note). ReuseContentViews caches each panel's
    // view so switching back restores it rather than rebuilding.
    DataTemplate [ DataType = PanelDockService ] {
        // Outer rounded container: @ShapeSmall corners + ClipToBounds so the rail
        // (top corners) and the panel body (bottom corners) clip to the rounded
        // silhouette, matching the left side pane and the document area. Fill is
        // @SurfaceContainer so the whole right dock reads as one surface.
        Border [ Fill = @SurfaceContainer, CornerRadius = @ShapeSmall, ClipToBounds = true, Margin = (1) ] {
            DockPanel [ LastChildFill = true ] {
                NavigationRail
                    [ DockPanel.Dock     = Top,
                      Style              = @DockRail,
                      ItemContainerStyle = @DockRailItem,
                      ItemsSource        = $Panels,
                      SelectedItem       = $SelectedPanel ]
                // Body painted @SurfaceContainer so the whole right dock (rail +
                // panel body) reads as one surface. The ContentPresenter itself is
                // transparent, so the fill lives on this wrapping Border.
                Border [ Fill = @SurfaceContainer ] {
                    ContentPresenter
                        [ Content           = $service(PanelDockService).SelectedPanel,
                          ReuseContentViews = true ]
                }
            }
        }
    }
}

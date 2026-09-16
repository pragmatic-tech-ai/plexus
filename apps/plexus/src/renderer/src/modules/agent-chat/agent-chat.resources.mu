// View resources for the Agent capability. DataTemplate[AgentService] renders
// the transcript (an ItemsControl over $Transcript) above an input row (a
// TextBox bound to $Draft + a Send button bound to $SendCommand). Item templates
// render each transcript Model by DataType. Merged app-global by app.mu.
// Render-through-templates rule: all chat chrome lives here, none in TS.

import ChatSession from "./services/chat-session.js"
import UserMessage from "./services/transcript.js"
import AssistantMessage from "./services/transcript.js"
import ErrorMessage from "./services/transcript.js"
import ToolActivity from "./services/transcript.js"
import QuestionCard from "./services/question-card.js"
import QuestionVM from "./services/question-card.js"
import OptionVM from "./services/question-card.js"
import NewProjectCard from "./services/new-project-card.js"
import ToolApprovalCard from "./services/approval-card.js"
import ModelPatchCard from "./services/model-patch-card.js"
import SessionRecoveryCard from "./services/session-recovery-card.js"
import ApprovalRuleRow from "./services/approval-rules.js"
import TemplateGalleryService from "./services/template-gallery-service.js"
import ContextItemVM from "./services/context-item.js"

resources AgentChatResources {
    DataTemplate [ DataType = ChatSession ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            resources: {
                // Enter-to-send. The single-line TextBox leaves Return unhandled,
                // so KeyDown bubbles to the input-row DockPanel (a descendant this
                // implicit style matches). The EventTrigger invokes SubmitCommand,
                // which sends only on Return and clears $Draft. A Style is the only
                // place `on <Event>` is allowed; DockPanel has no default style to
                // clobber and its local Dock/Margin attrs win over the (setter-less)
                // style.
                Style [ TargetType = DockPanel ] {
                    on KeyDown { InvokeCommand [ Command = $SubmitCommand ] }
                }
            }
            // (The workspace-shared "Approved tools" list moved out of the per-chat
            // panel to a single button in the Conversations panel — it's one list
            // scoped to the agent cwd, so it no longer belongs inside every chat.)
            // VSCode-style composer card pinned to the bottom: a rounded, outlined
            // container holding (top→bottom) the added-context chips, the multiline
            // input, and a footer with add-context + model picker on the left and the
            // send button on the right. Disabled ($CanInput = false) while a question
            // card awaits an answer. Enter-to-send: the TextBox uses SubmitsOnEnter so
            // a plain Return bubbles (no newline) to the enclosing DockPanel's
            // KeyDown → SubmitCommand trigger; Shift+Return inserts a newline.
            Border [ DockPanel.Dock = Bottom, Margin = (0,8,0,0),
                     Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
                     CornerRadius = 12, Padding = (10,8,10,8), ClipToBounds = true ] {
                DockPanel [ LastChildFill = true ] {
                    // Added-context chips — only present when the user has added any.
                    ItemsControl [ DockPanel.Dock = Top, ItemsSource = $ContextItems,
                                   ItemsPanel = @ComposerChipPanel, ItemTemplate = @ContextChipTemplate,
                                   Visibility = $HasContext << ToVisibility, Margin = (0,0,0,6) ]
                    // Footer. The send/stop button is docked FIRST so it reserves the
                    // right edge before the left items claim width — otherwise the
                    // model ComboBox (which stretches) eats the row in a narrow dock
                    // and pushes the button off the (clipped) edge.
                    DockPanel [ DockPanel.Dock = Bottom, LastChildFill = false, Margin = (0,8,0,0) ] {
                        // Send when idle; the same slot becomes Stop (interrupt the
                        // running turn) while a turn is in flight — one shows, the
                        // other collapses out of layout.
                        PanelButton [ DockPanel.Dock = Right, Command = $SendCommand, IsEnabled = $CanInput,
                                      Template = @ComposerIconButton, VerticalAlignment = Center,
                                      Visibility = $IsIdle << ToVisibility, Margin = (6,0,0,0) ] {
                            Shape [ Geometry = @ArrowUpward, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                        }
                        PanelButton [ DockPanel.Dock = Right, Command = $StopCommand, Template = @ComposerIconButton,
                                      VerticalAlignment = Center, Visibility = $IsBusy << ToVisibility, Margin = (6,0,0,0) ] {
                            Shape [ Geometry = @Stop, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                        }
                        PanelButton [ DockPanel.Dock = Left, Command = $AddContextCommand, Template = @ComposerIconButton,
                                      VerticalAlignment = Center, Margin = (0,6,0,0) ] {
                            Shape [ Geometry = @NewFolder, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                        }
                        ComboBox [ DockPanel.Dock = Right, ItemsSource = $Models, SelectedItem = $SelectedModel, MaxWidth = 100 ]
                    }
                    // The input fills the middle; grows with content up to a cap, then
                    // scrolls (auto-hide scrollbars are app-wide). The TextBox owns its
                    // own inner ScrollViewer + caret-into-view, so we cap its height
                    // directly rather than wrap it — a second ScrollViewer would give
                    // the inner one an unbounded viewport and defeat caret-follow.
                    TextBox [ Text = $Draft, IsEnabled = $CanInput, AcceptsReturn = true,
                              SubmitsOnEnter = true, TextWrapping = Wrap, MaxHeight = 320,
                              Placeholder = "Ask AI anything…", PlaceholderBrush = @OnSurfaceVariant ]
                }
            }
            // Scrolling transcript fills the rest. AutoScrollToEnd keeps the
            // latest message pinned to the bottom while the user is at the end
            // (sticky — scrolling up to read history is not interrupted).
            ScrollViewer [ HorizontalScrollEnabled = false, AutoScrollToEnd = true ] {
                ItemsControl [ ItemsSource = $Transcript, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    // Composer context chips wrap onto multiple rows as they accumulate.
    ItemsPanelTemplate x:key="ComposerChipPanel" {
        WrapPanel
    }

    // One added-context chip: a folder glyph + the basename + a ✕ that removes it
    // (RemoveCommand). v1 adds folders, so the folder glyph always fits.
    DataTemplate x:key="ContextChipTemplate" [ DataType = ContextItemVM ] {
        Border [ Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
                 CornerRadius = 4, Padding = (6,2,4,2), Margin = (0,0,4,4) ] {
            DockPanel [ LastChildFill = true ] {
                Shape [ DockPanel.Dock = Left, Geometry = @Folder, Fill = @OnSurfaceVariant,
                        Width = 12, Height = 12, VerticalAlignment = Center, Margin = (0,4,0,0) ]
                PanelButton [ DockPanel.Dock = Right, Command = $RemoveCommand, Margin = (4,0,0,0) ] {
                    Shape [ Geometry = @Close, Fill = @OnSurfaceVariant, Width = 10, Height = 10 ]
                }
                TextBlock [ Text = $Name, Style = @BodySmall, Foreground = @OnSurface,
                            VerticalAlignment = Center, Margin = (4,0,0,0) ]
            }
        }
    }

    // Compact icon-button chrome for the composer footer. The shell PanelButton
    // default template hardcodes a 40×40 border; here the chrome hugs its content
    // (the 16px icon) so send/stop read as small glyph buttons, not big circles.
    // Keeps the PART_Border / PART_StateLayer contract + hover/press state layers.
    Template x:key="ComposerIconButton" [ TargetType = PanelButton ] {
        Border x:name="PART_Border" [ Fill = #00000000, CornerRadius = @ShapeSmall ] {
            Border x:name="PART_StateLayer" [ Fill = #00000000, CornerRadius = @ShapeSmall, Padding = (4,4,4,4) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @OnSurfaceVariantHoverLayer; }
        when ( IsPressed ) { PART_StateLayer.Fill = @OnSurfaceVariantPressLayer; }
    }

    // ── Template Gallery (dev-only) ─────────────────────────────────────────────
    // Renders one of every transcript/tool card through the SAME implicit item
    // DataTemplates the chat uses, so the card visuals can be iterated on without
    // driving the agent (edit a template → compile:mu → reload). Seeded as a dock
    // tab in main.js only when IsDevelopment.
    DataTemplate [ DataType = TemplateGalleryService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            TextBlock [ DockPanel.Dock = Top, Style = @LabelSmall, Margin = (0,0,0,8),
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Text = "TEMPLATE GALLERY — dev preview of agent card templates" ]
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Cards, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    DataTemplate [ DataType = UserMessage ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 8,
                 Padding = (10,6,10,6), Margin = (40,3,0,3), ClipToBounds = true ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    // The agent writes markdown; $Document is the parsed FlowDocument and the
    // RichTextBlock lays it out with real formatting (headings, bold/italic,
    // inline + fenced code, lists, quotes, links). Foreground inherits to runs.
    DataTemplate [ DataType = AssistantMessage ] {
        Border [ Padding = (10,6,10,6), Margin = (0,3,40,3) ] {
            RichTextBlock [ Document = $Document, Foreground = @OnSurface ]
        }
    }

    // A failed turn: PLAIN text (not a markdown RichTextBlock — raw codes and
    // stack traces stay verbatim instead of being mangled), tinted @Error. Same
    // left-bubble geometry as the assistant message.
    DataTemplate [ DataType = ErrorMessage ] {
        Border [ Padding = (10,6,10,6), Margin = (0,3,40,3) ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @Error, TextWrapping = Wrap ]
        }
    }

    // Borderless header button — a full-width clickable row (name + description +
    // status) that toggles the tool card open/closed. Transparent with a neutral
    // hover/press state layer; content is left-aligned (not centred like a Button).
    Template x:key="ToolHeaderButton" [ TargetType = Button ] {
        Border x:name="PART_Border" [ Fill = #00000000, CornerRadius = 6 ] {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000, CornerRadius = 6, Padding = (6,4,6,4) ] {
                ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @StateHoverOverlay; }
        when ( IsPressed ) { PART_StateLayer.Fill = @StatePressOverlay; }
    }

    // Mono block used for both IN and OUT — a tinted, outlined box with the
    // command / output in a monospace face. ClipToBounds keeps a long
    // unbreakable token (a path, a hash) from spilling past the rounded corners.
    Style x:key="ToolMonoBox" [ TargetType = Border ] {
        Fill = @SurfaceContainerHigh;
        Stroke = Pen [ Brush = @OutlineVariant ];
        CornerRadius = 6;
        Padding = (8,6,8,6);
        ClipToBounds = true;
    }

    // The agent invoked a tool: a collapsible card. The header (name +
    // description + status) is always shown and toggles the body; the body holds
    // the IN (command / input) and OUT (captured result) mono blocks. Starts
    // collapsed — $IsCollapsed shows the ▸ caret, $IsExpanded reveals the body.
    DataTemplate [ DataType = ToolActivity ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 8,
                 Fill = @SurfaceContainerLow, Padding = (4), Margin = (0,3,20,3), ClipToBounds = true ] {
            StackPanel [ Orientation = Vertical ] {
                PanelButton [ Command = $ToggleCommand, Template = @ToolHeaderButton, HorizontalAlignment = Stretch ] {
                    DockPanel [ LastChildFill = true ] {
                        TextBlock [ DockPanel.Dock = Right, Style = @BodySmall, Text = $Status,
                                    Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (8,0,0,0) ]
                        TextBlock [ DockPanel.Dock = Left, Text = "▸", Visibility = $IsCollapsed << ToVisibility,
                                    Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                        TextBlock [ DockPanel.Dock = Left, Text = "▾", Visibility = $IsExpanded << ToVisibility,
                                    Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                        TextBlock [ DockPanel.Dock = Left, Style = @LabelLarge, Text = $Name,
                                    Foreground = @OnSurface, VerticalAlignment = Center ]
                        // Fill slot — clipped so a long description is cut at the
                        // status boundary instead of painting over "done".
                        Border [ ClipToBounds = true, Fill = #00000000,
                                 Visibility = $HasDescription << ToVisibility, Margin = (8,0,8,0) ] {
                            TextBlock [ Style = @BodySmall, Text = $Description,
                                        Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                        }
                    }
                }
                StackPanel [ Orientation = Vertical, Visibility = $IsExpanded << ToVisibility, Margin = (2,4,2,2) ] {
                    StackPanel [ Orientation = Vertical, Visibility = $HasCommand << ToVisibility ] {
                        TextBlock [ Style = @LabelSmall, Text = "IN", Foreground = @OnSurfaceVariant, Margin = (0,0,0,2), TextWrapping = Wrap ]
                        Border [ Style = @ToolMonoBox ] {
                            TextBlock [ Style = @BodySmall, FontFamily = "Consolas", Text = $Command,
                                        Foreground = @OnSurface, TextWrapping = Wrap ]
                        }
                    }
                    StackPanel [ Orientation = Vertical, Visibility = $HasOutput << ToVisibility, Margin = (0,6,0,0) ] {
                        TextBlock [ Style = @LabelSmall, Text = "OUT", Foreground = @OnSurfaceVariant, Margin = (0,0,0,2), TextWrapping = Wrap ]
                        Border [ Style = @ToolMonoBox ] {
                            TextBlock [ Style = @BodySmall, FontFamily = "Consolas", Text = $Output,
                                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
                        }
                    }
                }
            }
        }
    }

    // Compact filled button — a faithful copy of the framework's
    // DefaultFilledButton with a tighter state-layer padding (12,5 vs 24,10).
    // Padding lives inside the template (not a Button DP), so a smaller
    // Submit means its own template. Used by the card's Submit.
    Template x:key="CompactButton" [ TargetType = Button ] {
        Border x:name="PART_Border"
            [ Fill           = @Primary,
              CornerRadius         = $$CornerRadius,
              TextBlock.Foreground = @OnPrimary,
              TextBlock.FontFamily = @LabelLargeFont,
              TextBlock.FontWeight = @LabelLargeWeight,
              TextBlock.FontSize = @LabelLargeSize,
              TextBlock.LineHeight = @LabelLargeLineHeight,
              TextBlock.LetterSpacing = @LabelLargeTracking ] {
            Border x:name="PART_StateLayer"
                [ Fill   = #00000000,
                  CornerRadius = $$CornerRadius,
                  Padding      = (12,5,12,5) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @OnPrimaryHoverLayer; }
        when ( IsPressed ) { PART_StateLayer.Fill = @OnPrimaryPressLayer; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @DisabledContentOpacity; }
    }

    // ── AskUserQuestion card ────────────────────────────────────────────────────
    // The agent called ask_user_question: a bordered card of QuestionVMs. While
    // pending ($IsPending) it shows the questions + a Submit (enabled once every
    // question has a selection); after answering it collapses to a compact recap.
    DataTemplate [ DataType = QuestionCard ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 10,
                 Fill = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4), ClipToBounds = true ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Vertical, Visibility = $IsPending << ToVisibility ] {
                    ItemsControl [ ItemsSource = $Questions, ItemsPanel = @VerticalStackPanel ]
                    PanelButton [ Command = $SubmitCommand, IsEnabled = $IsSubmittable,
                             HorizontalAlignment = Right, Margin = (0,10,0,0), Template = @CompactButton ] {
                        TextBlock [ Text = "Submit", TextWrapping = Wrap ]
                    }
                }
                TextBlock [ Text = $AnswerSummary, Visibility = $IsAnswered << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // ── tool-approval card ──────────────────────────────────────────────────────
    // The agent asked to use a tool needing permission: tool + command, a button
    // row (Approve once / Always allow <prefix> / Deny) with a depleting countdown
    // ring at the right; on 10s expiry the card auto-approves once. Collapses to a
    // recap after answering.
    DataTemplate [ DataType = ToolApprovalCard ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 10,
                 Fill = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4), ClipToBounds = true ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Vertical, Visibility = $IsPending << ToVisibility ] {
                    TextBlock [ Text = $ToolName, Foreground = @OnSurface, Style = @BodyMedium, TextWrapping = Wrap ]
                    Border [ Style = @ToolMonoBox, Visibility = $HasCommand << ToVisibility, Margin = (0,6,0,0) ] {
                        TextBlock [ FontFamily = "Consolas", Text = $Command, Foreground = @OnSurface, TextWrapping = Wrap ]
                    }
                    // Buttons then the countdown ring, laid out left-to-right so the
                    // ring sits just right of Deny and stays inside the card border
                    // (a Right-docked ring overflowed the card's visible edge).
                    StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0) ] {
                        PanelButton [ Command = $ApproveOnceCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = "Approve once", TextWrapping = Wrap ]
                        }
                        PanelButton [ Command = $AllowAlwaysCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = $AllowAlwaysLabel, TextWrapping = Wrap ]
                        }
                        PanelButton [ Command = $DenyCommand, Template = @CompactButton, Margin = (0,0,8,0) ] {
                            TextBlock [ Text = "Deny", TextWrapping = Wrap ]
                        }
                        ProgressIndicator [ Variant = Circular, Value = $Countdown,
                                            Width = 12, Height = 12, VerticalAlignment = Center ]
                    }
                }
                TextBlock [ Text = $Recap, Visibility = $IsAnswered << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // A proposed model patch (Skills #4): summary + op list, Apply/Reject while
    // pending, an Undo affordance once applied, and validation problems inline.
    DataTemplate [ DataType = ModelPatchCard ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 10,
                 Fill = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4), ClipToBounds = true ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = $Summary, Foreground = @OnSurface, Style = @BodyMedium, TextWrapping = Wrap ]
                Border [ Style = @ToolMonoBox, Margin = (0,6,0,0) ] {
                    TextBlock [ FontFamily = "Consolas", Text = $OpText, Foreground = @OnSurface, TextWrapping = Wrap ]
                }
                TextBlock [ Text = $ProblemText, Visibility = $HasProblems << ToVisibility,
                            Foreground = @Error, TextWrapping = Wrap, Margin = (0,6,0,0) ]
                StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0), Visibility = $IsPending << ToVisibility ] {
                    PanelButton [ Command = $AcceptCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                        TextBlock [ Text = "Apply", TextWrapping = Wrap ]
                    }
                    PanelButton [ Command = $RejectCommand, Template = @CompactButton ] {
                        TextBlock [ Text = "Reject", TextWrapping = Wrap ]
                    }
                }
                StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0), Visibility = $IsApplied << ToVisibility ] {
                    TextBlock [ Text = "Applied", Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                    PanelButton [ Command = $UndoCommand, Template = @CompactButton ] {
                        TextBlock [ Text = "Undo", TextWrapping = Wrap ]
                    }
                }
                TextBlock [ Text = "Rejected", Visibility = $IsRejected << ToVisibility, Foreground = @OnSurfaceVariant ]
            }
        }
    }

    // ── session-recovery card ───────────────────────────────────────────────────
    // The CLI lost this conversation's session (AgentEventKind.SessionLost). While
    // pending, a warning message (tinted @Error like an error bubble) + two choices:
    // Start fresh (clears the conversation) or Continue (replay the stored transcript
    // to the agent as context). Collapses to a one-line summary after choosing.
    DataTemplate [ DataType = SessionRecoveryCard ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 10,
                 Fill = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4), ClipToBounds = true ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Vertical, Visibility = $IsPending << ToVisibility ] {
                    TextBlock [ Text = $Message, Foreground = @Error, Style = @BodyMedium, TextWrapping = Wrap ]
                    StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0) ] {
                        PanelButton [ Command = $StartFreshCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = "Start fresh", TextWrapping = Wrap ]
                        }
                        PanelButton [ Command = $ReplayCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = "Continue (replay history)", TextWrapping = Wrap ]
                        }
                    }
                }
                TextBlock [ Text = $Choice, Visibility = $IsDone << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // One approved-tool row: the rule label ("Bash: python" / "WebFetch") + Revoke.
    DataTemplate [ DataType = ApprovalRuleRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            PanelButton [ DockPanel.Dock = Right, Command = $RevokeCommand, Template = @CompactButton, Margin = (8,0,0,0) ] {
                TextBlock [ Text = "Revoke", TextWrapping = Wrap ]
            }
            TextBlock [ FontFamily = "Consolas", Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center, TextWrapping = Wrap ]
        }
    }

    // ── create_project card ─────────────────────────────────────────────────────
    // The agent called create_project: a bordered card hosting the reused New
    // Project form ($Form → DataTemplate[NewProjectDialogModel]) while pending;
    // after Create/Cancel it collapses to a one-line recap.
    DataTemplate [ DataType = NewProjectCard ] {
        Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 10,
                 Fill = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4), ClipToBounds = true ] {
            StackPanel [ Orientation = Vertical ] {
                ContentControl [ Content = $Form, Visibility = $IsPending << ToVisibility ]
                TextBlock [ Text = $ResultSummary, Visibility = $IsDone << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // One question: a header chip, the prompt, its selectable options, and an
    // "Other" toggle that enables a free-text box. Single-select questions get
    // a RadioButtonGroup (it owns mutual exclusion); multi-select gets the
    // independent-toggle list. Exactly one is visible per question.
    DataTemplate [ DataType = QuestionVM ] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,12) ] {
            Border [ HorizontalAlignment = Left, Fill = @SurfaceContainerHigh, CornerRadius = 4,
                     Padding = (6,1,6,1), Margin = (0,0,0,4) ] {
                TextBlock [ Style = @BodySmall, Text = $Header, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
            TextBlock [ Text = $Question, Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,0,0,6) ]
            // Single-select: labelled radio rows. SelectedItem two-ways back to
            // the VM's SelectedOption; each row hosts the OptionVM and renders
            // it through the DataTemplate[OptionVM] below.
            RadioButtonGroup [ ItemsSource = $Options, SelectedItem = $SelectedOption,
                               Visibility = $IsSingleSelect << ToVisibility ]
            // Multi-select: independent toggles (checkbox semantics). Both
            // lists include the trailing "Other" row (last option).
            ItemsControl [ ItemsSource = $Options, ItemsPanel = @VerticalStackPanel,
                           ItemTemplate = @OptionToggleTemplate,
                           Visibility = $IsMultiSelect << ToVisibility ]
            // Free-text editor — revealed only while the "Other" row is chosen.
            TextBox [ Text = $OtherText, Visibility = $IsOtherChosen << ToVisibility, Margin = (0,4,0,0) ]
        }
    }

    // One option's label + optional description. Implicit-by-DataType, so a
    // RadioButtonItem (single-select) slots it as its Content automatically.
    DataTemplate [ DataType = OptionVM ] {
        StackPanel [ Orientation = Vertical ] {
            TextBlock [ Text = $Label, Foreground = @OnSurface, TextWrapping = Wrap ]
            TextBlock [ Text = $Description, Visibility = $HasDescription << ToVisibility,
                        Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
        }
    }

    // Multi-select row: a real M3 Checkbox whose IsChecked binds the option's
    // IsSelected (TwoWay), with the label + description to its right. Submit
    // reads each option's IsSelected (question-card.ts SelectedLabels), so the
    // checked rows ARE the returned answer. x:key'd, so it's reachable only via
    // @OptionToggleTemplate and does NOT shadow the implicit OptionVM template
    // the single-select radio rows resolve. DockPanel/LastChildFill gives the
    // label column the remaining width so TextWrapping triggers.
    DataTemplate x:key="OptionToggleTemplate" [ DataType = OptionVM ] {
        DockPanel [ LastChildFill = true, Margin = (0,4,0,0) ] {
            Checkbox [ DockPanel.Dock = Left, IsChecked = $IsSelected,
                       VerticalAlignment = Top, Margin = (0,2,8,0) ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = $Label, Foreground = @OnSurface, TextWrapping = Wrap ]
                TextBlock [ Text = $Description, Visibility = $HasDescription << ToVisibility,
                            Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }
}

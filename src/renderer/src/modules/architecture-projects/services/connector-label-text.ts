import { Connector, flowDocumentFromPlainText } from '@pragmatic-tech-ai/mural/framework'

// Restores multiline connector captions.
//
// A connector label's text round-trips as PLAIN string content (its model `type`
// field, then Connector.LabelText on reopen). But the label's TextBlock renders plain
// Content as a SINGLE line — it collapses `\n` — so a caption the user typed across
// several lines comes back on one line after a reload. In-session it looked right only
// because the editor keeps a paragraph-per-line FlowDocument on commit (ShapeText
// CommitEdit); that Document is never serialized for a model-derived connector.
//
// Rebuild that Document from the restored text so the line breaks survive a reopen.
// Single-line captions keep the plain-Content path untouched (no Document).
export class ConnectorLabelText
{
    public static rebuildMultiline(c: Connector, label: string): void
    {
        if (label.includes('\n'))
            c.Text.Document = flowDocumentFromPlainText(label, c.Text.TextAlignment)
    }
}

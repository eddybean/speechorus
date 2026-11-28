# D-17 A multi-piece paste appends its first piece to the current line

- **Status**: Accepted (2026-11-26)
- **Code**: `src/features/script/`, `src/lib/text.ts`

## Context

Pasted text is split into lines at 。 and newlines. Something has to happen to the first piece when the cursor is in a
line that already has text.

## Decision

The first piece goes into the current line at the cursor; the rest become new lines below it. In an empty line the
first piece simply fills it.

## Consequences

Pasting in the middle or at the end of a line also attaches the first sentence to that line. This is on purpose; do
not "fix" it into always creating new lines.

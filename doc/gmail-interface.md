# Cloudmail component comparison

Compared the signed-in Gmail web interface in Chrome on November 20, 2026. The reference account had a photo theme. Cloudmail uses its light and dark palettes. Browser interaction checks use a fictional mailbox.

| Component | Compare in the rendered interface |
| --- | --- |
| Header and search | Navigation toggle, search field resting and focused, clear and search options, account and settings controls |
| Folder navigation | Compose, primary mailboxes, More and Less, selected pill, unread and draft counts, collapsed rail, mobile drawer |
| Mailbox toolbar | Selection menu, refresh, page range, previous and next, contextual bulk actions |
| Message and draft rows | Sender width, unread weight, subject and snippet truncation, draft marker, date replaced by actions on hover or keyboard focus |
| Message reader | Compact toolbar, subject, message headers, recipient details, per-message menu, collapsed history, reply buttons |
| Compose window and replies | Docked, minimized, expanded and inline states, recipient chips, subject, editing area, save and close |
| Formatting and links | Footer toggle, formatting groups, active formats, link text and URL, Apply, editing and removing links, keyboard shortcuts |
| Filing and feedback | Move to Trash from each entry point, Undo, retained permanent-delete confirmation, archive and snooze |
| Menus and dialogs | Anchoring, shadow, typography, hover and selected states, focus return, Escape and outside dismissal |
| Motion and responsive layout | Panel transitions, reduced motion, touch targets, focus visibility and overflow at narrow widths |

References include [Gmail formatting and links](https://support.google.com/mail/answer/8260), [deleting and recovering messages](https://support.google.com/mail/answer/7401), and [organizing mail with labels](https://support.google.com/mail/answer/118708).

## Verification notes

| Area | What was checked |
| --- | --- |
| Trash | Compared the live filter order, toolbar, retention notice, sender icon, spacing and page controls. Tested sender and attachment filters, search, hover actions, tooltips, mobile layout and permanent-delete cancellation. |
| Drafts and reading | Opened a marked inbox thread containing two cloud replies. Switched between them, refreshed, edited and reopened an attached draft. Confirmed that viewing it alone made no draft changes. |
| Writing | Compared the live docked composer and its bottom formatting strip. Checked font, size, text color, selection, formatted links, keyboard link insertion, removing a link, an inline image and reopening a saved draft. |
| Filing | Tested moving mail to Trash and undoing it from a message, conversation, row and bulk selection. Created and applied a label from a selection and from an open thread. |
| Keyboard and search | Checked focus entering and leaving the search and label popovers, the effect of typing before opening search options, and keyboard access to row actions. |

The Gmail account’s photo background, inbox category tabs and Google Workspace side panel are visible differences. The comparison covered the web mail workflows above. It is a behavioral and visual review rather than a pixel-by-pixel certification of all Gmail screens.

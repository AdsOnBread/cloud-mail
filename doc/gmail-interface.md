# Cloudmail component comparison

Compared the signed-in Gmail web interface on November 20, 2026. The reference account used a photo theme. Theme and navigation checks include desktop and narrow layouts. Browser interaction checks use a fictional mailbox.

| Component | Compare in the rendered interface |
| --- | --- |
| Header and search | Navigation toggle, search field resting and focused, clear and search options, account and settings controls |
| Folder navigation | Compose, primary mailboxes, More and Less, selected pill, unread and draft counts, collapsed rail, mobile drawer |
| Mailbox toolbar | Selection menu, refresh, page range, previous and next, contextual bulk actions |
| Message and draft rows | Sender width, unread weight, subject and snippet truncation, draft marker, date replaced by actions on hover or keyboard focus |
| Mailbox attachments | Filename chips in Default density, a paperclip in denser views, image, text and paged PDF previews, keyboard dismissal and downloads |
| Scheduled mailbox | Folder count, scoped search, delivery notice, selection, paging, recipient details, delivery time and Cancel send |
| Message reader | Compact toolbar, subject, message headers, recipient details, per-message menu, collapsed history, reply buttons |
| Compose More options | Checked Gmail’s order, checkmarks, row height, divider and menu width for Default to full screen, Plain text mode and Print. Cloudmail also preserves the selected format through draft reopening and scheduled delivery. Gmail’s Help me schedule entry remains a difference. |
| Spell check | Compared Gmail’s highlighted words, correction and Ignore menu, Recheck bar, language selector and close control. Cloudmail checks spelling locally with 30 dictionaries. The language list and suggestions differ from Gmail’s service. |
| Plain-text formatting | Compared the formatting bar in a plain-text Gmail draft. Opening the bar keeps the current mode. Choosing a format switches the draft to rich text, briefly shows the mode in the compose title and applies the command to the selection. |
| Send prompts | Measured Gmail’s 280 × 180 px missing-recipient dialog, 28 px corners and 24 px heading. Cloudmail accepts mail addressed exclusively in Cc or Bcc, allows subject-only and attachment-only messages, and asks for confirmation when a message has no subject, body or attachments. The missing-attachment reminder quotes the phrase from the new message, supports Cancel and Send anyway, and skips signatures and quoted history. |
| Compose labels | Compared the Label submenu in signed-in Gmail. It opens beside More options with a focused search field, 32 px checkbox rows, Add star, Create new and Manage labels. Cloudmail keeps filing choices with saved and scheduled drafts and applies them to the sender’s copy on delivery. |
| Compose window and replies | Compared the subject caption while typing, after leaving the subject and while minimized. Measured the minimized Gmail window at 328 × 40 px. Checked compact recipient summaries, To/Cc/Bcc contact buttons, keyboard shortcuts from the subject and message body, and reopening a saved draft. Checked that restoring a minimized message keeps the insertion point and reopening a saved message resumes after its existing text. |
| Inline photo options | Measured the Small, Best fit, Original size, Edit alt text and Remove bar and the 560 × 278 px alt-text dialog in signed-in Gmail. A 960 × 480 sample became 198 × 99 or 495 × 248 in docked compose, and 206 × 103 or 515 × 258 in expanded compose. Cloudmail keeps the chosen display size with the draft and sent HTML. |
| Insert Photo and file drops | Compared the signed-in Gmail photo picker’s source navigation and 990 × 612 px desktop frame. Cloudmail supports local uploads and image URLs, direct clipboard images, inline image drops and regular attachments. Google Photos library access remains a difference. Checked the saved insertion point, mixed-file drops, draft reopening and narrow screens. |
| Compose emoji | Measured Gmail’s 370 × 340 px picker, focused search, ten category tabs, 40 px emoji buttons and empty search message. Checked keyboard and pointer selection, recent emoji after reload, skin tones, formatting, undo, draft reopening and phone layout in Cloudmail. |
| Formatting and links | Compared Gmail’s eleven font families, four size previews, alignment menu, overflow actions, shortcut hints, and two eight-by-eight color grids. Verified editing a selected word without changing its neighbors, typing immediately after applying a format by keyboard, Escape and Tab focus, saved draft reopening, and narrow-screen overflow. Cloudmail retains its table, HTML, and preview tools in the overflow menu. |
| Importance | Outline and filled markers, reason on hover, keyboard toggle, selection menu and Important folder |
| Nested labels | Add sublabel, Nest label under, branch disclosure controls, full paths in filing menus, inbox chips and the reader |
| Label settings | Compared Gmail’s Settings → Labels system and custom label tables. System folder visibility is saved per owner. Custom labels can be created, renamed, nested, removed or hidden from either the sidebar or message list. Category visibility is covered below. IMAP visibility controls remain a difference. |
| Label visibility | Independent sidebar and message-list settings, Show if unread, unread conversation badges and the separate More control for labels |
| Category labels | Compared the Categories table in Gmail Settings → Labels. Purchases has one sidebar control. Social, Updates, Forums and Promotions each have separate sidebar and message-list controls. Hidden folders are available under More. Category folders include archived conversations and work independently of Inbox tabs. |
| Label colors | Sidebar options, six-column palette, custom background and text, recent pairs and removing a color |
| Filing and feedback | Move to Trash from each entry point, Undo, retained permanent-delete confirmation, archive and snooze |
| Menus and dialogs | Anchoring, shadow, typography, hover and selected states, focus return, Escape and outside dismissal |
| Motion and responsive layout | Panel transitions, reduced motion, touch targets, focus visibility and overflow at narrow widths |

References include [a screenshot of Gmail’s missing-attachment confirmation](https://hci.stanford.edu/courses/cs147/2022/wi/lectures/12-heuristic-evaluation.pdf), [Gmail attachment reminder phrases](https://www.labnol.org/internet/gmail-attachment-reminder/31959), [Gmail formatting and links](https://support.google.com/mail/answer/8260), [deleting and recovering messages](https://support.google.com/mail/answer/7401), and [organizing mail with labels](https://support.google.com/mail/answer/118708).

## Verification notes

| Area | What was checked |
| --- | --- |
| Trash | Compared the live filter order, toolbar, retention notice, sender icon, spacing and page controls. Tested sender and attachment filters, search, hover actions, tooltips, mobile layout and permanent-delete cancellation. |
| Mailbox attachments | Checked files on earlier replies, unread state after preview, keyboard focus return, download contents, PDF page switching and row height in desktop and mobile layouts. |
| Drafts and reading | Opened a marked inbox thread containing two cloud replies. Switched between them, refreshed, edited and reopened an attached draft. Confirmed that viewing it alone made no draft changes. |
| Signatures | Compared the compose pen, Manage signatures, the checked No signature row, and the Name new signature dialog with Gmail. Cloudmail stores named formatted signatures and separate sender defaults for new messages and replies/forwards. |
| Link popups | Compared the live Gmail insert form and existing-link preview. Checked pointer and keyboard opening, placement next to the text, first-field focus, Change, Remove, Escape, and mobile width. |
| Writing | Compared the live docked composer and its bottom formatting strip. Checked font, size, text color, selection, formatted links, keyboard link insertion, removing a link, an inline image and reopening a saved draft. |
| Nested labels | Compared the New label dialog and preselected parent with Gmail. Checked a three-level branch, moving and renaming its parent, keyboard expansion, collapse after reload, and independent message assignments. Removing a parent in Cloudmail keeps its descendants and their message assignments. |
| Label visibility | Compared the order and wording of both groups against signed-in Gmail. Checked read and unread transitions, alias switching, refresh after a change from another session, focus after hiding a label, and the full menu at 667 × 375. |
| Label colors | Compared the 24 Gmail presets in order and the custom color dialog. Checked hover, keyboard selection, compact navigation, mobile touch targets, rename, reload, recent colors and the same color on the inbox chip and conversation heading. |
| Trash and Scheduled date filters | Compared Gmail’s Any time menu, four Older than presets, custom range, calendar selection and applied chip. Active chips move to the front of the filter row. The range accepts either endpoint and includes the full final day in the browser’s time zone. |
| From and To filters | Compared Gmail’s focused Name or email field, selected-address tokens, compact +1 caption and 300 px contact list with 64 px rows and 40 px avatars. Cloudmail suggests people from the current folder and mailbox and accepts a typed name or pasted email address. Full addresses match exactly. Selecting multiple people matches any of them within that field. |
| Trash recovery | Compared Gmail’s selected-message toolbar and searchable Move to menu. Cloudmail offers Inbox and user labels, read and unread actions, and Restore to previous location. Create new and Manage labels are available inside the move menu. Gmail also offers Spam. |
| Filing | Tested moving mail to Trash and undoing it from a message, conversation, row and bulk selection. Created and applied a label from a selection and from an open thread. |
| Advanced search | Measured Gmail’s 722 px panel, 24 px inset, 40 px field spacing and 258 × 313 px calendar. Both Cloudmail entry points open at the search bar. Checked folder and label scope, searching saved draft bodies, retaining entered criteria, and centered date windows over a daylight-saving change and leap day. Gmail’s size, excluded-word and filter-creation controls remain differences. |
| Keyboard and search | Checked focus entering and leaving the search and label popovers, the effect of typing before opening search options, and keyboard access to row actions. |
| Quick settings and themes | Compared Gmail’s View all gallery, color and photo tiles, My photos, Cancel and Save. On Cloudmail, tested an included photo, a custom photo saved on this device, color choices, cancellation, reload and stacked mobile dialogs. |
| Collapsed navigation | Checked expansion on hover, folder names, pointer departure and the position of the mailbox under the open rail. |
| Move to | Moved a selection to a label, opened the conversation there and moved it back to Inbox. |
| Importance | Checked marking with Space, reload, folder membership, changing a mark in the reader, bulk marking and clearing, and separate touch targets for the star and marker. A sent reply marks a conversation automatically until the mailbox owner makes an explicit choice. |
| Schedule and snooze calendars | Compared Gmail’s month grid, month arrows, and separate date and time fields against published Gmail screenshots. Verified month-end navigation, exact local delivery time, daylight-saving gaps, cancellation and narrow-screen layout using a fictional mailbox. |
| Scheduled send | Compared Gmail’s Send dropdown and recipient validation. In Cloudmail, chose a custom time, checked the timezone and past-date validation, downloaded an attached file from Scheduled and canceled back to an editable draft. Delivery and interruption tests used fictional mailboxes. |

Calendar references include the New Mexico Judiciary’s [Gmail scheduling walkthrough](https://supremecourt.nmcourts.gov/wp-content/uploads/sites/52/2024/02/Google-presentation-v-3-presented-7-31-2020.pdf).

Cloudmail offers its own photos and supports choosing a personal image. Cloudmail uses sender and subject rules plus manual filing for category placement. Gmail uses a different classification service. The Google Workspace side panel remains a visible difference. The comparison covered the web mail workflows above. It is a behavioral and visual review rather than a pixel-by-pixel certification of all Gmail screens.


The inbox comparison covered Primary, Promotions, Social, Updates and Forums, the active underline, unread counts and keyboard switching. Checked manual filing from search and from a tab, returning from the reader, paging and the single-inbox setting. Cloudmail’s tab badges count unread conversations.

Scheduled rows and their message reader support stars and importance. Starred and Important show matching queued messages in a Scheduled section. Canceling keeps the choices with the draft. Delivery applies them to the sender’s copy. Messages addressed directly to the sending mailbox and replies can show automatic importance, with an explicit choice taking precedence.

The bundled photographs come from NASA’s public image library. [Orbital sunset](https://images.nasa.gov/details/iss067e124176) · [Aurora, photographed by Terry Virts](https://images.nasa.gov/details/iss043e125565) · [Himalayas](https://images.nasa.gov/details/iss068e047346)

### Discarding drafts

The composer closes immediately after a local discard. The Drafts list offers the same action on hover, with keyboard focus, and for a selection. The notification offers Undo. Undo from a docked composer reopens the restored message when that composer is still available. Undo from Drafts restores the rows, and an inline reply stays associated with its conversation while the source is available.

Checked empty and minimized composers, formatted text and links, inline replies reopened from their thread, the row action, selecting two drafts, and reopening after a reload in a fictional mailbox. Offline and synchronization tests cover recipients, attachments, competing edits, a lost upload response, and mailbox changes. Gmail reference: [discarded drafts and the Undo window](https://support.google.com/mail/thread/412155371/how-can-i-retrieve-a-discarded-gmail-draft?hl=en).

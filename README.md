<p align="center"><img src="doc/demo/logo.png" width="80" alt="Cloud Mail logo" /></p>

# Cloud Mail

A responsive email application running on Cloudflare Workers, with a Vue interface, multiple mailbox addresses, role-based permissions, and attachment support.

External email is sent through the **Cloudflare Email Service Workers API**. Incoming mail uses Cloudflare Email Routing. The application and its documentation are English only.

## Features

- Compose HTML and plain text email, reply to messages, and send to multiple recipients.
- Send file attachments and embedded images; receive and download attachments.
- Internal mailbox delivery, including plus-address aliases.
- Manage users, roles, domains, registration codes, and sending quotas.
- Store messages in D1, cache configuration in KV, and store files in R2, S3-compatible storage, or KV.
- Optional Turnstile verification, OAuth login, Telegram forwarding, inbound webhooks, and AI verification-code recognition.

## Requirements

- Node.js 22 or newer supported by Wrangler, and pnpm 11.
- A Cloudflare account, a domain in Cloudflare, a D1 database, and a KV namespace.
- Email Sending enabled for every domain used as an external sender. Complete Cloudflare's domain verification and DNS setup; Email Routing alone does not enable arbitrary external recipients.
- Email Routing configured to invoke the Worker for incoming mail.
- Optional R2 or S3-compatible storage for attachments. KV is the existing fallback.

See [Cloudflare Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/) and the [Workers sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

## Project structure

- `mail-worker`: Hono API, mailbox services, D1 initialization and upgrades, email handlers, and Wrangler configuration.
- `mail-vue`: Vue interface, Pinia state, Element Plus components, and TinyMCE editor.
- `mail-ios`: native iOS 18+ SwiftUI client, local drafts and cache, multiple user sessions, conversations, and best-effort background notifications. See [iOS setup](mail-ios/README.md).
- `.github/workflows/deploy-cloudflare.yml`: automated build and deployment.

## Configure the Worker

Edit `mail-worker/wrangler.toml`. Enable and fill in the D1 and KV sections using your resource names and IDs. Keep the binding names `db`, `kv`, `assets`, and `email` unchanged. Configure `r2` if using R2.

The email binding is enabled in every supplied Wrangler configuration:

```toml
[[send_email]]
name = "email"
```

This binding authenticates sending inside Workers; an email API token is not required. Your sending domain must also be onboarded in Cloudflare Email Service. Binding availability in System Settings indicates configuration only, not domain verification or delivery status.

Configure these Worker variables:

| Variable | Purpose |
| --- | --- |
| `domain` | Array of mailbox domains, for example `["example.com"]` |
| `admin` | Administrator email address on a configured domain |
| `jwt_secret` | Existing user-session signing secret |
| `app_access_secret` | Shared installation-access secret, entered on each device |
| `init_secret` | Separate database-initialization credential |
| `browser_origins` | Optional comma-separated development browser origins; production defaults to same origin |
| `ai_model` | Optional Workers AI model override |
| `analysis_cache` | Optional analytics caching flag |
| `orm_log` | Optional SQL logging flag |
| `project_link` | Whether to display the project link |

Store the production signing secret using Wrangler secrets or Cloudflare's dashboard. Use a git-ignored `.dev.vars` file for a local secret. Set `domain` and `admin` in the configuration or dashboard before initialization.

## Install, build, and deploy

```sh
pnpm --dir mail-worker install --frozen-lockfile
pnpm --dir mail-vue install --frozen-lockfile
pnpm --dir mail-vue build
pnpm --dir mail-worker exec wrangler deploy --dry-run
```

The Vue release build writes assets to `mail-worker/dist`. The Worker build hook also installs and builds the frontend.

When ready to publish, run `pnpm --dir mail-worker deploy`. For the existing separate test deployment configuration, use `pnpm --dir mail-worker deploy:test`. These commands deploy real resources; `pnpm --dir mail-worker test` runs automated local tests only.

Before using the deployment, configure three independent Worker secrets. Keep the existing `jwt_secret` when upgrading to preserve user sessions. Configure `app_access_secret` and `init_secret` using Wrangler's interactive secret prompts or the Cloudflare dashboard; use at least 32 random characters for each.

All HTTP app access now fails closed until `app_access_secret` is configured. Browsers unlock at `/unlock` and receive a seven-day HttpOnly cookie. Native clients and integrations send `X-Cloudmail-App-Secret`, in addition to their existing user authorization. Rotating the installation secret invalidates browser unlock cookies and requires re-entry on devices. It grants no user or administrator mailbox privileges.

Initialization is now **POST `/api/init`**, with `X-Cloudmail-App-Secret` and `X-Cloudmail-Init-Secret` headers. The old signing-secret URL has been removed. For local administration, save the two access credentials in a mode-600, git-ignored `.cloudmail-secrets.json` at the repository root and run `node scripts/initialize-cloudmail.mjs https://your-cloudmail-host`. The script does not print credentials. Initialization upgrades D1, installs mobile change-log triggers, translates unchanged built-in labels, and refreshes settings. Then register or sign in with the configured administrator address and enable sending under System Settings.

Keep Cloudflare Access enabled during the upgrade. Remove its application/policy only after validating the replacement gate and authenticated attachments. Make attachment storage private: disable public R2/S3 object access and public custom domains, and purge any formerly public attachment caches. Cloudmail now serves stored files through ownership-checked API downloads; raw storage access would bypass those checks. Inbound Email Routing is independent of HTTP Access.

Configure an Email Routing rule for your domain that sends incoming email to this Worker.

### GitHub Actions

Set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DOMAIN` (a JSON array), `ADMIN`, `JWT_SECRET`, `APP_ACCESS_SECRET`, and `INIT_SECRET` in repository secrets. Optional values include `NAME`, `CUSTOM_DOMAIN`, `D1_DATABASE_ID`, `KV_NAMESPACE_ID`, `R2_BUCKET_NAME`, `AI_MODEL`, `ANALYSIS_CACHE`, and `PROJECT_LINK`.

The workflow uses supplied D1/KV IDs or provisions the resources through its existing setup steps. It always includes the `email` binding. The former `CF_EMAIL` toggle is no longer needed. Sender-domain onboarding remains a prerequisite.

## Attachments and sending limits

- Up to 50 recipients per message.
- Up to 10 ordinary file attachments and 10 inline images per message.
- General outbound message budget: **5 MiB**, including bodies, attachments, base64 expansion, MIME headers, and boundaries. The app reserves overhead conservatively, so the maximum raw attachment size is smaller.
- Cloudflare supports a larger size for verified destinations, but this application consistently uses the general 5 MiB budget. See [Cloudflare limits](https://developers.cloudflare.com/email-service/platform/limits/).
- Browser uploads use base64 or data URLs in the existing API; the Worker validates and converts them to binary before sending. Stored inline images are loaded from configured storage and sent with matching content IDs.
- Missing or malformed attachments stop the send. File bytes and MIME metadata are preserved in storage.
- Cloudflare acceptance is shown as **Sent**. It does not confirm final delivery. Inspect Cloudflare email activity for delivery details.
- Sends are not automatically retried, to avoid duplicate mail. Check activity after an ambiguous service failure before resending.

## Local development

```sh
pnpm --dir mail-worker dev
pnpm --dir mail-vue dev
```

Update `wrangler-dev.toml` for your local setup. The Vue development server calls `http://127.0.0.1:8787/api`. Set `jwt_secret`, `app_access_secret`, and `init_secret` in a git-ignored `.dev.vars` and initialize through the same header-protected POST endpoint. For a separate Vite server, configure `browser_origins = "http://localhost:3001"` or your exact development origin.

Email bindings are simulated by default and do not send actual email. Cloudflare documents a local simulator limitation for binary attachment content. The automated tests use a mocked sending binding and verify exact binary payloads; use a test deployment to confirm real binary delivery.

For deliberate remote sending, add `remote = true` under the development email binding. This sends real email and requires an authenticated Cloudflare account and an onboarded sender domain. See [Cloudflare local sending guidance](https://developers.cloudflare.com/email-service/observability/local-development/sending/).

## Upgrading from Resend or a multilingual release

1. Back up your D1 database and configuration.
2. Onboard the sending domains in Cloudflare Email Service and deploy with the `email` binding.
3. Invoke the initialization endpoint to upgrade built-in labels and refresh cached settings.
4. Remove obsolete Resend credentials and webhook configuration from your external services.

Resend sending, token management, and the old `/api/webhooks` endpoint have been removed. Historical D1 columns remain for compatibility; old provider IDs and email history are preserved. The active identifier property is now `providerMessageId`, mapped to the historical storage column. It is separate from RFC email threading headers.

Obsolete tokens are excluded from settings responses and caches, and submissions from older clients are ignored. Built-in permission and default-role labels are translated only when they still match their original values. Custom names, announcements, email bodies, and attachment contents retain their original language. Previously saved language preferences normalize to English.

Internal-only mail still uses direct mailbox delivery, including without an external sending binding. External mail requires the binding and an onboarded sender domain.

## Tests

```sh
pnpm --dir mail-worker test
pnpm --dir mail-vue test
pnpm --dir mail-vue build
```

Tests use isolated local D1, KV, and R2 storage and mocked sending. They do not send real email or deploy resources.

For an isolated visual preview, run `pnpm --dir mail-vue test:preview` and open `http://127.0.0.1:3001/__preview`. It uses fictional users and mail, local browser drafts, and in-memory delivery; it does not connect to your deployment. Ports 3001 and 8787 must be available.

The web client uses a Gmail-style layout with a mailbox selector, light/dark themes, Cc/Bcc compose fields, and Reply all. Mail search accepts a plain substring in the current Inbox/Sent scope or user-wide Starred list; advanced Gmail operators are not supported. `GET /api/email/list` and `GET /api/star/list` accept optional `q`, and `GET /api/email/detail?emailId=…` returns the body, recipient metadata, and attachment metadata of an owned, non-deleted message. Bcc is exposed only on sent copies. These additions require no database migration.


## License

[MIT](LICENSE). Third-party components retain their own licenses.

## Mobile APIs

The iOS client uses `/api/mobile/v1`. All routes require the installation secret or web unlock cookie, plus an existing Cloudmail user token in `Authorization` (the existing raw JWT format). Responses retain `{ code, message, data }`; mobile clients must inspect both HTTP status and the envelope's `code`.

| Route | Purpose |
| --- | --- |
| `GET /bootstrap` | Consistent baseline cursor, mailboxes, unread total, and initial conversation page |
| `GET /changes?after=<cursor>&limit=100` | Ascending, replayable change pages, current message summaries, thread updates and deletion markers |
| `GET /threads?folder=inbox&accountId=…&q=…&before=…` | Search and paginate conversations; folders also include `sent`, `starred`, `all` |
| `GET /threads/:id/messages?after=<emailId>&limit=100` | Chronological conversation messages, including sent replies |
| `GET /messages/:id` | Body and attachment metadata for an owned message |
| `GET /attachments/:id/content` | Authenticated attachment bytes |
| `GET /attachment-by-key?key=…` | Authenticated compatibility download for web inline images |

`POST /api/email/send` accepts optional `cc` and `bcc` arrays in addition to `receiveEmail` (To). Combined recipient validation, permissions, size checks, quotas, and internal delivery include all three lists. Recipient copies omit Bcc. `PUT /api/email/read` accepts `{ emailIds, unread: 0 | 1 }`; omitting `unread` retains existing mark-read behavior (`1` means read).

Conversation membership is scoped to a user. RFC references and local reply links take priority over the subject/participant fallback. Outgoing provider IDs are not RFC message IDs; the provider controls external Message-ID headers. Historical or incomplete headers can therefore leave some messages separate or require the documented 14-day subject/participant heuristic.

The change log is retained without pruning in version one so offline clients do not lose deletion markers. Monitor D1 growth before introducing retention and a cursor-reset protocol.

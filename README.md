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
| `jwt_secret` | Long random signing and initialization secret |
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

After deployment, invoke the existing initialization endpoint `/api/init/<jwt_secret>` on your Worker with your configured secret. It returns `success`, initializes or upgrades D1, translates unchanged built-in labels, and refreshes the settings cache. Keep this URL private. Then register or sign in with the configured administrator address and enable sending under System Settings.

Configure an Email Routing rule for your domain that sends incoming email to this Worker.

### GitHub Actions

Set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DOMAIN` (a JSON array), `ADMIN`, and `JWT_SECRET` in repository secrets. Optional values include `NAME`, `CUSTOM_DOMAIN`, `D1_DATABASE_ID`, `KV_NAMESPACE_ID`, `R2_BUCKET_NAME`, `AI_MODEL`, `ANALYSIS_CACHE`, and `PROJECT_LINK`.

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

Update `wrangler-dev.toml` for your local setup. The Vue development server calls `http://127.0.0.1:8787/api`. Initialize the local database through the same initialization endpoint using the local secret.

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
pnpm --dir mail-vue build
```

Tests use isolated local D1, KV, and R2 storage and mocked sending. They do not send real email or deploy resources.

## License

[MIT](LICENSE). Third-party components retain their own licenses.

import {messageFilterSchema} from '../src/service/message-filter-schema.js';
// Apply the additive mailbox schema before switching traffic to a version that reads it.
import { execFileSync } from 'node:child_process';
import {mailWordSchema,seedWordIndex,wordIndexProgress} from '../src/service/mail-word-schema.js';
import { filingSchema,ensureDeliveredWakeColumn } from '../src/service/conversation-filing.js';

import {scheduledTrashSchema} from "../src/cloud/scheduled-trash-schema.js";
import { ensureEmailColumn,ensureRawSizeColumn,ensureGeneralPreferenceColumns,lastScheduleSchema,contactSchema,signatureSchema,systemLabelSchema,generalSettingsSchema } from '../src/cloud/schema.js';

const config = process.argv[2] || 'wrangler.toml';
const command = ['exec','wrangler','d1','execute','db','--remote','--config',config,'--json','--command'];
function execute(sql) {
  return JSON.parse(execFileSync('pnpm',[...command,sql],{encoding:'utf8'}));
}
const [schema] = execute("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('email','cloud_drafts','mobile_changes')");
const existing = new Set(schema.results.map(row => row.name));
// A new installation creates the core tables during its normal initializer.
if (existing.has('email')) await ensureRawSizeColumn(()=>execute('PRAGMA table_info(email)')[0].results,execute);
if (existing.has('email')) {
  execute(mailWordSchema().join(';\n'));
  for (let batch=0;batch<8;batch++) {
    const [progress]=execute(wordIndexProgress())[0].results;
    if (!progress) break;
    execute(seedWordIndex(progress).join(';\n'));
  }
}
for (const statement of [...filingSchema(existing), contactSchema, signatureSchema, systemLabelSchema, generalSettingsSchema, lastScheduleSchema]) execute(statement);
await ensureGeneralPreferenceColumns(()=>execute('PRAGMA table_info(mail_general_settings)')[0].results,execute);
if (existing.has('email') && existing.has('cloud_drafts')) {
  await ensureEmailColumn(()=>execute('PRAGMA table_info(email)')[0].results,execute,'scheduled_draft_id');
  for (const statement of scheduledTrashSchema) execute(statement);
}
await ensureDeliveredWakeColumn(()=>execute('PRAGMA table_info(scheduled_inbox_deliveries)')[0].results,execute);
if (existing.has('email')) for (const statement of messageFilterSchema) execute(statement);
console.log('Mailbox filing schema is ready.');

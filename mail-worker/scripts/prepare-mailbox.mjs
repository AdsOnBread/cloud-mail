// Apply the additive mailbox schema before switching traffic to a version that reads it.
import { execFileSync } from 'node:child_process';
import { filingSchema } from '../src/service/conversation-filing.js';

import { ensureRawSizeColumn,signatureSchema,systemLabelSchema } from '../src/cloud/schema.js';

const config = process.argv[2] || 'wrangler.toml';
const command = ['exec','wrangler','d1','execute','db','--remote','--config',config,'--json','--command'];
function execute(sql) {
  return JSON.parse(execFileSync('pnpm',[...command,sql],{encoding:'utf8'}));
}
const [schema] = execute("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('email','cloud_drafts')");
const existing = new Set(schema.results.map(row => row.name));
// A new installation creates these two tables during its normal initializer.
if (existing.has('email')) await ensureRawSizeColumn(()=>execute('PRAGMA table_info(email)')[0].results,execute);
for (const statement of [...filingSchema(existing), signatureSchema, systemLabelSchema]) execute(statement);
console.log('Mailbox filing schema is ready.');

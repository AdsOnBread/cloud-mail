import {excludedPhrases} from '../../../shared/mail-search-words';
import emailUtils from '../utils/email-utils';

// unicode61 treats private-use characters as tokens. This unsearchable separator
// prevents a quoted phrase from crossing from one header or address into the next.
const boundary = "' '||char(57344)||' '";
function addresses(column) {
  const list = `CASE WHEN json_valid(${column}) THEN ${column} ELSE json_array(${column}) END`;
  return `coalesce((SELECT group_concat(CASE WHEN j.type='object'
    THEN coalesce(json_extract(j.value,'$.name'),'')||${boundary}||coalesce(json_extract(j.value,'$.address'),'')
    WHEN j.type='text' THEN j.value ELSE '' END,${boundary}) FROM json_each(${list}) j),'')`;
}
function headers(row) {
  return [`coalesce(${row}.subject,'')`,`coalesce(${row}.name,'')`,`coalesce(${row}.send_email,'')`,
    addresses(row+'.recipient'),addresses(row+'.cc'),`CASE WHEN ${row}.type=1 THEN ${addresses(row+'.bcc')} ELSE '' END`]
    .join('||'+boundary+'||');
}
const visible = row => `${row}.user_id>0 AND ${row}.is_del=0`;
const htmlOnly = row => `trim(coalesce(${row}.text,''))='' AND length(${row}.content)>0`;
const indexRow = (source,row,where) => `INSERT OR REPLACE INTO mail_word_index(rowid,headers,body)
  SELECT ${row}.email_id,${headers(row)},coalesce(${row}.text,'') ${source} WHERE ${where}`;
const enqueue = (source,row,where) => `INSERT OR REPLACE INTO mail_word_pending(email_id,user_id,revision)
  SELECT ${row}.email_id,${row}.user_id,randomblob(16) ${source} WHERE ${where} AND ${htmlOnly(row)}`;

export function mailWordSchema() {
  const initial="NOT EXISTS(SELECT 1 FROM mail_word_setup WHERE version=1) AND "+visible('e');
  const add=indexRow('','NEW',visible('NEW'))+'; '+enqueue('','NEW',visible('NEW'))+';';
  const remove='DELETE FROM mail_word_index WHERE rowid=OLD.email_id; DELETE FROM mail_word_pending WHERE email_id=OLD.email_id;';
  return [
    `CREATE VIRTUAL TABLE IF NOT EXISTS mail_word_index USING fts5(headers,body,content='',contentless_delete=1,
      tokenize="unicode61 remove_diacritics 2 categories 'L* N* M* Co'")`,
    'CREATE TABLE IF NOT EXISTS mail_word_pending(email_id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,revision BLOB NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_mail_word_pending ON mail_word_pending(user_id,email_id)',
    'CREATE TABLE IF NOT EXISTS mail_word_setup(version INTEGER PRIMARY KEY)',
    `CREATE TRIGGER IF NOT EXISTS mail_words_insert AFTER INSERT ON email BEGIN ${add} END`,
    `CREATE TRIGGER IF NOT EXISTS mail_words_update AFTER UPDATE OF email_id,user_id,is_del,type,name,send_email,recipient,cc,bcc,subject,text,content
      ON email BEGIN ${remove} ${add} END`,
    `CREATE TRIGGER IF NOT EXISTS mail_words_delete AFTER DELETE ON email BEGIN ${remove} END`,
    indexRow('FROM email e','e',initial),enqueue('FROM email e','e',initial),
    'INSERT OR IGNORE INTO mail_word_setup(version) VALUES(1)',
  ];
}

// SQLite indexes plain text in the same transaction as each message. HTML-only
// messages need DOM text extraction. The revision fences concurrent edits/deletes.
export async function prepareExcludedSearch(db,userId,value) {
  if (!excludedPhrases(value).length) return;
  for (;;) {
    const {results}=await db.prepare(`SELECT p.email_id,hex(p.revision) AS revision,e.content FROM mail_word_pending p
      JOIN email e ON e.email_id=p.email_id AND e.user_id=p.user_id WHERE p.user_id=? ORDER BY p.email_id LIMIT 4`).bind(userId).all();
    if (!results.length) return;
    const statements=[];
    for (const row of results) {
      const text=emailUtils.htmlToText(row.content);
      statements.push(db.prepare(`INSERT OR REPLACE INTO mail_word_index(rowid,headers,body)
        SELECT e.email_id,${headers('e')},? FROM email e JOIN mail_word_pending p ON p.email_id=e.email_id
        WHERE p.email_id=? AND p.user_id=? AND hex(p.revision)=?`).bind(text,row.email_id,userId,row.revision),
        db.prepare('DELETE FROM mail_word_pending WHERE email_id=? AND user_id=? AND hex(revision)=?').bind(row.email_id,userId,row.revision));
    }
    await db.batch(statements);
  }
}

export function addExcludedFilter(params,conditions,args) {
  const phrases=excludedPhrases(params.excluded);
  if (!phrases.length) return;
  conditions.push('e.email_id NOT IN (SELECT rowid FROM mail_word_index WHERE mail_word_index MATCH ?) AND NOT EXISTS (SELECT 1 FROM mail_word_pending p WHERE p.email_id=e.email_id)');
  args.push(phrases.map(phrase=>'"'+phrase+'"').join(' OR '));
}

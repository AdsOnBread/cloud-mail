// unicode61 treats private-use characters as tokens. This unsearchable separator
// prevents a quoted phrase from crossing from one header or address into the next.
const boundary = "' '||char(57344)||' '";
function addresses(column) {
  const list = `CASE WHEN json_valid(${column}) THEN ${column} ELSE json_array(${column}) END`;
  return `coalesce((SELECT group_concat(CASE WHEN j.type='object'
    THEN coalesce(json_extract(j.value,'$.name'),'')||${boundary}||coalesce(json_extract(j.value,'$.address'),'')
    WHEN j.type='text' THEN j.value ELSE '' END,${boundary}) FROM json_each(${list}) j),'')`;
}
export function indexedHeaders(row) {
  return [`coalesce(${row}.subject,'')`,`coalesce(${row}.name,'')`,`coalesce(${row}.send_email,'')`,
    addresses(row+'.recipient'),addresses(row+'.cc'),`CASE WHEN ${row}.type=1 THEN ${addresses(row+'.bcc')} ELSE '' END`]
    .join('||'+boundary+'||');
}
const visible = row => `${row}.user_id>0 AND ${row}.is_del=0`;
const htmlOnly = row => `trim(coalesce(${row}.text,''))='' AND length(${row}.content)>0`;
const indexRow = (source,row,where) => `INSERT OR REPLACE INTO mail_word_index(rowid,headers,body)
  SELECT ${row}.email_id,${indexedHeaders(row)},coalesce(${row}.text,'') ${source} WHERE ${where}`;
const enqueue = (source,row,where) => `INSERT OR REPLACE INTO mail_word_pending(email_id,user_id,revision)
  SELECT ${row}.email_id,${row}.user_id,randomblob(16) ${source} WHERE ${where} AND ${htmlOnly(row)}`;

export function mailWordSchema() {
  const add=indexRow('','NEW',visible('NEW'))+'; '+enqueue('','NEW',visible('NEW'))+';';
  const remove='DELETE FROM mail_word_index WHERE rowid=OLD.email_id; DELETE FROM mail_word_pending WHERE email_id=OLD.email_id;';
  return [
    `CREATE VIRTUAL TABLE IF NOT EXISTS mail_word_index USING fts5(headers,body,content='',contentless_delete=1,
      tokenize="unicode61 remove_diacritics 2 categories 'L* N* M* Co'")`,
    'CREATE TABLE IF NOT EXISTS mail_word_pending(email_id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,revision BLOB NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_mail_word_pending ON mail_word_pending(user_id,email_id)',
    'CREATE TABLE IF NOT EXISTS mail_word_setup(version INTEGER PRIMARY KEY,cursor INTEGER NOT NULL,through_id INTEGER NOT NULL)',
    `CREATE TRIGGER IF NOT EXISTS mail_words_insert AFTER INSERT ON email BEGIN ${add} END`,
    `CREATE TRIGGER IF NOT EXISTS mail_words_update AFTER UPDATE OF email_id,user_id,is_del,type,name,send_email,recipient,cc,bcc,subject,text,content
      ON email BEGIN ${remove} ${add} END`,
    `CREATE TRIGGER IF NOT EXISTS mail_words_delete AFTER DELETE ON email BEGIN ${remove} END`,
    'INSERT OR IGNORE INTO mail_word_setup SELECT 1,0,coalesce(max(email_id),0) FROM email',
  ];
}


// Keep the installation upgrade restartable and each database write bounded.
export const wordIndexProgress = `SELECT cursor,through_id,coalesce((SELECT max(email_id) FROM
  (SELECT email_id FROM email WHERE email_id>cursor AND email_id<=through_id ORDER BY email_id LIMIT 32)),through_id) AS next
  FROM mail_word_setup WHERE version=1 AND cursor<through_id`;

export function seedWordIndex({cursor,next}) {
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(next) || next<=cursor) throw new Error('Invalid search index position');
  const where=`e.email_id>${cursor} AND e.email_id<=${next} AND ${visible('e')} AND NOT EXISTS
    (SELECT 1 FROM mail_word_index WHERE rowid=e.email_id)`;
  return [enqueue('FROM email e','e',where),indexRow('FROM email e','e',where),
    `UPDATE mail_word_setup SET cursor=${next} WHERE version=1 AND cursor=${cursor}`];
}

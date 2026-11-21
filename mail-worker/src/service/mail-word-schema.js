// unicode61 treats private-use characters as tokens. This unsearchable separator
// prevents a quoted phrase from crossing from one header or address into the next.
const boundary = "' '||char(57344)||' '";
function addresses(column) {
  const list = `CASE WHEN json_valid(${column}) THEN ${column} ELSE json_array(${column}) END`;
  return `coalesce((SELECT group_concat(CASE WHEN j.type='object'
    THEN coalesce(json_extract(j.value,'$.name'),'')||${boundary}||coalesce(json_extract(j.value,'$.address'),'')
    WHEN j.type='text' THEN j.value ELSE '' END,${boundary}) FROM json_tree(${list}) j WHERE j.type='object' OR (j.type='text' AND typeof(j.key)='integer')),'')`;
}
export function indexedHeaders(row) {
  return [`coalesce(${row}.subject,'')`,`coalesce(${row}.name,'')`,`coalesce(${row}.send_email,'')`,
    addresses(row+'.recipient'),addresses(row+'.cc'),`CASE WHEN ${row}.type=1 THEN ${addresses(row+'.bcc')} ELSE '' END`]
    .join('||'+boundary+'||');
}
const visible = row => `${row}.user_id>0 AND ${row}.is_del=0`;
// Match the whitespace recognized by JavaScript trim() for MIME plain alternatives.
export const blankMailText = column => `trim(coalesce(${column},''),char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))=''`;
const htmlOnly = row => `${blankMailText(row+'.text')} AND length(${row}.content)>0`;
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
    'CREATE TABLE IF NOT EXISTS mail_word_setup(user_id INTEGER NOT NULL,account_id INTEGER NOT NULL,cursor INTEGER NOT NULL,through_id INTEGER NOT NULL,PRIMARY KEY(user_id,account_id))',
    `CREATE TRIGGER IF NOT EXISTS mail_words_insert_v2 AFTER INSERT ON email BEGIN ${add} END`,
    `CREATE TRIGGER IF NOT EXISTS mail_words_update_v2 AFTER UPDATE OF email_id,user_id,is_del,type,name,send_email,recipient,cc,bcc,subject,text,content
      ON email BEGIN ${remove} ${add} END`,
    `CREATE TRIGGER IF NOT EXISTS mail_words_delete AFTER DELETE ON email BEGIN ${remove} END`,
    'DROP TRIGGER IF EXISTS mail_words_insert',
    'DROP TRIGGER IF EXISTS mail_words_update',
    'CREATE TABLE IF NOT EXISTS mail_word_upgrades(version INTEGER PRIMARY KEY)',
    `INSERT OR IGNORE INTO mail_word_pending(email_id,user_id,revision)
      SELECT email_id,user_id,randomblob(16) FROM email
      WHERE NOT EXISTS (SELECT 1 FROM mail_word_upgrades WHERE version=2) AND is_del=0 AND user_id>0
        AND (instr(recipient,'"group"')>0 OR instr(cc,'"group"')>0 OR (type=1 AND instr(bcc,'"group"')>0))`,
    'INSERT OR IGNORE INTO mail_word_upgrades VALUES(2)',
    'INSERT OR IGNORE INTO mail_word_setup SELECT 0,0,0,coalesce(max(email_id),0) FROM email',
  ];
}


// Keep the installation upgrade restartable and each database write bounded.
export function wordIndexProgress(userId=0,accountId=0) {
  if (![userId,accountId].every(id=>Number.isSafeInteger(id) && id>=0)) throw new Error('Invalid search index scope');
  const scope=(userId ? ' AND e.user_id='+userId : '')+(accountId ? ' AND e.account_id='+accountId : '');
  return `SELECT user_id,account_id,cursor,through_id,coalesce((SELECT max(email_id) FROM
    (SELECT email_id FROM email e WHERE email_id>cursor AND email_id<=through_id ${scope} ORDER BY email_id LIMIT 32)),through_id) AS next
    FROM mail_word_setup WHERE user_id=${userId} AND account_id=${accountId} AND cursor<through_id`;
}

export function seedWordIndex({user_id,account_id,cursor,next}) {
  if (![user_id,account_id,cursor,next].every(id=>Number.isSafeInteger(id) && id>=0) || next<=cursor) throw new Error('Invalid search index position');
  const scope=(user_id ? ' AND e.user_id='+user_id : '')+(account_id ? ' AND e.account_id='+account_id : '');
  const where=`e.email_id>${cursor} AND e.email_id<=${next} ${scope} AND ${visible('e')} AND NOT EXISTS
    (SELECT 1 FROM mail_word_index WHERE rowid=e.email_id)`;
  return [enqueue('FROM email e','e',where),indexRow('FROM email e','e',where),
    `UPDATE mail_word_setup SET cursor=${next} WHERE user_id=${user_id} AND account_id=${account_id} AND cursor=${cursor}`];
}

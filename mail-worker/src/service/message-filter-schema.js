// Both delivery and "also apply" evaluate the same incoming-message criteria.
const field = key => "json_extract(r.criteria,'$." + key + "')";
const contains = (haystack,needle) => "instr(lower(coalesce("+haystack+",'')),lower("+needle+"))>0";
const matchesPerson = (address,name,key) => `CASE WHEN instr(${field(key)},'@')>0
  THEN ${address}=${field(key)} COLLATE NOCASE ELSE ${contains(address,field(key))} OR ${contains(name,field(key))} END`;
function recipientMatches(column) {
  // json_tree also visits the members of named address groups.
  return `EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END) p
    WHERE (p.type='object' AND ${matchesPerson("json_extract(p.value,'$.address')","json_extract(p.value,'$.name')",'to')})
       OR (p.type='text' AND typeof(p.key)='integer' AND ${matchesPerson('p.value',"''",'to')}))`;
}
const body = "coalesce(e.subject,'')||char(10)||coalesce(e.text,'')||char(10)||coalesce(e.send_email,'')";
const attached = alias => `${alias}.type=0 AND (lower(${alias}.disposition)='attachment' OR
  (coalesce(${alias}.content_id,'')='' AND lower(coalesce(${alias}.disposition,''))!='inline'))`;
export const filterMatches = `e.user_id=r.user_id AND e.type=0 AND e.status=0 AND e.is_del=0 AND e.trashed_at IS NULL
  AND EXISTS (SELECT 1 FROM account a WHERE a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0)
  AND (${field('from')} IS NULL OR ${matchesPerson('e.send_email','e.name','from')})
  AND (${field('to')} IS NULL OR ${recipientMatches('e.recipient')} OR ${recipientMatches('e.cc')})
  AND (${field('subject')} IS NULL OR ${contains('e.subject',field('subject'))})
  AND NOT EXISTS (SELECT 1 FROM json_each(r.criteria,'$.includes') term WHERE NOT (${contains(body,'term.value')}))
  AND NOT EXISTS (SELECT 1 FROM json_each(r.criteria,'$.excludes') term WHERE ${contains(body,'term.value')})
  AND (${field('hasAttachment')} IS NULL OR EXISTS (SELECT 1 FROM attachments att
    WHERE att.email_id=e.email_id AND att.user_id=e.user_id AND att.account_id=e.account_id AND ${attached('att')}))`;

const applyMatches = (source,extra='') => `INSERT INTO mail_filter_hits(user_id,email_id,actions)
  SELECT e.user_id,e.email_id,r.actions FROM email e JOIN mail_filters r ON r.user_id=e.user_id
  WHERE e.email_id=${source} AND ${filterMatches} ${extra} ORDER BY r.rowid;`;
const action = key => "json_extract(NEW.actions,'$."+key+"')";
const ownedRules = 'EXISTS (SELECT 1 FROM mail_filters WHERE user_id=NEW.user_id)';
export const messageFilterSchema = [
  `CREATE TABLE IF NOT EXISTS mail_filters (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(user_id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1, criteria TEXT NOT NULL, actions TEXT NOT NULL, mutation TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_filters_owner ON mail_filters(user_id)',
  // A transient row executes each matching rule atomically with receipt or manual application.
  'CREATE TABLE IF NOT EXISTS mail_filter_hits(user_id INTEGER NOT NULL,email_id INTEGER NOT NULL,actions TEXT NOT NULL)',
  `CREATE TRIGGER IF NOT EXISTS mail_filter_hit AFTER INSERT ON mail_filter_hits BEGIN
    UPDATE email SET unread=1 WHERE user_id=NEW.user_id AND email_id=NEW.email_id AND unread=0 AND ${action('read')}=1;
    INSERT INTO star(user_id,email_id) SELECT NEW.user_id,NEW.email_id WHERE ${action('star')}=1
      AND NOT EXISTS (SELECT 1 FROM star WHERE user_id=NEW.user_id AND email_id=NEW.email_id);
    INSERT OR IGNORE INTO mailbox_label_members(user_id,label_id,email_id) SELECT NEW.user_id,label_id,NEW.email_id
      FROM mailbox_labels WHERE user_id=NEW.user_id AND label_id=${action('labelId')};
    INSERT OR REPLACE INTO conversation_filing(user_id,email_id,wake_at) SELECT NEW.user_id,NEW.email_id,NULL WHERE ${action('archive')}=1;
    INSERT OR REPLACE INTO mailbox_importance(user_id,email_id,important) SELECT NEW.user_id,NEW.email_id,${action('important')}
      WHERE ${action('important')} IS NOT NULL;
    INSERT OR REPLACE INTO mailbox_categories(user_id,email_id,category) SELECT NEW.user_id,NEW.email_id,${action('category')}
      WHERE ${action('category')} IS NOT NULL;
    DELETE FROM mail_filter_hits WHERE rowid=NEW.rowid;
  END`,
  ...[['insert','INSERT',''],['received','UPDATE OF status',' AND OLD.status=6']].map(([name,event,transition])=>
    `CREATE TRIGGER IF NOT EXISTS mail_filter_${name} AFTER ${event} ON email
      WHEN NEW.type=0 AND NEW.status=0 AND NEW.is_del=0${transition} AND ${ownedRules}
      BEGIN ${applyMatches('NEW.email_id')} END`),
  // Local deliveries persist the received copy before its attachment references.
  `CREATE TRIGGER IF NOT EXISTS mail_filter_attachment AFTER INSERT ON attachments
    WHEN ${attached('NEW')} AND ${ownedRules} AND NOT EXISTS (SELECT 1 FROM attachments other WHERE other.email_id=NEW.email_id
      AND other.user_id=NEW.user_id AND other.account_id=NEW.account_id AND other.att_id!=NEW.att_id AND ${attached('other')})
    BEGIN ${applyMatches('NEW.email_id',"AND e.user_id=NEW.user_id AND e.account_id=NEW.account_id AND json_extract(r.criteria,'$.hasAttachment')=1")} END`,
];

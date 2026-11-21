import {excludedPhrases} from '../../../shared/mail-search-words';
import emailUtils from '../utils/email-utils';

import {indexedHeaders,seedWordIndex,wordIndexProgress} from './mail-word-schema';

// SQLite indexes plain text in the same transaction as each message. HTML-only
// messages need DOM text extraction. The revision fences concurrent edits/deletes.
export async function indexWordBatch(db,userId,accountId) {
  let progress=await db.prepare(wordIndexProgress()).first();
  if (progress && userId) {
    accountId=Number(accountId) || 0;
    await db.prepare(`INSERT OR IGNORE INTO mail_word_setup(user_id,account_id,cursor,through_id)
      SELECT ?,?,cursor,through_id FROM mail_word_setup WHERE user_id=0 AND account_id=0 AND cursor<through_id`).bind(userId,accountId).run();
    progress=await db.prepare(wordIndexProgress(userId,accountId)).first();
  }
  if (progress) await db.batch(seedWordIndex(progress).map(sql=>db.prepare(sql)));
  const scope=[],args=[];
  if (userId) {scope.push('p.user_id=?');args.push(userId);}
  if (accountId) {scope.push('e.account_id=?');args.push(accountId);}
  const source=`FROM mail_word_pending p JOIN email e ON e.email_id=p.email_id AND e.user_id=p.user_id
    ${scope.length ? 'WHERE '+scope.join(' AND ') : ''}`;
  const {results}=await db.prepare(`SELECT p.email_id,p.user_id,hex(p.revision) AS revision,e.content,e.text
    ${source} ORDER BY p.email_id LIMIT 4`).bind(...args).all();
  const statements=[];
  for (const row of results) {
    const text=row.text?.trim() ? row.text : emailUtils.htmlToText(row.content);
    statements.push(db.prepare(`INSERT OR REPLACE INTO mail_word_index(rowid,headers,body)
      SELECT e.email_id,${indexedHeaders('e')},? FROM email e JOIN mail_word_pending p ON p.email_id=e.email_id
      WHERE p.email_id=? AND p.user_id=? AND hex(p.revision)=?`).bind(text,row.email_id,row.user_id,row.revision),
      db.prepare('DELETE FROM mail_word_pending WHERE email_id=? AND user_id=? AND hex(revision)=?').bind(row.email_id,row.user_id,row.revision));
  }
  if (statements.length) await db.batch(statements);
  if (progress && progress.next<progress.through_id) return false;
  return results.length<4 || !(await db.prepare('SELECT 1 '+source+' LIMIT 1').bind(...args).first());
}

export async function prepareExcludedSearch(db,userId,accountId,value) {
  return !excludedPhrases(value).length || await indexWordBatch(db,userId,accountId);
}

export function addExcludedFilter(params,conditions,args) {
  const phrases=excludedPhrases(params.excluded);
  if (!phrases.length) return;
  conditions.push('NOT EXISTS (SELECT 1 FROM mail_word_index WHERE rowid=e.email_id AND mail_word_index MATCH ?) AND NOT EXISTS (SELECT 1 FROM mail_word_pending p WHERE p.email_id=e.email_id)');
  args.push(phrases.map(phrase=>'"'+phrase+'"').join(' OR '));
}

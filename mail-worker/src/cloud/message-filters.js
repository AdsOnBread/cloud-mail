import BizError from '../error/biz-error';
import {filterMatches} from '../service/message-filter-schema';
import {checkCategory} from '../service/inbox-categories';

function invalid(text) { throw new BizError(text,400); }
function criteria(value={}) {
  const result={};
  for (const [key,limit] of [['from',320],['to',320],['subject',200],['words',200],['excluded',200]]) {
    if (value[key]==null || value[key]==='') continue;
    if (typeof value[key]!=='string' || value[key].length>limit) invalid('Invalid filter criteria.');
    const text=value[key].trim();
    if (text) result[key]=text;
  }
  if (value.hasAttachment===true) result.hasAttachment=true;
  for (const [key,list] of [['words','includes'],['excluded','excludes']]) {
    if (result[key]) result[list]=result[key].match(/"[^"]+"|[^\s"]+/gu)?.map(term=>term.replace(/^"|"$/g,'')) || [];
    if (result[list]?.length===0) invalid('Enter a word or phrase.');
  }
  if (!Object.keys(result).length) invalid('Choose at least one search criterion.');
  return result;
}

function actions(value={}) {
  const result={};
  for (const key of ['archive','read','star']) if (value[key]===true) result[key]=true;
  if (typeof value.important==='boolean') result.important=value.important;
  if (value.category) result.category=checkCategory(value.category);
  if (value.labelId!=null) {
    if (!Number.isSafeInteger(value.labelId) || value.labelId<1) invalid('Choose a label.');
    result.labelId=value.labelId;
  }
  if (!Object.keys(result).length) invalid('Select at least one filter action.');
  return result;
}

function exposed(row) {
  const {includes,excludes,...criteria}=JSON.parse(row.criteria);
  return {id:row.id,version:row.version,criteria,actions:JSON.parse(row.actions)};
}
export async function listFilters(db,user) {
  const {results}=await db.prepare('SELECT * FROM mail_filters WHERE user_id=? ORDER BY rowid').bind(user).all();
  return results.map(exposed);
}
export async function previewFilter(db,user,input) {
  const rule=JSON.stringify(criteria(input));
  const row=await db.prepare(`WITH r AS (SELECT ? AS user_id,? AS criteria)
    SELECT count(DISTINCT coalesce(m.thread_id,'message:'||e.email_id)) AS conversations
    FROM email e JOIN r ON r.user_id=e.user_id LEFT JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
    WHERE ${filterMatches}`).bind(user,rule).first();
  return row;
}
export async function saveFilter(db,user,id,input) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(input.version) || input.version<0) invalid('Invalid filter revision.');
  const query=JSON.stringify(criteria(input.criteria)), action=actions(input.actions), json=JSON.stringify(action);
  const mutation=crypto.randomUUID(), label=action.labelId || null;
  const validLabel='(? IS NULL OR EXISTS (SELECT 1 FROM mailbox_labels WHERE user_id=? AND label_id=?))';
  const statements=[input.version===0
    ? db.prepare(`INSERT INTO mail_filters(id,user_id,criteria,actions,mutation) SELECT ?,?,?,?,? WHERE ${validLabel}
        AND (SELECT count(*) FROM mail_filters WHERE user_id=?)<100 ON CONFLICT(id) DO NOTHING`).bind(id,user,query,json,mutation,label,user,label,user)
    : db.prepare(`UPDATE mail_filters SET criteria=?,actions=?,mutation=?,version=version+1 WHERE id=? AND user_id=? AND version=? AND ${validLabel}`)
      .bind(query,json,mutation,id,user,input.version,label,user,label)];
  if (input.applyExisting===true) statements.push(db.prepare(`INSERT INTO mail_filter_hits(user_id,email_id,actions)
    SELECT e.user_id,e.email_id,r.actions FROM mail_filters r JOIN email e ON e.user_id=r.user_id
    WHERE r.user_id=? AND r.id=? AND r.mutation=? AND ${filterMatches}`).bind(user,id,mutation));
  statements.push(db.prepare('SELECT * FROM mail_filters WHERE id=? AND user_id=?').bind(id,user));
  const result=await db.batch(statements),row=result.at(-1).results[0];
  if (row?.mutation!==mutation) {
    if (input.version===0 && row?.version===1 && row.criteria===query && row.actions===json) return exposed(row);
    if (label && !await db.prepare('SELECT 1 FROM mailbox_labels WHERE user_id=? AND label_id=?').bind(user,label).first())
      throw new BizError('This label is no longer available.',404);
    throw new BizError(input.version || row ? 'This filter has changed. Reopen it from Settings.' : 'Cannot create another filter.',409);
  }
  return exposed(row);
}
export async function deleteFilter(db,user,id,version) {
  const row=await db.prepare('DELETE FROM mail_filters WHERE id=? AND user_id=? AND version=? RETURNING id').bind(id,user,version).first();
  if (!row) throw new BizError('This filter has changed. Reload your filters.',409);
  return row;
}

import {personPatterns} from '../service/people-filter-sql';
import {excludedPhrases} from '../../../shared/mail-search-words';
import { ensureThreads } from '../mobile/threads';
import {indexWordBatch} from '../service/mail-word-index';
import BizError from '../error/biz-error';
import { filterMatches } from '../service/message-filter-schema';
import { checkCategory } from '../service/inbox-categories';

function invalid(text) {
	throw new BizError(text, 400);
}
function criteria(value = {}) {
  const supported=['from','to','subject','words','excluded','hasAttachment'];
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!supported.includes(key)) ||
      (value.hasAttachment!=null && typeof value.hasAttachment!=='boolean')) invalid('Invalid filter criteria.');
	const result = {};
	for (const [key, limit] of [
		['from', 320],
		['to', 320],
		['subject', 200],
		['words', 200],
		['excluded', 200],
	]) {
		if (value[key] == null || value[key] === '') continue;
		if (typeof value[key] !== 'string' || value[key].length > limit) invalid('Invalid filter criteria.');
		const text = value[key].trim();
		if (text) result[key] = text;
	}
	for (const key of ['from','to']) if(result[key]) result[key+'Patterns']=personPatterns([result[key]]);
  if (value.hasAttachment===true) result.hasAttachment=true;
  const phrases=excludedPhrases(result.excluded);
  if(phrases.length) result.excludedQuery=phrases.map(word=>'"'+word+'"').join(' OR ');
  else if(result.excluded)invalid('Enter a word or phrase.');
  if (!Object.keys(result).length) invalid('Choose at least one search criterion.');
	return result;
}

function actions(value = {}) {
  if (!value || typeof value!=='object' || Array.isArray(value)) invalid('Invalid filter actions.');
	const result = {};
	for (const key of ['archive', 'read', 'star']) if (value[key] === true) result[key] = true;
	if (typeof value.important === 'boolean') result.important = value.important;
	if (value.category) result.category = checkCategory(value.category);
	if (value.labelId != null) {
		if (!Number.isSafeInteger(value.labelId) || value.labelId < 1) invalid('Choose a label.');
		result.labelId = value.labelId;
	}
	if (!Object.keys(result).length) invalid('Select at least one filter action.');
	return result;
}

function exposed(row) {
	const { fromPatterns,toPatterns,excludedQuery, ...criteria } = JSON.parse(row.criteria);
	return { id: row.id, version: row.version, criteria, actions: JSON.parse(row.actions) };
}
export async function listFilters(db, user) {
	const { results } = await db.prepare('SELECT * FROM mail_filters WHERE user_id=? ORDER BY rowid').bind(user).all();
	return results.map(exposed);
}
// The search index tracks its backfill cursor and pending HTML by owner. Drain several
// bounded pages per request while leaving time for the preview itself.
async function prepareExclusions(db,user){
  const deadline=Date.now()+500;
  do { if(await indexWordBatch(db,user,null))return true; } while(Date.now()<deadline);
  return false;
}
const pendingWords='EXISTS (SELECT 1 FROM mail_word_pending WHERE user_id=?)';
export async function previewFilter(db, user, input) {
	const rule = JSON.stringify(criteria(input));
	if (input.excluded && !(await prepareExclusions(db,user))) return { preparing: true };
	await ensureThreads(db, user);
	const row = await db
		.prepare(
			`WITH r AS (SELECT ? AS user_id,? AS criteria)
    SELECT count(DISTINCT coalesce(m.thread_id,'message:'||e.email_id)) AS conversations, (? AND ${pendingWords}) AS pending
    FROM email e JOIN r ON r.user_id=e.user_id LEFT JOIN mobile_thread_members m ON m.email_id=e.email_id AND m.user_id=e.user_id
    WHERE ${filterMatches}`,
		)
		.bind(user, rule, input.excluded ? 1 : 0, user)
		.first();
	return row.pending ? {preparing:true} : {conversations:row.conversations};
}
export async function saveFilter(db, user, id, input) {
	if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(input.version) || input.version < 0) invalid('Invalid filter revision.');
	const query = JSON.stringify(criteria(input.criteria)),
		action = actions(input.actions),
		json = JSON.stringify(action);
	const mutation = crypto.randomUUID(),
		label = action.labelId || null;
	const validLabel = '(? IS NULL OR EXISTS (SELECT 1 FROM mailbox_labels WHERE user_id=? AND label_id=?))';
	if (input.applyExisting === true && input.criteria?.excluded && !(await prepareExclusions(db,user)))
		return { preparing: true };
	const indexesWords=Boolean(input.applyExisting && input.criteria?.excluded);
  const ready='(?=0 OR NOT '+pendingWords+')';
  const statements = [
		input.version === 0
			? db
					.prepare(
						`INSERT INTO mail_filters(id,user_id,criteria,actions,mutation) SELECT ?,?,?,?,? WHERE ${validLabel} AND ${ready}
        ON CONFLICT(id) DO NOTHING`,
					)
					.bind(id, user, query, json, mutation, label, user, label,Number(indexesWords),user)
			: db
					.prepare(
						`UPDATE mail_filters SET criteria=?,actions=?,mutation=?,version=version+1 WHERE id=? AND user_id=? AND version=? AND ${validLabel} AND ${ready}`,
					)
					.bind(query, json, mutation, id, user, input.version, label, user, label,Number(indexesWords),user),
	];
	if (input.applyExisting === true)
		statements.push(
			db
				.prepare(
					`INSERT INTO mail_filter_hits(user_id,email_id,actions)
    SELECT e.user_id,e.email_id,r.actions FROM mail_filters r JOIN email e ON e.user_id=r.user_id
    WHERE r.user_id=? AND r.id=? AND r.mutation=? AND ${filterMatches}`,
				)
				.bind(user, id, mutation),
		);
	statements.push(db.prepare('SELECT (? AND '+pendingWords+') AS pending').bind(Number(indexesWords),user));
  statements.push(db.prepare('SELECT * FROM mail_filters WHERE id=? AND user_id=?').bind(id, user));
	const result = await db.batch(statements),
		row = result.at(-1).results[0];
	if (row?.mutation !== mutation) {
    if(result.at(-2).results[0].pending)return {preparing:true};
		if (input.version === 0 && row?.version === 1 && row.criteria === query && row.actions === json) return exposed(row);
		if (label && !(await db.prepare('SELECT 1 FROM mailbox_labels WHERE user_id=? AND label_id=?').bind(user, label).first()))
			throw new BizError('This label is no longer available.', 404);
		throw new BizError('This filter has changed. Reopen it from Settings.', 409);
	}
	return exposed(row);
}
export async function deleteFilter(db, user, id, version) {
	const row = await db
		.prepare('DELETE FROM mail_filters WHERE id=? AND user_id=? AND version=? RETURNING id')
		.bind(id, user, version)
		.first();
	if (!row) throw new BizError('This filter has changed. Reload your filters.', 409);
	return row;
}

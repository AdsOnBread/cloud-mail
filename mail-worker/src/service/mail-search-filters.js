import {personPatterns,peopleSQL} from './people-filter-sql';
import {addExcludedFilter} from './mail-word-index';
import {sizeCriterion} from '../../../shared/mail-search-size';
import {peopleTerms} from '../../../shared/mail-search-people';
import {searchDateBounds} from "../../../shared/mail-search-date";
import { attachedFile } from "./mailbox-attachments";

export function addPeopleFilter(params, field, columns, filters, args, suggestions=false) {
  const terms=peopleTerms(params,field);
  if (!terms.length) return;
  const patterns=personPatterns(terms,suggestions);
  filters.push(peopleSQL(field,columns,'?',patterns.some(term=>term.pairs.length)));
  args.push(JSON.stringify(patterns));
}
export function addSizeFilter(params, filters, args, {columns,files,raw}) {
  const criterion=sizeCriterion(params);
  if (!criterion) return;
  const parts=columns.map(column=>`coalesce(length(cast(${column} as blob)),0)`);
  parts.push(`coalesce((${files}),0)`);
  const estimate=parts.join('+');
  const bytes=raw ? `coalesce(${raw},${estimate})` : `(${estimate})`;
  filters.push(bytes+(criterion.larger ? '>?' : '<?'));
  args.push(criterion.bytes);
}

// Both the conversation and message lists use "e" for the owned, visible email.
export function addMailFilters(params, filters, args, {conversation = false} = {}) {
  if (String(params.isMuted)==='1') filters.push('EXISTS(SELECT 1 FROM conversation_mutes mute WHERE mute.user_id=e.user_id AND mute.email_id=e.email_id)');
  addExcludedFilter(params,filters,args);
  addPeopleFilter(params, 'from', ['e.send_email', 'e.name'], filters, args);
  addPeopleFilter(params, 'to', ['e.recipient', 'e.cc', "CASE WHEN e.type=1 THEN e.bcc ELSE '' END"], filters, args);
  if (params.subject?.trim()) {
    filters.push('instr(lower(e.subject),lower(?))>0');
    args.push(params.subject.trim().slice(0,200));
  }
	if (String(params.hasAttachment) === '1')
		filters.push(conversation
      ? `EXISTS (SELECT 1 FROM mobile_thread_members fm JOIN email e ON e.email_id=fm.email_id AND e.user_id=fm.user_id
          JOIN account fa ON fa.account_id=e.account_id AND fa.user_id=e.user_id AND fa.is_del=0
          JOIN attachments att ON ${attachedFile} WHERE fm.user_id=m.user_id AND fm.thread_id=m.thread_id
          AND e.is_del=0 AND e.trashed_at IS NULL AND e.status NOT IN (6,7))`
      : `EXISTS (SELECT 1 FROM attachments att WHERE ${attachedFile})`);
	if (String(params.isUnread) === '1') filters.push('e.type=0 AND e.unread=0');
  addSizeFilter(params,filters,args,{
    raw:'e.raw_size',columns:['e.subject','e.text','e.content'],
    files:'SELECT sum(att.size) FROM attachments att WHERE att.email_id=e.email_id AND att.user_id=e.user_id AND att.account_id=e.account_id',
  });
  addSearchDates(params, 'e.create_time', filters, args);
}

// Callers provide the creation-time column, independently of the folder or pagination order.
export function addSearchDates(params, column, filters, args) {
  const {after, before} = searchDateBounds(params);
  if (after !== null) {
    filters.push(column + ">=datetime(?,'unixepoch')");
    args.push(after);
  }
  if (before !== null) {
    filters.push(column + "<datetime(?,'unixepoch')");
    args.push(before);
  }
}

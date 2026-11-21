import {peopleTerms} from '../../../shared/mail-search-people';
import {searchDateBounds} from "../../../shared/mail-search-date";
import { attachedFile } from "./mailbox-attachments";

export function addPeopleFilter(params, field, columns, filters, args) {
  const terms = peopleTerms(params, field);
  if (!terms.length) return;
  if (terms.length === 1) {
    filters.push('(' + columns.map(column => `instr(lower(${column}),lower(?))>0`).join(' OR ') + ')');
    args.push(...columns.map(() => terms[0]));
    return;
  }
  const matches = columns.map(column => `instr(lower(${column}),lower(person.value))>0`).join(' OR ');
  filters.push(`EXISTS (SELECT 1 FROM json_each(?) person WHERE ${matches})`);
  args.push(JSON.stringify(terms));
}

// Both the conversation and message lists use "e" for the owned, visible email.
export function addMailFilters(params, filters, args, {conversation = false} = {}) {
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

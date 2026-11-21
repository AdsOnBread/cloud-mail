import {formatDay,parseDay} from './dates';

export const olderChoices = [
  ['1w', 'Older than a week'], ['1m', 'Older than a month'],
  ['6m', 'Older than 6 months'], ['1y', 'Older than a year'],
];
export const recentChoices = [['1','Past day'],['7','Past week'],['30','Past month'],['365','Past year']];

export function rangeInput(date) {
  const pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
}
export function parseRangeInput(text) {
  return parseDay(text.trim().replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, '$1-$2-$3'));
}
export function midnight(date, nextDay = false) {
  const local = new Date(date);
  if (nextDay) local.setDate(local.getDate() + 1);
  local.setHours(0, 0, 0, 0);
  return Math.floor(local.getTime() / 1000);
}
export function rangeDates(filters) {
  const day = (value, offset) => value == null ? null : new Date((Number(value) + offset) * 1000);
  return [day(filters.dateAfter, 0), day(filters.dateBefore, -1)];
}
export function timeCaption(filters) {
  const preset = olderChoices.find(([key]) => key === filters.olderThan) || recentChoices.find(([key]) => key === String(filters.days));
  if (preset) return preset[1];
  const [start,end] = rangeDates(filters);
  if (start && end) return formatDay(start) + ' – ' + formatDay(end);
  if (start) return 'After ' + formatDay(start);
  if (end) return 'Before ' + formatDay(end);
  return 'Any time';
}
export function withoutTime(filters) {
  const {days,olderThan,dateAfter,dateBefore,...rest} = filters;
  return rest;
}

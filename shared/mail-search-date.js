// Preserve the day of the month when looking back, clamping at the end of shorter months.
export function olderCutoff(period, now = new Date()) {
  if (period === '1w') return Math.floor(now.getTime() / 1000) - 7 * 86400;
  const months = {'1m':1, '6m':6, '1y':12}[period];
  if (typeof months !== 'number') return null;
  const date = new Date(now);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(now.getUTCDate(), last));
  return Math.floor(date.getTime() / 1000);
}

export function searchDateBounds(params, now = new Date()) {
  function timestamp(value) {
    if (value == null || !/^-?\d+$/.test(String(value))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= -62135596800 && number <= 253402300799 ? number : null;
  }
  const days = Number(params.days);
  const after = timestamp(params.dateAfter);
  const recent = [1,7,30,365].includes(days) ? Math.floor(now.getTime()/1000) - days*86400 : null;
  return {
    after:recent === null ? after : Math.max(after ?? recent, recent),
    before:olderCutoff(params.olderThan, now) ?? timestamp(params.dateBefore),
  };
}

export function withinDateBounds(milliseconds, {after, before}) {
  return (after === null || milliseconds >= after * 1000) && (before === null || milliseconds < before * 1000);
}

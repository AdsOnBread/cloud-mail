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
    return Number.isSafeInteger(number) && number >= -62135596800 && number <= 253402300800 ? number : null;
  }
  return {
    after:timestamp(params.dateAfter),
    before:olderCutoff(params.olderThan, now) ?? timestamp(params.dateBefore),
  };
}

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.locale('en')
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function fromNow(date) {
    const d = dayjs.utc(date).tz(timeZone);
    const now = dayjs();
    const diffSeconds = now.diff(d, 'second');
    const diffMinutes = now.diff(d, 'minute');
    const diffHours = now.diff(d, 'hour');
    if (now.isSame(d, 'day')) {
        if (diffSeconds < 60) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes} min ago`;
        if (diffHours < 2) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return d.format('hh:mm A');
    }
    return d.year() === now.year() ? d.format('MMM D') : d.format('MMM D, YYYY');
}

export function updateNow(date) {
    return fromNow(date);
}

export function formatDetailDate(time) {
    const d = dayjs.utc(time).tz(timeZone);
    return d.year() === dayjs().year()
        ? d.format('ddd, MMM D, h:mm A')
        : d.format('ddd, MMM D, YYYY, h:mm A');
}

export function tzDayjs(time) {
    return dayjs.utc(time).tz(timeZone)
}

export function toUtc(time) {
    return dayjs(time).utc()
}


export function mailboxDate(value) {
    const date = tzDayjs(value);
    if (!value || !date.isValid()) return '';
    if (date.isSame(dayjs(), 'day')) return date.format('h:mm A');
    return date.format(date.year() === dayjs().year() ? 'MMM D' : 'M/D/YY');
}

export function readerTimestamp(value, now = new Date()) {
    if (value == null || value === '') return null;
    const date = tzDayjs(value);
    if (!date.isValid()) return null;
    const today = dayjs(now).tz(timeZone);
    const sameDay = today.isSame(date, 'day');
    const sameYear = today.year() === date.year();
    const stamp = sameDay ? date.format('h:mm A') : date.format(sameYear ? 'ddd, MMM D, h:mm A' : 'ddd, MMM D, YYYY, h:mm A');
    const minutes = Math.floor((today.valueOf() - date.valueOf()) / 60000);
    let age = '';
    if (minutes >= 0 && minutes < 7 * 24 * 60) {
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const [count, unit] = days ? [days, 'day'] : hours ? [hours, 'hour'] : [minutes, 'minute'];
        age = minutes === 0 ? 'just now' : count + ' ' + unit + (count === 1 ? '' : 's') + ' ago';
    }
    return {
        label: age ? stamp + ' (' + age + ')' : stamp,
        compact: sameDay ? stamp : date.format(sameYear ? 'MMM D' : 'M/D/YY'),
        full: date.format('ddd, MMM D, YYYY, h:mm A'),
        iso: date.toISOString(),
    };
}

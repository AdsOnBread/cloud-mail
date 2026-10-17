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

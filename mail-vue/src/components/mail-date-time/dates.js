const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Date(2020, month, 1).toLocaleDateString("en-US", { month: "long" }),
);

export function calendarDate(year, month, day) {
  return new Date(year, month, day, 12);
}
export function formatDay(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function parseDay(text) {
  const value = text.trim();
  let year, month, day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    [, year, month, day] = match;
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value))) {
    [, month, day, year] = match;
  } else if ((match = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value))) {
    const name = match[1].toLowerCase();
    month =
      monthNames.findIndex((full) =>
        [full, full.slice(0, 3)].some((part) => part.toLowerCase() === name),
      ) + 1;
    [, , day, year] = match;
  } else return null;
  const date = calendarDate(+year, +month - 1, +day);
  return +year >= 1000 &&
    date.getFullYear() === +year &&
    date.getMonth() === +month - 1 &&
    date.getDate() === +day
    ? date
    : null;
}
export function parseTime(text) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (minute > 59 || hour > 23) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  }
  return { hour, minute };
}
export function localTime(day, time) {
  const result = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time.hour,
    time.minute,
  );
  // A clock that skips forward can normalize a nonexistent local time into a different hour.
  return result.getDate() === day.getDate() &&
    result.getHours() === time.hour &&
    result.getMinutes() === time.minute
    ? result
    : null;
}
export function moveMonth(date, step) {
  const last = calendarDate(date.getFullYear(), date.getMonth() + step + 1, 0);
  return calendarDate(
    last.getFullYear(),
    last.getMonth(),
    Math.min(date.getDate(), last.getDate()),
  );
}
export function suggestions(now = new Date()) {
  function nextAt(hour) {
    const date = new Date(now);
    date.setHours(hour, 0, 0, 0);
    if (date <= now) date.setDate(date.getDate() + 1);
    return date;
  }
  const morning = nextAt(8),
    afternoon = nextAt(13);
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7));
  monday.setHours(8, 0, 0, 0);
  if (monday <= now) monday.setDate(monday.getDate() + 7);
  const choices = [
    {
      label:
        morning.toDateString() === now.toDateString()
          ? "This morning"
          : "Tomorrow morning",
      when: morning,
    },
    {
      label:
        afternoon.toDateString() === now.toDateString()
          ? "This afternoon"
          : "Tomorrow afternoon",
      when: afternoon,
    },
    { label: "Monday morning", when: monday },
  ];
  return choices
    .filter(
      (option, i) =>
        choices.findIndex((item) => +item.when === +option.when) === i,
    )
    .sort((a, b) => a.when - b.when);
}

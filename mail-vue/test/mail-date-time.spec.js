import { describe, expect, it } from "vitest";
import {
  calendarDate,
  formatDay,
  parseDay,
  parseTime,
  moveMonth,
  suggestions,
} from "../src/components/mail-date-time/dates";

describe("mail date and time picker", () => {
  it("round trips typed dates and rejects rollovers", () => {
    for (const value of [
      "Feb 29, 2028",
      "February 29 2028",
      "2028-02-29",
      "2/29/2028",
    ]) {
      expect(formatDay(parseDay(value))).toBe("Feb 29, 2028");
    }
    for (const value of [
      "Feb 29, 2027",
      "2028-13-01",
      "2027-00-01",
      "11/31/2026",
      "Feb 0, 2030",
    ])
      expect(parseDay(value)).toBeNull();
  });
  it("accepts twelve and twenty-four hour times and preserves midnight and noon", () => {
    expect(parseTime("12:00 am")).toEqual({ hour: 0, minute: 0 });
    expect(parseTime("12 PM")).toEqual({ hour: 12, minute: 0 });
    expect(parseTime("4:45pm")).toEqual(parseTime("16:45"));
    for (const invalid of [
      "4:60 pm",
      "0 am",
      "13 pm",
      "24:00",
      "1:2",
      "4:15 noon",
    ])
      expect(parseTime(invalid)).toBeNull();
  });
  it("keeps month navigation inside short months", () => {
    expect(formatDay(moveMonth(calendarDate(2028, 0, 31), 1))).toBe(
      "Feb 29, 2028",
    );
    expect(formatDay(moveMonth(calendarDate(2028, 1, 29), 12))).toBe(
      "Feb 28, 2029",
    );
  });
  it("offers future local presets in chronological order, including today where available", () => {
    const friday = new Date(2026, 10, 20, 7, 30);
    expect(suggestions(friday).map((s) => s.label)).toEqual([
      "This morning",
      "This afternoon",
      "Monday morning",
    ]);
    expect(suggestions(new Date(2026, 10, 20, 11)).map((s) => s.label)).toEqual(
      ["This afternoon", "Tomorrow morning", "Monday morning"],
    );
    for (const hour of [0, 8, 13, 23])
      for (let day = 15; day < 22; day++) {
        const now = new Date(2026, 10, day, hour);
        const times = suggestions(now).map((s) => +s.when);
        expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
        expect(times.every((time) => time > +now)).toBe(true);
      }
  });
});

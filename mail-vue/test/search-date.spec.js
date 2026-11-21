import {expect,it} from 'vitest';
import {olderCutoff,searchDateBounds,withinDateBounds} from '../../shared/mail-search-date';
import {parseRangeInput,midnight,rangeDates,rangeInput,withoutTime} from '../src/components/mail-date-time/search-range';

it('looks back by calendar months and years even at month end or on leap day',()=>{
  const iso=(p,day)=>new Date(olderCutoff(p,new Date(day))*1000).toISOString();
  expect(iso('1m','2024-03-31T12:35:00Z')).toBe('2024-02-29T12:35:00.000Z');
  expect(iso('1y','2024-02-29T12:35:00Z')).toBe('2023-02-28T12:35:00.000Z');
  expect(iso('6m','2024-08-31T12:35:00Z')).toBe('2024-02-29T12:35:00.000Z');
  const bounds=searchDateBounds({olderThan:'1w'},new Date('2024-03-10T12:00:00Z'));
  expect(withinDateBounds(Date.parse('2024-03-03T12:00:00Z'),bounds)).toBe(false);
  expect(withinDateBounds(Date.parse('2024-03-03T11:59:59Z'),bounds)).toBe(true);
});

it('round-trips a local day through half-open timestamp bounds and clears only date filters',()=>{
  const day=parseRangeInput('2024/02/29');
  expect(parseRangeInput('2023/02/29')).toBeNull();
  const filters={dateAfter:midnight(day),dateBefore:midnight(day,true),from:'pat',hasAttachment:1};
  expect(rangeDates(filters).map(rangeInput)).toEqual(['2024/02/29','2024/02/29']);
  expect(withoutTime(filters)).toEqual({from:'pat',hasAttachment:1});
});

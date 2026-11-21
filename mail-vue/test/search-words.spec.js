import {describe,expect,it,vi} from 'vitest';
import {containsExcluded,excludedPhrases,readSearchBar,searchBarText} from '../../shared/mail-search-words';
import {draftSearchMatcher,draftSummary} from '../src/utils/draft-summary';
import {searchPage} from '../src/services/preparing-search';

describe('excluded search terms',()=>{
  it('round-trips negatives in the search bar without interpreting hyphens inside words or positive quotes',()=>{
    expect(readSearchBar('check-in "keep -here" -fjord -{zephyr "paper lantern"} tail')).toEqual({query:'check-in "keep -here" tail',excluded:'fjord zephyr "paper lantern"'});
    expect(searchBarText('notes','fjord zephyr "paper lantern"')).toBe('notes -{fjord zephyr "paper lantern"}');
    for (const field of ['fjord','"paper lantern"','braces {item}','show-{temp}','"unfinished phrase']) {
      const {query,excluded}=readSearchBar(searchBarText('report',field));
      expect(query).toBe('report');expect(excludedPhrases(excluded)).toEqual(excludedPhrases(field));
    }
  });
  it('matches complete words and quoted phrases in visible saved draft text',()=>{
    const row=draftSummary({subject:'Café newsletter',text:'\r\n',content:'<p style="color:magenta">Paper <b>lantern</b></p>',bcc:['hidden@example.org']});
    const search=excluded=>draftSearchMatcher('',{excluded},[])(row);
    for (const value of ['cafe','"PAPER lantern"','hidden']) expect(search(value)).toBe(false);
    for (const value of ['news','magenta','"lantern cafe"','missing']) expect(search(value)).toBe(true);
    expect(containsExcluded(['κόσμος'],excludedPhrases('κόσμοσ'))).toBe(true);
    expect(containsExcluded(['paper','lantern'],excludedPhrases('"paper lantern"'))).toBe(false);
  });
  it('drops completed results if the session changes during a request',async()=>{
    const old=localStorage.getItem('token');
    try {const result=await searchPage(async()=>{localStorage.setItem('token','replacement');return {threads:[]};},()=>true,vi.fn());expect(result).toBeNull();}
    finally {if(old===null)localStorage.removeItem('token');else localStorage.setItem('token',old);}
  });
});

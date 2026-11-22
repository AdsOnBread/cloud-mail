import {beforeEach,describe,expect,it} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {formatSearchExpression,readSearchExpression} from '../src/utils/search-expression';
import {useMailSearchStore} from '../src/store/mail-search';

describe('mailbox search expressions',()=>{
  it('displays the sender menu and advanced search forms of an address',()=>{
    const filters={from:'alex@example.test',to:'sam@example.test',subject:'status report'};
    expect(formatSearchExpression('',{from:filters.from},{compact:true})).toBe('from:alex@example.test');
    const text=formatSearchExpression('agenda',filters);
    expect(text).toBe('from:(alex@example.test) to:(sam@example.test) subject:(status report) agenda');
    expect(readSearchExpression(text)).toEqual({query:'agenda',filters});
  });

  it.each(['from:(Ann OR Bob)','{from:Ann from:Bob}','from:Ann OR from:Bob'])('applies sender alternatives in %s',text=>{
    expect(readSearchExpression(text)).toEqual({query:'',filters:{from:'Ann',fromAny:'["Bob"]'}});
  });

  it.each(['from:alice OR to:ben','subject:(report) OR has:attachment','{from:alice to:ben}'])('keeps unsupported disjunction %s intact',query=>{
    expect(readSearchExpression(query)).toEqual({query,filters:{}});
  });

  it('keeps literal advanced words, punctuation and significant spaces when editing a generated expression',()=>{
    const filters={from:'Alice  Jones',fromAny:JSON.stringify(['Names (West)','Lee OR Kay','A "quote"']),subject:'Q4 (review)',hasAttachment:1};
    for (const body of ['from:alice','subject:(old)','has:attachment','report (open','"quoted" phrase','first   second','OR','-{old new}']) {
      const text=formatSearchExpression(body,filters);
      expect(readSearchExpression(text+' invoice')).toEqual({query:body+' invoice',filters});
    }
  });

  it('opens typed criteria in their own advanced fields and replaces only the searchable fields',()=>{
    const existing={from:'older',to:'old',subject:'old',days:'7d',sizeValue:'2',sizeUnit:'MB'};
    const {query,filters}=readSearchExpression('FROM:"Project Team" subject:(Q4) words -{old "closed case"} has:attachment is:unread',existing);
    expect(query).toBe('words');
    expect(filters).toEqual({from:'Project Team',subject:'Q4',days:'7d',sizeValue:'2',sizeUnit:'MB',excluded:'old "closed case"',hasAttachment:1,isUnread:1});
    expect(readSearchExpression('revised',filters)).toEqual({query:'revised',filters:{days:'7d',sizeValue:'2',sizeUnit:'MB'}});
  });
});

describe('mailbox search edits',()=>{
  beforeEach(()=>setActivePinia(createPinia()));
  it('uses typed conditions for the next chip and clears the pending text on folder change',()=>{
    const store=useMailSearchStore();
    store.applySearch('',{from:'one'},'from:one');
    store.pendingText='from:two invoice';
    const {query,filters}=store.inputCriteria;
    store.applySearch(query,{...filters,hasAttachment:1});
    expect(store.expression).toBe('from:(two) invoice has:attachment');
    expect(store.query).toBe('invoice');
    expect(store.pendingText).toBeNull();
    store.pendingText='unfinished';
    store.visit('trash');
    expect(store.expression).toBe('');
    expect(store.pendingText).toBeNull();
  });
});

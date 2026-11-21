import {expect,it} from 'vitest';
import {senderLine} from '../src/components/mail-row/senders';

it('keeps single and ambiguous names identifiable',()=>{
  const line=(...names)=>senderLine(names.map((name,lastId)=>({name,lastId}))).map(p=>p.label);
  expect(line('Casey Blue')).toEqual(['Casey Blue']);
  expect(line('Casey Blue','Riley Rose','Casey Green')).toEqual(['Casey Blue','Riley','Casey Green']);
});

it('retains the originator and recent distinct correspondents on a crowded row',()=>{
  const people=['Amir','Bea','Chris','Dev','Em'].map((name,i)=>({name,unread:i===1,lastId:[10,17,14,16,15][i]}));
  expect(senderLine(people).map(p=>[p.separator,p.label,p.unread])).toEqual([
    ['', 'Amir',false],[' .. ','Dev',false],[', ','Bea',true],
  ]);
});

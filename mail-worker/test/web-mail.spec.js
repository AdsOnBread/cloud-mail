import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { dbInit } from '../src/init/init';
import emailService from '../src/service/email-service';
import starService from '../src/service/star-service';
import settingService from '../src/service/setting-service';
const context=()=>({env,text:value=>value,get:()=>({userId:1,email:'admin@example.com'}),set:()=>{},req:{header:()=>undefined}});
async function insert(extra={}) {
  const row={user_id:1,account_id:1,send_email:'sender@example.net',name:'Sender',subject:'Report',text:'Hello',content:'<p>Hello</p>',recipient:'[{"address":"admin@example.com"}]',type:0,status:0,...extra};
  return (await env.db.prepare(`INSERT INTO email (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')}) RETURNING *`).bind(...Object.values(row)).first());
}
const list=(q,extra={})=>emailService.list(context(),{accountId:1,allReceive:0,size:50,timeSort:0,type:0,full:0,q,...extra},1);
beforeEach(async()=>{
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  await dbInit.init(context());
  await env.db.prepare("INSERT INTO user(user_id,email,password,salt) VALUES(1,'admin@example.com','unused','unused'),(2,'other@example.com','unused','unused')").run();
  await env.db.prepare("INSERT INTO account(account_id,email,user_id,name) VALUES(1,'admin@example.com',1,'Admin'),(2,'other@example.com',2,'Other'),(3,'alias@example.com',1,'Alias')").run();
  await settingService.refresh(context());
});
afterEach(()=>vi.restoreAllMocks());
describe('web mail search',()=>{
  it.each([
    ['name','Unique sender'],['send_email','unique@example.net'],['subject','Unique subject'],
    ['recipient','[{"address":"unique@example.net"}]'],['cc','[{"address":"unique@example.net"}]'],
    ['text','Unique plain body'],['content','<p>Unique HTML body</p>'],
  ])('matches %s in both summary and full requests',async(field,value)=>{
    const row=await insert({[field]:value}); await insert();
    const brief=await list('unique');const full=await list('unique',{full:1});
    expect(brief.total).toBe(1);expect(full.total).toBe(1);
    expect(brief.list.map(item=>item.emailId)).toEqual([row.email_id]);
    expect(full.list.map(item=>item.emailId)).toEqual([row.email_id]);
  });
  it('treats percent, underscore, backslash and SQL-like text literally',async()=>{
    for(const value of ['100% complete','one_two','a\\b',"' OR 1=1 --"]) {
      const row=await insert({subject:value});const result=await list(value);
      expect(result.list.map(item=>item.emailId)).toEqual([row.email_id]);
    }
  });
  it('keeps search totals consistent across cursor pages and preserves sort order',async()=>{
    const ids=[];for(let i=0;i<5;i++)ids.push((await insert({subject:'Match '+i})).email_id);
    await insert({subject:'Other'});
    const first=await list('match',{size:2});const second=await list('match',{size:2,emailId:first.list.at(-1).emailId});
    expect(first.total).toBe(5);expect(second.total).toBe(5);
    expect([...first.list,...second.list].map(item=>item.emailId)).toEqual(ids.reverse().slice(0,4));
  });
  it('respects owner, mailbox, all-receive, folder and deleted-mail filters',async()=>{
    const own=await insert({subject:'Match'});const alias=await insert({subject:'Match',account_id:3});
    await insert({subject:'Match',user_id:2,account_id:2});await insert({subject:'Match',is_del:1});await insert({subject:'Match',type:1});
    expect((await list('match')).list.map(item=>item.emailId)).toEqual([own.email_id]);
    expect((await list('match',{allReceive:1})).list.map(item=>item.emailId)).toEqual([alias.email_id,own.email_id]);
    expect((await list('match',{type:1})).list).toHaveLength(1);
    expect((await list('')).total).toBe((await list(undefined)).total);
  });
  it('searches Bcc only in sent copies and masks Bcc in received results',async()=>{
    const received=await insert({bcc:'[{"address":"private@example.net"}]'});
    const sent=await insert({type:1,bcc:'[{"address":"private@example.net"}]'});
    expect((await list('private')).total).toBe(0);
    expect((await list('private',{type:1})).list[0].emailId).toBe(sent.email_id);
    for (const full of [0,1]) expect((await list(undefined,{full})).list.find(item=>item.emailId===received.email_id).bcc).toBe('[]');
  });
  it('searches only owned starred messages and supports cursor pagination',async()=>{
    const first=await insert({subject:'Unique first'});const second=await insert({subject:'Unique second'});const privateRow=await insert({user_id:2,account_id:2,subject:'Unique private'});
    for(const id of [first.email_id,second.email_id])await starService.add(context(),{emailId:id},1);
    await starService.add(context(),{emailId:privateRow.email_id},2);
    const page=await starService.list(context(),{q:'unique',size:1,full:0},1);
    expect(page.list.map(item=>item.emailId)).toEqual([second.email_id]);
    expect((await starService.list(context(),{q:'unique',size:10,emailId:second.email_id,full:1},1)).list.map(item=>item.emailId)).toEqual([first.email_id]);
  });
});
describe('owned web message details',()=>{
  it('returns complete metadata and attachments and only exposes Bcc on sent copies',async()=>{
    const row=await insert({cc:'[{"address":"copy@example.net"}]',bcc:'[{"address":"private@example.net"}]'});
    await env.db.prepare("INSERT INTO attachments(user_id,email_id,account_id,key,filename) VALUES(1,?,1,'attachments/test.txt','test.txt')").bind(row.email_id).run();
    const detail=await emailService.detail(context(),row.email_id,1);
    expect(detail).toMatchObject({text:'Hello',cc:'[{"address":"copy@example.net"}]',bcc:'[]'});expect(detail.attList).toHaveLength(1);
    const sent=await insert({type:1,bcc:'[{"address":"private@example.net"}]'});
    expect((await emailService.detail(context(),sent.email_id,1)).bcc).toContain('private@example.net');
  });
  it('returns 404 for other users, missing messages, deleted messages and deleted mailboxes',async()=>{
    const foreign=await insert({user_id:2,account_id:2});const deleted=await insert({is_del:1});const alias=await insert({account_id:3});
    await env.db.prepare('UPDATE account SET is_del=1 WHERE account_id=3').run();
    for(const id of [foreign.email_id,deleted.email_id,alias.email_id,99999,'invalid',0]) await expect(emailService.detail(context(),id,1)).rejects.toMatchObject({code:404});
  });
});

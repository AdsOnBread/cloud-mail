import {containsExcluded,excludedPhrases} from '../../shared/mail-search-words.js';
import {fileContentBytes,matchesSize,sizeCriterion,storedMessageBytes} from '../../shared/mail-search-size.js';
import {peopleSuggestions} from '../../shared/mail-people-suggestions.js';
import {maxPeople,peopleTerms,matchesPeople} from '../../shared/mail-search-people.js';
import {searchDateBounds,withinDateBounds} from '../../shared/mail-search-date.js';
// Isolated visual-test preview. All mail and users below are fictional; sends remain in memory.
import { inLabelBranch } from '../src/components/mail-labels/tree.js';
import { groupThreads } from '../../mail-worker/src/mobile/threads.js';
import { createServer as createHTTPServer } from 'node:http';
import { createServer, loadConfigFromFile } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
const accounts=[{accountId:1,email:'alex@example.com',name:'Alex Morgan',sort:10,allReceive:0},{accountId:2,email:'hello@example.com',name:'Cloudmail',sort:0,allReceive:0}];
const user={userId:1,email:'alex@example.com',name:'Alex Morgan',account:accounts[0],permKeys:['email:send','email:delete','account:query','account:add','account:delete'],role:{name:'Member',sendType:'day',sendCount:100,accountCount:10},sendCount:12};
const settings={title:'Cloudmail',domainList:['@example.com'],manyEmail:0,addEmail:0,addEmailVerify:1,minEmailPrefix:1,send:0,autoRefresh:0,notice:1,loginOpacity:1,r2Domain:'',background:'',register:1};
const rows=[
 ['Maya Chen','maya@example.net','A few ideas for the next chapter','Hey Alex, I pulled together a few thoughts for our next release. Would love your take.'],
 ['Oliver at Figma','oliver@example.net','Your weekly design inspiration','Fresh perspectives, useful resources, and a little inspiration for your next project.'],
 ['Jordan Lee','jordan@example.net','Re: Saturday morning coffee?','That sounds perfect. Let’s meet at the usual spot around 10. See you there!'],
 ['Cloudflare','updates@example.net','The developer newsletter — October','What’s new this month: useful tools, platform updates, and stories from the community.'],
 ['Sam Rivera','sam@example.net','Website refresh · final feedback','The latest version is looking great. I’ve left a few comments for you to review.'],
 ['Notion','team@example.net','A little more organized','Your workspace is ready when you are. Here’s what happened while you were away.'],
 ['Taylor Brooks','taylor@example.net','Photos from our weekend away','Finally got around to sorting these! There are some really good ones in here.'],
 ['GitHub','notifications@example.net','Your pull request has been approved','All checks have passed. Your changes are ready to merge.'],
 ['Avery Williams','avery@example.net','Lunch next week?','I’ll be in your neighborhood on Tuesday. Do you have time to grab a bite?'],
 ['The Browser','hello@example.net','Something worth reading','Five thoughtful reads to make a little time for this weekend.'],
 ['Morgan Ellis','morgan@example.net','October project notes','Sharing the updated notes and next steps from our last conversation.'],
 ['Casey Park','casey@example.net','Thanks for the introduction','Really appreciate you connecting us. We had a great conversation this afternoon.'],
 ['Linear','updates@example.net','Your team’s week in review','A quick look at what moved forward this week.'],
 ['Riley Stone','riley@example.net','A quick question about the proposal','I’ve been going through the details and have one small question before we kick things off.'],
 ['Jamie Carter','jamie@example.net','See you on Monday','Looking forward to catching up. I’ll send over an agenda beforehand.'],
 ['Alex Morgan','alex@example.com','Re: Website refresh · final feedback','Thanks Sam! I’ll take a look this afternoon and get back to you.'],
].map(([name,sendEmail,subject,text],index)=>({emailId:100-index,userId:1,accountId:1,name,sendEmail,subject,text,content:`<div style="font:14px/1.7 Arial;color:inherit"><p>Hi Alex,</p><p>${text}</p><p>I’ve added the details below so we can keep everything moving. Let me know what you think when you have a chance.</p><p>Thanks,<br>${name.split(' ')[0]}</p></div>`,listText:text,recipient:JSON.stringify([{address:'alex@example.com'},{address:'sam@example.net'}]),cc:JSON.stringify([{address:'hello@example.com'},{address:'jordan@example.net'}]),bcc:index===15?'[{"address":"private@example.net"}]':'[]',type:index===15?1:0,status:index===15?2:0,isStar:[0,4,6].includes(index)?1:0,unread:index<4?0:1,createTime:`2026-10-17 ${String(15-Math.floor(index/4)).padStart(2,'0')}:${String(45-index*2).padStart(2,'0')}:00`,attList:[]}));
// Explicit links exercise received messages, sent replies, and an older multi-page conversation.
rows[0].messageId='<ideas@example.net>';
rows.push({...rows[0],emailId:38,name:'Fieldwork Shop',sendEmail:'receipts@shop.example',subject:'Your receipt from Fieldwork',messageId:'<receipt@shop.example>',unread:0});
rows.push({...rows[0],emailId:101,type:1,status:2,unread:1,name:'Alex Morgan',sendEmail:'alex@example.com',recipient:'[{"address":"maya@example.net"}]',subject:'Re: A few ideas for the next chapter',text:'These are great ideas. I added a few notes.',content:'<p>These are great ideas. I added a few notes.</p>',inReplyTo:'<ideas@example.net>',replyToEmailId:100});
rows.push({...rows[0],emailId:102,subject:'Re: A few ideas for the next chapter',text:'Thanks! The first option is my favorite. What do you think?',content:'<p>Thanks! The first option is my favorite. What do you think?</p>',inReplyTo:'<ideas@example.net>',replyToEmailId:100});
for(let i=40;i<75;i++)rows.push({...rows[0],emailId:i,messageId:`<archive-${i}@example.net>`,replyToEmailId:i===40?0:40,subject:'Release planning archive',text:`Planning update ${i-39}`,content:`<p>Planning update ${i-39}</p>`,unread:1});
const fixtureText='Project notes\nReview the fall colors and send feedback on Friday.';
const fixtureFiles=[
 {attId:501,filename:'Project notes.txt',mimeType:'text/plain',size:fixtureText.length},
 {attId:502,filename:'Color study.png',mimeType:'image/png',size:68},
];
rows.find(row=>row.emailId===100).attList=fixtureFiles;
const attachmentSummary=files=>files.length ? {attachmentCount:files.length,attachments:files.slice(0,3)} : {};
const filedCategory=new Map();
const importanceChoices = new Map();
let importanceRevision = 0;
function importanceReason(members) {
  const latest = members.map(row => importanceChoices.get(row.emailId)).filter(Boolean)
    .sort((a, b) => b.revision - a.revision)[0];
  if (latest) return latest.important ? 'user' : null;
  const sent=members.filter(row=>row.type===1 && [1,2].includes(row.status));
  if(sent.some(row=>row.replyToEmailId || row.inReplyTo))return 'reply';
  return sent.some(row=>{
    const email=accounts.find(account=>account.accountId===row.accountId)?.email;
    const to=typeof row.recipient==='string' ? JSON.parse(row.recipient || '[]') : row.recipient || [];
    return email && to.some(person=>(person.address || person).toLowerCase()===email.toLowerCase());
  }) ? 'direct' : null;
}
function scheduledImportance(d,email) {
  if (d.mailboxImportant!=null)return d.mailboxImportant ? 'user' : null;
  if (d.sendType==='reply' && d.emailId)return 'reply';
  return d.receiveEmail.some(a=>a.toLowerCase()===email.toLowerCase()) ? 'direct' : null;
}
const fixtureCategory = new Map([['Oliver at Figma','promotions'],['Fieldwork Shop','updates'],['GitHub','updates'],['Linear','updates'],['The Browser','forums'],['Taylor Brooks','social']]);
const cloudDrafts=new Map(),draftEvents=[],sendAttempts=new Map();let nextDraft=1;
const trashOperations=new Map();
function recordDraft(draft){draftEvents.push({seq:draftEvents.length+1,draftId:draft.draftId,operation:draft.state!=='draft'?'delete':'upsert',draft:draft.state!=='draft'?null:structuredClone(draft)});}
function previewSend(form) {
 const sender=accounts.find(a=>a.accountId===form.accountId) || accounts[0];
 const source=form.sendType==='reply' ? rows.find(r=>r.emailId===form.emailId) : null;
 const recipients=values=>JSON.stringify((values || []).map(address=>({address})));
 const row={...form,emailId:Math.max(0,...rows.map(r=>r.emailId))+1,messageId:'<'+crypto.randomUUID()+'@example.test>',
   replyToEmailId:source?.emailId || 0,inReplyTo:source?.messageId || '',type:1,status:2,userId:user.userId,
   accountId:sender.accountId,sendEmail:sender.email,name:form.name || sender.name,
   recipient:recipients(form.receiveEmail),cc:recipients(form.cc),bcc:recipients(form.bcc),
   createTime:new Date().toISOString(),unread:1,isStar:Number(!!form.mailboxStarred),listText:form.text||form.content,trashedAt:null,attList:[]};
 rows.unshift(row);
 return [row];
}
function grouped(){
 const groups=groupThreads(rows.filter(row=>!row.trashedAt).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/[A-Z]/g,l=>'_'+l.toLowerCase()),value]))),accounts.map(account=>account.email));
 return groups.reduce((map,member)=>{const thread=map.get(member.threadId)||[];thread.push(rows.find(row=>row.emailId===member.emailId));map.set(member.threadId,thread);return map;},new Map());
}
function threadFor(id){return [...grouped().values()].find(thread=>thread.some(row=>row.emailId===Number(id)))||[];}
const systemLabels={};
function previewSenders(members) {
  const people = new Map();
  for (const row of members.toSorted((a,b)=>a.emailId-b.emailId)) {
    const key = row.type===1 ? 'me' : row.sendEmail.toLowerCase();
    const person = people.get(key) || {name:row.type===1 ? 'me' : row.name || row.sendEmail, unread:false};
    person.unread ||= row.type===0 && row.unread===0;
    person.lastId = row.emailId;
    people.set(key,person);
  }
  return [...people.values()];
}
const labels = new Map(), membership = new Map(), savedContacts = new Map();
let recentColors=[];
let nextLabel = 1;
function threadLabels(members) {
 return [...new Set(members.flatMap(row=>[...(membership.get(row.emailId)||[])]))];
}
const filing = new Map(), moveUndos = new Map(), moveRequests = new Map();
function replayMove(res,request,intent){
  if(!request || !moveRequests.has(request))return false;
  const prior=moveRequests.get(request), same=prior.intent===intent;
  const result=moveUndos.get(prior.token)?.members.size ? {undoToken:prior.token} : {alreadyProcessed:true};
  res.writeHead(same?200:409,{'Content-Type':'application/json'});
  res.end(JSON.stringify(same?{code:200,data:result}:{code:409,message:'This request is for a different move.'}));
  return true;
}

function filingAnchor(members) {
 const received=members.filter(row=>row.type===0 && row.status===0);
 return received.length ? Math.max(...received.map(row=>row.emailId)) : Math.min(...members.map(row=>row.emailId));
}
function matchesDate(created,p) {
 const utc = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(created);
 return withinDateBounds(Date.parse(utc ? utc[1]+'T'+utc[2]+'Z' : created),searchDateBounds(p));
}
function matchesRowSize(row,p,files) {
 const criterion=sizeCriterion(p);
 return !criterion || matchesSize(row.rawSize ?? storedMessageBytes(row,(files || []).reduce((sum,file)=>sum+fileContentBytes(file),0)),criterion);
}
function matchesFilters(row,p) {
 const matches=(values,value)=>!value || values.some(v=>String(v||'').toLowerCase().includes(value.toLowerCase()));
 const recipients=[row.recipient,row.cc,...(row.type===1?[row.bcc]:[])].flatMap(v=>typeof v==='string'?JSON.parse(v||'[]'):v||[]).flatMap(v=>typeof v==='string'?[v]:[v.name,v.address]);
 return !containsExcluded([row.subject,row.text,row.name,row.sendEmail,...recipients],excludedPhrases(p.excluded)) && matchesPeople([{name:row.name,address:row.sendEmail}],peopleTerms(p,'from')) && matchesPeople([row.recipient,row.cc,...(row.type===1?[row.bcc]:[])].flatMap(v=>typeof v==='string'?JSON.parse(v||'[]'):v||[]),peopleTerms(p,'to')) &&
    matches([row.subject],p.subject) && (!p.hasAttachment || row.attList?.length>0) && (!p.isUnread || row.type===0 && row.unread===0) &&
    matchesDate(row.createTime,p) && matchesRowSize(row,p,row.attList);
}
let lastSchedule=null;
let generalSettings={version:0,undoSeconds:null,replyAll:false,keyboardShortcuts:false,hoverActions:true};
let signatures={version:0,items:[],defaults:{},beforeQuote:false};
const api=createHTTPServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3001');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Accept-Language');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 let body='';for await(const chunk of req) body+=chunk;
 let data={};const path=url.pathname.replace(/^\/api/,'');
 if(path==='/v1/attachments/501/content'||path==='/v1/attachments/502/content'){
   const text=path.includes('/501/');
   res.writeHead(200,{'Content-Type':text?'text/plain':'image/png'});
   res.end(text?(url.searchParams.get('preview')==='text' ? fixtureText.slice(0,1024) : fixtureText):Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jnt8AAAAASUVORK5CYII=','base64'));return;
 }
 if(path.startsWith('/v1/drafts/attachments/')){
   const id=path.split('/')[4],file=[...cloudDrafts.values()].flatMap(d=>d.attachments).find(f=>f.attachmentId===id);
   if(!file){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',file.mimeType||'application/octet-stream');const bytes=Buffer.from(file.content.replace(/^data:[^,]*;base64,/,''),'base64');
   res.end(url.searchParams.get('preview')==='text' ? bytes.subarray(0,1024) : bytes);return;
 }
 if(path==='/v1/system-labels')data=systemLabels;
 else if(path.startsWith('/v1/system-labels/') && req.method==='PUT'){
   const folder=path.split('/').at(-1),{mode}=JSON.parse(body);systemLabels[folder]=mode;data={folder,mode};
 }else if(path==='/v1/general-settings'){
   if(req.method==='PUT'){
     const {signatures:edited,...update}=JSON.parse(body);
     if(update.version!==generalSettings.version || (edited && edited.version!==signatures.version)){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Settings changed elsewhere.'}));return;}
     generalSettings={...generalSettings,...update,version:update.version+1};
     if(edited)signatures={...edited,version:edited.version+1};
     data=edited ? {...generalSettings,signatures} : generalSettings;
   }else data=generalSettings;
 }else if(path==='/v1/signatures'){
   if(req.method==='PUT'){
     const update=JSON.parse(body);
     if(update.version!==signatures.version){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Signatures changed elsewhere.'}));return;}
     signatures={...update,version:signatures.version+1};
   }
   data=signatures;
 }
 else if(path==='/v1/connections')data={connections:[]};
 else if(path==='/v1/drafts/changes')data={changes:draftEvents.filter(e=>e.seq>Number(url.searchParams.get('after')||0)).map(e=>{
   const latest=cloudDrafts.get(e.draftId), draft=latest && latest.state==='draft' ? latest : null;
   return {...e,operation:draft?'upsert':'delete',draft};
 }),cursor:draftEvents.length,hasMore:false};
 else if(path==='/v1/scheduled'){
   const p=Object.fromEntries(url.searchParams),scope=Number(p.accountId);
   const now=Math.floor(Date.now()/1000);
   const queued=[...cloudDrafts.values()].filter(d=>d.scheduledAt && (!scope || d.accountId===scope));
   if(p.countOnly==='1')data={count:queued.length,...(p.includeInboxUnread==='1'?{inboxUnread:queued.filter(d=>d.scheduledUnread && d.scheduledInbox && !(d.scheduledWakeAt>now)).length}:{}),...(p.includeNextWake==='1'?{nextWakeAt:Math.min(...queued.map(d=>d.scheduledWakeAt).filter(t=>t>now)) || null}:{})};
   else data=queued.filter(d=>(!Number(p.isUnread) || d.scheduledUnread) && matchesDate(d.createTime,p) && matchesRowSize(d,p,d.attachments)).map(d=>{
     const sender=accounts.find(a=>a.accountId===d.accountId);
     const attachments=(d.attachments||[]).filter(f=>!f.contentId).map(({content,...f})=>f);
     return {draftId:d.draftId,version:d.version,accountId:d.accountId,state:d.state,labelIds:d.labelIds || [],subject:d.subject,recipients:d.receiveEmail,cc:d.cc||[],bcc:d.bcc||[],
       inbox:Number(Boolean(d.scheduledInbox && !(d.scheduledWakeAt>now))),wakeAt:d.scheduledWakeAt || 0,unread:d.scheduledUnread||0,starred:d.mailboxStarred||0,importanceReason:scheduledImportance(d,sender.email),
       senderEmail:sender.email,mailboxName:sender.name,senderName:d.name||sender.name,preview:d.text,sendAt:d.scheduledAt,attachmentCount:attachments.length,attachments:attachments.slice(0,3)};
   }).filter(row=>{
     const matches=(values,value)=>!value||values.some(v=>String(v||'').toLowerCase().includes(value.toLowerCase()));
     const recipients=[...row.recipients,...row.cc,...row.bcc];
     return (!p.labelId || row.labelIds.includes(Number(p.labelId))) && (p.mark!=='inbox'||row.inbox) && (p.mark!=='snoozed'||row.wakeAt>now) && (p.mark!=='starred'||row.starred) && (p.mark!=='important'||row.importanceReason) && matchesPeople([{address:row.senderEmail,name:row.senderName}],peopleTerms(p,'from'))&&matchesPeople(recipients,peopleTerms(p,'to'))&&matches([row.subject],p.subject)&&
       !containsExcluded([row.senderEmail,row.senderName,row.subject,row.preview,...recipients],excludedPhrases(p.excluded)) && matches([row.senderEmail,row.senderName,row.subject,row.preview,...recipients],p.q)&&(!p.hasAttachment||row.attachmentCount);
   }).sort((a,b)=>(p.mark==='snoozed' ? a.wakeAt-b.wakeAt : a.sendAt-b.sendAt)||a.draftId-b.draftId);
 }else if(path==='/v1/scheduled/trash'){
   const {messages,edit}=JSON.parse(body);
   const previous=trashOperations.get(edit);
   if(previous && previous.intent===JSON.stringify(messages)){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({code:200,data:{edit,count:messages.length}}));return;}
   const selected=messages.map(m=>cloudDrafts.get(m.draftId));
   if(selected.some((d,i)=>!d?.scheduledAt || d.version!==messages[i].version)){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Message changed.'}));return;}
   for(const d of selected){
     const recipient=key=>JSON.stringify((d[key]||[]).map(address=>({address})));
     const row={emailId:Math.max(0,...rows.map(r=>r.emailId))+1,scheduledDraftId:d.draftId,userId:1,accountId:d.accountId,
       subject:d.subject,name:d.name,sendEmail:accounts.find(a=>a.accountId===d.accountId).email,text:d.text,content:d.content,
       type:1,status:0,isStar:Number(!!d.mailboxStarred),unread:1-(d.scheduledUnread||0),createTime:d.createTime,trashedAt:new Date().toISOString(),
       recipient:recipient('receiveEmail'),cc:recipient('cc'),bcc:recipient('bcc'),attList:[]};
     rows.unshift(row);membership.set(row.emailId,new Set(d.labelIds||[]));
     d.trashEdit=edit;d.trashSendAt=d.scheduledAt;delete d.scheduledAt;d.state='trashed';d.version++;recordDraft(d);
   }
   trashOperations.set(edit,{intent:JSON.stringify(messages)});data={edit,count:selected.length};
 }else if(path==='/v1/scheduled/undo-trash'){
   const {edit,count}=JSON.parse(body);
   const previous=trashOperations.get(edit);
   if(previous?.undo){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({code:200,data:previous.undo}));return;}
   const selected=[...cloudDrafts.values()].filter(d=>d.state==='trashed' && d.trashEdit===edit);
   if(selected.length!==count){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Message changed.'}));return;}
   let scheduled=0;
   for(const d of selected){
     if(d.trashSendAt>Date.now()/1000){d.scheduledAt=d.trashSendAt;scheduled++;}
     const i=rows.findIndex(r=>r.scheduledDraftId===d.draftId);
     d.labelIds=[...(membership.get(rows[i].emailId)||[])];rows.splice(i,1);
     delete d.trashEdit;delete d.trashSendAt;d.state=d.scheduledAt?'scheduled':'draft';d.version++;recordDraft(d);
   }
   data={scheduled,drafts:count-scheduled};if(previous)previous.undo=data;
 }else if(['/v1/scheduled/read','/v1/scheduled/inbox','/v1/scheduled/snooze','/v1/scheduled/labels'].includes(path) && req.method==='POST'){
   const {messages,unread,inbox,wakeAt,previousEdit,add,remove}=JSON.parse(body);
   if(!messages.every(m=>{const d=cloudDrafts.get(m.draftId);return d?.scheduledAt && d.version===m.version && (!previousEdit || d.scheduledInboxEdit===previousEdit);})){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Message changed.'}));return;}
   const edit=crypto.randomUUID(),changed=[];
   for(const m of messages){
     const d=cloudDrafts.get(m.draftId);
     if(path.endsWith('/labels')) d.labelIds=[...new Set([...(d.labelIds || []).filter(id=>!remove.includes(id)),...add])];
     else if(path.endsWith('/inbox') || path.endsWith('/snooze')){
       const old=d.scheduledInbox ? (d.scheduledWakeAt>Date.now()/1000 ? d.scheduledWakeAt : 0) : -1;
       const next=previousEdit ? d.scheduledPreviousPlacement : wakeAt || (inbox ? 0 : -1);
       if(old!==next)changed.push(m.draftId);
       d.scheduledPreviousPlacement=old;d.scheduledInbox=Number(next>=0);d.scheduledWakeAt=Math.max(0,next);d.scheduledInboxEdit=edit;
     }else d.scheduledUnread=Number(unread);
   }
   data={updated:messages.length,...((path.endsWith('/inbox') || path.endsWith('/snooze'))?{edit,changed}:{})};
 }else if(path.startsWith('/v1/scheduled/')){
   const draft=cloudDrafts.get(Number(path.split('/')[3]));
   if(!draft?.scheduledAt){res.writeHead(404);res.end(JSON.stringify({code:404,message:'Scheduled message not found.'}));return;}
   if(path.endsWith('/mark')){
     const {field,value,version}=JSON.parse(body);
     if(version!==draft.version){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Message changed.'}));return;}
     draft[field==='starred'?'mailboxStarred':'mailboxImportant']=Number(value);
     data={draftId:draft.draftId,field,value};
   }else if(path.endsWith('/cancel')){
     if(JSON.parse(body).version!==draft.version){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Message changed.'}));return;}
     delete draft.scheduledAt;delete draft.scheduledUnread;delete draft.scheduledInbox;delete draft.scheduledWakeAt;delete draft.scheduledInboxEdit;delete draft.scheduledPreviousPlacement;draft.state='draft';draft.version++;recordDraft(draft);data={draftId:draft.draftId};
   }else data={...draft,attachments:draft.attachments.map(({content,...f})=>f)};
 }else if(path==='/v1/drafts'&&req.method==='POST'){
   const input=JSON.parse(body);let draft=[...cloudDrafts.values()].find(d=>d.clientId===input.clientId);
   if(!draft){draft={...input,draftId:nextDraft++,version:1,state:'draft',createTime:new Date().toISOString(),attachments:(input.attachments||[]).map(f=>({...f,attachmentId:crypto.randomUUID(),mimeType:f.contentType||f.mimeType,size:fileContentBytes(f)}))};cloudDrafts.set(draft.draftId,draft);recordDraft(draft);}
   data={...draft,attachments:draft.attachments.map(({content,...f})=>f)};
 }else if(path.startsWith('/v1/drafts/')){
   const id=Number(path.split('/')[3]),draft=cloudDrafts.get(id),input=body?JSON.parse(body):{};
   if(!draft){res.writeHead(404);res.end(JSON.stringify({code:404,message:'Draft not found.'}));return;}
   if(path.endsWith('/schedule')){
     if(input.version!==draft.version || draft.state!=='draft'){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Draft changed.'}));return;}
     draft.state='scheduled';draft.scheduledAt=input.sendAt;draft.version++;recordDraft(draft);lastSchedule={sendAt:input.sendAt,version:(lastSchedule?.version||0)+1};data={draftId:id,version:draft.version,sendAt:input.sendAt,lastSchedule};
   }else if(path.endsWith('/send')){
     const key=input.idempotencyKey;
     const deliver=()=>{const receipt={state:'sent',attemptId:key,messages:previewSend(draft)};sendAttempts.set(key,receipt);draft.state='sent';draft.version++;recordDraft(draft);return receipt;};
     data=sendAttempts.get(key);
     if(!data && input.undoSeconds){
       const duration=(generalSettings.undoSeconds ?? input.undoSeconds)*1000;
       draft.state='sending';draft.version++;recordDraft(draft);
       data={state:'holding',draftId:id,attemptId:key,version:draft.version,undoUntil:Date.now()+duration};
       sendAttempts.set(key,data);
       setTimeout(()=>{if(sendAttempts.get(key)?.state==='holding')deliver();},duration);
     }else if(!data)data=deliver();
   }
   else if(req.method==='DELETE'){draft.state='deleted';draft.version++;recordDraft(draft);data={deleted:true};}
   else if(req.method==='PUT'){if(input.version!==draft.version){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Draft changed.',current:draft}));return;}Object.assign(draft,input,{version:draft.version+1,attachments:(input.attachments||[]).map(f=>({...f,attachmentId:crypto.randomUUID(),mimeType:f.contentType||f.mimeType,size:fileContentBytes(f)}))});recordDraft(draft);data={...draft,attachments:draft.attachments.map(({content,...f})=>f)};}
   else data={...draft,attachments:draft.attachments.map(({content,...f})=>f)};
 }else if(path.startsWith('/v1/send-attempts/')){
   const key=path.split('/')[3],receipt=sendAttempts.get(key);
   if(path.endsWith('/undo')){
     if(receipt?.state==='holding' && Date.now()<receipt.undoUntil){
       receipt.state='canceled';const d=cloudDrafts.get(receipt.draftId);d.state='draft';d.version++;recordDraft(d);
     }
     if(receipt?.state!=='canceled'){res.writeHead(409);res.end(JSON.stringify({code:409,message:'Cancellation period ended.'}));return;}
   }
   data=receipt||{state:'not_started'};
 }
 else if(path==='/v1/contacts'){
   const p=body ? JSON.parse(body) : Object.fromEntries(url.searchParams);
   const key=JSON.stringify([Number(p.accountId),p.email.toLowerCase()]);
   if(req.method==='PUT'){
     if(p.saved)savedContacts.set(key,{accountId:Number(p.accountId),email:p.email,name:p.name});
     else savedContacts.delete(key);
   }
   data=savedContacts.get(key) || null;
 }
 else if(path==='/v1/search/people'){
   const p=Object.fromEntries(url.searchParams), scoped=rows.filter(r=>!p.accountId||r.accountId===Number(p.accountId));
   const initial=p.folder==='compose'?[...savedContacts.values()].filter(person=>person.accountId===Number(p.accountId)).map(person=>({sendEmail:person.email,name:person.name})):p.folder==='trash'?scoped.filter(r=>r.trashedAt):[...cloudDrafts.values()]
     .filter(d=>d.scheduledAt && (!p.accountId || d.accountId===Number(p.accountId))).map(d=>{
       const sender=accounts.find(a=>a.accountId===d.accountId);
       return {draftId:d.draftId,senderEmail:sender?.email,senderName:d.name||sender?.name,recipients:d.receiveEmail,cc:d.cc,bcc:d.bcc};
     });
   data=peopleSuggestions([...initial,...scoped.filter(r=>!r.trashedAt)],p.field,p.q,p.view==='picker' ? 50 : 8+maxPeople);
 }
 else if(path==='/v1/messages'){
   const params=Object.fromEntries(url.searchParams),q=(params.q||'').toLowerCase(),limit=Number(params.limit)||30;
   const all=rows.filter(r=>r.trashedAt && (!params.accountId || r.accountId===Number(params.accountId)) &&
     matchesFilters(r,params) && (!q || [r.subject,r.sendEmail,r.text].some(v=>v?.toLowerCase().includes(q))))
     .sort((a,b)=>b.emailId-a.emailId);
   const last=Math.max(0,Math.ceil(all.length/limit)-1);
   let start=0,take=limit;
   if(params.page==='older') {
     const before=all.filter(r=>r.emailId>=Number(params.anchor)).length;
     start=before<all.length ? before : last*limit;
   } else if(params.page==='newer') {
     const before=all.filter(r=>r.emailId>Number(params.anchor)).length;
     start=Math.max(0,before-limit);take=Math.min(limit,before || limit);
   } else if(params.page) start=Math.min(last,params.page==='last' ? last : Number(params.page)-1)*limit;
   const remaining=params.cursor ? all.filter(r=>r.emailId<Number(params.cursor)) : all.slice(start);
   const messages=remaining.slice(0,take).map(r=>({...r,importanceReason:r.scheduledDraftId ? scheduledImportance(cloudDrafts.get(r.scheduledDraftId),r.sendEmail) : importanceReason([r]),...attachmentSummary(r.attList||[]),labelIds:[...(membership.get(r.emailId)||[])],preview:r.text}));
   const hasMore=remaining.length>take;
   data={messages,hasMore,nextCursor:hasMore ? messages.at(-1).emailId : null,...(params.page ? {total:all.length,offset:start} : {})};
 }
 else if(path==='/v1/messages/trash-labels'){
   const {emailIds,add,remove}=JSON.parse(body);
   for(const row of rows.filter(r=>r.trashedAt&&emailIds.includes(r.emailId))){
     const applied=membership.get(row.emailId)||new Set();add.forEach(id=>applied.add(id));remove.forEach(id=>applied.delete(id));membership.set(row.emailId,applied);
   }
   data={messageCount:emailIds.length};
 }
 else if(/^\/v1\/messages\/\d+\/trash-importance$/.test(path) && req.method==='POST'){
   const row=rows.find(r=>r.emailId===Number(path.split('/')[3]) && r.trashedAt);
   if(!row){res.writeHead(409);res.end(JSON.stringify({code:409,message:'This message is no longer in Trash.'}));return;}
   const {important}=JSON.parse(body);
   if(row.scheduledDraftId)cloudDrafts.get(row.scheduledDraftId).mailboxImportant=Number(important);
   else if(importanceChoices.get(row.emailId)?.important!==important)importanceChoices.set(row.emailId,{revision:++importanceRevision,important});
   data={importanceReason:important?'user':null};
 }
 else if(path==='/v1/messages/trash-read'){
   const {emailIds,read}=JSON.parse(body);rows.filter(row=>emailIds.includes(row.emailId)&&row.trashedAt).forEach(row=>row.unread=Number(read));
   data={messageCount:emailIds.length};
 }else if(path==='/email/conversation/undo-move' || path==='/v1/messages/undo-recovery'){
   const move=moveUndos.get(JSON.parse(body).token);
   if(!move || Boolean(move.trash)!==path.endsWith('/undo-recovery')){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({code:409,message:'This move can no longer be undone.'}));return;}
   for(const [id,prior] of move.members){
     if(move.trash)rows.find(r=>r.emailId===id).trashedAt=prior.trashedAt;
     if(prior.wakeAt===undefined)filing.delete(id);else filing.set(id,prior.wakeAt);
     const set=membership.get(id)||new Set();
     if(prior.source)set.add(move.source);
     if(!prior.destination)set.delete(move.destination);
     membership.set(id,set);
   }
   move.members.clear(); data={restored:true};
 }else if(path==='/v1/messages/move-from-trash' || (path==='/v1/messages/restore' && JSON.parse(body).undoable)){
   const {emailIds,labelId,undoable,requestId,clientId}=JSON.parse(body);
   const request=requestId||clientId, intent=JSON.stringify([path,labelId,[...emailIds].sort((a,b)=>a-b)]);
   if(replayMove(res,request,intent))return;
   const selected=emailIds.map(id=>rows.find(m=>m.emailId===id));
   if(selected.some(r=>!r?.trashedAt || r.scheduledDraftId)){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({code:409,message:'Trash changed.'}));return;}
   const members=new Map();
   for(const row of selected){
     const id=row.emailId, applied=membership.get(id)||new Set();
     members.set(id,{trashedAt:row.trashedAt,wakeAt:filing.get(id),destination:applied.has(labelId)});
     row.trashedAt=null;
     if(labelId){applied.add(labelId);membership.set(id,applied);}
     if(path.endsWith('move-from-trash'))filing.set(id,labelId?null:0);
   }
   data={messageCount:selected.length};
   if(undoable){data.undoToken=crypto.randomUUID();moveUndos.set(data.undoToken,{members,trash:true,destination:labelId});if(request)moveRequests.set(request,{token:data.undoToken,intent});}
 }
 else if(['/v1/messages/restore','/v1/messages/trash','/v1/messages/purge'].includes(path)){const ids=JSON.parse(body).emailIds;for(let i=rows.length-1;i>=0;i--)if(ids.includes(rows[i].emailId)){if(rows[i].scheduledDraftId && !path.endsWith('/trash')){
   const d=cloudDrafts.get(rows[i].scheduledDraftId);d.state=path.endsWith('/purge')?'deleted':'draft';d.version++;delete d.trashEdit;delete d.trashSendAt;d.labelIds=[...(membership.get(rows[i].emailId)||[])];recordDraft(d);rows.splice(i,1);
 }else if(path.endsWith('purge'))rows.splice(i,1);else rows[i].trashedAt=path.endsWith('restore')?null:new Date().toISOString();}}
 else if(path.startsWith('/v1/messages/')){const row=rows.find(r=>r.emailId===Number(path.split('/').at(-1)));const mailbox=accounts.find(a=>a.accountId===row?.accountId);data=row&&{...row,mailboxEmail:mailbox?.email,mailboxName:mailbox?.name,labelIds:[...(membership.get(row.emailId)||[])]};}
 else if(path==='/setting/websiteConfig')data=settings;
 else if(path==='/my/lastSchedule')data=lastSchedule;
 else if(path==='/my/loginUserInfo')data={...user,generalSettings,lastSchedule};
 else if(path==='/account/list')data=url.searchParams.get('accountId')!=='0'?[]:accounts;
 else if(path==='/email/conversations'){
   const p=Object.fromEntries(url.searchParams),q=(p.q||'').toLowerCase(),asc=(Number(p.timeSort)===1)!==(p.pageDirection==='backward');
   const now=Math.floor(Date.now()/1000);
   let threads=[];
   for(const [threadId,members] of grouped()) {
     const anchor=filingAnchor(members), state=filing.get(anchor);
     if(p.folder==='inbox' && state!==undefined && (state===null || state>now))continue;
     if(p.folder==='important' && !importanceReason(members))continue;
     if(p.folder==='purchases' && !members.some(row=>row.emailId===38))continue;
     if(p.folder==='archived' && state!==null)continue;
     if(p.folder==='snoozed' && !(state>now))continue;
     const matches=members.some(row=>{
       if(!matchesFilters(row,{...p,hasAttachment:false}) || (p.hasAttachment && !members.some(member=>member.attList?.length)))return false;
       if(p.folder==='label' && !membership.get(row.emailId)?.has(Number(p.labelId)))return false;
       if(p.folder!=='starred' && p.allReceive!=='1' && row.accountId!==Number(p.accountId))return false;
       if(p.folder==='starred' && !row.isStar || p.folder==='sent' && row.type!==1)return false;
       if(p.folder==='inbox' && row.type!==0 && !(row.emailId===anchor && typeof state==='number' && state<=now))return false;
       return !q || [row.name,row.sendEmail,row.recipient,row.cc,row.subject,row.text,row.content,...(row.type===1?[row.bcc]:[])].some(value=>(value||'').toLowerCase().includes(q));
     });
     if(!matches)continue;
     const sorted=members.toSorted((a,b)=>a.emailId-b.emailId), latest=sorted.at(-1);
     threads.push({threadId,purchase:members.some(row=>row.emailId===38),...attachmentSummary(members.flatMap(row=>row.attList||[])),importanceReason:importanceReason(members),category:filedCategory.get(threadId)||fixtureCategory.get(sorted.find(r=>r.type===0)?.name)||'primary',filedAway:state===null||state>now,labelIds:threadLabels(members),lastEmailId:latest.emailId,lastSenderEmail:latest.sendEmail,lastSenderName:latest.name,subject:sorted[0].subject,
       ...(p.folder==='sent'?{}:{senders:previewSenders(members)}),participants:[...new Set(sorted.map(row=>row.type===1?'me':row.name))].join(', '),preview:latest.text,lastDate:latest.createTime,
       messageCount:members.length,unreadCount:members.filter(row=>row.type===0&&row.unread===0).length,
       starred:members.some(row=>row.isStar)?1:0,wakeAt:state,status:latest.status});
   }
   const categoryUnread={};for(const thread of threads)if(thread.unreadCount)categoryUnread[thread.category]=(categoryUnread[thread.category]||0)+1;
   const folderCategory=['social','updates','forums','promotions'].includes(p.folder) ? p.folder : p.category;
   if(folderCategory)threads=threads.filter(t=>t.category===folderCategory);
   if(p.categoryCounts==='1')categoryUnread.purchases=threads.filter(t=>t.purchase && t.unreadCount).length;
   const unreadThreads=threads.filter(row=>row.unreadCount>0).length,total=threads.length;threads=threads.filter(row=>!Number(p.cursor)||(asc?row.lastEmailId>Number(p.cursor):row.lastEmailId<Number(p.cursor))).sort((a,b)=>asc?a.lastEmailId-b.lastEmailId:b.lastEmailId-a.lastEmailId);
   const limit=Number(p.limit)||30,backward=p.pageDirection==='backward';
   const page=threads.slice(0,backward && !p.cursor && total ? (total-1)%limit+1 : limit);
   if(backward)page.reverse();
   const offset=backward ? threads.length-page.length : total-threads.length;
   const hasMore=p.includeOffset==='1' ? page.length>0 && offset+page.length<total : backward ? Boolean(p.cursor && page.length) : threads.length>limit;
   data={threads:page,total,...(p.includeOffset==='1' ? {offset} : {}),unreadThreads,categoryUnread:p.category || p.categoryCounts?categoryUnread:undefined,nextWakeAt:Math.min(...[...filing.values()].filter(t=>t>now))||null,hasMore,firstCursor:page[0]?.lastEmailId||null,nextCursor:hasMore?page.at(-1).lastEmailId:null};
 }else if(path==='/email/conversation/messages'){
   const p=Object.fromEntries(url.searchParams),members=threadFor(p.emailId),limit=Number(p.limit)||30;
   const filtered=members.filter(row=>!Number(p.before)||row.emailId<Number(p.before)).sort((a,b)=>b.emailId-a.emailId);
   const state=filing.get(filingAnchor(members));
   data={importanceReason:importanceReason(members),filedAway:state===null||state>Date.now()/1000,unreadCount:members.filter(r=>r.type===0&&r.unread===0).length,incoming:members.filter(r=>r.type===0).length,labelIds:threadLabels(members),threadId:'t-'+Math.min(...members.map(row=>row.emailId)),subject:members.toSorted((a,b)=>a.emailId-b.emailId)[0]?.subject,ownedAddresses:accounts.map(account=>account.email),messages:filtered.slice(0,limit).reverse().map(({content,text,...row})=>({...row,bcc:row.type===1?row.bcc:'[]'})),total:members.length,hasMore:filtered.length>limit,nextCursor:filtered.length>limit?filtered[limit-1].emailId:null};
 }else if(path==='/email/conversation/draft-threads'){
   const ids=JSON.parse(body).emailIds;
   data=[...grouped()].flatMap(([threadId,members])=>{
     const requested=members.filter(row=>ids.includes(row.emailId));
     if (!requested.length) return [];
     const state=filing.get(filingAnchor(members));
     const inbox=state===undefined ? members.some(row=>row.type===0 && row.status===0) : state!==null && state<=Date.now()/1000;
     const subject=members.toSorted((a,b)=>a.emailId-b.emailId)[0].subject;
     return requested.map(row=>({emailId:row.emailId,threadId,subject,inbox:Number(inbox),hasUnread:Number(members.some(m=>m.type===0 && m.unread===0)),messageCount:members.length,senders:previewSenders(members)}));
   });
 }else if(path==='/email/conversation/label-unread'){
   const accountId=Number(url.searchParams.get('accountId')),combined=url.searchParams.get('allReceive')==='1';
   data={};
   for(const members of grouped().values()){
     if(!members.some(row=>row.type===0 && row.unread===0))continue;
     for(const id of threadLabels(members.filter(row=>combined || row.accountId===accountId)))data[id]=(data[id]||0)+1;
   }
   for(const d of cloudDrafts.values()) if(d.scheduledAt && d.scheduledUnread && (combined || d.accountId===accountId))
     for(const id of new Set(d.labelIds || [])) if(labels.has(id))data[id]=(data[id]||0)+1;
 }else if(path==='/email/conversation/label-colors')data=recentColors;
 else if(path==='/email/conversation/labels' && req.method==='GET')data=[...labels.values()];
 else if((path==='/email/conversation/labels' && req.method==='POST') || (/^\/email\/conversation\/labels\/\d+$/.test(path) && req.method==='PUT')){
   const id=req.method==='PUT'?Number(path.split('/').at(-1)):null,previous=labels.get(id);
   const {name,parentId}=JSON.parse(body),parent=labels.get(parentId), leaf=typeof name==='string'?name.trim():'';
   const fail=(code,message)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({code,message}));};
   if(id && !previous || parentId!=null && !parent){fail(404,'Label not found.');return;}
   if(!leaf || leaf.length>100 && !(previous?.name===leaf || previous?.name.endsWith('/'+leaf)) || parent && leaf.startsWith('/')){fail(400,'Enter a label name of up to 100 characters.');return;}
   const destination=parent ? parent.name+'/'+leaf : leaf;
   const key=path=>path.replace(/[A-Z]/g,c=>c.toLowerCase());
   const old=previous && key(previous.name);
   if(old && ((key(destination)!==old && inLabelBranch(destination,previous.name)) || parent && inLabelBranch(parent.name,previous.name))){fail(400,'Choose an existing parent outside this label.');return;}
   const updated=new Map();
   for(const label of labels.values())if(old && inLabelBranch(label.name,previous.name))
     updated.set(label.id,destination+label.name.slice(previous.name.length));
   if(!previous)updated.set(nextLabel,destination);
   const names=new Set([...labels.values()].filter(label=>!updated.has(label.id)).map(label=>key(label.name)));
   if([...updated.values()].some(value=>names.has(key(value)))){fail(409,'A label with that name already exists.');return;}
   for(const [labelId,value] of updated)labels.set(labelId,{...labels.get(labelId),id:labelId,name:value});
   data=labels.get(id || nextLabel++);
 }else if(path.startsWith('/email/conversation/labels/') && path.endsWith('/display')){
   const id=Number(path.split('/').at(-2)),label=labels.get(id),{list,mode}=JSON.parse(body);
   if(!label){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({code:404,message:'Label not found.'}));return;}
   if(!['sidebar','messages'].includes(list) || !['show','hide'].includes(mode) && !(list==='sidebar' && mode==='unread')){
     res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:400,message:'Invalid label visibility.'}));return;
   }
   label[list]=mode;data={id,[list]:mode};
 }else if(path.startsWith('/email/conversation/labels/') && path.endsWith('/color')){
   const id=Number(path.split('/').at(-2)), colors=JSON.parse(body);
   const {background,foreground,custom}=colors;
   const label=labels.get(id);
   if(!label){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({code:404,message:'Label not found.'}));return;}
   Object.assign(label,{background,foreground});data={id,background,foreground};
   if(custom)recentColors=[{background,foreground},...recentColors.filter(p=>p.background!==background || p.foreground!==foreground)].slice(0,6);
 }else if(path.startsWith('/email/conversation/labels/')){
   const id=Number(path.split('/').at(-1));
   if(req.method==='DELETE'){labels.delete(id);for(const set of membership.values()) set.delete(id);}

 }else if(path.startsWith('/email/conversation/')){
   const p=JSON.parse(body),ids=new Set(p.emailIds.flatMap(id=>threadFor(id).map(row=>row.emailId))),operation=path.split('/').at(-1);
   const request=operation==='move' && (p.requestId || p.clientId);
   const intent=request && JSON.stringify([p.fromLabelId||0,p.labelId,[...p.emailIds].sort((a,b)=>a-b)]);
   if(replayMove(res,request,intent))return;
   for(const [token,move] of moveUndos){
     const touchesLabel=operation==='label' && [...p.add,...p.remove].some(id=>id===move.source || id===move.destination);
     if((touchesLabel || ['move','inbox','archive','snooze','delete'].includes(operation)) && [...ids].some(id=>move.members.has(id)))moveUndos.delete(token);
   }
   if(operation==='importance'){const revision=++importanceRevision;for(const id of ids)importanceChoices.set(id,{revision,important:p.important});}
   else if(operation==='category'){for(const [threadId,members] of grouped())if(members.some(r=>ids.has(r.emailId)))filedCategory.set(threadId,p.category);}
   else if(['archive','snooze','inbox'].includes(operation))for(const id of ids)filing.set(id,operation==='archive'?null:operation==='inbox'?0:p.wakeAt);
   else if(operation==='move'){
     const members=new Map();
     for(const id of ids){
       const set=membership.get(id)||new Set();
       members.set(id,{wakeAt:filing.get(id),source:set.has(p.fromLabelId),destination:set.has(p.labelId)});
       set.delete(p.fromLabelId);if(p.labelId)set.add(p.labelId);membership.set(id,set);filing.set(id,p.labelId?null:0);
     }
     if(p.undoable){const token=crypto.randomUUID();moveUndos.set(token,{members,source:p.fromLabelId,destination:p.labelId});data={undoToken:token};if(request)moveRequests.set(request,{intent,token});}
   }
   else if(operation==='label')for(const id of ids){
     const set=membership.get(id)||new Set();for(const lid of p.add)set.add(lid);for(const lid of p.remove)set.delete(lid);membership.set(id,set);
   }
   else if(operation==='delete'){data={emailIds:[...ids]};rows.filter(row=>ids.has(row.emailId)).forEach(row=>row.trashedAt=new Date().toISOString());}
   else if(operation==='read')rows.filter(row=>ids.has(row.emailId)).forEach(row=>row.unread=p.unread??1);
   else if(operation==='star')for(const id of p.emailIds){const members=threadFor(id);if(p.starred)members.toSorted((a,b)=>b.emailId-a.emailId)[0].isStar=1;else members.forEach(row=>row.isStar=0);}
 }else if(path==='/email/list'||path==='/star/list'){
   const q=(url.searchParams.get('q')||'').toLowerCase(),cursor=Number(url.searchParams.get('emailId'))||0;
   let list=rows.filter(row=>!row.trashedAt).filter(row=>path==='/star/list'?row.isStar:row.type===Number(url.searchParams.get('type')||0));
   list=list.filter(row=>!q||[row.name,row.sendEmail,row.subject,row.text,row.recipient,row.cc,...(row.type===1?[row.bcc]:[])].some(value=>value.toLowerCase().includes(q)));
   const total=list.length;const ascending=Number(url.searchParams.get('timeSort'))===1;
   list=list.filter(row=>!cursor||(ascending?row.emailId>cursor:row.emailId<cursor)).sort((a,b)=>ascending?a.emailId-b.emailId:b.emailId-a.emailId).slice(0,Number(url.searchParams.get('size'))||50);
   if(url.searchParams.get('full')!=='1')list=list.map(({content,text,...row})=>row);
   data={list,total,latestEmail:{emailId:100,accountId:1,userId:1}};
 }else if(path==='/email/detail')data={...rows.find(row=>row.emailId===Number(url.searchParams.get('emailId'))),mailboxEmail:'alex@example.com',mailboxName:'Alex Morgan'};
 else if(path==='/email/latest')data=[];
 else if(path==='/email/send'){
   data=previewSend(JSON.parse(body));
 }else if(path==='/email/read'){const ids=JSON.parse(body).emailIds;rows.filter(row=>ids.includes(row.emailId)).forEach(row=>row.unread=JSON.parse(body).unread??1);}
 else if(path==='/email/delete'){const ids=(url.searchParams.get('emailIds')||'').split(',').map(Number);for(let i=rows.length-1;i>=0;i--)if(ids.includes(rows[i].emailId))rows[i].trashedAt=new Date().toISOString();}
 else if(path==='/star/add'){rows.find(row=>row.emailId===JSON.parse(body).emailId).isStar=1;}
 else if(path==='/star/cancel'){rows.find(row=>row.emailId===Number(url.searchParams.get('emailId'))).isStar=0;}
 else if(path==='/account/setAllReceive'){accounts.find(account=>account.accountId===JSON.parse(body).accountId).allReceive^=1;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,data}));
});
await new Promise(resolve=>api.listen(8787,'127.0.0.1',resolve));
const {config:base}=await loadConfigFromFile({command:'serve',mode:'dev'},undefined,root);
const bootstrap={name:'isolated-preview',configureServer(server) {
 server.middlewares.use((req,res,next)=>{
  if(req.url!=='/__preview')return next();
  res.setHeader('Content-Type','text/html');res.end('<script>localStorage.setItem("token","local-visual-test");location.replace("/inbox")</script>');
 });
}};
const server=await createServer({...base,mode:'dev',configFile:false,plugins:[...base.plugins,bootstrap],root,server:{...base.server,host:'127.0.0.1',strictPort:true}});
await server.listen();
console.log('Isolated preview: http://127.0.0.1:3001/__preview (mock delivery only)');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();api.close();process.exit(0);});

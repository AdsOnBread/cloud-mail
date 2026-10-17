// Isolated visual-test preview. All mail and users below are fictional; sends remain in memory.
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
const api=createHTTPServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3001');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Accept-Language');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 let body='';for await(const chunk of req) body+=chunk;
 let data={};const path=url.pathname.replace(/^\/api/,'');
 if(path==='/setting/websiteConfig')data=settings;
 else if(path==='/my/loginUserInfo')data=user;
 else if(path==='/account/list')data=url.searchParams.get('accountId')!=='0'?[]:accounts;
 else if(path==='/email/list'||path==='/star/list'){
   const q=(url.searchParams.get('q')||'').toLowerCase(),cursor=Number(url.searchParams.get('emailId'))||0;
   let list=rows.filter(row=>path==='/star/list'?row.isStar:row.type===Number(url.searchParams.get('type')||0));
   list=list.filter(row=>!q||[row.name,row.sendEmail,row.subject,row.text,row.recipient,row.cc,...(row.type===1?[row.bcc]:[])].some(value=>value.toLowerCase().includes(q)));
   const total=list.length;const ascending=Number(url.searchParams.get('timeSort'))===1;
   list=list.filter(row=>!cursor||(ascending?row.emailId>cursor:row.emailId<cursor)).sort((a,b)=>ascending?a.emailId-b.emailId:b.emailId-a.emailId).slice(0,Number(url.searchParams.get('size'))||50);
   if(url.searchParams.get('full')!=='1')list=list.map(({content,text,...row})=>row);
   data={list,total,latestEmail:{emailId:100,accountId:1,userId:1}};
 }else if(path==='/email/detail')data=rows.find(row=>row.emailId===Number(url.searchParams.get('emailId')));
 else if(path==='/email/latest')data=[];
 else if(path==='/email/send'){
   const form=JSON.parse(body);const row={...rows[0],...form,emailId:Math.max(...rows.map(row=>row.emailId))+1,type:1,status:2,sendEmail:accounts[0].email,name:user.name,recipient:JSON.stringify(form.receiveEmail.map(address=>({address}))),cc:JSON.stringify(form.cc.map(address=>({address}))),bcc:JSON.stringify(form.bcc.map(address=>({address}))),listText:form.text||form.content};rows.unshift(row);data=[row];
 }else if(path==='/email/read'){const ids=JSON.parse(body).emailIds;rows.filter(row=>ids.includes(row.emailId)).forEach(row=>row.unread=1);}
 else if(path==='/email/delete'){const ids=(url.searchParams.get('emailIds')||'').split(',').map(Number);for(let i=rows.length-1;i>=0;i--)if(ids.includes(rows[i].emailId))rows.splice(i,1);}
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

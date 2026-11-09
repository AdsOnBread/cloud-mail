import { OAuthProvider,AuthorizationError,CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { mcpFetch } from './tools';
import { allowedOrigin,equalSecret,hasAppAccess,rateLimit } from '../security/app-access';
import loginService from '../service/login-service';

export const scopes=['mail:read','mail:drafts','mail:send','mail:delete','offline_access'];
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
async function consentPage(req,env,authRequest,message='',selectedScopes) {
  const oauth=env.OAUTH_PROVIDER;
  const info=await oauth.describeConsent(authRequest),transaction=await oauth.beginConsent(authRequest);
  const offeredScopes=scopes;
  const checkedScopes=new Set(selectedScopes??scopes);
  const unlocked=await hasAppAccess(req,env);
  transaction.headers.set('Content-Type','text/html; charset=utf-8');transaction.headers.set('Cache-Control','no-store');
  transaction.headers.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Cloudmail</title>
  <style>body{font:17px system-ui;max-width:480px;margin:50px auto;padding:24px;line-height:1.5;color:#17223b;background:#f5f7fb}input:not([type=checkbox]),button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font:inherit}label{display:block;margin:12px 0}button{cursor:pointer}small{display:block;color:#45536b}.error{color:#b42318}</style>
  <h1>Connect Cloudmail</h1><p><strong>${escape(info.clientName)}</strong> wants to access all mailboxes belonging to the user you sign in as.</p>
  <p>Callback destination: <strong>${escape(info.redirectHost)}</strong>${info.clientDomain?`<br>Published by ${escape(info.clientDomain)}`:'<br>This client registered its own name.'}${info.redirectIsLoopback?'<br>Only continue if you started connecting an app on this computer.':''}</p>
  <p class="error" role="alert">${escape(message)}</p><form method="post"><input type="hidden" name="handle" value="${escape(transaction.handle)}">
  ${unlocked?'':'<label>Installation secret<input type="password" name="secret" autocomplete="off" required></label>'}
  <label>Cloudmail email<input name="email" type="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label>
  <p>All supported permissions are available below and selected on a new connection. Review them and uncheck any you do not want before allowing access.</p>
  ${offeredScopes.map(scope=>`<label><input type="checkbox" name="scope" value="${escape(scope)}"${checkedScopes.has(scope)?' checked':''}> ${escape({'mail:read':'Read messages and files','mail:drafts':'Read, create, edit, and discard cloud drafts','mail:send':'Send, reply, and forward email','mail:delete':'Move mail to Trash, restore mail, and permanently delete trashed mail',offline_access:'Stay connected until access expires or is revoked'}[scope]||scope)}</label>`).join('')}
  <button name="decision" value="approve">Sign in and Allow selected permissions</button><button name="decision" value="deny" formnovalidate>Deny</button></form><small>Manage or revoke this connection in Cloudmail Settings.</small></html>`,{headers:transaction.headers});
}
async function authorize(req,env) {
  const oauth=env.OAUTH_PROVIDER;
  try {
    if(!allowedOrigin(req,env))return new Response('Origin not allowed.',{status:403});
    if(req.method==='GET')return consentPage(req,env,await oauth.parseAuthRequest(req));
    if(req.method!=='POST')return new Response(null,{status:405});
    if(!await rateLimit(req,env,'oauth-consent'))return new Response('Too many attempts. Try again in a minute.',{status:429});
    if(Number(req.headers.get('content-length')||0)>16384)return new Response('Request too large.',{status:413});
    const form=await req.formData();const handle=String(form.get('handle')||'');
    if(form.get('decision')!=='approve') {const denied=await oauth.denyConsent(req,handle);return new Response(null,{status:302,headers:denied.headers});}
    const approved=await oauth.approveConsent(req,handle,{scope:form.getAll('scope').map(String)});
    if(!await hasAppAccess(req,env)&&!await equalSecret(String(form.get('secret')||''),env.app_access_secret))return consentPage(req,env,approved.request,'Incorrect installation secret.',approved.request.scope);
    let userId;
    try {
      const c={env,req:{header:k=>req.headers.get(k)},set:()=>{},get:()=>undefined};
      const user=await loginService.authenticate(c,{email:String(form.get('email')||''),password:String(form.get('password')||'')});
      userId=user.userId;
    } catch {return consentPage(req,env,approved.request,'Sign-in failed. Check your email and password.',approved.request.scope);}
    const connectionId=crypto.randomUUID(),info=await oauth.describeConsent(approved.request);
    await env.db.prepare('INSERT INTO connected_apps(grant_id,user_id,client_id,name,scopes) VALUES(?,?,?,?,?)').bind(connectionId,userId,approved.request.clientId,info.clientName,JSON.stringify(approved.request.scope)).run();
    const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:String(userId),metadata:{connectionId,name:info.clientName},scope:approved.request.scope,props:{userId,connectionId}});
    approved.headers.set('Location',redirectTo);return new Response(null,{status:302,headers:approved.headers});
  } catch(error) {
    if(error instanceof AuthorizationError&&error.redirectTo)return Response.redirect(error.redirectTo,302);
    if(error instanceof AuthorizationError||error instanceof CimdFetchError)return new Response('This connection request is invalid or expired. Start connecting again.',{status:400});
    console.error('oauth_authorization_failed');return new Response('Could not complete sign-in.',{status:500});
  }
}
export async function oauthFetch(req,env,ctx,fallback) {
  const path=new URL(req.url).pathname;
  if(!env.OAUTH_KV||!env.mcp_public_url) {
    if(path==='/mcp'||path.startsWith('/oauth/')||path.startsWith('/.well-known/'))return Response.json({error:'MCP_NOT_CONFIGURED',message:'Configure OAUTH_KV and mcp_public_url.'},{status:503});
    return fallback(req,env,ctx);
  }
  const canonical=new URL(env.mcp_public_url);
  if(canonical.pathname!=='/mcp'||(canonical.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(canonical.hostname)))return Response.json({error:'INVALID_MCP_URL'},{status:503});
  if(path==='/mcp'||path.startsWith('/oauth/')) {
    const maximum=path==='/mcp'?10*1024*1024:16384;
    if(req.body) {
      const reader=req.body.getReader(),chunks=[];let length=0;
      for(;;) {const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum){await reader.cancel();return new Response('Request is too large.',{status:413});}chunks.push(value);}
      const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
      req=new Request(req,{body:buffer});
    }
  }
  const provider=new OAuthProvider({apiRoute:'/mcp',apiHandler:{fetch:mcpFetch},
    defaultHandler:{fetch:(request,bindings,context)=>new URL(request.url).pathname==='/oauth/authorize'?authorize(request,bindings):fallback(request,bindings,context)},
    authorizeEndpoint:'/oauth/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
    // Discovery names the minimum scopes; tools request additional scopes on demand.
    scopesSupported:scopes,requiredScopes:['mail:read'],accessTokenTTL:3600,refreshTokenTTL:30*86400,
    clientIdMetadataDocumentEnabled:true,resourceMetadata:{resource:canonical.href,authorization_servers:[canonical.origin]}});
  return provider.fetch(req,env,ctx);
}

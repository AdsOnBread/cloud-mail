import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
async function grants(c) {
  if(!c.env.OAUTH_PROVIDER)return [];
  const all=[];let cursor;
  do {const page=await c.env.OAUTH_PROVIDER.listUserGrants(String(userContext.getUserId(c)),{cursor});all.push(...page.items);cursor=page.cursor;}while(cursor);
  return all;
}
app.get('/v1/connections',async c=>{
  const active=(await c.env.db.prepare('SELECT grant_id FROM connected_apps WHERE user_id=? AND revoked=0').bind(userContext.getUserId(c)).all()).results;
  const ids=new Set(active.map(row=>row.grant_id));
  return c.json(result.ok({connections:(await grants(c)).filter(g=>ids.has(g.metadata?.connectionId)).map(g=>({id:g.metadata.connectionId,name:g.metadata?.name||g.clientId,scopes:g.scope,createdAt:g.createdAt}))}));
});
app.delete('/v1/connections/:id',async c=>{
  const uid=userContext.getUserId(c),id=c.req.param('id');
  const row=await c.env.db.prepare('UPDATE connected_apps SET revoked=1 WHERE user_id=? AND grant_id=? RETURNING grant_id').bind(uid,id).first();
  if(!row)throw new BizError('Connection not found.',404);
  for(const grant of await grants(c))if(grant.metadata?.connectionId===id)await c.env.OAUTH_PROVIDER.revokeGrant(grant.id,String(uid));
  return c.json(result.ok({revoked:true}));
});

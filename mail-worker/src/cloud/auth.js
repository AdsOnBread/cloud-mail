import BizError from '../error/biz-error';
import permService from '../service/perm-service';

export async function activeUser(c, userId) {
  const row = await c.env.db.prepare('SELECT user_id,email,type,status,is_del FROM user WHERE user_id=?').bind(userId).first();
  if (!row || row.is_del || row.status !== 0) throw new BizError('This user is no longer active.',403);
  return row;
}
export async function permission(c,userId,key) {
  const user = await activeUser(c,userId);
  if (user.email !== c.env.admin && !(await permService.userPermKeys(c,userId)).includes(key)) throw new BizError('You do not have permission for this operation.',403);
  return user;
}
export async function mailbox(c,userId,id) {
  if (!Number.isSafeInteger(id) || id<1) throw new BizError('Select a sender mailbox.',400);
  const row=await c.env.db.prepare('SELECT * FROM account WHERE account_id=? AND user_id=? AND is_del=0').bind(id,userId).first();
  if (!row) throw new BizError('Mailbox not found.',404);
  return row;
}
export function positive(value,label='ID') {
  if(typeof value!=='number' && (typeof value!=='string'||!/^\d+$/.test(value)))throw new BizError(`Invalid ${label}.`,400);
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1) throw new BizError(`Invalid ${label}.`,400);
  return id;
}
export function pageSize(value) { return Math.min(100,Math.max(1,Math.floor(Number(value)||30))); }
export function conflict(current) {
  const error=new BizError('This draft changed elsewhere. Reload its current revision.',409);
  error.current=current; return error;
}

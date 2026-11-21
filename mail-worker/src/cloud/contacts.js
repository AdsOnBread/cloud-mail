import {personSearchKey} from '../../../shared/mail-search-people';
import {cleanRecipientName} from '../../../shared/recipient-names';
import BizError from '../error/biz-error';
import verify from '../utils/verify-utils';
import {mailbox,positive} from './auth';

async function contactKey(c,userId,accountId,address) {
  const email=typeof address==='string' ? address.trim() : '';
  if (email.length>320 || !verify.isEmail(email)) throw new BizError('Invalid contact email.',400);
  const account=positive(accountId);
  await mailbox(c,userId,account);
  return {account,email,key:personSearchKey(email)};
}

export async function readContact(c,userId,input) {
  const {account,key}=await contactKey(c,userId,input.accountId,input.email);
  return c.env.db.prepare('SELECT email,name FROM mailbox_contacts WHERE user_id=? AND account_id=? AND address_key=?')
    .bind(userId,account,key).first();
}

export async function setContact(c,userId,input) {
  const {account,email,key}=await contactKey(c,userId,input.accountId,input.email);
  if (typeof input.saved!=='boolean') throw new BizError('Choose whether to save the contact.',400);
  if (!input.saved) {
    await c.env.db.prepare('DELETE FROM mailbox_contacts WHERE user_id=? AND account_id=? AND address_key=?')
      .bind(userId,account,key).run();
    return null;
  }
  const name=cleanRecipientName(input.name) || email;
  return c.env.db.prepare(`INSERT INTO mailbox_contacts(user_id,account_id,address_key,email,name,name_key) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,account_id,address_key) DO UPDATE SET name=excluded.name,name_key=excluded.name_key
    RETURNING email,name`).bind(userId,account,key,email,name,personSearchKey(name)).first();
}

export async function savedContactSuggestions(db,userId,account,query,limit) {
  const term=personSearchKey(query);
  return (await db.prepare(`SELECT c.email AS sendEmail,c.name FROM mailbox_contacts c JOIN account a
    ON a.account_id=c.account_id AND a.user_id=c.user_id AND a.is_del=0
    WHERE c.user_id=? AND c.account_id=? AND (instr(c.address_key,?)>0 OR instr(c.name_key,?)>0)
    ORDER BY c.name_key,c.address_key LIMIT ?`).bind(userId,account,term,term,limit).all()).results;
}

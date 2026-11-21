import BizError from '../error/biz-error.js';

// A create-and-file dialog can retry either request independently. Store the
// response to filing in the same transaction as the actual mailbox changes.
export async function withLabelMove(db,userId,token,labelId,request,apply) {
  if (token===undefined) return apply(null);
  if (typeof token!=='string' || !/^[a-zA-Z0-9-]{8,80}$/.test(token)) throw new BizError('Invalid label request.',400);
  const intent=JSON.stringify(request);
  async function replay() {
    const row=await db.prepare(`SELECT c.label_id,m.intent,m.result FROM mailbox_label_creations c
      LEFT JOIN mailbox_label_moves m ON m.user_id=c.user_id AND m.token=c.token
      WHERE c.user_id=? AND c.token=?`).bind(userId,token).first();
    if (!row || row.label_id!==labelId || (row.intent && row.intent!==intent)) throw new BizError('This request is for a different move.',409);
    return row.result ? JSON.parse(row.result) : null;
  }
  const prior=await replay();
  if (prior) return prior;
  function record(result,guard='1',checks=[]) {
    return db.prepare(`INSERT INTO mailbox_label_moves(user_id,token,intent,result)
      SELECT ?,?,?,? WHERE ${guard}`).bind(userId,token,intent,JSON.stringify(result),...checks);
  }
  try { return await apply(record); }
  catch (error) {
    // Includes a concurrently committed receipt and validation that became
    // stale because the first request already moved these messages.
    const completed=await replay();
    if (completed) return completed;
    throw error;
  }
}

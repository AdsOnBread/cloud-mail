import {shallowReactive} from 'vue';

// A reader opened from another folder must observe writes started in the old view.
const sessions=new WeakMap();
export function pendingScheduledReads(database,token) {
  let session=sessions.get(database);
  if (!session || session.token!==token) {
    session={token,pending:shallowReactive(new Map())};
    sessions.set(database,session);
  }
  return session.pending;
}

export function holdScheduledReads(operations,messages) {
  if (messages.some(row=>operations.has(row.draftId))) throw new Error("Wait for the scheduled message to finish updating.");
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  for (const row of messages) operations.set(row.draftId,pending);
  return ()=>{
    for (const row of messages) operations.delete(row.draftId);
    finish();
  };
}

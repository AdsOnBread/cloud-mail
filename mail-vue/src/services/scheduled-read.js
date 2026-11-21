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

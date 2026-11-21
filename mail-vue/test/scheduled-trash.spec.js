import {beforeEach,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import http from '../src/axios';
import {deleteScheduled,retryPendingTrash} from '../src/services/scheduled-trash';
import {useMailFeedback} from '../src/store/mail-feedback';
import {useUserStore} from '../src/store/user';
vi.mock('../src/axios',()=>({default:{post:vi.fn()}}));
const rows=[{draftId:5,version:3},{draftId:4,version:2}];
function login(email) {
  const user=useUserStore();
  user.user.email=email;user.authenticatedToken='session/'+email;
  localStorage.setItem('token',user.authenticatedToken);
}
beforeEach(()=>{
  sessionStorage.clear();vi.resetAllMocks();setActivePinia(createPinia());login('editor@example.org');
});
it('recovers Undo after a lost reply and reload, using the original account and operation',async()=>{
  http.post.mockRejectedValueOnce(new Error('Network Error'));
  expect(await deleteScheduled(rows)).toBe(false);
  const original=http.post.mock.calls[0][1];
  const receipt={edit:original.edit,count:2};
  setActivePinia(createPinia());login('other@example.org');await retryPendingTrash();
  expect(http.post).toHaveBeenCalledTimes(1);
  login('editor@example.org');http.post.mockResolvedValueOnce(receipt);
  await retryPendingTrash();
  expect(http.post.mock.calls[1][1]).toEqual(original);
  const feedback=useMailFeedback();
  expect(feedback.notice.message).toBe('2 messages moved to Trash.');
  http.post.mockResolvedValueOnce({scheduled:2,drafts:0});
  await feedback.undo();expect(http.post.mock.calls[2].slice(0,2)).toEqual(['/v1/scheduled/undo-trash',receipt]);
  expect(feedback.notice.message).toBe('Action undone.');
  await retryPendingTrash();expect(http.post).toHaveBeenCalledTimes(3);
});
it('forgets a stale revision after a definitive response',async()=>{
  http.post.mockRejectedValueOnce({code:409,message:'Message changed.'});
  await expect(deleteScheduled(rows)).rejects.toMatchObject({code:409});
  await retryPendingTrash();expect(http.post).toHaveBeenCalledTimes(1);
});

it('keeps each recovered Undo available before resolving the next pending operation',async()=>{
  http.post.mockRejectedValue(new Error('Network Error'));
  await deleteScheduled(rows.slice(0,1));
  await deleteScheduled(rows.slice(1));
  http.post.mockImplementation(async(path,payload)=>path.endsWith('/undo-trash') ? {scheduled:1,drafts:0} : {edit:payload.edit,count:1});
  const feedback=useMailFeedback();
  for (const i of [0,1]) {
    await retryPendingTrash();
    const edit=http.post.mock.calls[i][1].edit;
    expect(feedback.notice.scheduledTrash).toBe(edit);
    await retryPendingTrash();
    expect(feedback.notice.scheduledTrash).toBe(edit);
    await feedback.undo();
    expect(http.post.mock.calls.at(-1)[1].edit).toBe(edit);
  }
  expect(http.post).toHaveBeenCalledTimes(6);
});

it('reconciles in a new session while the original response is still in flight',async()=>{
  let finish;
  http.post.mockImplementationOnce((_path,op)=>new Promise(resolve=>{finish=()=>resolve({edit:op.edit,count:2});}));
  const first=deleteScheduled(rows);
  const user=useUserStore();user.authenticatedToken='new-session';localStorage.setItem('token','new-session');
  http.post.mockImplementationOnce(async(_path,op)=>({edit:op.edit,count:2}));
  await retryPendingTrash();
  const edit=http.post.mock.calls[0][1].edit;
  expect(http.post.mock.calls[1][1].edit).toBe(edit);
  expect(useMailFeedback().notice.scheduledTrash).toBe(edit);
  finish();expect(await first).toBe(false);
  expect(useMailFeedback().notice.scheduledTrash).toBe(edit);
});

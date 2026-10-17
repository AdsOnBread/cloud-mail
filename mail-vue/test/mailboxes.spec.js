import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAccountStore } from '../src/store/account.js';
import { useUserStore } from '../src/store/user.js';
import { accountList } from '../src/request/account.js';
vi.mock('../src/request/account.js',()=>({accountList:vi.fn()}));
vi.mock('../src/request/my.js',()=>({loginUserInfo:vi.fn()}));
beforeEach(()=>{setActivePinia(createPinia());useUserStore().user={email:'me@example.com'};vi.mocked(accountList).mockReset();});
describe('shared mailbox loading',()=>{
  it('loads every cursor page for Reply all and shares the list with the selector',async()=>{
    const page=Array.from({length:30},(_,index)=>({accountId:index+1,email:`alias${index}@example.com`,sort:10}));
    vi.mocked(accountList).mockResolvedValueOnce(page).mockResolvedValueOnce([{accountId:31,email:'last@example.com',sort:1}]);
    const store=useAccountStore();store.currentAccountId=1;
    const addresses=await store.loadAll();
    expect(store.accounts).toHaveLength(31);expect(addresses).toContain('last@example.com');expect(addresses).toContain('me@example.com');
    expect(accountList).toHaveBeenNthCalledWith(2,30,30,10);expect(store.currentAccount.email).toBe('alias0@example.com');
    await store.loadMore();expect(accountList).toHaveBeenCalledTimes(2);
  });
  it('shares concurrent page loads and retains a retry after failure',async()=>{
    let finish;vi.mocked(accountList).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const store=useAccountStore();const first=store.loadMore();const second=store.loadMore();
    finish([{accountId:1,email:'one@example.com'}]);await Promise.all([first,second]);expect(accountList).toHaveBeenCalledTimes(1);expect(store.loading).toBe(false);
    vi.mocked(accountList).mockRejectedValueOnce(new Error('Offline'));
    await expect(store.refresh()).rejects.toThrow('Offline');expect(store.loadError).toBe('Offline');expect(store.loading).toBe(false);
    vi.mocked(accountList).mockResolvedValueOnce([{accountId:1,email:'one@example.com'}]);await store.loadMore();expect(store.accounts).toHaveLength(1);
  });
});

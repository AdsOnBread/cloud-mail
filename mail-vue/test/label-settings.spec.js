import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useMailLabels} from '../src/store/mail-labels';
import http from '../src/axios';
vi.mock('../src/axios',()=>({default:{get:vi.fn(),put:vi.fn(),post:vi.fn(),delete:vi.fn()}}));
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());localStorage.clear();});
describe('Label settings session',()=>{
  it('retries a compose label with the same ID and applies it before refreshing the list',async()=>{
    const labels=useMailLabels();
    localStorage.setItem('token','test-token');labels.bindSession('person@example.com','test-token');
    const assigned=vi.fn();
    labels.edit={clientId:'first-creation',onCreated:assigned};
    http.post.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({id:7,name:'Project'});
    await expect(labels.save(null,'Project')).rejects.toThrow('Connection lost');
    let finish;
    http.get.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const saving=labels.save(null,'Project');
    await vi.waitFor(()=>expect(assigned).toHaveBeenCalledWith(7));
    expect(http.post.mock.calls.map(call=>call[1].clientId)).toEqual(['first-creation','first-creation']);
    expect(labels.edit).toBeNull();
    finish([{id:7,name:'Project'}]);
    await saving;
  });
  it('closes the edit dialog and refreshes the list after removing a label',async()=>{
    const labels=useMailLabels();
    localStorage.setItem('token','test-token');labels.bindSession('person@example.com','test-token');
    labels.items=[{id:4,name:'Unused'}];labels.edit={id:4,remove:true};
    http.delete.mockResolvedValueOnce({});http.get.mockResolvedValueOnce([]);
    await labels.remove(4);
    expect(labels.edit).toBeNull();
    expect(labels.items).toEqual([]);
  });
  it('requires the authenticated owner before sending and rebinds on a new login to the same account',async()=>{
    const labels=useMailLabels();
    localStorage.setItem('token','first');labels.bindSession('person@example.com','first');
    localStorage.setItem('token','second');
    await expect(labels.setSystem('draft','hide')).rejects.toThrow('account changed');
    expect(http.put).not.toHaveBeenCalled();
    labels.bindSession('person@example.com','second');
    await labels.setSystem('draft','show');
    expect(http.put.mock.calls[0][2].headers.Authorization).toBe('second');
    expect(labels.system.draft).toBe('show');
  });
});

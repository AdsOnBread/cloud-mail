import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useMailLabels} from '../src/store/mail-labels';
import http from '../src/axios';
vi.mock('../src/axios',()=>({default:{get:vi.fn(),put:vi.fn(),post:vi.fn()}}));
beforeEach(()=>{vi.resetAllMocks();setActivePinia(createPinia());localStorage.clear();});
describe('Label settings session',()=>{
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

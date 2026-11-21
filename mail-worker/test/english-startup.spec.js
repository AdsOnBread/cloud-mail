import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	setting: { lang: '' }, user: {}, account: {}, locale: { value: '' }
}));
vi.mock('@/store/setting.js', () => ({ useSettingStore: () => state.setting }));
vi.mock('@/store/user.js', () => ({ useUserStore: () => state.user }));
vi.mock('@/store/account.js', () => ({ useAccountStore: () => state.account }));
vi.mock('@/request/my.js', () => ({ loginUserInfo: vi.fn() }));
vi.mock('@/perm/perm.js', () => ({ permsToRouter: vi.fn() }));
vi.mock('@/router', () => ({ default: { addRoute: vi.fn() } }));
vi.mock('@/request/setting.js', () => ({ websiteConfig: async () => ({ title: 'Cloud Mail', domainList: ['@example.com'] }) }));
vi.mock('@/i18n/index.js', () => ({ default: { global: { locale: state.locale } } }));
import {loginUserInfo} from '@/request/my.js';
import {permsToRouter} from '@/perm/perm.js';
import { init } from '../../mail-vue/src/init/init';

afterEach(() => vi.unstubAllGlobals());

describe('English startup preferences', () => {
	it.each(['', 'zh', 'zh-CN', 'en'])('normalizes saved locale "%s" with a Chinese browser preference', async saved => {
		state.setting.lang = saved;
		state.locale.value = saved;
		vi.stubGlobal('document', { title: '' });
		vi.stubGlobal('navigator', { language: 'zh-CN' });
		vi.stubGlobal('localStorage', { getItem: () => null });
		await init();
		expect(state.setting.lang).toBe('en');
		expect(state.locale.value).toBe('en');
		expect(document.title).toBe('Cloud Mail');
		expect(state.setting.domainList).toEqual(['@example.com']);
	});
	it('identifies the current account if another tab signs in during startup',async()=>{
		let token='older';
		vi.stubGlobal('document',{title:''});
		vi.stubGlobal('localStorage',{getItem:()=>token});
		loginUserInfo.mockImplementationOnce(async()=>{token='current';return {email:'first@example.com'};})
			.mockResolvedValueOnce({email:'second@example.com',account:{accountId:2},permKeys:[]});
		permsToRouter.mockReturnValue([]);
		await init();
		expect(loginUserInfo).toHaveBeenLastCalledWith('current');
		expect(state.user.user.email).toBe('second@example.com');
		expect(state.user.authenticatedToken).toBe('current');
	});
});

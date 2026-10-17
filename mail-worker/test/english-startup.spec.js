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
});

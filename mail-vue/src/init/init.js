import {useUserStore} from "@/store/user.js";
import {useSettingStore} from "@/store/setting.js";
import {useAccountStore} from "@/store/account.js";
import {loginUserInfo} from "@/request/my.js";
import {permsToRouter} from "@/perm/perm.js";
import router from "@/router";
import {websiteConfig} from "@/request/setting.js";
import i18n from "@/i18n/index.js";

export async function init() {
    document.title = '\u200B'

    const settingStore = useSettingStore();
    const userStore = useUserStore();
    const accountStore = useAccountStore();

    let token = localStorage.getItem('token');
    // Normalize preferences saved by earlier multilingual versions.
    settingStore.lang = 'en'

    i18n.global.locale.value = settingStore.lang

    const profile = credential => credential ? loginUserInfo(credential).catch(e => {
        console.error(e);
        return null;
    }) : null;
    const [setting, initial] = await Promise.all([websiteConfig(),profile(token)]);
    settingStore.settings = setting;
    settingStore.domainList = setting.domainList;
    document.title = setting.title;

    let user = initial;
    while (token !== localStorage.getItem('token')) {
        token = localStorage.getItem('token');
        user = await profile(token);
    }
    if (user) {
        accountStore.currentAccountId = user.account.accountId;
        accountStore.currentAccount = user.account;
        userStore.authenticatedToken = token;
        userStore.user = user;
        permsToRouter(user.permKeys).forEach(route => router.addRoute('layout',route));
    }
}

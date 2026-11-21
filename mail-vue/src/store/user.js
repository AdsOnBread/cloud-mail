import { defineStore } from 'pinia'
import {useUiStore} from './ui';
import {loginUserInfo} from "@/request/my.js";

export const useUserStore = defineStore('user', {
    state: () => ({
        user: {},
        authenticatedToken:null,
        refreshList: 0,
    }),
    getters: {
        undoSeconds: state => state.user.generalSettings?.undoSeconds ?? useUiStore().composeModes[state.user.email]?.undoSeconds ?? 5,
        hoverActions: state => state.user.generalSettings?.hoverActions !== false,
        defaultReplyAll: state => state.user.generalSettings?.replyAll === true,
    },
    actions: {
        refreshUserList() {
            loginUserInfo().then(user => {
                this.refreshList ++
            })
        },
        refreshUserInfo() {
            const token=this.authenticatedToken;
            if (!token || token!==localStorage.getItem("token")) return;
            loginUserInfo(token).then(user => {
                if (token!==this.authenticatedToken || token!==localStorage.getItem("token")) return;
                if (this.user.userId===user.userId && this.user.generalSettings?.version > (user.generalSettings?.version ?? 0))
                    user.generalSettings=this.user.generalSettings;
                this.user = user
            })
        }
    }
})
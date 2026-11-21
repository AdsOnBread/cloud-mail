import { defineStore } from 'pinia'
import {loginUserInfo} from "@/request/my.js";

export const useUserStore = defineStore('user', {
    state: () => ({
        user: {},
        authenticatedToken:null,
        refreshList: 0,
    }),
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
                if (token===this.authenticatedToken && token===localStorage.getItem("token")) this.user = user
            })
        }
    }
})
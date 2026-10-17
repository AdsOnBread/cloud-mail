import { defineStore } from 'pinia'
import { accountList } from '@/request/account.js'
import { useUserStore } from './user.js'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        accounts: [],
        recipientOwnAddresses: [],
        owner: '',
        loading: false,
        loaded: false,
        loadError: '',
        pending: null,
    }),
    getters: {
        ownAddresses(state) {
            return [...new Set([useUserStore().user.email, state.currentAccount.email,
                ...state.recipientOwnAddresses, ...state.accounts.map(account => account.email)].filter(Boolean))];
        }
    },
    actions: {
        async loadMore() {
            const owner = useUserStore().user.email;
            if (this.owner !== owner) {
                this.accounts.splice(0);
                this.recipientOwnAddresses=[];
                this.loaded = false;
                this.pending = null;
                this.owner = owner;
            }
            if (this.pending) return this.pending;
            if (this.loaded) return;
            this.loading = true;
            this.loadError = '';
            const last = this.accounts.at(-1);
            const request = accountList(last?.accountId || 0, 30, last?.sort).then(list => {
                if (this.owner !== owner) return;
                this.accounts.push(...list.filter(item => !this.accounts.some(existing => existing.accountId === item.accountId)));
                this.loaded = list.length < 30;
                const current = this.accounts.find(item => item.accountId === this.currentAccountId);
                if (current) this.currentAccount = current;
            }).catch(error => {
                if (this.owner === owner) this.loadError = error.message || 'Could not load mailboxes.';
                throw error;
            }).finally(() => {
                if (this.pending === request) { this.loading = false; this.pending = null; }
            });
            this.pending = request;
            return request;
        },
        async loadAll() {
            do { await this.loadMore(); } while (!this.loaded);
            return this.ownAddresses;
        },
        async refresh() {
            if (this.pending) await this.pending.catch(() => {});
            this.accounts.splice(0);
            this.loaded = false;
            return this.loadMore();
        },
        select(account) {
            this.currentAccountId = account.accountId;
            this.currentAccount = account;
        }
    }
})

import { defineStore } from 'pinia'

export const useWriterStore = defineStore('writer', {
    state: () => ({
        sendRecipientRecord: [],
        mailboxRecents: {},
        removedSuggestions: {}
    }),
    actions: {
        recentAddresses(owner, accountId) {
            return this.mailboxRecents[JSON.stringify([owner, accountId])] || [];
        },
        rememberAddresses(owner, accountId, addresses) {
            if (!owner || !(accountId > 0)) return;
            const key = JSON.stringify([owner, accountId]);
            if (this.removedSuggestions[key]?.length) {
                const reused = new Set(addresses.map(address=>address.toLowerCase()));
                this.removedSuggestions[key] = this.removedSuggestions[key].filter(address=>!reused.has(address));
            }
            this.mailboxRecents[key] = [...new Set([...addresses, ...this.recentAddresses(owner,accountId)])].slice(0,500);
        },
        forgetAddresses(owner, accountId, addresses) {
            const removed = new Set(addresses.map(address=>address.toLowerCase()));
            this.sendRecipientRecord = this.sendRecipientRecord.filter(address => !removed.has(address.toLowerCase()));
            if (!owner || !(accountId > 0)) return;
            const key = JSON.stringify([owner, accountId]);
            this.mailboxRecents[key] = this.recentAddresses(owner,accountId).filter(address => !removed.has(address.toLowerCase()));
            this.removedSuggestions[key] = [...new Set([...(this.removedSuggestions[key] || []),...removed])];
        }
    },
    persist: {
        pick: ['sendRecipientRecord','mailboxRecents','removedSuggestions'],
    },
})

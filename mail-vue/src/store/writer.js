import { defineStore } from 'pinia'

export const useWriterStore = defineStore('writer', {
    state: () => ({
        sendRecipientRecord: [],
        mailboxRecents: {}
    }),
    actions: {
        recentAddresses(owner, accountId) {
            return this.mailboxRecents[JSON.stringify([owner, accountId])] || [];
        },
        rememberAddresses(owner, accountId, addresses) {
            if (!owner || !(accountId > 0)) return;
            const key = JSON.stringify([owner, accountId]);
            this.mailboxRecents[key] = [...new Set([...addresses, ...this.recentAddresses(owner,accountId)])].slice(0,500);
        },
        forgetAddresses(addresses) {
            const removed = new Set(addresses);
            this.sendRecipientRecord = this.sendRecipientRecord.filter(address => !removed.has(address));
            for (const key of Object.keys(this.mailboxRecents)) {
                this.mailboxRecents[key] = this.mailboxRecents[key].filter(address => !removed.has(address));
            }
        }
    },
    persist: {
        pick: ['sendRecipientRecord','mailboxRecents'],
    },
})

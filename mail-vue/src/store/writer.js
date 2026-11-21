import { defineStore } from 'pinia'

let contactsChannel;

export const useWriterStore = defineStore('writer', {
    state: () => ({
        contactRevision: 0,
        mailboxRecents: {},
        removedSuggestions: {}
    }),
    actions: {
        listenForContacts(isCurrent) {
            const channel = new BroadcastChannel('phooey-mail-contacts');
            contactsChannel = channel;
            channel.onmessage = ({data}) => {
                if (data && isCurrent(data.owner)) this.applyContactChange(data);
            };
            return () => {
                if (contactsChannel === channel) contactsChannel = undefined;
                channel.close();
            };
        },
        applyContactChange({owner, accountId, email, saved}) {
            if (saved) this.restoreSuggestions(owner, accountId, [email]);
            this.contactRevision++;
        },
        contactChanged(change) {
            this.applyContactChange(change);
            contactsChannel?.postMessage(change);
        },
        recentAddresses(owner, accountId) {
            return this.mailboxRecents[JSON.stringify([owner, accountId])] || [];
        },
        restoreSuggestions(owner, accountId, addresses) {
            if (!owner || !(accountId > 0)) return;
            const key = JSON.stringify([owner, accountId]);
            if (this.removedSuggestions[key]?.length) {
                const reused = new Set(addresses.map(address=>address.toLowerCase()));
                this.removedSuggestions[key] = this.removedSuggestions[key].filter(address=>!reused.has(address));
            }
        },
        rememberAddresses(owner, accountId, addresses) {
            if (!owner || !(accountId > 0)) return;
            this.restoreSuggestions(owner,accountId,addresses);
            const key=JSON.stringify([owner,accountId]);
            this.mailboxRecents[key] = [...new Set([...addresses, ...this.recentAddresses(owner,accountId)])].slice(0,500);
        },
        forgetAddresses(owner, accountId, addresses) {
            const removed = new Set(addresses.map(address=>address.toLowerCase()));
            if (!owner || !(accountId > 0)) return;
            const key = JSON.stringify([owner, accountId]);
            this.mailboxRecents[key] = this.recentAddresses(owner,accountId).filter(address => !removed.has(address.toLowerCase()));
            this.removedSuggestions[key] = [...new Set([...(this.removedSuggestions[key] || []),...removed])];
        }
    },
    persist: {
        pick: ['mailboxRecents','removedSuggestions'],
    },
})

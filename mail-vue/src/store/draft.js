import { defineStore } from 'pinia'

export const userDraftStore = defineStore('draft', {
    state: () => ({
        refreshList: 0,
        setDraft: {},
        items: [],
        threads: {},
        listError: '',
    }),
    getters: {
        replies(state) {
            const byThread = {};
            for (const draft of state.items) {
                if (!draft.reply || !draft.emailId) continue;
                const key = state.threads[draft.emailId] || 'anchor-' + draft.emailId;
                (byThread[key] ||= []).push(draft);
            }
            return byThread;
        },
    }
})
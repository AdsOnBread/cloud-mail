import { defineStore } from 'pinia'

// A docked or inline editor owns its unsaved text. Route row actions through it
// while open so its next autosave includes the new filing choice.
const editors = new Set();
export function watchDraftStars(handler) {
    editors.add(handler);
    return () => editors.delete(handler);
}
export function starInOpenEditor(id, owner, starred) {
    for (const apply of editors) {
        const saved = apply(id, owner, starred);
        if (saved) return saved;
    }
}

export const userDraftStore = defineStore('draft', {
    state: () => ({
        refreshList: 0,
        scheduledRevision: 0,
        scheduledInboxUnread: 0,
        setDraft: {},
        items: [],
        threads: {},
        threadSummaries: {},
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
import { defineStore } from 'pinia';

export const useMailSearchStore = defineStore('mail-search', {
  state: () => ({ query: '', folder: 'email' }),
  actions: {
    visit(folder) {
      if (folder === 'content') return;
      if (folder !== this.folder) this.query = '';
      this.folder = folder;
    },
  },
});

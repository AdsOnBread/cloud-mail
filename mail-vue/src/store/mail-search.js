import { defineStore } from 'pinia';

export const advancedSearchOpenerKey=Symbol('advanced search opener');

export const useMailSearchStore = defineStore('mail-search', {
  state: () => ({ query: '', folder: 'email', labelId:'', filters: {} }),
  actions: {
    visit(folder,labelId = "") {
      if (folder === 'content' || folder === 'label-settings') return;
      if (folder !== this.folder || labelId !== this.labelId) { this.query = ''; this.filters = {}; }
      this.folder = folder; this.labelId=labelId;
    },
  },
});

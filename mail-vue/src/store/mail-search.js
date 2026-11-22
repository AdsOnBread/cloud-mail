import { defineStore } from 'pinia';
import {formatSearchExpression,readSearchExpression} from '@/utils/search-expression';

export const advancedSearchOpenerKey=Symbol('advanced search opener');

export const useMailSearchStore = defineStore('mail-search', {
  state: () => ({ query: '', folder: 'email', labelId:'', filters: {}, spelling:null, pendingText:null }),
  getters: {
    inputCriteria() {
      return this.pendingText==null ? {query:this.query,filters:this.filters} : readSearchExpression(this.pendingText,this.filters);
    },
    expression(state) {
      const canonical=formatSearchExpression(state.query,state.filters);
      return state.spelling?.canonical===canonical ? state.spelling.text : canonical;
    },
  },
  actions: {
    applySearch(query,filters,text) {
      this.$patch(state=>{
        state.pendingText=null;
        state.query=query;
        state.filters=filters;
        state.spelling=text==null ? null : {canonical:formatSearchExpression(query,filters),text};
      });
    },
    visit(folder,labelId = "") {
      if (folder === 'content' || folder === 'label-settings') return;
      if (folder !== this.folder || labelId !== this.labelId) { this.applySearch('',{}); }
      this.folder = folder; this.labelId=labelId;
    },
  },
});

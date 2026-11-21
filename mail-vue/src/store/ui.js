import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
    state: () => ({
        asideShow: window.innerWidth >= 1024,
        accountShow: false,
        quickSettings:false,
        density:"default",
        inboxTabs:true,
        backgroundLoading: true,
        changeNotice: 0,
        writerRef: null,
        changePreview: 0,
        composeFormatting:false,
        composeModes:{},
        previewData: {},
        key: 0,
        dark: false,
        asideCount: {
            email: 0,
            send: 0,
            sysEmail: 0
        }
    }),
    getters: {
        rowHeight:state=>({default:40,comfortable:36,compact:32}[state.density] || 40),
    },
    actions: {
        setDark(dark) {
            document.documentElement.classList.toggle("dark",dark);
            document.getElementById("theme-color-meta")?.setAttribute("content",dark?"#1b1b1f":"#f6f8fc");
            this.dark=dark;
        },
        showNotice() {
            this.changeNotice ++
        },
        previewNotice(data) {
            this.previewData = data
            this.changePreview ++
        }
    },
    persist: {
        pick: ['dark','composeFormatting','composeModes','density','inboxTabs'],
    },
})

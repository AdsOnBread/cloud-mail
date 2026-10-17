<template>
  <div class="mail-layout" :class="{ 'nav-expanded': uiStore.asideShow }">
    <header class="mail-header"><Header /></header>
    <aside class="mail-sidebar" aria-label="Mail navigation" :inert="isMobile && !uiStore.asideShow" :aria-hidden="isMobile && !uiStore.asideShow ? true : undefined"><Aside /></aside>
    <button v-if="uiStore.asideShow && isMobile" class="nav-overlay" aria-label="Close navigation" @click="uiStore.asideShow = false" />
    <main class="mail-main"><Main /></main>
    <writer ref="writerRef" />
    <button v-if="route.name !== 'content'" v-perm="'email:send'" class="mobile-compose" aria-label="Compose message" @click="uiStore.writerRef.open()"><Icon icon="material-symbols:edit-outline" width="24" /><span>Compose</span></button>
  </div>
</template>
<script setup>
import Aside from '@/layout/aside/index.vue';
import Header from '@/layout/header/index.vue';
import Main from '@/layout/main/index.vue';
import writer from '@/layout/write/index.vue';
import { Icon } from '@iconify/vue';
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useUiStore } from '@/store/ui.js';
const uiStore = useUiStore();
const route = useRoute();
const writerRef = ref();
const isMobile = ref(window.innerWidth < 768);
let size = window.innerWidth >= 1024 ? 'desktop' : window.innerWidth >= 768 ? 'tablet' : 'mobile';
function resize() {
  isMobile.value = window.innerWidth < 768;
  const next = window.innerWidth >= 1024 ? 'desktop' : window.innerWidth >= 768 ? 'tablet' : 'mobile';
  if (next !== size) { uiStore.asideShow = next === 'desktop'; size = next; }
}
watch(() => route.name, () => { if (isMobile.value) uiStore.asideShow = false; });
onMounted(() => { uiStore.writerRef = writerRef; window.addEventListener('resize', resize); });
onBeforeUnmount(() => { uiStore.writerRef = null; window.removeEventListener('resize', resize); });
</script>
<style scoped>
.mail-layout { --nav-width:72px; position:fixed; inset:0; display:grid; grid-template-columns:var(--nav-width) minmax(0,1fr); grid-template-rows:64px minmax(0,1fr); background:var(--mail-canvas); }
.nav-expanded { --nav-width:256px; }
.mail-header { grid-column:1/-1; min-width:0; }
.mail-sidebar { grid-column:1; grid-row:2; min-height:0; overflow:hidden; }
.mail-main { grid-column:2; grid-row:2; min-width:0; min-height:0; padding:0 16px 16px 0; }
.mobile-compose { display:none; }
@media (max-width:767px) {
 .mail-layout { grid-template-columns:minmax(0,1fr); }
 .mail-main { grid-column:1; padding:0; }
 .mail-sidebar { position:fixed; top:64px; bottom:0; left:0; width:280px; background:var(--mail-canvas); z-index:110; transform:translateX(-100%); transition:transform .15s; }
 .nav-expanded .mail-sidebar { transform:translateX(0); }
 .nav-overlay { position:fixed; inset:64px 0 0; background:#0006; z-index:100; }
 .mobile-compose { display:flex; position:fixed; right:16px; bottom:24px; padding:16px 20px; align-items:center; gap:12px; border-radius:16px; background:var(--mail-compose); color:var(--mail-on-compose); box-shadow:0 3px 8px #0003; z-index:20; cursor:pointer; }
}
</style>

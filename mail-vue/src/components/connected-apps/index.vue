<template><section class="connected-apps"><h2>Connected apps</h2><p>Apps can access only your phooey! mail mailboxes. Revoking access stops further requests.</p><p v-if="error" role="alert">{{error}}</p><p v-if="!connections.length">No connected apps.</p><div v-for="app in connections" :key="app.id" class="connection"><div><strong>{{app.name}}</strong><p>{{app.scopes.join(', ')}}</p></div><el-button @click="revoke(app)">Revoke access</el-button></div></section></template>
<script setup>
import {ref,onMounted} from 'vue';
import http from '@/axios';
const connections=ref([]),error=ref('');
async function load(){try{connections.value=(await http.get('/v1/connections')).connections;}catch(e){error.value=e.message||'Could not load connected apps.';}}
async function revoke(app){try{await http.delete(`/v1/connections/${app.id}`);await load();}catch(e){error.value=e.message||'Could not revoke access.';}}
onMounted(load);
</script>
<style scoped>.connected-apps{padding:24px;background:var(--mail-surface);border-radius:16px;margin:24px 0}.connection{display:flex;justify-content:space-between;gap:16px;align-items:center}p{color:var(--regular-text-color);font-size:14px}</style>

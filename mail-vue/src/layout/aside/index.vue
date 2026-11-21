<template>
  <el-scrollbar class="scroll">
    <div>
      <button v-perm="'email:send'" type="button" class="compose-button" data-tip="Compose" aria-label="Compose message" @click="uiStore.writerRef.open()"><Icon icon="material-symbols:edit-outline" width="24" /><span>Compose</span></button>
      <el-menu :collapse="false"  >
        <el-menu-item @click="router.push({name: 'email'})" index="email" aria-label="Inbox" data-tip="Inbox"
                      :class="activeFolder === 'email' ? 'choose-item' : ''">
          <Icon icon="material-symbols:inbox-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('inbox')}}</span><span v-if="unread" class="menu-name draft-count">{{ unread }}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'star'})" index="star" aria-label="Starred" data-tip="Starred"
                      :class="activeFolder === 'star' ? 'choose-item' : ''">
          <Icon icon="material-symbols:star-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('starred')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name:'snoozed'})" index="snoozed" aria-label="Snoozed" data-tip="Snoozed" :class="{'choose-item':activeFolder==='snoozed'}">
          <Icon icon="material-symbols:schedule-outline" width="20"/><span class="menu-name" style="margin-left:16px">Snoozed</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'send'})" index="send" aria-label="Sent" data-tip="Sent" v-perm="'email:send'"
                      :class="activeFolder === 'send' ? 'choose-item' : ''">
          <Icon icon="material-symbols:send-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('sent')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push('/scheduled')" index="scheduled" aria-label="Scheduled" data-tip="Scheduled" :class="{'choose-item':activeFolder==='scheduled'}">
          <Icon icon="material-symbols:schedule-send-outline" width="20"/><span class="menu-name folder-name">Scheduled</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'draft'})" index="draft" aria-label="Drafts" data-tip="Drafts" v-perm="'email:send'"
                      :class="activeFolder === 'draft' ? 'choose-item' : ''">
          <Icon icon="material-symbols:draft-outline" width="19" height="19" />
          <span class="menu-name" style="margin-left: 17px">{{$t('drafts')}}</span><span v-if="drafts.items.length" class="menu-name draft-count">{{ drafts.items.length }}</span>
        </el-menu-item>
        <el-menu-item index="more" :aria-expanded="more" :aria-label="more ? 'Less' : 'More'" :data-tip="more ? 'Less' : 'More'" @click="more=!more">
          <Icon :icon="more ? 'material-symbols:expand-less' : 'material-symbols:expand-more'" width="20" /><span class="menu-name folder-name">{{ more ? 'Less' : 'More' }}</span>
        </el-menu-item>
        <template v-if="more">
          <el-menu-item index="all" aria-label="All Mail" data-tip="All Mail" :class="{'choose-item':activeFolder==='all'}" @click="router.push('/all')">
            <Icon icon="material-symbols:all-inbox-outline" width="20" /><span class="menu-name folder-name">All Mail</span>
          </el-menu-item>
        <el-menu-item @click="router.push({name:'archived'})" index="archived" aria-label="Archived" data-tip="Archived" :class="{'choose-item':activeFolder==='archived'}">
          <Icon icon="material-symbols:archive-outline" width="20"/><span class="menu-name" style="margin-left:16px">Archived</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name:'trash'})" index="trash" aria-label="Trash" data-tip="Trash" :class="activeFolder==='trash'?'choose-item':''"><Icon icon="material-symbols:delete-outline" width="20"/><span class="menu-name" style="margin-left:16px">Trash</span></el-menu-item>
        <el-menu-item @click="router.push({name: 'setting'})" aria-label="Settings" data-tip="Settings" index="setting"
                      :class="activeFolder === 'setting' ? 'choose-item' : ''">
          <Icon icon="fluent:settings-48-regular" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('settings')}}</span>
        </el-menu-item>
        </template>
        <div class="label-heading"><span class="menu-name">Labels</span><button class="mail-icon" aria-label="Create new label" data-tip="Create new label" @click="labels.edit={}"><Icon icon="material-symbols:add" width="20" /></button></div>
        <div v-for="label in labels.items" :key="label.id" class="label-row" :class="{'selected-label':activeLabel===label.id}">
          <router-link :to="{name:'label',params:{labelId:label.id}}" :data-tip="label.name" :aria-label="label.name">
            <Icon icon="material-symbols:label-outline" width="20" /><span class="menu-name">{{ label.name }}</span>
          </router-link>
          <el-dropdown trigger="click" popper-class="mail-action-menu" :show-arrow="false" @command="cmd=>labels.edit={...label,remove:cmd==='remove'}">
            <button class="mail-icon label-options" :aria-label="'Options for '+label.name"><Icon icon="material-symbols:more-vert" width="18" /></button>
            <template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">Edit</el-dropdown-item><el-dropdown-item command="remove">Remove label</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
        </div>
        <button v-if="labels.error" class="labels-error" @click="labels.load()">Retry loading labels</button>
        <div class="manage-title" v-perm="['all-email:query','user:query','role:query','setting:query','analysis:query','reg-key:query']">
          <div>{{$t('manage')}}</div>
        </div>
        <el-menu-item @click="router.push({name: 'analysis'})" aria-label="Analytics" data-tip="Analytics" index="analysis" v-perm="'analysis:query'"
                      :class="activeFolder === 'analysis' ? 'choose-item' : ''">
          <Icon icon="fluent:data-pie-20-regular" width="24" height="24" />
          <span class="menu-name" style="margin-left: 13px">{{$t('analytics')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'user'})" aria-label="All users" data-tip="All users" index="setting" v-perm="'user:query'"
                      :class="activeFolder === 'user' ? 'choose-item' : ''">
          <Icon icon="si:user-alt-2-line" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('allUsers')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'all-email'})" aria-label="Manage all mail" data-tip="Manage all mail" index="all-email" v-perm="'all-email:query'"
                      :class="activeFolder === 'all-email' ? 'choose-item' : ''">
          <Icon icon="fluent:mail-list-28-regular" width="22" height="22" />
          <span class="menu-name" style="margin-left: 15px">Manage all mail</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'role'})" aria-label="Permissions" data-tip="Permissions" index="setting" v-perm="'role:query'"
                      :class="activeFolder === 'role' ? 'choose-item' : ''">
          <Icon icon="fluent:lock-closed-16-regular" width="22" height="22" />
          <span class="menu-name" style="margin-left: 15px">{{$t('permissions')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'reg-key'})" aria-label="Invite codes" data-tip="Invite codes" index="reg-key" v-perm="'reg-key:query'"
                      :class="activeFolder === 'reg-key' ? 'choose-item' : ''">
          <Icon icon="fluent:fingerprint-20-filled" width="22" height="22" />
          <span class="menu-name" style="margin-left: 15px">{{$t('inviteCode')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'sys-setting'})" aria-label="System settings" data-tip="System settings" index="sys-setting" v-perm="'setting:query'"
                      :class="activeFolder === 'sys-setting' ? 'choose-item' : ''">
          <Icon icon="eos-icons:system-ok-outlined" width="18" height="18" style="margin-left: 2px" />
          <span class="menu-name" style="margin-left: 17px">{{$t('SystemSettings')}}</span>
        </el-menu-item>
      </el-menu>
      <div class="mailbox-selector">
        <el-popover v-if="hasPerm('account:query') && settingStore.settings.manyEmail === 0" v-model:visible="uiStore.accountShow" trigger="click" placement="right-start" :width="340" popper-class="mailbox-popover">
          <template #reference><button type="button" class="mailbox-button" :data-tip="accountStore.currentAccount.email" aria-label="Choose mailbox" :aria-expanded="uiStore.accountShow"><Icon icon="material-symbols:account-circle-outline" width="22" /><span>{{ accountStore.currentAccount.email }}</span><Icon class="mailbox-chevron" icon="material-symbols:expand-more" width="18" /></button></template>
          <Account />
        </el-popover>
        <div v-else class="mailbox-button" :data-tip="accountStore.currentAccount.email"><Icon icon="material-symbols:account-circle-outline" width="22" /><span>{{ accountStore.currentAccount.email }}</span></div>
      </div>
    </div>
  </el-scrollbar>
</template>

<script setup>
import {conversationList} from '@/request/conversation';
import { useEmailStore } from '@/store/email';
import { userDraftStore } from '@/store/draft';
import Account from '@/layout/account/index.vue';
import { useAccountStore } from '@/store/account.js';
import { useUiStore } from '@/store/ui.js';
import { hasPerm } from '@/perm/perm.js';
import router from "@/router/index.js";
import { useRoute } from 'vue-router';
import { computed, ref, watch } from 'vue';
import { useMailLabels } from '@/store/mail-labels';
import { useUserStore } from '@/store/user';
import { useMailSearchStore } from '@/store/mail-search.js';
import {Icon} from "@iconify/vue";
import {useSettingStore} from "@/store/setting.js";

const drafts = userDraftStore();
const settingStore = useSettingStore();
const route = useRoute();
const mailSearch = useMailSearchStore();
const activeFolder = computed(() => route.name === 'content' ? mailSearch.folder : route.meta.name);
const labels = useMailLabels(), user=useUserStore();
const more=ref(false);
const activeLabel=computed(()=>activeFolder.value==="label"?Number(route.params.labelId || route.query.labelId):0);
watch(activeFolder,folder=>{if(["archived","trash","all","setting"].includes(folder))more.value=true;},{immediate:true});
watch(()=>user.user.email,email=>labels.load(email),{immediate:true});
const accountStore = useAccountStore();
const emailStore=useEmailStore();
const unread=ref(0);
watch(()=>emailStore.inboxUnread, snapshot=>{
  if(snapshot?.accountId===accountStore.currentAccountId && snapshot.allReceive===Boolean(accountStore.currentAccount.allReceive))
    unread.value=snapshot.count;
});
watch([()=>user.user.email,()=>accountStore.currentAccountId,()=>Boolean(accountStore.currentAccount.allReceive),()=>emailStore.conversationRevision],
  ([owner,accountId,allReceive],previous,onCleanup)=>{
    let current=true;
    if (!previous || previous[0]!==owner || previous[1]!==accountId || previous[2]!==allReceive) unread.value=0;
    if (!owner || !accountId) return;
    const timer=setTimeout(async()=>{
      try {
        const data=await conversationList({folder:"inbox",accountId,allReceive:allReceive?1:0,countOnly:1});
        if(current)unread.value=data.unreadThreads;
      } catch { /* Keep the last known count until the next refresh. */ }
    },100);
    onCleanup(()=>{current=false;clearTimeout(timer);});
  },{immediate:true});
const uiStore = useUiStore();

</script>

<style scoped>
.folder-name { margin-left:16px; }
.label-heading { height:48px; margin:10px 16px 0 24px; display:flex; align-items:center; justify-content:space-between; }
.label-heading span { font-size:16px; font-weight:500; }
.label-row { display:flex; align-items:center; margin-right:8px; height:32px; border-radius:0 16px 16px 0; }
.label-row:hover { background:var(--mail-hover); }
.label-row.selected-label { background:var(--mail-selected); font-weight:600; }
.label-row a { display:flex; align-items:center; gap:16px; padding-left:24px; min-width:0; flex:1; height:100%; color:inherit; text-decoration:none; }
.label-row a svg { flex-shrink:0; }
.label-row a span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.label-options { opacity:0; }
.label-row:hover .label-options,.label-row:focus-within .label-options { opacity:1; }
:global(.mail-layout.nav-compact) .label-row .el-dropdown { display:none; }
.labels-error { margin:8px 24px; color:var(--el-color-primary); }
.scroll { height:100%; }
.mailbox-selector { padding:12px 12px 8px; }
.mailbox-button { width:100%; height:36px; display:flex; align-items:center; gap:10px; color:var(--regular-text-color); cursor:pointer; padding:0 12px; border-radius:18px; font-size:12px; }
.mailbox-button:hover { background:var(--mail-hover); }
.mailbox-button svg { flex-shrink:0; }
.mailbox-button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left; }
.compose-button { margin:8px 0 12px 8px; padding:0 24px; height:56px; display:flex; align-items:center; gap:16px; color:var(--mail-on-compose); background:var(--mail-compose); border-radius:16px; cursor:pointer; font-weight:500; box-shadow:0 1px 2px #0001; }
.compose-button:hover { box-shadow:0 2px 5px #0003; }
.el-menu { border:0; background:transparent; width:100%; }
.el-menu-item { height:32px; line-height:32px; margin:0 12px 0 0; padding:0 24px !important; border-radius:0 18px 18px 0; color:var(--el-text-color-primary); }
.el-menu-item svg { flex-shrink:0; }
.el-menu-item:hover { background:var(--mail-hover); }
.choose-item { background:var(--mail-selected) !important; font-weight:600; }
.menu-name { font-size:14px; }
.draft-count { margin-left:auto; font-size:12px; font-weight:600; }
.manage-title { padding:24px 24px 8px; font-size:12px; color:var(--regular-text-color); }
:global(.mail-layout.nav-compact .mail-sidebar .menu-name), :global(.mail-layout.nav-compact .mail-sidebar .manage-title), :global(.mail-layout.nav-compact .mail-sidebar .mailbox-button span), :global(.mail-layout.nav-compact .mail-sidebar .mailbox-chevron), :global(.mail-layout.nav-compact .mail-sidebar .compose-button span) { display:none; }
:global(.mail-layout.nav-compact .mail-sidebar .el-menu-item) { padding:0 24px !important; margin-right:8px; height:40px; border-radius:0 20px 20px 0; }
:global(.mail-layout.nav-compact .mail-sidebar .compose-button) { width:48px; padding:0 12px; margin-left:12px; height:48px; }
:global(.mail-layout.nav-compact .mail-sidebar .mailbox-button) { padding:0 12px; }
@media (max-width:767px) { .el-menu-item { height:40px; } }
</style>

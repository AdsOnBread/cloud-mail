<template>
  <el-scrollbar class="scroll">
    <div>
      <div class="mailbox-selector">
        <el-popover v-if="hasPerm('account:query') && settingStore.settings.manyEmail === 0" v-model:visible="uiStore.accountShow" trigger="click" placement="right-start" :width="340" popper-class="mailbox-popover">
          <template #reference><button type="button" class="mailbox-button" :title="accountStore.currentAccount.email" aria-label="Choose mailbox" :aria-expanded="uiStore.accountShow"><Icon icon="material-symbols:account-circle-outline" width="22" /><span>{{ accountStore.currentAccount.email }}</span><Icon class="mailbox-chevron" icon="material-symbols:expand-more" width="18" /></button></template>
          <Account />
        </el-popover>
        <div v-else class="mailbox-button" :title="accountStore.currentAccount.email"><Icon icon="material-symbols:account-circle-outline" width="22" /><span>{{ accountStore.currentAccount.email }}</span></div>
      </div>
      <button v-perm="'email:send'" type="button" class="compose-button" title="Compose" aria-label="Compose message" @click="uiStore.writerRef.open()"><Icon icon="material-symbols:edit-outline" width="24" /><span>Compose</span></button>
      <el-menu :collapse="false"  style="margin-top: 10px">
        <el-menu-item @click="router.push({name: 'email'})" index="email" aria-label="Inbox" title="Inbox"
                      :class="activeFolder === 'email' ? 'choose-item' : ''">
          <Icon icon="material-symbols:inbox-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('inbox')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'send'})" index="send" aria-label="Sent" title="Sent" v-perm="'email:send'"
                      :class="activeFolder === 'send' ? 'choose-item' : ''">
          <Icon icon="material-symbols:send-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('sent')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'draft'})" index="draft" aria-label="Drafts" title="Drafts" v-perm="'email:send'"
                      :class="activeFolder === 'draft' ? 'choose-item' : ''">
          <Icon icon="material-symbols:draft-outline" width="19" height="19" />
          <span class="menu-name" style="margin-left: 17px">{{$t('drafts')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'star'})" index="star" aria-label="Starred" title="Starred"
                      :class="activeFolder === 'star' ? 'choose-item' : ''">
          <Icon icon="material-symbols:star-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('starred')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'setting'})" aria-label="Settings" title="Settings" index="setting"
                      :class="activeFolder === 'setting' ? 'choose-item' : ''">
          <Icon icon="fluent:settings-48-regular" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('settings')}}</span>
        </el-menu-item>
        <div class="manage-title" v-perm="['all-email:query','user:query','role:query','setting:query','analysis:query','reg-key:query']">
          <div>{{$t('manage')}}</div>
        </div>
        <el-menu-item @click="router.push({name: 'analysis'})" aria-label="Analytics" title="Analytics" index="analysis" v-perm="'analysis:query'"
                      :class="activeFolder === 'analysis' ? 'choose-item' : ''">
          <Icon icon="fluent:data-pie-20-regular" width="24" height="24" />
          <span class="menu-name" style="margin-left: 13px">{{$t('analytics')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'user'})" aria-label="All users" title="All users" index="setting" v-perm="'user:query'"
                      :class="activeFolder === 'user' ? 'choose-item' : ''">
          <Icon icon="si:user-alt-2-line" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('allUsers')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'all-email'})" aria-label="All mail" title="All mail" index="all-email" v-perm="'all-email:query'"
                      :class="activeFolder === 'all-email' ? 'choose-item' : ''">
          <Icon icon="fluent:mail-list-28-regular" width="22" height="22" />
          <span class="menu-name" style="margin-left: 15px">{{$t('allMail')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'role'})" aria-label="Permissions" title="Permissions" index="setting" v-perm="'role:query'"
                      :class="activeFolder === 'role' ? 'choose-item' : ''">
          <Icon icon="fluent:lock-closed-16-regular" width="22" height="22" />
          <span class="menu-name" style="margin-left: 15px">{{$t('permissions')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'reg-key'})" aria-label="Invite codes" title="Invite codes" index="reg-key" v-perm="'reg-key:query'"
                      :class="activeFolder === 'reg-key' ? 'choose-item' : ''">
          <Icon icon="fluent:fingerprint-20-filled" width="22" height="22" />
          <span class="menu-name" style="margin-left: 15px">{{$t('inviteCode')}}</span>
        </el-menu-item>
        <el-menu-item @click="router.push({name: 'sys-setting'})" aria-label="System settings" title="System settings" index="sys-setting" v-perm="'setting:query'"
                      :class="activeFolder === 'sys-setting' ? 'choose-item' : ''">
          <Icon icon="eos-icons:system-ok-outlined" width="18" height="18" style="margin-left: 2px" />
          <span class="menu-name" style="margin-left: 17px">{{$t('SystemSettings')}}</span>
        </el-menu-item>
      </el-menu>
    </div>
  </el-scrollbar>
</template>

<script setup>
import Account from '@/layout/account/index.vue';
import { useAccountStore } from '@/store/account.js';
import { useUiStore } from '@/store/ui.js';
import { hasPerm } from '@/perm/perm.js';
import router from "@/router/index.js";
import { useRoute } from 'vue-router';
import { computed } from 'vue';
import { useMailSearchStore } from '@/store/mail-search.js';
import {Icon} from "@iconify/vue";
import {useSettingStore} from "@/store/setting.js";

const settingStore = useSettingStore();
const route = useRoute();
const mailSearch = useMailSearchStore();
const activeFolder = computed(() => route.name === 'content' ? mailSearch.folder : route.meta.name);
const accountStore = useAccountStore();
const uiStore = useUiStore();

</script>

<style scoped>
.scroll { height:100%; }
.mailbox-selector { padding:0 12px 8px; }
.mailbox-button { width:100%; height:36px; display:flex; align-items:center; gap:10px; color:var(--regular-text-color); cursor:pointer; padding:0 12px; border-radius:18px; font-size:12px; }
.mailbox-button:hover { background:var(--mail-hover); }
.mailbox-button svg { flex-shrink:0; }
.mailbox-button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left; }
.compose-button { margin:0 0 12px 12px; padding:0 24px; height:56px; display:flex; align-items:center; gap:16px; color:var(--mail-on-compose); background:var(--mail-compose); border-radius:16px; cursor:pointer; font-weight:500; box-shadow:0 1px 2px #0001; }
.compose-button:hover { box-shadow:0 2px 5px #0003; }
.el-menu { border:0; background:transparent; width:100%; }
.el-menu-item { height:32px; line-height:32px; margin:0 12px 0 0; padding:0 24px !important; border-radius:0 18px 18px 0; color:var(--el-text-color-primary); }
.el-menu-item svg { flex-shrink:0; }
.el-menu-item:hover { background:var(--mail-hover); }
.choose-item { background:var(--mail-selected) !important; font-weight:600; }
.menu-name { font-size:14px; }
.manage-title { padding:24px 24px 8px; font-size:12px; color:var(--regular-text-color); }
:global(.mail-layout:not(.nav-expanded) .mail-sidebar .menu-name), :global(.mail-layout:not(.nav-expanded) .mail-sidebar .manage-title), :global(.mail-layout:not(.nav-expanded) .mail-sidebar .mailbox-button span), :global(.mail-layout:not(.nav-expanded) .mail-sidebar .mailbox-chevron), :global(.mail-layout:not(.nav-expanded) .mail-sidebar .compose-button span) { display:none; }
:global(.mail-layout:not(.nav-expanded) .mail-sidebar .el-menu-item) { padding:0 24px !important; margin-right:8px; height:40px; border-radius:0 20px 20px 0; }
:global(.mail-layout:not(.nav-expanded) .mail-sidebar .compose-button) { width:48px; padding:0 12px; margin-left:12px; height:48px; }
:global(.mail-layout:not(.nav-expanded) .mail-sidebar .mailbox-button) { padding:0 12px; }
@media (max-width:767px) { .el-menu-item { height:40px; } }
</style>

<template>
  <el-scrollbar class="scroll">
    <div>
      <button v-perm="'email:send'" type="button" class="compose-button" data-tip="Compose" aria-label="Compose message" @click="uiStore.writerRef.open()"><Icon icon="material-symbols:edit-outline" width="24" /><span>Compose</span></button>
      <el-menu :collapse="false"  >
        <el-menu-item @click="router.push({name: 'email'})" index="email" aria-label="Inbox" data-tip="Inbox"
                      :class="activeFolder === 'email' ? 'choose-item' : ''">
          <Icon icon="material-symbols:inbox-outline" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('inbox')}}</span><span v-if="unread + drafts.scheduledInboxUnread" class="menu-name draft-count">{{ unread + drafts.scheduledInboxUnread }}</span>
        </el-menu-item>
        <template v-for="hidden in [false,true]" :key="String(hidden)">
          <el-menu-item v-if="hidden" index="more" :aria-expanded="more" :aria-label="more ? 'Less' : 'More'" :data-tip="more ? 'Less' : 'More'" @click="more=!more">
            <Icon :icon="more ? 'material-symbols:expand-less' : 'material-symbols:expand-more'" width="20"/><span class="menu-name folder-name">{{ more ? 'Less' : 'More' }}</span>
          </el-menu-item>
          <template v-if="!hidden || more">
            <el-menu-item v-for="folder in folderGroups[Number(hidden)]" :key="folder.id" :index="folder.id" :aria-label="folder.name" :data-tip="folder.name"
              :class="{'choose-item':activeFolder===folder.id}" @click="router.push({name:folder.id})">
              <Icon :icon="'material-symbols:'+folder.icon" width="20" height="20"/>
              <span class="menu-name folder-name">{{ folder.translation ? $t(folder.translation) : folder.name }}</span>
              <span v-if="folderCounts[folder.id]" class="menu-name draft-count">{{ folderCounts[folder.id] }}</span>
            </el-menu-item>
          </template>
        </template>
        <template v-if="more">
        <el-menu-item @click="router.push({name: 'setting'})" aria-label="Settings" data-tip="Settings" index="setting"
                      :class="activeFolder === 'setting' ? 'choose-item' : ''">
          <Icon icon="fluent:settings-48-regular" width="20" height="20" />
          <span class="menu-name" style="margin-left: 16px">{{$t('settings')}}</span>
        </el-menu-item>
        </template>
        <div class="label-heading"><span class="menu-name">Labels</span><button class="mail-icon" aria-label="Create new label" data-tip="Create new label" @click="labels.edit={}"><Icon icon="material-symbols:add" width="20" /></button></div>
        <template v-for="{node,depth,label} in orderedLabels" :key="label.id">
          <button v-if="label.id===firstHidden" class="more-labels" type="button"
            :aria-label="showHiddenLabels ? 'Fewer labels' : 'More labels'" :aria-expanded="showHiddenLabels"
            :data-tip="showHiddenLabels ? 'Less' : 'More'" @click="showHiddenLabels=!showHiddenLabels">
            <Icon :icon="showHiddenLabels ? 'material-symbols:expand-less' : 'material-symbols:expand-more'" width="20" />
            <span class="menu-name">{{ showHiddenLabels ? 'Less' : 'More' }}</span>
          </button>
          <div v-show="showHiddenLabels || !isHiddenLabel(label)" class="label-row" :data-label-id="label.id" :style="{ '--branch-indent': Math.min(depth,5)*12+'px' }"
            :class="{'selected-label':activeLabel===label.id,'unread-label':labelUnread[label.id]}">
            <button v-if="node.children.length" type="button" class="label-disclosure"
              :aria-expanded="expandedLabels.has(label.id)" :aria-label="(expandedLabels.has(label.id)?'Collapse label: ':'Expand label: ')+label.name"
              @click="toggleBranch(label.id)">
              <Icon :icon="expandedLabels.has(label.id)?'material-symbols:arrow-drop-down':'material-symbols:chevron-right'" width="16" />
            </button>
            <router-link @keydown.right.prevent="branchKey(node,true)" @keydown.left.prevent="branchKey(node,false)"
              :to="{name:'label',params:{labelId:label.id}}" :data-tip="label.name" :aria-label="label.name"
              :aria-description="labelUnread[label.id] ? labelUnread[label.id]+' unread' : undefined">
              <Icon :icon="label.background ? 'material-symbols:label' : 'material-symbols:label-outline'" :style="{color:label.background}" width="20" />
              <span class="menu-name">{{ node.text }}</span>
            </router-link>
            <span v-if="labelUnread[label.id]" class="menu-name label-count" aria-hidden="true">{{ labelUnread[label.id] }}</span>
            <LabelOptions :key="labels.owner+'-'+label.id" :label="label" />
          </div>
        </template>
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
import {categoryFolders} from "@/utils/inbox-categories";
import {systemFolders,folderMode} from "@/components/mail-labels/system-folders";
import http from '@/axios';
import {conversationList,labelUnreadCounts} from '@/request/conversation';
import { useEmailStore } from '@/store/email';
import { userDraftStore } from '@/store/draft';
import Account from '@/layout/account/index.vue';
import { useAccountStore } from '@/store/account.js';
import { useUiStore } from '@/store/ui.js';
import { hasPerm } from '@/perm/perm.js';
import router from "@/router/index.js";
import { useRoute } from 'vue-router';
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import {labelTree,openLabelRows} from "@/components/mail-labels/tree";
import LabelOptions from "@/components/mail-labels/options.vue";
import { useMailLabels } from '@/store/mail-labels';
import { useUserStore } from '@/store/user';
import { useMailSearchStore } from '@/store/mail-search.js';
import {Icon} from "@iconify/vue";
import {useSettingStore} from "@/store/setting.js";

const drafts = userDraftStore();
const settingStore = useSettingStore();
const route = useRoute();
const mailSearch = useMailSearchStore();
const activeFolder = computed(() => {
  if (route.name==='content') return mailSearch.folder;
  if (route.name==='scheduled' && route.query.message) {
    const folders={inbox:'email',starred:'star',important:'important'};
    if (Object.hasOwn(folders,route.query.from)) return folders[route.query.from];
    if (route.query.from==='label' && /^\d+$/.test(route.query.labelId || '')) return 'label';
  }
  return route.meta.name;
});
const labels = useMailLabels(), user=useUserStore();
const more=ref(false);
const activeLabel=computed(()=>activeFolder.value==="label"?Number(route.params.labelId || route.query.labelId):0);
watch([()=>user.user.email,()=>user.authenticatedToken],([email,token])=>{
  if(!email || !token)return;
  labels.bindSession(email,token);
  labels.load(email);labels.loadSystem(email);
},{immediate:true});
const accountStore = useAccountStore();
const emailStore=useEmailStore();
const unread=ref(0);
const labelUnread=ref({}), countsReady=ref(false), showHiddenLabels=ref(false);
const isHiddenLabel=label=>label.sidebar==='hide' || (label.sidebar==='unread' && !labelUnread.value[label.id]);
const hiddenLabels=computed(()=>labels.items.filter(isHiddenLabel));
watch(()=>hiddenLabels.value.length,count=>{if(!count)showHiddenLabels.value=false;});
const mainTree=computed(()=>labelTree(labels.items.filter(label=>!isHiddenLabel(label))));
const moreTree=computed(()=>labelTree(hiddenLabels.value));
const firstHidden=computed(()=>moreTree.value.roots[0]?.label.id);
const expandedLabels=ref(new Set());
const orderedLabels=computed(()=>[...openLabelRows(mainTree.value,expandedLabels.value),...openLabelRows(moreTree.value,expandedLabels.value)]
  .map(row=>({...row,label:row.node.label})));
const expansionKey=owner=>'cloudmail.labelExpansion.'+owner;
watch(()=>labels.owner, owner=>{
  let ids=[];
  try { const saved=JSON.parse(localStorage.getItem(expansionKey(owner))); if(Array.isArray(saved))ids=saved; } catch {}
  expandedLabels.value=new Set(ids.filter(Number.isSafeInteger));
},{immediate:true,flush:'sync'});
function rememberExpansion(ids) {
  expandedLabels.value=ids;
  if(labels.owner)try {localStorage.setItem(expansionKey(labels.owner),JSON.stringify([...ids]));} catch {}
}
function toggleBranch(id) {
  const ids=new Set(expandedLabels.value);
  if(ids.has(id))ids.delete(id);else ids.add(id);
  rememberExpansion(ids);
}
function branchKey(node,right) {
  if(node.children.length && expandedLabels.value.has(node.label.id)!==right){toggleBranch(node.label.id);return;}
  const target=right ? node.children[0] : node.parent;
  if(target)document.querySelector(`.mail-sidebar [data-label-id="${target.label.id}"] a`)?.focus();
}
function ancestors(id) {
  const ids=[];
  let parent=(mainTree.value.byId.get(id) || moreTree.value.byId.get(id))?.parent;
  while(parent){ids.push(parent.label.id);parent=parent.parent;}
  return ids;
}
function revealAncestors(id) {
  const ids=ancestors(id);
  if(ids.some(parent=>!expandedLabels.value.has(parent)))rememberExpansion(new Set([...expandedLabels.value,...ids]));
}
watch(()=>[activeLabel.value,...ancestors(activeLabel.value)].join('/'),()=>revealAncestors(activeLabel.value),{immediate:true});
watch(()=>labels.revealed,change=>{
  if(!change)return;
  if(moreTree.value.byId.has(change.id))showHiddenLabels.value=true;
  revealAncestors(change.id);
});
watch(()=>labels.displayChanged,change=>{if(change)focusLabelControl(change.id);});
async function focusLabelControl(id) {
  const focused=document.activeElement;
  const labelName=labels.items.find(label=>label.id===id)?.name;
  if(focused && focused!==document.body && !focused.closest(`[data-label-id="${id}"]`) &&
    focused.closest('[role="menu"]')?.getAttribute('aria-label')!=='Options for '+labelName)return;
  if(mainTree.value.byId.has(id) || showHiddenLabels.value)revealAncestors(id);
  await nextTick();
  const row=document.querySelector(`.mail-sidebar [data-label-id="${id}"]`);
  const target=row?.getClientRects().length ? row.querySelector('.label-options') : document.querySelector('.mail-sidebar .more-labels');
  target?.focus();
}
const activeLabelMode=computed(()=>{
  const label=labels.items.find(item=>item.id===activeLabel.value);
  return label ? label.sidebar || 'show' : null;
});
watch([activeLabel,activeLabelMode,()=>Boolean(labelUnread.value[activeLabel.value]),
  ()=>accountStore.currentAccountId,()=>Boolean(accountStore.currentAccount.allReceive),countsReady],
  ([id,mode,hasUnread,accountId,combined,ready],prev)=>{
    const explicitlyChanged=prev && prev[0]===id && prev[1] && mode!==prev[1] && prev[3]===accountId && prev[4]===combined;
    if(!explicitlyChanged && (mode==='hide' || (mode==='unread' && ready && !hasUnread)))showHiddenLabels.value=true;
  },{immediate:true,flush:'post'});
watch([()=>user.user.email,()=>accountStore.currentAccountId,()=>Boolean(accountStore.currentAccount.allReceive),
  ()=>labels.items.length,()=>emailStore.conversationRevision,()=>emailStore.conversationListRefresh],
  ([owner,accountId,allReceive,size],prev,cleanup)=>{
    let current=true;
    if(!prev || owner!==prev[0] || accountId!==prev[1] || allReceive!==prev[2]){
      labelUnread.value={};countsReady.value=false;showHiddenLabels.value=false;
    }
    if(!owner || !accountId || !size)return;
    const timer=setTimeout(async()=>{
      try {
        const counts=await labelUnreadCounts({accountId,allReceive:allReceive?1:0});
        if(current){labelUnread.value=counts;countsReady.value=true;}
      } catch { /* Keep the last successful count for this mailbox. */ }
    },100);
    cleanup(()=>{current=false;clearTimeout(timer);});
  },{immediate:true});
const scheduledCount=ref(0);
const categoryUnread=ref({});
watch([()=>user.user.email,()=>user.authenticatedToken,()=>accountStore.currentAccountId,
  ()=>Boolean(accountStore.currentAccount.allReceive),()=>emailStore.conversationRevision,()=>emailStore.conversationListRefresh],
  ([owner,token,accountId,combined],previous,onCleanup)=>{
    let current=true;
    if (!previous || [owner,token,accountId,combined].some((item,i)=>item!==previous[i])) categoryUnread.value={};
    if (!owner || !accountId || !token) return;
    const timer=setTimeout(async()=>{
      if (localStorage.getItem('token')!==token) return;
      try {
        const result=await http.get('/email/conversations',{params:{folder:'all',accountId,allReceive:combined?1:0,countOnly:1,categoryCounts:1},headers:{Authorization:token},noMsg:true});
        if(current && localStorage.getItem('token')===token)categoryUnread.value=result.categoryUnread || {};
      } catch { /* Retain the last successful counts until the next mailbox refresh. */ }
    },100);
    onCleanup(()=>{current=false;clearTimeout(timer);});
  },{immediate:true});
const folderCounts=computed(()=>({...categoryUnread.value,draft:drafts.items.length,scheduled:scheduledCount.value}));
const folderGroups=computed(()=>{
  const groups=[[],[]];
  for(const folder of [...systemFolders,...categoryFolders]){
    if(folder.permission && !hasPerm(folder.permission))continue;
    const mode=folderMode(folder,labels.system);
    const hidden=mode==='hide' || (mode==='unread' && !folderCounts.value[folder.id]);
    groups[Number(hidden)].push(folder);
  }
  return groups;
});
watch([activeFolder,()=>folderGroups.value[1].some(f=>f.id===activeFolder.value)],([folder,hidden])=>{
  if(hidden || folder==='setting')more.value=true;
},{immediate:true});

let countRequest=0;
async function refreshScheduledCount(){
  const request=++countRequest;
  if(!user.user.email || !accountStore.currentAccountId)return;
  try {
    const result=await http.get('/v1/scheduled',{params:{countOnly:1,includeInboxUnread:1,accountId:accountStore.currentAccount.allReceive?undefined:accountStore.currentAccountId},noMsg:true});
    if(request===countRequest){
      scheduledCount.value=result.count;
      drafts.scheduledInboxUnread=result.inboxUnread || 0;
    }
  }catch{/* Retain this mailbox's last successful count while offline. */}
}
watch([()=>user.user.email,()=>user.authenticatedToken,()=>accountStore.currentAccountId,()=>accountStore.currentAccount.allReceive],()=>{
  scheduledCount.value=0;drafts.scheduledInboxUnread=0;
  refreshScheduledCount();
},{immediate:true,flush:'sync'});
watch(()=>drafts.scheduledRevision,refreshScheduledCount);
const refreshIfVisible=()=>{if(!document.hidden)refreshScheduledCount();};
const scheduledTimer=setInterval(refreshIfVisible,60000);
document.addEventListener('visibilitychange',refreshIfVisible);
onBeforeUnmount(()=>{countRequest++;clearInterval(scheduledTimer);document.removeEventListener('visibilitychange',refreshIfVisible);});
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
.more-labels { display:flex; align-items:center; height:32px; gap:16px; padding:0 12px 0 24px; width:calc(100% - 8px); color:inherit; border-radius:0 16px 16px 0; font:inherit; cursor:pointer; }
.more-labels:hover { background:var(--mail-hover); }
.more-labels svg { flex:none; }
.label-count { pointer-events:none; position:absolute; right:10px; font-size:12px; font-weight:600; }
.label-row.unread-label { font-weight:600; }
.label-row:hover .label-count,.label-row:focus-within .label-count,.label-row:has([aria-expanded=true]) .label-count { visibility:hidden; }
@media (hover:none) { .label-count { position:static; padding-left:4px; } }
.label-row { position:relative; display:flex; align-items:center; margin-right:8px; height:32px; border-radius:0 16px 16px 0; }
.label-row:hover { background:var(--mail-hover); }
.label-row.selected-label { background:var(--mail-selected); font-weight:600; }
.label-disclosure { position:absolute; left:calc(3px + var(--branch-indent)); display:grid; place-items:center; padding:0; width:20px; height:24px; border-radius:12px; color:inherit; cursor:pointer; }
.label-disclosure:hover { background:var(--mail-hover); }
:global(.mail-layout.nav-compact .label-disclosure) { display:none; }
:global(.mail-layout.nav-compact .label-row a) { padding-left:24px; }
.label-row a { display:flex; align-items:center; gap:16px; padding-left:calc(24px + var(--branch-indent)); min-width:0; flex:1; height:100%; color:inherit; text-decoration:none; }
.label-row a svg { flex-shrink:0; }
.label-row a span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.label-row :deep(.label-options) { opacity:0; }
.label-row:hover :deep(.label-options),.label-row:focus-within :deep(.label-options),.label-row :deep(.label-options[aria-expanded=true]) { opacity:1; }
@media (hover:none) { .label-row :deep(.label-options) { opacity:1; } }
:global(.mail-layout.nav-compact .label-row .label-options) { display:none; }
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

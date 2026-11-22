<template>
  <div class="header">
    <div class="header-brand">
      <button type="button" class="icon-button" aria-label="Toggle navigation" data-tip="Main menu" :aria-expanded="uiStore.asideShow" @click="changeAside"><Icon icon="material-symbols:menu" width="24" /></button>
      <router-link to="/inbox" class="brand-name"><MailBrand :title="settingStore.settings.title"/></router-link>
    </div>
    <div v-if="searchable" class="mail-search" role="search" @focusout="leaveSuggestions">
      <form class="search-entry" @submit.prevent="submitSearch">
      <button type="submit" @pointerdown.left.prevent class="icon-button" aria-label="Search mail" data-tip="Search mail"><Icon icon="material-symbols:search" width="24" /></button>
      <span v-if="searchScope" id="mail-search-scope" class="search-folder">{{ searchScope }}</span>
      <input ref="searchInput" v-model="searchText" role="combobox" aria-autocomplete="list" :aria-expanded="showLabels"
        :aria-controls="showLabels ? 'search-label-suggestions' : undefined"
        :aria-activedescendant="showLabels && matches[choice] ? 'search-label-option-'+choice : undefined"
        :aria-keyshortcuts="userStore.user.generalSettings?.keyboardShortcuts ? '/' : undefined"
        aria-label="Search mail" :aria-describedby="searchScope ? 'mail-search-scope' : undefined" placeholder="Search mail" @pointerdown="searchOrigin=null" @focus="suggest=true" @input="suggest=true;choice=0" @keydown="searchKeys" />
      <button v-if="searchText || mailSearch.query || Object.keys(mailSearch.filters).length" type="button" @pointerdown.left.prevent class="icon-button" aria-label="Clear search" data-tip="Clear search" @click="clearSearch"><Icon icon="material-symbols:close" width="22" /></button>
      </form>
      <div v-if="showLabels" id="search-label-suggestions" role="listbox" aria-label="Go to label" class="search-label-suggestions">
        <button v-for="(item,i) in matches" :id="'search-label-option-'+i" :key="item.key" type="button"
          role="option" :aria-selected="i===choice" tabindex="-1" @pointerdown.prevent @click="openLabel(item)">
          <Icon :icon="'material-symbols:'+item.icon" width="18"/><span>{{item.query ? 'Search '+item.name+' for “'+item.query+'”' : item.name}}</span>
        </button>
        <div v-if="!matches.length" role="presentation">No matching labels</div>
      </div>
      <SearchOptions :query-text="searchText" @applied="applyAdvanced" />
    </div>
    <div v-else class="page-title">{{ $t(route.meta.title) }}</div>
    <MailboxShortcuts :available="searchable" @search="focusSearch" />
    <div class="toolbar">
      <button type="button" v-if="uiStore.dark" class="icon-button" aria-label="Switch to light mode" data-tip="Light mode" @click="openDark($event)">
        <Icon icon="material-symbols:light-mode-outline" width="22"/>
      </button>
      <button type="button" v-else class="icon-button" aria-label="Switch to dark mode" data-tip="Dark mode" @click="openDark($event)">
        <Icon icon="material-symbols:dark-mode-outline" width="22"/>
      </button>
      <button type="button" class="icon-button notice" aria-label="Announcements" data-tip="Announcements" @click="openNotice"><Icon icon="material-symbols:campaign-outline" width="22" /></button>
      <button type="button" class="icon-button" id="mail-settings-trigger" aria-label="Settings" data-tip="Settings" :aria-expanded="uiStore.quickSettings" @click="uiStore.quickSettings=!uiStore.quickSettings"><Icon icon="material-symbols:settings-outline" width="24" /></button>
      <el-dropdown trigger="click" placement="bottom-end" :show-arrow="false" :teleported="false" popper-class="detail-dropdown">
        <button type="button" class="avatar" aria-label="Your account" data-tip="Your account" >
          <div class="avatar-text">
            <div>{{ formatName(userStore.user.email) }}</div>
          </div>
        </button>
        <template #dropdown>
          <div class="user-details">
            <div class="details-avatar">
              {{ formatName(userStore.user.email) }}
            </div>
            <div class="user-name">
              {{ userStore.user.name }}
            </div>
            <div class="detail-email" @click="copyEmail(userStore.user.email)">
              {{ userStore.user.email }}
            </div>
            <div class="detail-user-type">
              <el-tag>{{ userStore.user.role.name }}</el-tag>
            </div>
            <div class="action-info">
              <div>
                <span style="margin-right: 10px">{{ $t('sendCount') }}</span>
                <span style="margin-right: 10px">{{ $t('accountCount') }}</span>
              </div>
              <div>
                <div>
                  <span v-if="sendCount" style="margin-right: 5px">{{ sendCount }}</span>
                  <el-tag v-if="!hasPerm('email:send')">{{ sendType }}</el-tag>
                  <el-tag v-else>{{ sendType }}</el-tag>
                </div>
                <div>
                  <el-tag v-if="settingStore.settings.manyEmail || settingStore.settings.addEmail">
                    {{ $t('disabled') }}
                  </el-tag>
                  <span v-else-if="accountCount && hasPerm('account:add')"
                        style="margin-right: 5px">{{ $t('totalUserAccount', {msg: accountCount}) }}</span>
                  <el-tag v-else-if="!accountCount && hasPerm('account:add')">{{ $t('unlimited') }}</el-tag>
                  <el-tag v-else-if="!hasPerm('account:add')">{{ $t('unauthorized') }}</el-tag>
                </div>
              </div>
            </div>
            <div class="logout">
              <el-button type="primary" :loading="logoutLoading" @click="clickLogout">{{ $t('logOut') }}</el-button>
            </div>
          </div>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup>
import MailBrand from '@/components/mail-brand.vue';
import MailboxShortcuts from "@/components/mail-keyboard-shortcuts/index.vue";
import {labelSuggestions} from '@/utils/search-labels';
import {systemFolders} from '@/components/mail-labels/system-folders';
import {useMailLabels} from '@/store/mail-labels';
import SearchOptions from "@/components/mail-search-options.vue";
import router from "@/router";
import {logout} from "@/request/login.js";
import {Icon} from "@iconify/vue";
import { useMailTheme } from '@/store/mail-theme';
import {useUiStore} from "@/store/ui.js";
import {useUserStore} from "@/store/user.js";
import {useRoute} from "vue-router";
import {computed, nextTick, ref, watch} from "vue";
import { useMailSearchStore } from "@/store/mail-search.js";
import {useSettingStore} from "@/store/setting.js";
import {hasPerm} from "@/perm/perm.js"
import {useI18n} from "vue-i18n";

const {t} = useI18n();
const route = useRoute();
const mailSearch = useMailSearchStore();
const appliedText=computed(()=>mailSearch.expression);
const searchText = computed({
  get:()=>mailSearch.pendingText ?? appliedText.value,
  set:value=>{mailSearch.pendingText=value===appliedText.value ? null : value;},
});
import {readSearchExpression} from '@/utils/search-expression';
import {categoryFolders} from "@/utils/inbox-categories";
const searchable = computed(() => ['email','send','star','content','draft','archived','snoozed','important','trash','scheduled','all','label'].includes(route.name) || categoryFolders.some(item=>item.id===route.name));
const searchFolder = computed(() => {
  if (route.name==='content') {
    const origin=route.query.folder;
    if (!origin) return mailSearch.folder;
    if (origin==='label') return /^\d+$/.test(route.query.labelId || '') ? 'label' : 'all';
    if (['all','draft','archived','snoozed','important',...categoryFolders.map(item=>item.id)].includes(origin)) return origin;
    if (origin==='sent') return 'send';
    return origin==='starred' ? 'star' : 'email';
  }
  if (route.name === "scheduled" && route.query.message) {
    if (route.query.from === "inbox") return "email";
    if (route.query.from === "starred") return "star";
    if (["important","snoozed"].includes(route.query.from)) return route.query.from;
    if (route.query.from === "label" && /^\d+$/.test(route.query.labelId || "")) return "label";
  }
  return route.name;
});
const searchScope = computed(() => {
  if (searchFolder.value==='label') {
    const label=labels.items.find(item=>String(item.id)===String(searchLabelId.value));
    if(label) return 'label:'+label.name;
  }
  if (categoryFolders.some(item=>item.id===searchFolder.value)) return "category:" + searchFolder.value;
  return ["trash","scheduled"].includes(searchFolder.value) ? "in:" + searchFolder.value : "";
});
const searchLabelId=computed(()=>route.params.labelId || (searchFolder.value==="label" ? route.query.labelId : undefined));
watch([searchFolder,searchLabelId], ([name,labelId]) => { mailSearch.visit(name,labelId); searchText.value = appliedText.value; }, { immediate:true });

const labels=useMailLabels(), searchInput=ref(null), suggest=ref(false), choice=ref(0);
let searchOrigin;
const labelQuery=computed(()=>/^label:(.*)$/i.exec(searchText.value)?.[1]);
const showLabels=computed(()=>suggest.value && labelQuery.value!==undefined);
const destinations=computed(()=>{
  return [{id:'email',name:'Inbox',icon:'inbox-outline'},...systemFolders,...categoryFolders]
    .filter(folder=>!folder.permission || hasPerm(folder.permission))
    .map(folder=>({...folder,key:folder.id,to:{name:folder.id}}))
    .concat(labels.items.map(label=>({key:'label-'+label.id,name:label.name,icon:'label-outline',to:{name:'label',params:{labelId:label.id}}})));
});
const matches=computed(()=>labelSuggestions(labelQuery.value,destinations.value));
function focusSearch(label){
  if(!searchInput.value) return;
  searchOrigin=document.activeElement;
  searchInput.value.focus();
  if(label){searchText.value='label:';choice.value=0;suggest.value=true;}
  else searchInput.value.select();
}
function leaveSuggestions(event){
  if(event.relatedTarget!==searchInput.value) suggest.value=false;
}
function searchKeys(event){
  if(event.isComposing || event.keyCode===229) return;
  if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();
    suggest.value=false;searchText.value=appliedText.value;
    if(searchOrigin?.isConnected && searchOrigin!==document.body) searchOrigin.focus();
    else searchInput.value.blur();
    searchOrigin=null;
  } else if(showLabels.value && matches.value.length && ['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();
    choice.value=(choice.value+(event.key==='ArrowDown'?1:-1)+matches.value.length)%matches.value.length;
    document.getElementById('search-label-option-'+choice.value)?.scrollIntoView({block:'nearest'});
  }
}
async function openLabel(item){
  const owner=userStore.user.userId, token=userStore.authenticatedToken;
  await router.push(item.to);
  if(router.resolve(item.to).fullPath!==router.currentRoute.value.fullPath ||
     token!==userStore.authenticatedToken || token!==localStorage.getItem('token') || owner!==userStore.user.userId) return;
  const {query,filters}=readSearchExpression(item.query || '');
  mailSearch.applySearch(query,filters,item.query);
  searchText.value=appliedText.value;
  suggest.value=false;choice.value=0;searchInput.value?.blur();searchOrigin=null;
}
function submitSearch() {
  const selected=matches.value[choice.value];
  if(showLabels.value && selected){openLabel(selected);return;}
  suggest.value=false;
  if (searchText.value!==appliedText.value) {
    const {query,filters}=readSearchExpression(searchText.value,mailSearch.filters);
    mailSearch.applySearch(query,filters,searchText.value.trim());
  }
  searchText.value=appliedText.value;
  returnToResults();
}
function returnToResults() {
  if (route.name === 'scheduled' && route.query.message) router.replace(searchFolder.value==='label' ? {name:'label',params:{labelId:searchLabelId.value}} : {name:searchFolder.value});
  if (route.name === 'content') router.push(mailSearch.folder === "label" && route.query.labelId ? {name:"label",params:{labelId:route.query.labelId}} : {name:mailSearch.folder === "label" ? "all" : mailSearch.folder,query:mailSearch.folder==="email" && route.query.category?{category:route.query.category}:{}});
}
async function applyAdvanced({scope,query,filters,stillCurrent,origin}) {
  if (!stillCurrent()) return;
  const [name,labelId]=scope.split(':');
  const target={name};
  if (name==='label') target.params={labelId};
  if (name==='email' && route.query.category && mailSearch.folder==='email') target.query={category:route.query.category};
  if (route.fullPath!==router.resolve(target).fullPath) await router.push(target);
  if (route.name!==name || (name==='label' && String(route.params.labelId)!==labelId) || !stillCurrent()) return;
  mailSearch.visit(name,labelId);
  mailSearch.applySearch(query,filters);
  searchText.value=appliedText.value;
  await nextTick();
  if (!origin?.isConnected && document.activeElement===document.body) document.querySelector('.mail-search [data-search-options]')?.focus({preventScroll:true});
}
function clearSearch() { choice.value=0; searchText.value = ''; mailSearch.applySearch('',{}); }

const settingStore = useSettingStore();
const userStore = useUserStore();
const uiStore = useUiStore(), theme=useMailTheme();
const logoutLoading = ref(false)


const accountCount = computed(() => {
  return userStore.user.role.accountCount
})

const sendType = computed(() => {

  if (settingStore.settings.send === 1) {
    return t('disabled')
  }

  if (!hasPerm('email:send')) {
    return t('unauthorized')
  }

  if (userStore.user.role.sendType === 'ban') {
    return t('sendBanned')
  }

  if (userStore.user.role.sendType === 'internal') {
    return t('sendInternal')
  }

  if (!userStore.user.role.sendCount) {
    return t('unlimited')
  }

  if (userStore.user.role.sendType === 'day') {
    return t('daily')
  }

  if (userStore.user.role.sendType === 'count') {
    return t('total')
  }
})

const sendCount = computed(() => {


  if (!hasPerm('email:send')) {
    return null
  }

  if (userStore.user.role.sendType === 'ban') {
    return null
  }

  if (userStore.user.role.sendType === 'internal') {
    return null
  }

  if (!userStore.user.role.sendCount) {
    return null
  }

  if (settingStore.settings.send === 1) {
    return null
  }

  return userStore.user.sendCount + '/' + userStore.user.role.sendCount
})

async function copyEmail(email) {
  try {
    await navigator.clipboard.writeText(email);
    ElMessage({
      message: t('copySuccessMsg'),
      type: 'success',
      plain: true,
    })
  } catch (err) {
    console.error(`${t('copyFailMsg')}:`, err);
    ElMessage({
      message: t('copyFailMsg'),
      type: 'error',
      plain: true,
    })
  }
}


function openNotice() {
  uiStore.showNotice()
}

async function openDark() {
  try { await theme.apply(uiStore.dark?'light':'dark'); }
  catch(e){ ElMessage.error(e.message || 'Could not save this theme.'); }
}

function changeAside() {
  uiStore.asideShow = !uiStore.asideShow
}

function clickLogout() {
  logoutLoading.value = true
  logout().then(() => {
    localStorage.removeItem("token")
    router.replace('/login')
  }).finally(() => {
    logoutLoading.value = false
  })
}

function formatName(email) {
  return email?.[0]?.toUpperCase() || ''
}

</script>
<style>
.detail-dropdown {
  color: var(--el-text-color-primary) !important;
}
</style>
<style lang="scss" scoped>

:deep(.el-popper.is-pure) {
  border-radius: 6px;
}

.user-details {
  width: 250px;
  font-size: 14px;
  display: grid;
  grid-template-columns: 1fr;
  justify-items: center;

  .user-name {
    font-weight: bold;
    margin-top: 10px;
    padding-left: 20px;
    padding-right: 20px;
    width: 250px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: center;
  }

  .detail-user-type {
    margin-top: 10px;
  }

  .action-info {
    width: 100%;
    display: grid;
    grid-template-columns: auto auto;
    margin-top: 10px;

    > div:first-child {
      display: grid;
      align-items: center;
      gap: 10px;
    }

    > div:last-child {
      display: grid;
      gap: 10px;
      text-align: center;

      > div {
        display: flex;
        align-items: center;
      }
    }
  }

  .detail-email {
    padding-left: 20px;
    padding-right: 20px;
    width: 250px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: center;
    color: var(--regular-text-color);
    cursor: pointer;
  }

  .logout {
    margin-top: 20px;
    width: 100%;
    padding-left: 10px;
    padding-right: 10px;
    padding-bottom: 10px;

    .el-button {
      border-radius: 6px;
      height: 28px;
      width: 100%;
    }
  }

  .details-avatar {
    margin-top: 20px;
    height: 40px;
    width: 40px;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    border: 1px solid var(--dark-border);
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
  }
}


.header { height:64px; display:grid; grid-template-columns:256px minmax(180px,720px) minmax(160px,1fr); align-items:center; gap:0; padding-right:20px; }
.header-brand { display:flex; align-items:center; gap:4px; padding-left:16px; min-width:0; }
.brand-name { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--regular-text-color); font-size:22px; min-width:0; }

.icon-button { width:40px; height:40px; display:flex; align-items:center; justify-content:center; flex-shrink:0; border-radius:50%; cursor:pointer; color:var(--regular-text-color); }
.icon-button:hover { background:var(--mail-hover); }
.mail-search { display:flex; align-items:center; height:48px; min-width:0; border-radius:24px; background:var(--mail-search); padding:0 6px; }
.search-entry { flex:1; min-width:0; display:flex; align-items:center; }
.search-folder { font-size:16px; margin-left:8px; white-space:nowrap; max-width:42%; overflow:hidden; text-overflow:ellipsis; }
.mail-search:focus-within { background:var(--mail-surface); box-shadow:0 1px 3px #0003; }
.mail-search input { flex:1; width:0; min-width:0; color:var(--el-text-color-primary); font-size:16px; padding:0 8px; }
.mail-search input:focus-visible { outline:0; }
.mail-search:has(input:focus-visible) { box-shadow:0 0 0 1px var(--light-border-color),0 2px 6px #0003; }
@media (forced-colors:active) { .mail-search:has(input:focus-visible) { outline:2px solid Highlight; } }
.search-folder + input::placeholder { visibility:hidden; }
.mail-search input::placeholder { color:var(--regular-text-color); opacity:1; }
.page-title { font-size:20px; padding-left:16px; }
.toolbar { display:flex; align-items:center; justify-content:flex-end; gap:4px; padding-left:12px; }
.avatar { width:36px; height:36px; border:3px solid var(--mail-surface); border-radius:50%; color:#fff; background:#7c4d79; cursor:pointer; margin-left:8px; display:flex; align-items:center; justify-content:center; font-size:16px; }
.avatar-text { display:flex; align-items:center; justify-content:center; }
@media (max-width:1023px) { .header { grid-template-columns:72px minmax(140px,1fr) auto; padding-right:12px; } .brand-name { display:none; } .header-brand { padding-left:16px; } }
@media (max-width:767px) { .header { grid-template-columns:48px minmax(90px,1fr) auto; padding-right:8px; } .header-brand { padding-left:4px; } .toolbar { gap:0; padding-left:4px; } .toolbar .icon-button { width:32px; height:36px; } .notice { display:none; } .avatar { margin-left:4px; width:34px; height:34px; } .mail-search { height:44px; padding:0 2px; } .mail-search .icon-button { width:32px; } .mail-search input { font-size:14px; padding:0 2px; } }
@media (max-width:600px) {
  .search-folder { display:none; }
  .search-folder + input::placeholder { visibility:visible; }
}
/* Make room for the active query and its controls on compact phones. */
@media (max-width:480px) {
  .header { position:relative; }
  .mail-search:has(.search-entry input:focus) { position:absolute; inset-inline:8px; z-index:2; }
}
</style>

<style scoped>
.mail-search{position:relative}
.search-label-suggestions{position:absolute;top:100%;inset-inline:0;z-index:110;max-height:min(360px,50dvh);overflow:auto;background:var(--el-bg-color);color:var(--el-text-color-primary);box-shadow:0 4px 8px #20212433;border-radius:0 0 16px 16px;padding:4px 0 8px}
.mail-search:has(.search-label-suggestions){border-radius:24px 24px 0 0;background:var(--el-bg-color)}
.search-label-suggestions button,.search-label-suggestions>div{display:flex;align-items:center;gap:16px;width:100%;padding:0 18px;min-height:36px;font:14px/20px Arial,sans-serif;text-align:start}
.search-label-suggestions button{cursor:pointer}.search-label-suggestions button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-label-suggestions button[aria-selected=true],.search-label-suggestions button:hover{background:var(--mail-hover)}
</style>

<template>
  <div class="header">
    <div class="header-brand">
      <button type="button" class="icon-button" aria-label="Toggle navigation" title="Main menu" :aria-expanded="uiStore.asideShow" @click="changeAside"><Icon icon="material-symbols:menu" width="24" /></button>
      <router-link to="/inbox" class="brand-name"><Icon icon="material-symbols:mail-outline-rounded" width="32" /><span>{{ settingStore.settings.title || 'Cloudmail' }}</span></router-link>
    </div>
    <form v-if="searchable" class="mail-search" role="search" @submit.prevent="submitSearch">
      <button type="submit" class="icon-button" aria-label="Search mail" title="Search mail"><Icon icon="material-symbols:search" width="24" /></button>
      <input v-model="searchText" aria-label="Search mail" placeholder="Search mail" @keydown.esc="clearSearch" />
      <button v-if="searchText || mailSearch.query" type="button" class="icon-button" aria-label="Clear search" title="Clear search" @click="clearSearch"><Icon icon="material-symbols:close" width="22" /></button>
    </form>
    <div v-else class="page-title">{{ $t(route.meta.title) }}</div>
    <div class="toolbar">
      <button type="button" v-if="uiStore.dark" class="icon-button" aria-label="Switch to light mode" title="Light mode" @click="openDark($event)">
        <Icon icon="material-symbols:light-mode-outline" width="22"/>
      </button>
      <button type="button" v-else class="icon-button" aria-label="Switch to dark mode" title="Dark mode" @click="openDark($event)">
        <Icon icon="material-symbols:dark-mode-outline" width="22"/>
      </button>
      <button type="button" class="icon-button notice" aria-label="Announcements" title="Announcements" @click="openNotice"><Icon icon="material-symbols:campaign-outline" width="22" /></button>
      <button type="button" class="icon-button" aria-label="Settings" title="Settings" @click="router.push('/settings')"><Icon icon="material-symbols:settings-outline" width="24" /></button>
      <el-dropdown ref="userinfoRef" @visible-change="e => userInfoShow = e" :teleported="false" popper-class="detail-dropdown">
        <button type="button" class="avatar" aria-label="Your account" title="Your account" @click="userInfoHide" >
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
import router from "@/router";
import {logout} from "@/request/login.js";
import {Icon} from "@iconify/vue";
import {useUiStore} from "@/store/ui.js";
import {useUserStore} from "@/store/user.js";
import {useRoute} from "vue-router";
import {computed, ref, watch} from "vue";
import { useMailSearchStore } from "@/store/mail-search.js";
import {useSettingStore} from "@/store/setting.js";
import {hasPerm} from "@/perm/perm.js"
import {useI18n} from "vue-i18n";

const {t} = useI18n();
const route = useRoute();
const mailSearch = useMailSearchStore();
const searchText = ref(mailSearch.query);
const searchable = computed(() => ['email','send','star','content'].includes(route.name));
watch(() => route.name, name => { mailSearch.visit(name); searchText.value = mailSearch.query; }, { immediate:true });
watch(() => mailSearch.query, query => { searchText.value = query; });
function submitSearch() {
  mailSearch.query = searchText.value.trim();
  if (route.name === 'content') router.push({ name: mailSearch.folder });
}
function clearSearch() { searchText.value = ''; mailSearch.query = ''; }

const settingStore = useSettingStore();
const userStore = useUserStore();
const uiStore = useUiStore();
const logoutLoading = ref(false)
const userInfoShow = ref(false)
const userinfoRef = ref({})

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

function userInfoHide(e) {
    if (userInfoShow.value) {
        userinfoRef.value.handleClose()
    } else {
        userinfoRef.value.handleOpen()
    }
}

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

function openDark(e) {

  const nextIsDark = !uiStore.dark
  const root = document.documentElement

  if (!document.startViewTransition) {
    switchDark(nextIsDark, root);
    return
  }

  const x = e.clientX
  const y = e.clientY

  const maxX = Math.max(x, window.innerWidth - x)
  const maxY = Math.max(y, window.innerHeight - y)
  const endRadius = Math.hypot(maxX, maxY)

  // Set the transition target for CSS selectors
  root.setAttribute('data-theme-to', nextIsDark ? 'dark' : 'light')
  root.style.setProperty('--vt-x', `${x}px`)
  root.style.setProperty('--vt-y', `${y}px`)
  root.style.setProperty('--vt-end-radius', `${endRadius + 10}px`)

  const transition = document.startViewTransition(() => {
    switchDark(nextIsDark, root);
  })

  transition.finished.finally(() => {
    // Clear the transition target
    root.removeAttribute('data-theme-to')
  })
}

function switchDark(nextIsDark, root) {
  root.setAttribute('class', nextIsDark ? 'dark' : '')
  const metaTag = document.getElementById('theme-color-meta');
  const isMobile =  !window.matchMedia("(pointer: fine) and (hover: hover)").matches;
  metaTag?.setAttribute('content', nextIsDark ? '#1b1b1f' : '#f6f8fc');
  uiStore.dark = nextIsDark
}

function openSend() {
  uiStore.writerRef.open()
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
.brand-name svg { color:#d93025; flex-shrink:0; }
.brand-name span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:166px; }
.icon-button { width:40px; height:40px; display:flex; align-items:center; justify-content:center; flex-shrink:0; border-radius:50%; cursor:pointer; color:var(--regular-text-color); }
.icon-button:hover { background:var(--mail-hover); }
.mail-search { display:flex; align-items:center; height:48px; min-width:0; border-radius:24px; background:var(--mail-search); padding:0 6px; }
.mail-search:focus-within { background:var(--mail-surface); box-shadow:0 1px 3px #0003; }
.mail-search input { flex:1; width:0; min-width:0; color:var(--el-text-color-primary); font-size:16px; padding:0 8px; }
.mail-search input::placeholder { color:var(--regular-text-color); opacity:1; }
.page-title { font-size:20px; padding-left:16px; }
.toolbar { display:flex; align-items:center; justify-content:flex-end; gap:4px; padding-left:12px; }
.avatar { width:36px; height:36px; border:3px solid var(--mail-surface); border-radius:50%; color:#fff; background:#7c4d79; cursor:pointer; margin-left:8px; display:flex; align-items:center; justify-content:center; font-size:16px; }
.avatar-text { display:flex; align-items:center; justify-content:center; }
@media (max-width:1023px) { .header { grid-template-columns:72px minmax(140px,1fr) auto; padding-right:12px; } .brand-name { display:none; } .header-brand { padding-left:16px; } }
@media (max-width:767px) { .header { grid-template-columns:48px minmax(90px,1fr) auto; padding-right:8px; } .header-brand { padding-left:4px; } .toolbar { gap:0; padding-left:4px; } .toolbar .icon-button { width:32px; height:36px; } .notice { display:none; } .avatar { margin-left:4px; width:34px; height:34px; } .mail-search { height:44px; padding:0 2px; } .mail-search .icon-button { width:32px; } .mail-search input { font-size:14px; padding:0 2px; } }
</style>

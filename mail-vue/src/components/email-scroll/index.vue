<template>
  <div class="email-container">
    <div class="header-actions">
      <el-checkbox aria-label="Select all messages"
          v-model="checkAll"
          :indeterminate="isIndeterminate"
          :disabled="!emailList.length || loading"
          @change="handleCheckAllChange"
      >
      </el-checkbox>
      <div class="header-left" :style="'padding-left:' + actionLeft">

        <slot name="first"></slot>
        <button type="button" class="list-action" title="Refresh" aria-label="Refresh mail" @click="refresh"><Icon icon="material-symbols:refresh" width="22" /></button>
        <button v-if="getSelectedMailsIds().length > 0" v-perm="'email:delete'" type="button" class="list-action" title="Delete selected" aria-label="Delete selected messages" @click="handleDelete"><Icon icon="material-symbols:delete-outline" width="22" /></button>
        <button v-if="getSelectedMailsIds().length > 0 && showUnread" v-perm="'email:delete'" type="button" class="list-action" title="Mark as read" aria-label="Mark selected messages as read" @click="handleRead"><Icon icon="material-symbols:mark-email-read-outline" width="22" /></button>
      </div>

      <div class="header-right">
        <span class="email-count" v-if="total">{{ $t('emailCount', {total: total}) }}</span>
        <span v-if="['email','send'].includes(type)" class="current-mailbox" :title="accountStore.currentAccount.email">{{ accountStore.currentAccount.allReceive ? 'All mailboxes' : accountStore.currentAccount.email }}</span>
      </div>
    </div>

    <div ref="scroll" class="scroll">
      <UseVirtualList ref="scrollbarRef"
                        @scroll="onScroll"
                        :list="list"
                        :options="{ itemHeight: itemHeight, overscan: 15 }"
                        class="virtual"
                        style="height: 100%"
                        v-if="!loading && emailList.length > 0"
                        :key="keyCount"
        >
          <template #default="{ data: item, index }" >
            <div :class="['email-row', props.type, { 'right-checked': item.rightChecked, 'unread-row': item.unread === EmailUnreadEnum.UNREAD && showUnread }]"
                 :data-checked="item.checked" tabindex="0" :aria-label="`${item.name || item.sendEmail || 'Draft'}: ${item.subject || 'No subject'}`" @keydown.enter.self="jumpDetails(item)"
                 @click="jumpDetails(item)"
                 v-if="!item.expand"
                 :key="item.emailId"
                 @contextmenu="handleContextmenu($event, item)"
            >
              <el-checkbox :class=" props.type === 'all-email' ? 'all-email-checkbox' : 'checkbox'"
                           v-model="item.checked" :aria-label="`Select ${item.subject || 'message'}`"
                           :disabled="!item.checked && isSelectMax"
                           @click.stop></el-checkbox>
              <button type="button" @click.stop="starChange(item)" class="pc-star" v-if="showStar" :aria-label="item.isStar ? 'Remove star' : 'Star message'" :title="item.isStar ? 'Remove star' : 'Star message'">
                <Icon v-if="item.isStar" icon="fluent-color:star-16" width="20" height="20"/>
                <Icon v-else icon="material-symbols:star-outline" width="20" height="20"/>
              </button>
              <div v-if="!showStar"></div>
              <div class="title" :class="accountShow ? 'title-column' : 'title-column'">

                <div class="email-sender" :style=" (showStatus ? 'gap: 10px;' : '') + ((item.unread === EmailUnreadEnum.UNREAD && showUnread)  ? 'font-weight: bold' : '')">
                  <div class="email-status" v-if="showStatus">
                    <el-tooltip effect="dark" :content="item.statusIcon.content">
                      <Icon :icon="item.statusIcon.icon" :style="`color: ${item.statusIcon.color}`" width="20" height="20"/>
                    </el-tooltip>
                    <div class="del-status" v-if="item.isDel">
                      <el-tooltip effect="dark" :content="item.isDelContent">
                        <Icon class="icon" icon="mdi:email-remove" width="20" height="20"/>
                      </el-tooltip>
                    </div>
                  </div>
                  <div v-else></div>
                  <span class="name">
                    <span>
                      <div class="unread" v-if="isMobile && (item.unread === EmailUnreadEnum.UNREAD && showUnread) "/>
                      <slot name="name" :email="item"> {{ item.name || item.sendEmail }}</slot>
                    </span>
                    <span>
                      <Icon v-if="item.isStar" icon="fluent-color:star-16" width="18" height="18"/>
                    </span>
                  </span>
                  <span class="phone-time">{{ item.formatCreateTime }}</span>
                </div>
                <div>
                  <div class="email-text">
                    <span class="email-subject" :style="(item.unread === EmailUnreadEnum.UNREAD && showUnread)  ? 'font-weight: bold' : ''">
                      <div class="unread" v-if="!isMobile && (item.unread === EmailUnreadEnum.UNREAD && showUnread) "/>
                      <span v-if="item.code" class="code-tag" @click.stop="copyCode(item.code)">[{{ t('codeLabel') }}{{ item.code }}]</span>
                      <span class="subject-text">
                        <slot name="subject" :email="item" >
                          {{ item.subject || '(no subject)' }}
                        </slot>
                      </span>
                    </span>
                    <span class="email-content">{{ item.listText || item.text || '\u200B' }}</span>
                  </div>
                  <div class="user-info" v-if="showUserInfo">
                    <div class="user">
                      <span>
                        <Icon icon="mynaui:user" width="20" height="20"/>
                      </span>
                      <span>{{ item.userEmail }}</span>
                    </div>
                    <div class="account">
                      <span>
                        <Icon icon="mdi-light:email" width="20" height="20"/>
                      </span>
                      <span>{{ item.type === 0 ? item.toEmail : item.sendEmail }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="email-right" :style="showUserInfo ? 'align-self: start;':''">
                <span class="email-time" :style="(item.unread === EmailUnreadEnum.UNREAD && showUnread) ? 'font-weight: bold' : ''">{{ item.formatCreateTime }}</span>
              </div>
            </div>
            <skeletonBlock v-else-if="item.expand === 'loading'"
                           :rows="1"
                           :showStar="showStar"
                           :accountShow="accountShow"
                           :showStatus="showStatus"
                           :showUserInfo="showUserInfo"
                           :type="type"/>
            <div class="noLoading" v-else-if="item.expand === 'noMoreData'">
              <div>{{ $t('noMoreData') }}</div>
            </div>
          </template>
        </UseVirtualList>
      <skeletonBlock v-if="firstLoad && showFirstLoading"
                       :rows="20"
                       :showStar="showStar"
                       :accountShow="accountShow"
                       :showStatus="showStatus"
                       :showUserInfo="showUserInfo"
                       :type="type"/>
      <skeletonBlock v-if="loading && !firstLoad"
                       :rows="skeletonRows"
                       :showStar="showStar"
                       :accountShow="accountShow"
                       :showStatus="showStatus"
                       :showUserInfo="showUserInfo"
                       :type="type"/>
      <div v-if="loadError" class="list-error" role="alert">{{ loadError }} <button type="button" @click="loadError = ''; loadData()">Retry</button></div>
      <div class="empty" v-if="!loadError && noLoading && emailList.length === 0 && !loading">
        <el-empty :image-size="isMobile ? 120 : null" :description="$t('noMessagesFound')"/>
      </div>
    </div>
    <el-dropdown
        ref="dropdownRef"
        @visible-change="visibleChange"
        :virtual-ref="triggerRef"
        :show-arrow="false"
        :popper-options="{
      modifiers: [{ name: 'offset', options: { offset: [0, 0] } }],
    }"
        virtual-triggering
        trigger="contextmenu"
        placement="bottom-start"
    >
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-if="rightClickEmail.code" @click="copyCode(rightClickEmail.code)" >
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="fluent-color:clipboard-24" width="20" height="20" />
                <span>{{t('copyCode')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="['email'].includes(props.type)" @click="emailRead(rightClickEmail.emailId)" >
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="fluent:mail-read-20-regular" width="20" height="20" />
                <span>{{t('markAsRead')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="['email','star'].includes(props.type) && hasPerm('email:send')" @click="openReply(rightClickEmail)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="la:reply" width="20" height="20"  />
                <span>{{t('reply')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="['email','star'].includes(props.type) && hasPerm('email:send')" @click="openReplyAll(rightClickEmail)">
            <div class="right-dropdown-item"><Icon icon="material-symbols:reply-all" width="20" /><span>Reply all</span></div>
          </el-dropdown-item>
          <el-dropdown-item v-if="['email','send', 'star'].includes(props.type) && hasPerm('email:send')" @click="openForward(rightClickEmail)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="iconoir:arrow-up-right" width="19" height="19"  />
                <span>{{t('forward')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="['email','send', 'star'].includes(props.type)" @click="starChange(rightClickEmail)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="solar:star-line-duotone" width="19" height="19"/>
                <span>{{t('star')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="props.type === 'all-email'" @click="handleSearch('user', rightClickEmail.userEmail)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="iconoir:search" width="20" height="20" />
                <span>{{t('searchUser')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="props.type === 'all-email' " @click="handleSearch('account', rightClickEmail.toEmail)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="iconoir:search" width="20" height="20" />
                <span>{{t('searchEmail')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item v-if="props.type === 'all-email' " @click="handleSearch('name', rightClickEmail.name)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="iconoir:search" width="20" height="20" />
                <span>{{t('searchSender')}}</span>
              </div>
            </template>
          </el-dropdown-item>
          <el-dropdown-item @click="rightDelete(rightClickEmail.emailId)">
            <template #default>
              <div class="right-dropdown-item">
                <Icon icon="uiw:delete" width="16" height="20" style="margin-left: 1px;margin-right: 3px" />
                <span>{{t('delete')}}</span>
              </div>
            </template>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
import {Icon} from "@iconify/vue";
import skeletonBlock from "@/components/email-scroll/skeleton/index.vue"
import {computed, onActivated, reactive, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import {useEmailStore} from "@/store/email.js";
import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {fromNow} from "@/utils/day.js";
import {useI18n} from "vue-i18n";
import {EmailUnreadEnum} from "@/enums/email-enum.js";
import { UseVirtualList } from '@vueuse/components'
import { useScroll } from '@vueuse/core'
import { createRequestGuard } from '@/utils/request-guard.js';
import { useMailSearchStore } from '@/store/mail-search.js';
import { hasPerm } from '@/perm/perm.js';
import { useAccountStore } from '@/store/account.js';

const props = defineProps({
  requestKey: { type: String, default: '' },
  getEmailList: Function,
  emailDelete: Function,
  emailRead: Function,
  starAdd: Function,
  starCancel: Function,
  cancelSuccess: Function,
  starSuccess: Function,
  actionLeft: {
    type: String,
    default: '0'
  },
  timeSort: {
    type: Number,
    default: 0,
  },
  showStatus: {
    type: Boolean,
    default: false
  },
  showAccountIcon: {
    type: Boolean,
    default: true,
  },
  showUserInfo: {
    type: Boolean,
    default: false
  },
  showStar: {
    type: Boolean,
    default: true
  },
  allowStar: {
    type: Boolean,
    default: true
  },
  type: {
    type: String,
    default: 'email'
  },
  showFirstLoading: {
    type: Boolean,
    default: true
  },
  showUnread: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['jump', 'refresh-before', 'delete-draft', 'right-search'])
const {t} = useI18n()
const settingStore = useSettingStore()
const uiStore = useUiStore();
const emailStore = useEmailStore();
const loading = ref(false);
const followLoading = ref(false);
const noLoading = ref(false);
const emailList = reactive([])
const expandList = reactive([])
const total = ref(0);
const checkAll = ref(false);
const isIndeterminate = ref(false);
const scroll = ref(null)
const firstLoad = ref(true)
let scrollTop = 0
const latestEmail = ref(null)
const scrollbarRef = ref(null)
const requests = createRequestGuard();
const mailSearch = useMailSearchStore();
const accountStore = useAccountStore();
const loadError = ref('');
let isMobile = ref(innerWidth < 768)
let skeletonRows = 0
const timePaddingRight = ref('');
const keyCount = ref(0);
const dropdownRef = ref(null);
const dropdownCloseLock = ref(false);
const dropdownShow = ref(false);
const rightClickEmail = ref({});
const MAX_SELECT_COUNT = 95;
const checkedEmailCount = ref(0);
const isSelectMax = computed(() => checkedEmailCount.value >= MAX_SELECT_COUNT);
let timer = null
const position = ref(
    DOMRect.fromRect({
      x: 0,
      y: 0,
    })
)

const triggerRef = ref({
  getBoundingClientRect() {
    return position.value;
  }
})

const queryParam = reactive({
  size: 50
});

defineExpose({
  refreshList,
  deleteEmail,
  addItem,
  handleList,
  emailList,
  firstLoad,
  latestEmail,
  noLoading,
  total
})

onActivated(() => {
  requestAnimationFrame(() => {
    const index = scrollTop / itemHeight.value
    scrollbarRef.value?.scrollTo(index);
  })
})

onMounted(() => {
  timer = setInterval(() => {
    emailList.forEach(email => {
      email.formatCreateTime = fromNow(email.createTime);
    })
  }, 1000 * 60);
})

onUnmounted(() => {
  clearInterval(timer)
})

getEmailList()

function resize() { isMobile.value = innerWidth < 768; }
onMounted(() => window.addEventListener('resize', resize));
onUnmounted(() => window.removeEventListener('resize', resize));
watch(() => props.requestKey, () => refreshList());

function onScroll(e) {
  scrollTop = e.target.scrollTop;
}

const { arrivedState } = useScroll(scrollbarRef, {
  offset: { bottom: isMobile.value ? 2200 : 1500 }
})


const list = computed(() => {
  return [...emailList, ...expandList]
})

const itemHeight = computed(() => {
    if (props.type === 'all-email') {
      return isMobile.value ? 116 : 64;
    } else  {
      return isMobile.value ? 84 : 40;
    }
})

watch(emailList, () => {
  updateHasScrollbar();
})

watch(scrollbarRef, () => {
  updateHasScrollbar();
})

// Refresh explicitly after changing itemHeight; the virtual list does not update automatically
watch(itemHeight, () => {
  keyCount.value ++
})

watch(followLoading, (isFollowLoading) => {
  if (isFollowLoading) {
    expandList.push({
      emailId: 0,
      expand: 'loading'
    })
  } else {
    const index = expandList.findIndex(item => item.expand === 'loading')
    if (index >= 0) expandList.splice(index, 1);
  }
});

watch(noLoading, (isNoLoading) => {
  if (isNoLoading) {
    expandList.push({
      emailId: 0,
      expand: 'noMoreData'
    })
  } else {
    const index = expandList.findIndex(item => item.expand === 'noMoreData')
    if (index >= 0) expandList.splice(index, 1);
  }
})


// Watch for the end of the list
watch(() => arrivedState.bottom, (isBottom) => {
  if (isBottom && !loading.value) {
    loadData();
  }
});

watch(
    () => emailList.map(item => item.checked),
    () => {
      checkedEmailCount.value = emailList.length
      if (emailList.length > 0) {
        updateCheckStatus();
      }
    },
    {deep: true}
);


watch(() => emailStore.deleteIds, () => {
  if (emailStore.deleteIds) {
    deleteEmail(emailStore.deleteIds)
  }
})

watch(() => emailStore.cancelStarEmailId, () => {
  emailList.forEach(email => {
    if (email.emailId === emailStore.cancelStarEmailId) {
      email.isStar = 0
    }
  })
})

watch(() => emailStore.addStarEmailId, () => {
  emailList.forEach(email => {
    if (email.emailId === emailStore.addStarEmailId) {
      email.isStar = 1
    }
  })
})

function closeContextMenu() { if (dropdownShow.value) dropdownRef.value.handleClose(); }
onMounted(() => window.addEventListener('wheel', closeContextMenu));
onUnmounted(() => window.removeEventListener('wheel', closeContextMenu));

function openReply(email) { uiStore.writerRef.openReply(email); }
function openReplyAll(email) { uiStore.writerRef.openReplyAll(email); }

function openForward(email) { uiStore.writerRef.openForward(email); }

function visibleChange(e) {
  dropdownShow.value = e;
  dropdownCloseLock.value = true;
  setTimeout(() => {
    dropdownCloseLock.value = false;
  },1500)

  if (!e && rightClickEmail.value.rightChecked) {
    rightClickEmail.value.rightChecked = false
  }
}

const handleContextmenu = (event, email) => {

  if (props.type === 'draft') {
    return
  }

  if (rightClickEmail.value.rightChecked) {
    rightClickEmail.value.rightChecked = false
  }

  const { clientX, clientY } = event
  position.value = DOMRect.fromRect({
    x: clientX,
    y: clientY,
  })
  event.preventDefault();
  dropdownRef.value?.handleOpen();

  rightClickEmail.value = email;
  rightClickEmail.value.rightChecked = true
}

function updateHasScrollbar() {
  nextTick(() => {
    const doc = document.querySelector('.virtual');
    if (doc) {
      if (doc.scrollHeight > doc.clientHeight) {
        timePaddingRight.value = '5px';
      } else {
        timePaddingRight.value = '15px'
      }
    }
  })
}

function getSkeletonRows() {
  if (emailList.length > 20) return skeletonRows = 20
  if (emailList.length === 0) return skeletonRows = 1
  skeletonRows = emailList.length
}

const accountShow = computed(() => {
  return uiStore.accountShow && settingStore.settings.manyEmail === 0
})

function starChange(email) {

  if (!email.isStar) {

    if (!props.allowStar) return;

    email.isStar = 1;
    props.starAdd(email.emailId).then(() => {
      email.isStar = 1;
      props.starSuccess(email)
    }).catch(e => {
      console.error(e)
      email.isStar = 0
    })
  } else {

    email.isStar = 0;
    props.starCancel(email.emailId).then(() => {
      email.isStar = 0;
      props.cancelSuccess?.(email)
    }).catch(e => {
      console.error(e)
      email.isStar = 1;
    })
  }
}

const handleRead = () => {
  const emailIds = getSelectedMailsIds();
  props.emailRead(emailIds);
  localRead(emailIds);
}

function emailRead(emailId) {
  props.emailRead([emailId])
  localRead([emailId]);
}

function localRead(emailIds) {
  emailIds.forEach(emailId => {
    const index = emailList.findIndex(email => email.emailId === emailId);
    if (index > -1) {
      emailList[index].unread = EmailUnreadEnum.READ;
      emailList[index].checked = false;
    }
  })
}

function rightDelete(emailId) {

  if (props.type === 'all-email') {
    ElMessageBox.confirm(t('delOneEmailConfirm'), {
      confirmButtonText: t('confirm'),
      cancelButtonText: t('cancel'),
      type: 'warning'
    }).then(() => {
      props.emailDelete([emailId]).then(() => {
        ElMessage({
          message: t('delSuccessMsg'),
          type: 'success',
          plain: true
        })
        emailStore.deleteIds = [emailId];
      })
    })
    return;
  }
  props.emailDelete([emailId]).then(() => {
    ElMessage({
      message: t('delSuccessMsg'),
      type: 'success',
      plain: true
    })
    emailStore.deleteIds = [emailId];
  })
}

function handleSearch(type, value) {
  emit('right-search', type, value);
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    ElMessage({
      message: t('copySuccessMsg'),
      type: 'success',
      plain: true
    })
  } catch (err) {
    console.error(`${t('copyFailMsg')}:`, err);
    ElMessage({
      message: t('copyFailMsg'),
      type: 'error',
      plain: true
    })
  }
}

function handleDelete() {
  ElMessageBox.confirm(t('delEmailsConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {

    if (props.type === 'draft') {
      const draftIds = getSelectedDraftsIds();
      emit('delete-draft', draftIds);
      return;
    }

    const emailIds = getSelectedMailsIds();
    props.emailDelete(emailIds).then(() => {
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true
      })
      emailStore.deleteIds = emailIds;
    })
  })
}

function deleteEmail(emailIds) {
  emailIds.forEach(emailId => {
    emailList.forEach((item, index) => {
      if (emailId === item.emailId) {
        emailList.splice(index, 1);
      }
    })
  })
  if (emailList.length < queryParam.size && !noLoading.value) {
    getEmailList()
  }
}

function addItem(email) {
  if (['email','send','star'].includes(props.type) && mailSearch.query) return false;
  if (['email','send'].includes(props.type) && !accountStore.currentAccount.allReceive && email.accountId && email.accountId !== accountStore.currentAccountId) return false;

  const existIndex = emailList.findIndex(item => item.emailId === email.emailId)

  if (existIndex > -1) {
    return false;
  }

  email.formatCreateTime = fromNow(email.formatCreateTime);

  if (props.timeSort) {
    if (noLoading.value) {
      handleList([email]);
      emailList.push(email);
    }

    if (email.emailId > latestEmail.value?.emailId) {
      latestEmail.value = email
    }

    total.value++
    return true;
  }


  const index = emailList.findIndex(item => item.emailId < email.emailId)

  if (index !== -1) {
    handleList([email]);
    emailList.splice(index, 0, email);
  } else {
    if (noLoading.value) {
      handleList([email]);
      emailList.push(email);
    }
  }

  if (email.emailId > latestEmail.value?.emailId) {
    latestEmail.value = email
  }

  total.value++
  return true;
}

function handleCheckAllChange(val) {
  if (val) {
    let count = 0;
    emailList.forEach(item => {
      if (count < MAX_SELECT_COUNT) {
        item.checked = true;
        count++;
      } else {
        item.checked = false;
      }
    });
  } else {
    emailList.forEach(item => item.checked = false);
  }
  isIndeterminate.value = false;
}

// Get selected message IDs
function getSelectedMailsIds() {
  return emailList.filter(item => item.checked).map(item => item.emailId);
}

function getSelectedDraftsIds() {
  return emailList.filter(item => item.checked).map(item => item.draftId);
}

function updateCheckStatus() {
  const checkedCount = emailList.filter(item => item.checked).length;
  checkedEmailCount.value = checkedCount;
  const atMax = checkedCount >= MAX_SELECT_COUNT;
  checkAll.value = emailList.length > 0 && (checkedCount === emailList.length || atMax);
  isIndeterminate.value = checkedCount > 0 && !checkAll.value;
}

function jumpDetails(email) {

  if (dropdownShow.value) {
    dropdownRef.value.handleClose();
    return;
  }

  if (!dropdownCloseLock.value) {
    const sel = window.getSelection();
    if (sel.toString().trim()) {
      return
    }
  }
  emit('jump', email)
}


async function getEmailList(refresh = false) {
  if (!refresh && (loading.value || noLoading.value)) return;
  const token = requests.begin(refresh);
  if (token === null) return;
  let emailId = !refresh && emailList.length ? emailList.at(-1).emailId : 0;
  if (refresh) {
    getSkeletonRows(); scrollTop = 0; emailList.splice(0);
    noLoading.value = false; checkAll.value = false; isIndeterminate.value = false;
    followLoading.value = false;
  }
  loading.value = !emailId;
  followLoading.value = !!emailId;
  loadError.value = '';
  try {
    const data = await props.getEmailList(emailId, queryParam.size);
    if (!requests.current(token)) return;
    firstLoad.value = false;
    const items = data.list.map(item => ({ ...item, checked:false }));
    latestEmail.value = data.latestEmail;
    handleList(items); emailList.push(...items);
    if (refresh) { keyCount.value++; scrollTop = 0; }
    noLoading.value = data.list.length < queryParam.size;
    total.value = data.total;
  } catch (error) {
    if (requests.current(token)) {
      firstLoad.value = false;
      loadError.value = error.message || 'Could not load mail. Please try again.';
    }
  } finally {
    if (requests.current(token)) { loading.value = false; followLoading.value = false; }
    requests.finish(token);
  }
}

function handleList(list) {
  list.forEach(email => {
    email.formatCreateTime = fromNow(email.createTime);
    email.test = t('received')
    const statusIconMap = {
      0: { icon: 'ic:round-mark-email-read', color: '#51C76B', content: t('received') },
      1: { icon: 'bi:send-arrow-up-fill',  color: '#51C76B', content: t('sent') },
      2: { icon: 'bi:send-check-fill',     color: '#51C76B', content: t('delivered') },
      3: { icon: 'bi:send-x-fill',         color: '#F56C6C', content: t('bounced') },
      8: { icon: 'bi:send-x-fill',         color: '#F56C6C', content: t('bounced') },
      4: { icon: 'bi:send-exclamation-fill', color: '#FBBD08', content: t('complained') },
      5: { icon: 'bi:send-arrow-up-fill',  color: '#FBBD08', content: t('delayed') },
      7: { icon: 'ic:round-mark-email-read', color: '#FBBD08', content: t('noRecipient') },
    };

    if (email.isDel) {
      email.isDelContent = t('selectDeleted');
    }
    email.statusIcon = statusIconMap[email.status] || { icon:'material-symbols:mail-outline', color:'#80868b', content:'Mail' };
  })
}

function refresh() {
  emit('refresh-before')
  if (props.skeleton) {
    scrollbarRef.value.setScrollTop(0)
  }
  refreshList()
}

function refreshList() {
  checkAll.value = false;
  isIndeterminate.value = false;
  getEmailList(true);
}

function loadData() {
  getEmailList()
}

</script>
<style scoped lang="scss">
.email-container { display:grid; grid-template-rows:48px minmax(0,1fr); height:100%; overflow:hidden; color:var(--el-text-color-primary); font-size:14px; }
.header-actions { display:flex; align-items:center; gap:20px; padding:0 16px; }
.header-left { flex:1; display:flex; align-items:center; gap:20px; min-width:0; }
.header-right { display:flex; align-items:center; gap:20px; color:var(--regular-text-color); font-size:12px; min-width:0; }
.email-count { white-space:nowrap; }
.current-mailbox { max-width:200px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.icon { cursor:pointer; }
.list-action { display:flex; align-items:center; justify-content:center; cursor:pointer; width:32px; height:32px; border-radius:50%; color:var(--regular-text-color); }
.list-action:hover { background:var(--mail-hover); }
.scroll { height:100%; min-height:0; overflow:hidden; }
.empty { display:flex; align-items:center; justify-content:center; height:100%; }
.list-error { padding:32px; text-align:center; color:var(--regular-text-color); }
.list-error button { color:var(--el-color-primary); text-decoration:underline; cursor:pointer; }
.noLoading, .follow-loading { display:flex; align-items:center; justify-content:center; height:40px; font-size:12px; color:var(--secondary-text-color); }
:deep(.email-row) {
 height:40px; display:flex; align-items:center; padding:0 16px 0 0; cursor:pointer; background:var(--mail-read); box-shadow:inset 0 -1px var(--light-border-color); position:relative;
 &.unread-row { background:var(--mail-surface); }
 &:hover { box-shadow:inset 1px 0 var(--light-border-color),inset -1px 0 var(--light-border-color),0 1px 3px #0003; z-index:1; }
 &[data-checked="true"], &.right-checked { background:var(--mail-selected); }
 .checkbox, .all-email-checkbox { flex-shrink:0; width:48px; height:40px; display:flex; align-items:center; justify-content:center; padding:0; }
 .pc-star { flex-shrink:0; display:flex; align-items:center; justify-content:center; width:32px; height:32px; color:#747775; cursor:pointer; border-radius:50%; }
 .pc-star:hover { background:var(--mail-hover); }
 .title { flex:1; min-width:0; display:grid; align-items:center; grid-template-columns:180px minmax(0,1fr); gap:16px; padding-left:8px; }
 .title > div { min-width:0; }
 .email-sender { display:flex; align-items:center; gap:6px; min-width:0; }
 .email-status { display:flex; flex-shrink:0; gap:4px; }
 .email-status svg { width:16px; height:16px; }
 .name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 .name > span:last-child { display:none; }
 .phone-time { display:none; }
 .email-text { display:flex; align-items:center; min-width:0; }
 .email-subject { display:flex; align-items:center; max-width:75%; min-width:0; gap:4px; flex-shrink:0; }
 .subject-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 .code-tag { flex-shrink:0; color:var(--el-color-primary); font-size:12px; }
 .unread { display:none; }
 .email-content { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--email-scroll-content-color); }
 .email-content::before { content:' – '; white-space:pre; }
 .email-right, .email-right-skeleton { flex-shrink:0; padding-left:24px; font-size:12px; white-space:nowrap; }
 .user-info { display:flex; gap:16px; color:var(--regular-text-color); font-size:12px; }
 .user-info > div { display:flex; align-items:center; gap:4px; min-width:0; }
 .user-info span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
 &.all-email { height:64px; }
 .name-skeleton { width:130px; height:14px; }
 .text-skeleton-one { width:70%; height:14px; }
 .text-skeleton-two { display:none; }
}
.right-dropdown-item { display:flex; align-items:center; gap:12px; }
@media (max-width:1023px) and (min-width:768px) { :deep(.email-row .title) { grid-template-columns:150px minmax(0,1fr); gap:8px; } .current-mailbox { max-width:150px; } }
@media (max-width:767px) {
 .header-actions { gap:14px; padding:0 12px; }
 .header-left { gap:14px; }
 .header-right { gap:0; }
 .current-mailbox { display:none; }
 :deep(.email-row) {
   height:84px; padding-right:12px;
   .checkbox, .all-email-checkbox { width:36px; height:84px; }
   .pc-star { position:absolute; right:8px; bottom:9px; width:28px; height:28px; }
   .title { grid-template-columns:minmax(0,1fr); gap:3px; padding:0; }
   .email-sender { justify-content:space-between; }
   .name { flex:1; font-size:15px; }
   .phone-time { display:inline; font-size:11px; color:var(--regular-text-color); flex-shrink:0; }
   .email-text { display:block; padding-right:28px; font-size:13px; }
   .email-subject { max-width:100%; }
   .email-content { display:block; }
   .email-content::before { content:none; }
   .email-right, .email-right-skeleton { display:none; }
   &.all-email { height:116px; }
   .user-info { flex-wrap:wrap; gap:0 8px; }
 }
}
</style>

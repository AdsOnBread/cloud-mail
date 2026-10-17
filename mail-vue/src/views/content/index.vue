<template>
  <div class="box">
    <div class="header-actions">
      <button type="button" class="message-action" title="Back to mail" aria-label="Back to mail" @click="handleBack"><Icon icon="material-symbols:arrow-back" width="22" /></button>
      <button v-perm="'email:delete'" type="button" class="message-action" title="Delete" aria-label="Delete message" @click="handleDelete"><Icon icon="material-symbols:delete-outline" width="22" /></button>
      <button v-if="emailStore.contentData.showStar" type="button" class="message-action" :title="email.isStar ? 'Remove star' : 'Star message'" :aria-label="email.isStar ? 'Remove star' : 'Star message'" @click="changeStar"><Icon :icon="email.isStar ? 'fluent-color:star-16' : 'material-symbols:star-outline'" width="22" /></button>
      <template v-if="emailStore.contentData.showReply">
        <button v-perm="'email:send'" type="button" class="message-action" title="Reply" aria-label="Reply" @click="openReply"><Icon icon="material-symbols:reply" width="22" /></button>
        <button v-perm="'email:send'" type="button" class="message-action" title="Reply all" aria-label="Reply all" @click="openReplyAll"><Icon icon="material-symbols:reply-all" width="22" /></button>
        <button v-perm="'email:send'" type="button" class="message-action" title="Forward" aria-label="Forward" @click="openForward"><Icon icon="material-symbols:forward" width="22" /></button>
      </template>
    </div>
    <el-scrollbar class="scrollbar">
      <div class="container">
        <div class="email-title">
          {{ email.subject || '(no subject)' }}
        </div>
        <div class="content">
          <div class="email-info">
            <div class="sender-avatar" aria-hidden="true">{{ (email.name || email.sendEmail || '?')[0].toUpperCase() }}</div>
            <div class="sender-metadata">
              <div class="sender-line"><span class="send-name-title">{{ email.name || email.sendEmail }}</span><span class="sender-address">&lt;{{ email.sendEmail }}&gt;</span><time>{{ formatDetailDate(email.createTime) }}</time></div>
              <button type="button" class="recipient-toggle" :aria-expanded="recipientDetails" @click="recipientDetails = !recipientDetails">to {{ formateReceive(email.recipient) || email.toEmail }} <Icon icon="material-symbols:expand-more" width="16" /></button>
              <div v-if="recipientDetails" class="recipient-details">
                <div><span>From</span><span>{{ email.sendEmail }}</span></div>
                <div><span>To</span><span>{{ formateReceive(email.recipient) }}</span></div>
                <div v-if="addresses(email.cc).length"><span>Cc</span><span>{{ formateReceive(email.cc) }}</span></div>
                <div v-if="showBcc"><span>Bcc</span><span>{{ formateReceive(email.bcc) }}</span></div>
                <div><span>Date</span><span>{{ formatDetailDate(email.createTime) }}</span></div>
              </div>
            </div>
            <el-alert v-if="email.status === 3" :closable="false" :title="toMessage(email.message)" class="email-msg" type="error" show-icon />
            <el-alert v-if="email.status === 4" :closable="false" :title="$t('complained')" class="email-msg" type="warning" show-icon />
            <el-alert v-if="email.status === 5" :closable="false" :title="$t('delayed')" class="email-msg" type="warning" show-icon />
          </div>
          <div v-if="detailLoading" class="detail-status" role="status">Loading message…</div>
          <div v-if="detailError && !email.content && !email.text" class="detail-status" role="alert">{{ detailError }} <button type="button" @click="loadDetail">Retry</button></div>
          <el-scrollbar class="htm-scrollbar" :class="!email.attList?.length ? 'bottom-distance' : ''">
            <ShadowHtml class="shadow-html" :html="formatImage(email.content)" v-if="email.content" />
            <pre v-else class="email-text" >{{email.text}}</pre>
          </el-scrollbar>
          <div class="att" v-if="email.attList?.length > 0">
            <div class="att-title">
              <span>{{$t('attachments')}}</span>
              <span>{{$t('attCount',{total: email.attList.length})}}</span>
            </div>
            <div class="att-box">

              <div class="att-item" v-for="att in email.attList" :key="att.attId">
                <div class="att-icon" @click="showImage(att.key)">
                  <Icon v-bind="getIconByName(att.filename)" />
                </div>
                <div class="att-name" @click="showImage(att.key)">
                  {{ att.filename }}
                </div>
                <div class="att-size">{{ formatBytes(att.size) }}</div>
                <div class="opt-icon att-icon">
                  <Icon v-if="isImage(att.filename)" icon="hugeicons:view" width="22" height="22" @click="showImage(att.key)"/>
                  <a href="#" @click.prevent="downloadAttachment(att)">
                    <Icon icon="system-uicons:push-down" width="22" height="22"/>
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div v-if="emailStore.contentData.showReply" v-perm="'email:send'" class="message-replies">
            <el-button @click="openReply"><Icon icon="material-symbols:reply" width="20" />Reply</el-button>
            <el-button @click="openReplyAll"><Icon icon="material-symbols:reply-all" width="20" />Reply all</el-button>
            <el-button @click="openForward"><Icon icon="material-symbols:forward" width="20" />Forward</el-button>
          </div>
        </div>
      </div>
    </el-scrollbar>
    <el-image-viewer
        v-if="showPreview"
        :url-list="srcList"
        show-progress
        @close="showPreview = false"
    />
  </div>
</template>
<script setup>
import { useUserStore } from '@/store/user.js';
import { addresses } from '@/utils/recipients.js';
import { privateFileURL } from '@/utils/private-files';
import ShadowHtml from '@/components/shadow-html/index.vue'
import {computed, reactive, ref, watch, onMounted, onUnmounted} from "vue";
import {useRouter} from 'vue-router'
import {ElMessage, ElMessageBox} from 'element-plus'
import {emailDelete, emailRead} from "@/request/email.js";
import {Icon} from "@iconify/vue";
import {useEmailStore} from "@/store/email.js";
import {useAccountStore} from "@/store/account.js";
import {formatDetailDate} from "@/utils/day.js";
import {starAdd, starCancel} from "@/request/star.js";
import {getExtName, formatBytes} from "@/utils/file-utils.js";
import {cvtR2Url,toOssDomain} from "@/utils/convert.js";
import {getIconByName} from "@/utils/icon-utils.js";
import {useSettingStore} from "@/store/setting.js";
import {allEmailDelete} from "@/request/all-email.js";
import {useUiStore} from "@/store/ui.js";
import {useI18n} from "vue-i18n";
import {EmailUnreadEnum} from "@/enums/email-enum.js";

const uiStore = useUiStore();
const settingStore = useSettingStore();
const accountStore = useAccountStore();
const emailStore = useEmailStore();
const router = useRouter()
const email = computed(() => emailStore.contentData.email || {
  emailId: 0,
  attList: [],
  content: '',
  text: '',
  recipient: '[]',
})
const showPreview = ref(false)
const srcList = reactive([])
const recipientDetails = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const userStore = useUserStore()
const showBcc = computed(() => email.value.type === 1 && email.value.userId === userStore.user.userId && addresses(email.value.bcc).length > 0)
async function loadDetail() {
  const message = email.value
  if (!message.emailId) return
  detailLoading.value = true; detailError.value = ''
  try { await emailStore.ensureDetail(message) }
  catch (error) { if (email.value.emailId === message.emailId) detailError.value = error.message || 'Could not load the message.' }
  finally { if (email.value.emailId === message.emailId) detailLoading.value = false }
}
watch(() => email.value.emailId, () => { recipientDetails.value = false; loadDetail() }, { immediate:true })

const { t } = useI18n()
watch(() => accountStore.currentAccountId, () => {
  handleBack()
})

let readRequesting = false

function tryMarkRead() {
  if (!emailStore.contentData.showUnread || readRequesting) return
  const current = email.value
  if (!current?.emailId || current.unread !== EmailUnreadEnum.UNREAD) return

  // Mark as read after details are available in detailMap or the message body
  const full = emailStore.detailMap[current.emailId]
  const detailReady = !!full || !!(current.content || current.text)
  if (!detailReady) return

  readRequesting = true
  const emailId = current.emailId
  current.unread = EmailUnreadEnum.READ
  if (emailStore.detailMap[emailId]) {
    emailStore.detailMap[emailId].unread = EmailUnreadEnum.READ
  }
  emailStore.markListRead(emailId)
  emailRead([emailId]).finally(() => {
    readRequesting = false
  })
}

watch(
  () => [
    email.value?.emailId,
    email.value?.content,
    email.value?.text,
    emailStore.detailMap[email.value?.emailId]
  ],
  () => tryMarkRead(),
  { flush: 'post' }
)

onMounted(() => {
  tryMarkRead()
  window.addEventListener('keydown', handleKeyDown);
})

onUnmounted(() => {
  emailStore.contentData.showUnread = false;
  readRequesting = false
  window.removeEventListener('keydown', handleKeyDown);
  srcList.forEach(URL.revokeObjectURL);
})

function handleKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (showPreview.value) return;
  if (document.querySelector('.el-message-box')) return;
  const writeBox = document.querySelector('.write-box');
  if (writeBox && writeBox.offsetParent !== null) return;
  handleBack();
}

function openReply() {
  uiStore.writerRef.openReply(email.value)
}

function openReplyAll() {
  uiStore.writerRef.openReplyAll(email.value)
}

function openForward() {
  uiStore.writerRef.openForward(email.value)
}

function toMessage(message) {
  return  message ? JSON.parse(message).message : '';
}

function formatImage(content) {
  content = content || '';
  return content;
}

async function showImage(key) {
  if (!isImage(key)) return;
  const url = await privateFileURL(key)
  srcList.forEach(URL.revokeObjectURL)
  srcList.length = 0
  srcList.push(url)
  showPreview.value = true
}

async function downloadAttachment(att) {
  try {
    const url = await privateFileURL(att.key)
    const link = document.createElement('a');link.href=url;link.download=att.filename || 'attachment';link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (e) { ElMessage.error(e.message) }
}

function isImage(filename) {
  return ['png', 'jpg', 'jpeg', 'bmp', 'gif','jfif'].includes(getExtName(filename))
}

function formateReceive(recipient) { return addresses(recipient).join(', '); }

function changeStar() {
  if (email.value.isStar) {
    email.value.isStar = 0;
    starCancel(email.value.emailId).then(() => {
      email.value.isStar = 0;
      emailStore.cancelStarEmailId = email.value.emailId
      setTimeout(() => emailStore.cancelStarEmailId = 0)
      emailStore.starScroll?.deleteEmail([email.value.emailId])
    }).catch((e) => {
      console.error(e)
      email.value.isStar = 1;
    })
  } else {
    email.value.isStar = 1;
    starAdd(email.value.emailId).then(() => {
      email.value.isStar = 1;
      emailStore.addStarEmailId = email.value.emailId
      setTimeout(() => emailStore.addStarEmailId = 0)
      emailStore.starScroll?.addItem(email.value)
    }).catch((e) => {
      console.error(e)
      email.value.isStar = 0;
    })
  }
}

const handleBack = () => {
  router.back()
}

const handleDelete = () => {
  ElMessageBox.confirm(t('delEmailConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    if (emailStore.contentData.delType === 'logic') {
      emailDelete(email.value.emailId).then(() => {
        ElMessage({
          message: t('delSuccessMsg'),
          type: 'success',
          plain: true,
        })
        emailStore.deleteIds = [email.value.emailId]
      })
    } else  {

      allEmailDelete(email.value.emailId).then(() => {
        ElMessage({
          message: t('delSuccessMsg'),
          type: 'success',
          plain: true,
        })
        emailStore.deleteIds = [email.value.emailId]
      })
    }

    router.back()
  })
}
</script>
<style scoped>
.box { height:100%; overflow:hidden; }
.header-actions { height:48px; display:flex; align-items:center; gap:8px; padding:0 12px; }
.message-action { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; color:var(--regular-text-color); cursor:pointer; }
.message-action:hover { background:var(--mail-hover); }
.scrollbar { height:calc(100% - 48px); width:100%; }
.container { padding:20px 32px 40px 64px; font-size:14px; }
.email-title { font-size:24px; line-height:1.4; font-weight:400; margin:0 0 24px; overflow-wrap:anywhere; }
.content { display:flex; flex-direction:column; }
.email-info { position:relative; margin-bottom:24px; }
.sender-avatar { position:absolute; left:-48px; top:0; width:36px; height:36px; border-radius:50%; background:var(--mail-compose); color:var(--mail-on-compose); display:flex; align-items:center; justify-content:center; font-size:18px; }
.sender-line { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.send-name-title { font-weight:600; }
.sender-address { font-size:12px; color:var(--regular-text-color); overflow-wrap:anywhere; }
.sender-line time { margin-left:auto; color:var(--regular-text-color); font-size:12px; }
.recipient-toggle { display:flex; align-items:center; text-align:left; gap:4px; margin-top:2px; color:var(--regular-text-color); font-size:12px; cursor:pointer; max-width:100%; overflow-wrap:anywhere; }
.recipient-toggle svg { flex-shrink:0; }
.recipient-details { margin-top:12px; border:1px solid var(--light-border-color); padding:16px; border-radius:8px; font-size:12px; width:fit-content; max-width:100%; box-shadow:0 2px 6px #0001; }
.recipient-details > div { display:flex; align-items:baseline; gap:16px; margin-bottom:4px; }
.recipient-details > div > span:first-child { width:32px; flex-shrink:0; color:var(--regular-text-color); }
.recipient-details > div > span:last-child { overflow-wrap:anywhere; }
.email-msg { margin-top:12px; width:fit-content; }
.detail-status { padding:12px 0; color:var(--regular-text-color); }
.detail-status button { color:var(--el-color-primary); cursor:pointer; }
.htm-scrollbar { min-height:80px; }
.email-text { font-family:inherit; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.6; }
.shadow-html { position:relative; }
.shadow-html::after { content:''; position:absolute; inset:0; background:var(--message-block-color); pointer-events:none; }
.att { margin-top:28px; }
.att-title { display:flex; gap:12px; font-size:13px; margin-bottom:12px; color:var(--regular-text-color); }
.att-box { display:flex; flex-wrap:wrap; gap:12px; }
.att-item { display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:8px; align-items:center; width:280px; max-width:100%; padding:16px; border:1px solid var(--light-border-color); border-radius:12px; background:var(--mail-read); }
.att-icon { display:flex; align-items:center; cursor:pointer; }
.att-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
.att-size { grid-column:2; color:var(--regular-text-color); font-size:12px; }
.opt-icon { grid-column:3; grid-row:1/3; display:flex; gap:8px; }
.opt-icon a { display:flex; color:var(--regular-text-color); }
.message-replies { display:flex; flex-wrap:wrap; gap:8px; margin-top:36px; }
.message-replies .el-button { margin:0; gap:8px; height:36px; padding:0 20px; color:var(--regular-text-color); }
.message-replies svg { margin-right:6px; }
@media (max-width:767px) {
 .container { padding:16px 16px 96px; }
 .email-title { font-size:22px; margin-bottom:20px; }
 .sender-avatar { position:static; flex-shrink:0; }
 .email-info { display:flex; flex-wrap:wrap; gap:12px; }
 .sender-metadata { min-width:0; flex:1; }
 .sender-line { gap:0 6px; }
 .sender-line time { margin:4px 0 0; width:100%; font-size:11px; }
 .sender-address { font-size:11px; }
 .recipient-details { margin-left:-48px; max-width:calc(100% + 48px); }
 .message-replies .el-button { padding:0 14px; }
}
</style>

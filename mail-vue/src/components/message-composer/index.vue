<template>
  <div v-if="modal" class="compose-backdrop" aria-hidden="true" />
  <section
    @keydown="keydown" :inert="discardLocked || dockHidden"
    @dragenter="dragFiles" @dragover="dragFiles" @dragleave="leaveFiles" @drop="dropFiles"
    ref="composeRoot"
    v-show="show"
    class="send"
    :class="{ expanded, minimized, inline, separate: !!separateWindow, 'compose-open': show }"
    :role="modal ? 'dialog' : undefined"
    :aria-modal="modal || undefined"
    aria-label="Compose message"
  >
    <div v-if="dragHint && !minimized" class="file-drop-hint" aria-hidden="true">
      <Icon icon="material-symbols:upload-file-outline" width="36" /><span>{{ dragHint }}</span>
    </div>
    <div class="write-box" :aria-busy="sending || preparing" :inert="preparing || undefined">
      <div v-if="separateWindow" class="compose-title separate-title">
        <span class="compose-caption">{{ caption }}</span>
        <div class="window-actions"><button type="button" aria-label="Pop-in" data-tip="Pop-in"
          :disabled="preparing || sending || attaching" @click="moveWindow">
          <Icon icon="material-symbols:close-fullscreen" width="16"/>
        </button></div>
      </div>
      <div v-else-if="!inline" class="compose-title">
        <button
          type="button"
          class="compose-caption"
          :title="caption"
          :aria-expanded="!minimized"
          @click="toggleMinimized"
        >{{ caption }}</button>
        <div class="window-actions">
          <button
            v-if="!inline"
            type="button"
            :aria-label="minimized ? 'Restore compose' : 'Minimize compose'"
            :data-tip="minimized ? 'Maximize' : 'Minimize'"
            @click="toggleMinimized"
          >
            <Icon :icon="minimized ? 'material-symbols:check-box-outline-blank' : 'material-symbols:remove'" width="18" />
          </button>
          <button
            v-if="!inline"
            type="button"
            :aria-label="(expanded && !minimized) ? 'Exit full screen' : 'Expand compose'"
            :data-tip="((expanded && !minimized) ? 'Exit full screen' : 'Full screen') + ' (Shift for pop-out)'"
            :disabled="preparing || sending || attaching"
            @click="$event.shiftKey ? moveWindow() : toggleFullScreen()"
          >
            <Icon
              :icon="
                expanded && !minimized
                  ? 'material-symbols:close-fullscreen'
                  : 'material-symbols:open-in-full'
              "
              width="16"
            />
          </button>
          <button
            type="button"
            aria-label="Close and save draft"
            data-tip="Save &amp; close"
            :disabled="sending || attaching"
            @click="close"
          >
            <Icon icon="material-symbols:close" width="18" />
          </button>
        </div>
      </div>
      <div v-show="!minimized" class="compose-container">
        <div v-if="responseHeader" class="inline-reply-header">
          <ResponseMenu :mode="responseMode" :all="hasReplyAll(responseSource,accountStore.ownAddresses)"
            :inline="inline" :disabled="sending || preparing || attaching" @command="responseCommand"/>
          <button type="button" class="inline-recipients" :aria-expanded="editingRecipients"
            :aria-label="form.sendType === 'forward' ? 'Edit forward recipients' : 'Edit reply recipients'"
            :data-tip="replyRecipientTitle" :disabled="sending || preparing || attaching" @click="editReplyRecipients">
            <span>{{ replyRecipientSummary }}</span>
          </button>
          <button v-if="inline" type="button" class="compose-tool pop-reply" aria-label="Pop out reply" data-tip="Pop out reply"
            :disabled="sending || preparing || attaching" @click="responseCommand('pop')">
            <Icon icon="material-symbols:open-in-new" width="20"/>
          </button>
        </div>
        <fieldset
          v-show="!responseHeader || editingRecipients"
          :disabled="sending || attaching"
          class="compose-fields"
          @focusin="rememberInput"
        >
          <button
            v-if="!responseHeader && !addressExpanded"
            type="button"
            class="recipient-summary"
            aria-label="Edit recipients"
            :title="replyRecipientTitle || 'Recipients'"
            @click="focusRecipients('receiveEmail')"
          >{{ replyRecipientTitle || "Recipients" }}</button>
          <div v-show="responseHeader || addressExpanded">
            <div v-if="!inline && showSender" class="from-row">
              <span>From</span
              ><span :title="form.sendEmail"
                >{{ form.name }} &lt;{{ form.sendEmail }}&gt;</span
              >
            </div>
            <RecipientField
              ref="toField"
              v-model="form.receiveEmail"
              :other-recipients="[...form.cc,...form.bcc]"
              label="To"
              :owner="form.ownerEmail===userStore.user.email ? form.ownerEmail : ''"
              :account-id="form.accountId"
              :recent="mailboxRecents"
              :removed="removedSuggestions" :contact-revision="writerStore.contactRevision"
              @choose-person="rememberPerson"
              @compose-contact="writeToContact"
              :names="form.replyRecipientNames"
              :error="recipientNotice ? undefined : recipientErrors.receiveEmail"
              @contacts="openContacts('receiveEmail')"
            >
              <button
                v-if="!showCc"
                type="button"
                class="reveal-recipient"
                :data-tip="copyShortcutHint('Cc')"
                @click="focusRecipients('cc')"
              >
                Cc
              </button>
              <button
                v-if="!showBcc"
                type="button"
                class="reveal-recipient"
                :data-tip="copyShortcutHint('Bcc')"
                @click="focusRecipients('bcc')"
              >
                Bcc
              </button>
            </RecipientField>
            <RecipientField
              v-if="showCc"
              ref="ccField"
              v-model="form.cc"
              :other-recipients="[...form.receiveEmail,...form.bcc]"
              label="Cc"
              :owner="form.ownerEmail===userStore.user.email ? form.ownerEmail : ''"
              :account-id="form.accountId"
              :recent="mailboxRecents"
              :removed="removedSuggestions" :contact-revision="writerStore.contactRevision"
              @choose-person="rememberPerson"
              @compose-contact="writeToContact"
              :names="form.replyRecipientNames"
              :error="recipientNotice ? undefined : recipientErrors.cc"
              @contacts="openContacts('cc')"
            />
            <RecipientField
              v-if="showBcc"
              ref="bccField"
              v-model="form.bcc"
              :other-recipients="[...form.receiveEmail,...form.cc]"
              label="Bcc"
              :owner="form.ownerEmail===userStore.user.email ? form.ownerEmail : ''"
              :account-id="form.accountId"
              :recent="mailboxRecents"
              :removed="removedSuggestions" :contact-revision="writerStore.contactRevision"
              @choose-person="rememberPerson"
              @compose-contact="writeToContact"
              :names="form.replyRecipientNames"
              :error="recipientNotice ? undefined : recipientErrors.bcc"
              @contacts="openContacts('bcc')"
            />
          </div>
          <input
            v-if="!responseHeader"
            v-model="form.subject"
            class="subject-input"
            aria-label="Subject"
            @focus="collapseAddresses"
            @blur="subjectCaption = form.subject.trim()"
            placeholder="Subject"
            maxlength="998"
          />
        </fieldset>
        <div
          class="compose-editor" :inert="sending || attaching"
          :class="{
            'editor-disabled': sending,
            'formatting-open': inline && showFormatting,
            'quote-open': inline && quoteExpanded,
          }"
        >
          <tinyEditor
            :plain-text="form.plainText"
            :writing-style="writingStyle"
            :def-value="defValue"
            mail-compose
            :spell-active="show && !minimized && !sending"
            :show-toolbar="showFormatting"
            :collapse-quote="responseHeader"
            :show-quote="quoteExpanded"
            ref="editor"
            @focus="focusBody"
            @rich-command="useRichCommand"
            @compose-keydown="composeShortcut($event,true)"
            @file-drag="dragFiles($event, true)" @file-leave="dragHint = ''"
            @file-drop="dropFiles($event, true)" @file-paste="pasteFiles"
            @change="change"
          />
        </div>
        <div v-if="responseHeader && hasQuotedContent" class="quote-actions">
          <button
            type="button"
            class="quote-toggle"
            :aria-label="
              quoteExpanded ? 'Hide quoted text' : 'Show quoted text'
            "
            :aria-expanded="quoteExpanded"
            :disabled="sending"
            @click="quoteExpanded = !quoteExpanded"
          >
            •••
          </button>
        </div>
        <div v-if="attachedFiles.length" class="compose-attachments">
          <div
            v-for="(file, index) in attachedFiles"
            :key="index"
            class="attachment-chip"
          >
            <Icon v-bind="getIconByName(file.filename)" /><span>{{
              file.filename
            }}</span
            ><span class="file-size">{{ formatBytes(file.size) }}</span>
            <button
              type="button"
              :aria-label="`Remove ${file.filename}`"
              :disabled="sending || attaching"
              @click="form.attachments.splice(form.attachments.indexOf(file), 1)"
            >
              ×
            </button>
          </div>
        </div>
        <p v-if="sendError" class="send-error" role="alert">{{ sendError }}</p>
        <div class="compose-footer" data-tip-placement="top">
          <SendControls :inline="inline" :busy="sending || attaching || preparing" :sending="sending"
            :active="show && !minimized && !dockHidden" :tip="shortcutHint('Send','Enter')" :shortcut="primaryKey+'+Enter'"
            @send="trigger => sendEmail(null,trigger)" @schedule="openSchedule"/>
          <button
            type="button"
            class="compose-tool formatting-toggle"
            aria-label="Formatting options"
            :aria-pressed="showFormatting"
            data-tip="Formatting options"
            :disabled="sending"
            @click="showFormatting = !showFormatting"
          >
            Aa
          </button>
          <button
            type="button"
            class="compose-tool"
            data-tip="Attach files"
            aria-label="Attach files"
            :disabled="sending || attaching"
            @click="chooseFile"
          >
            <Icon icon="material-symbols:attach-file" width="22" />
          </button>
          <button v-if="!form.plainText" type="button" class="compose-tool" data-compose-link :data-tip="shortcutHint('Insert link','K')" aria-label="Insert link" :disabled="sending" @mousedown.prevent @click="editor?.openLink()">
            <Icon icon="material-symbols:link" width="20" />
          </button>
          <ComposeEmoji ref="emojiPicker" :editor="editor" :owner="userStore.user.email"
            :active="show && !minimized" :disabled="sending || preparing" />
          <button v-if="!form.plainText" type="button" class="compose-tool" data-tip="Insert photo" aria-label="Insert photo" :disabled="sending || attaching" @mousedown.prevent @click="showPhotos">
            <Icon icon="material-symbols:image-outline" width="20" />
          </button>
          <el-dropdown trigger="click" placement="top-start" :show-arrow="false"
            popper-class="mail-action-menu compose-format-popup signature-menu" @visible-change="loadSignatureMenu" @command="signatureCommand">
            <button class="compose-tool" ref="signatureButton" aria-label="Insert signature" data-tip="Insert signature" :disabled="sending || preparing" @mousedown.prevent>
              <Icon icon="material-symbols:ink-pen-outline" width="20"/>
            </button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item command="manage"><span class="signature-check"></span>Manage signatures</el-dropdown-item>
              <el-dropdown-item v-if="signatureError" disabled>{{signatureError}}</el-dropdown-item>
              <el-dropdown-item v-for="(item,index) in menuItems" :key="item.id" :divided="index===0" :command="'insert/'+item.id"
                role="menuitemcheckbox" :aria-checked="selectedSignature===item.id">
                <span class="signature-check"><Icon v-if="selectedSignature===item.id" icon="material-symbols:check" width="17"/></span>{{item.name}}
              </el-dropdown-item>
              <el-dropdown-item :divided="!menuItems.length" command="none" role="menuitemcheckbox" :aria-checked="!selectedSignature">
                <span class="signature-check"><Icon v-if="!selectedSignature" icon="material-symbols:check" width="17"/></span>No signature
              </el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <ComposeMore ref="moreOptions" :disabled="sending || preparing || attaching" :active="show && !minimized"
            :full-screen="Boolean(composeMode.fullScreen)" :plain-text="form.plainText"
            :label-ids="form.labelIds" :read-star="readComposeStar"
            @labels="form.labelIds = $event" @star="chooseStar" @error="sendError=$event" @command="moreCommand"/>

          <span class="draft-status">{{
            form.draftId ? ({saving:"Saving…",saved:"Saved",offline:"Saved on this device · Offline",conflict:"Both versions saved",uncertain:"Delivery uncertain"}[form.syncState] || "Saved to Drafts") : ""
          }}</span>
          <button
            type="button"
            class="compose-tool"
            :data-tip="shortcutHint('Discard draft','D',true)"
            :aria-keyshortcuts="primaryKey+'+Shift+D'"
            aria-label="Discard draft"
            :disabled="sending || attaching"
            @click="discard"
          >
            <Icon icon="material-symbols:delete-outline" width="22" />
          </button>
        </div>
      </div>
    </div>
    <SignatureManager v-if="managerMounted" v-model="managingSignatures" :account-id="form.accountId" @closed="signatureButton?.focus()"/>
    <dialog v-if="recipientNotice" ref="recipientDialog" class="recipient-dialog" role="alertdialog" aria-label="Error"
      :aria-describedby="recipientNoticeId" @keydown.esc.stop @cancel.prevent="dismissRecipientError" @close="dismissRecipientError">
      <h2>Error</h2>
      <p :id="recipientNoticeId">{{ recipientNotice.message }}</p>
      <form method="dialog" @submit.prevent="dismissRecipientError"><button type="submit" autofocus>OK</button></form>
    </dialog>
    <PhotoPicker v-if="photosOpen" :submit="insertPickerPhotos" @close="closePhotos" />
    <SchedulePicker ref="schedulePicker" v-model="scheduling" @schedule="sendEmail"/>
    <ContactPicker v-if="showContacts" :owner="form.ownerEmail" :account-id="form.accountId"
      :addresses="form[contactField]" :names="form.replyRecipientNames" :recent="mailboxRecents" :removed="removedSuggestions"
      @insert="chooseContact" @forget="emails=>writerStore.forgetAddresses(form.ownerEmail,form.accountId,emails)" @close="closeContacts"/>
  </section>
</template>
<script setup>
import { draftSession, discardDrafts, saveLocalDraft, removeLocalDraft, syncCloudDrafts, sendCloudDraft, scheduleCloudDraft, cancelScheduledReceipt } from "@/services/cloud-drafts";
import {useUiStore} from "@/store/ui";
import http from "@/axios";
import {quotedMessage} from "./quoted-message";
import SignatureManager from "@/components/mail-signatures/manager.vue";
import {useMailSignatures} from "@/store/mail-signatures";
import ContactPicker from './contact-picker.vue';
import {changeQuotedBody,responseSubject,responseFileSignatures,restoreResponseFiles} from "./response";
import ResponseMenu from "./response-menu.vue";
import SendControls from "./send-controls.vue";
import {sendConfirmation} from "./send-confirmation";
import {textStyleCSS} from '../../../../shared/mail-text-style';
import {plainMarkup,richMarkup} from "./plain-text";
import {printDraft} from "./print-draft";
import { hasFiles, transferFiles, photoTypes, planFiles } from "./files";
import PhotoPicker from "./photo-picker.vue";
import ComposeEmoji from "./emoji-picker.vue";
import ComposeMore from "./more-options.vue";
import { useMailLabels } from "@/store/mail-labels";
import { useRouter } from "vue-router";
import SchedulePicker from "./schedule.vue";
import {useMailFeedback} from "@/store/mail-feedback";
import tinyEditor from "@/components/tiny-editor/index.vue";
import {recipientDragSession} from "@/components/recipient-field/drag";
import RecipientField from "@/components/recipient-field/index.vue";
import {
  nextTick,
  onMounted,
  provide,
  useId,
  onUnmounted,
  reactive,
  ref,
  toRaw,
  computed, shallowRef,
  watch,
} from "vue";
import { Icon } from "@iconify/vue";
import { useUserStore } from "@/store/user.js";
import { useAccountStore } from "@/store/account.js";
import { useEmailStore } from "@/store/email.js";
import { fileToBase64, formatBytes } from "@/utils/file-utils.js";
import { getIconByName } from "@/utils/icon-utils.js";
import { formatDetailDate } from "@/utils/day.js";
import { userDraftStore, watchDraftStars } from "@/store/draft.js";
import { mailboxEntries } from "../../../../shared/stored-recipients";
import { useSettingStore } from "@/store/setting.js";
import { useWriterStore } from "@/store/writer.js";
import { hasPerm } from "@/perm/perm.js";
import {
  addresses,
  normalizeRecipients,
  restoreDraft,
  hasDraftContent,
  draftFingerprint,
  draftFilingFingerprint,
  hasReplyAll, replyRecipients,
  recipientFields,
} from "@/utils/recipients.js";
import db from "@/db/db.js";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";

import {openContactWindow, openSeparateWindow, returnComposeWindow, saveWindowState, windowState} from "@/layout/write/separate-window";
const props = defineProps({ inline: Boolean, responseMessage:Object, separateWindow:String, dockActive:{type:Boolean,default:true}, dockHidden:Boolean });
const emit = defineEmits(["sent", "closed", "dock-state", "editor-focus"]);
const composeRoot = ref();
const labelStore=useMailLabels();
const moreOptions=ref();
const router=useRouter();
const recipientDialog = ref();
const recipientNotice = ref(null);
const recipientNoticeId = useId();
const desktop = ref(window.innerWidth >= 768);
const modal = computed(
  () =>
    show.value &&
    expanded.value && !props.dockHidden &&
    !minimized.value &&
    desktop.value &&
    !props.inline,
);

const writerStore = useWriterStore();
const draftStore = userDraftStore();
const emailStore = useEmailStore();
const accountStore = useAccountStore();
const userStore = useUserStore();
const editor = ref();
const emojiPicker = ref();
const photosOpen = ref(false), schedulePicker=ref(), scheduling=ref(false);
const feedback=useMailFeedback();
const dragHint = ref("");
const fileBusy = () => !show.value || minimized.value || preparing.value || sending.value || attaching.value;
function dragFiles(event, body = false) {
  if (!hasFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = fileBusy() ? "none" : "copy";
  if (fileBusy()) return;
  const items = Array.from(event.dataTransfer.items || []).filter(item => item.kind === "file");
  dragHint.value = body && !form.plainText && items.length && items.every(item => photoTypes.includes(item.type))
    ? "Drop photos here to insert inline" : "Drop files here";
}
function leaveFiles(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) dragHint.value = "";
}
function dropFiles(event, body = false) {
  if (!hasFiles(event.dataTransfer)) return;
  event.preventDefault();
  dragHint.value = "";
  if (fileBusy()) return;
  try { addFiles(transferFiles(event.dataTransfer), body ? "auto" : "attachments"); }
  catch (error) { sendError.value = error.message; }
}
function pasteFiles(event) {
  if (fileBusy()) return;
  try { addFiles(transferFiles(event.clipboardData), "auto"); }
  catch (error) { sendError.value = error.message; }
}
let photoSelection, photoTrigger, returnToBody;
function closePhotos(inserted) {
  photosOpen.value = false;
  if (!inserted) {
    const resume = returnToBody && photoSelection, trigger = photoTrigger, generation = fileGeneration;
    nextTick(() => {
      if (generation !== fileGeneration || !show.value || form.ownerEmail !== userStore.user.email) return;
      if (resume) resume();
      else trigger?.focus();
    });
    photoSelection = undefined;
  }
}
function showPhotos(event) {
  if (fileBusy()) return;
  returnToBody = document.activeElement === composeRoot.value?.querySelector(".compose-editor iframe");
  photoTrigger = event.currentTarget;
  photoSelection = editor.value?.rememberSelection();
  photosOpen.value = true;
}
async function insertPickerPhotos({files, url}, closePicker) {
  if (!photosOpen.value || fileBusy()) throw new Error("This message is no longer ready to edit.");
  const resume = () => { closePicker(true); photoSelection?.(); photoSelection = undefined; };
  if (files) {
    if (!await addFiles(files, "photos", resume)) throw new Error(sendError.value || "Could not insert the photos.");
  } else {
    await editor.value.ready();
    if (!photosOpen.value || fileBusy()) return;
    resume();
    editor.value.insertPhotos([{src:url, name:""}]);
  }
}
async function addFiles(files, mode, beforeInsert) {
  if (fileBusy() || !files.length) return false;
  const owner = form.ownerEmail, generation = fileGeneration;
  const current = () => mounted && show.value && owner === userStore.user.email && generation === fileGeneration;
  attaching.value = true;
  sendError.value = "";
  try {
    await editor.value?.ready();
    if (!current()) return false;
    const content = editor.value?.getContent() ?? form.content;
    const plan = planFiles(files, mode, form, content);
    const photos = await Promise.all(plan.photos.map(async file => ({ src: await fileToBase64(file, true), name: file.name })));
    const attachments = await Promise.all(plan.attachments.map(async file => ({
      filename: file.name, size: file.size, contentType: file.type || "application/octet-stream", content: await fileToBase64(file),
    })));
    if (!current()) return false;
    beforeInsert?.();
    if (photos.length) editor.value.insertPhotos(photos);
    form.attachments.push(...attachments);
    return true;
  } catch (error) {
    if (current()) sendError.value = error.message || "Could not add these files.";
    return false;
  } finally { attaching.value = false; }
}
let fileGeneration = 0;
const toField = ref();
const ccField = ref();
const bccField = ref();
const show = ref(false);
const editingRecipients = ref(false);
const loadedSource = shallowRef(null);
const responseSource = computed(() => loadedSource.value || props.responseMessage || emailStore.detailMap?.[form.responseSourceId || form.emailId]);
const responseHeader = computed(() => props.inline || (!form.detachedReply && !!form.sendType && form.responseView === "pop"));
const responseMode = computed(() => form.sendType === "forward" ? "forward" : form.replyAll ? "all" : "reply");
const addressExpanded = ref(true);
const subjectCaption = ref("");
const formatCaption = ref("");
let formatCaptionTimer;
function clearFormatCaption() {
  clearTimeout(formatCaptionTimer);
  formatCaption.value = "";
}
const caption = computed(() => formatCaption.value || subjectCaption.value || ({reply: "Reply", forward: "Forward"}[form.sendType] || "New Message"));
const settingStore = useSettingStore();
const showSender = computed(() => {
  if (form.sendEmail?.toLowerCase() !== userStore.user.email?.toLowerCase()) return true;
  const canChooseMailbox = hasPerm("account:query") && settingStore.settings.manyEmail === 0;
  return canChooseMailbox && (!accountStore.loaded || accountStore.accounts.length > 1);
});

let lastInput;
let restoreFocus;
function rememberInput(event) {
  if (event.target.matches("input")) lastInput = event.target;
}
function focusBody() {
  emit("editor-focus");
  lastInput = null;
  collapseAddresses();
}
function restoreCompose() {
  if (!minimized.value) return;
  minimized.value = false;
  nextTick(() => {
    if (show.value && !minimized.value) restoreFocus?.();
    restoreFocus = null;
  });
}
function toggleMinimized() {
  if (minimized.value) return restoreCompose();
  subjectCaption.value = form.subject.trim();
  const input = lastInput;
  if (input?.isConnected) {
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    restoreFocus = () => {
      input.focus();
      if (start !== null) input.setSelectionRange(start, end, direction);
    };
  } else restoreFocus = editor.value?.rememberSelection?.();
  minimized.value = true;
  nextTick(() => composeRoot.value?.querySelector(".compose-caption")?.focus());
}
let focusAfterResize;
function focusWritingField(resumeBody) {
  if (![form.receiveEmail, form.cc, form.bcc].some(addresses => addresses.length))
    focusRecipients("receiveEmail");
  else if (!form.subject.trim()) composeRoot.value?.querySelector(".subject-input")?.focus();
  else if (resumeBody) resumeBody();
  else editor.value?.focus();
}
function setFullScreen(value) {
  if (expanded.value === value) return;
  const resumeBody = editor.value?.rememberSelection?.();
  focusAfterResize = () => focusWritingField(resumeBody);
  expanded.value = value;
}
async function moveWindow() {
  if (preparing.value || sending.value || attaching.value || !show.value) return;
  const session = draftSession();
  preparing.value = true;
  async function saveForMove() {
    await editor.value?.ready?.();
    await pendingDefault;
    commitRecipients();
    await saveQueue;
    session.check();
    clearTimeout(cloudSaveTimer);
    if (form.draftId || hasDraftContent(form) || form.labelIds?.length || form.mailboxStarred)
      await persistDraft({requireCurrent:true,session});
    session.check();
    return {owner:session.owner, draftId:form.draftId, formatting:showFormatting.value, plainText:form.plainText,
      sender:{accountId:form.accountId,email:form.sendEmail,name:form.name}};
  }
  try {
    if (props.separateWindow) {
      saveWindowState(props.separateWindow, {...windowState(props.separateWindow), person:null, ...await saveForMove()});
      await returnComposeWindow(props.separateWindow);
      window.close();
    } else {
      await openSeparateWindow(saveForMove, session);
      show.value = false;
      resetForm();
      emit("closed");
    }
  } catch (error) { sendError.value = error.message || "Could not move this draft."; }
  finally { preparing.value = false; }
}
function toggleFullScreen() {
  if (minimized.value) {
    expanded.value = true;
    restoreCompose();
  } else setFullScreen(!expanded.value);
}
function collapseAddresses() {
  commitRecipients();
  if (!props.inline) addressExpanded.value = false;
}
function focusRecipients(field,address,focus=true) {
  if (responseHeader.value) editingRecipients.value = true;
  else addressExpanded.value = true;
  if (field === "cc") showCc.value = true;
  if (field === "bcc") showBcc.value = true;
  const input = {receiveEmail: toField, cc: ccField, bcc: bccField}[field];
  nextTick(() => {
    if (address) input?.value?.focusAddress(address,focus);
    else if (focus) input?.value?.focus();
  });
}
const appleKeys=/Mac|iPhone|iPad/.test(navigator.platform);
const primaryKey=appleKeys ? 'Meta' : 'Control';
function shortcutHint(label,key,shift=false) {
  const modifiers=appleKeys ? '⌘'+(shift?'⇧':'') : 'Ctrl+'+(shift?'Shift+':'');
  return label+' ('+modifiers+key+')';
}
function copyShortcutHint(label) {
  return shortcutHint('Add '+label+' recipients',label[0].toUpperCase(),true);
}
function composeShortcut(event,body=false) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey) ||
      !show.value || minimized.value || sending.value || preparing.value || attaching.value ||
      showContacts.value || managingSignatures.value || scheduling.value || photosOpen.value || labelStore.edit) return;
  const key=event.key?.toLowerCase();
  const send=key==='enter' && !event.shiftKey, discardDraft=key==='d' && event.shiftKey;
  if (send || discardDraft) {
    // Address fields and the editor share this action. Inputs in nested link,
    // photo and formatting dialogs keep their own Enter and Escape behavior.
    if (!(body || event.target.matches?.('.subject-input,.recipient-entry input')) ||
        (appleKeys ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) {
      if (send) sendEmail();
      else discard();
    }
    return;
  }
  if (!event.shiftKey) return;
  if (event.code === "Digit2" || event.key === "@") {
    event.preventDefault();
    event.stopImmediatePropagation();
    emojiPicker.value?.open();
    return;
  }
  const field = {c: "cc", b: "bcc"}[key];
  if (!field) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  focusRecipients(field);
}
const uiPreferences=useUiStore();
const composeMode = computed(() => uiPreferences.composeModes[userStore.user.email] || {});
const showFormatting=computed({get:()=>uiPreferences.composeFormatting,set:value=>{uiPreferences.composeFormatting=value;}});
const quoteExpanded = ref(false);
const hasQuotedContent = computed(() =>
  /\bcloudmail-reply-quote\b/.test(form.content),
);
const replyRecipientTitle = computed(() =>
  [...form.receiveEmail, ...form.cc, ...form.bcc].join(", "),
);
const replyRecipientSummary = computed(() => {
  const recipients = [...form.receiveEmail, ...form.cc, ...form.bcc];
  const address = recipients[0];
  if (!address) return "Add recipients";
  const candidate = form.replyRecipientNames?.[address.toLowerCase()];
  const name = typeof candidate === "string" ? candidate : "";
  return `${name && name.toLowerCase() !== address.toLowerCase() ? `${name} (${address})` : address}${recipients.length > 1 ? ` +${recipients.length - 1}` : ""}`;
});
function editReplyRecipients() {
  commitRecipients();
  editingRecipients.value = !editingRecipients.value;
  if (editingRecipients.value) nextTick(() => toField.value?.focus());
}
const showCc = ref(false);
const showBcc = ref(false);
const minimized = ref(false);
const expanded = ref(false);
const sending = ref(false);
const attaching = ref(false);
const sendError = ref("");
const validateAddresses = ref(false);
const recipientErrors = computed(()=>validateAddresses.value ? normalizeRecipients(form).errors : {});
const defValue = ref("");
const showContacts = ref(false);
const contactField = ref("receiveEmail");
let baseline = "";
let restoredUntouched = false;
const preparing = ref(false);
const emptyForm = () => ({
  sendEmail: "",
  labelIds: [],
  mailboxStarred: false,
  receiveEmail: [],
  cc: [],
  bcc: [],
  accountId: -1,
  name: "",
  subject: "",
  content: "",
  plainText: false,
  sendType: "",
  text: "",
  emailId: 0,
  attachments: [],
  draftId: null,
});
const form = reactive(emptyForm());
provide(recipientDragSession,()=>{
  const token=userStore.authenticatedToken;
  return show.value && !minimized.value && !sending.value && !preparing.value && !attaching.value &&
    form.ownerEmail && form.ownerEmail===userStore.user.email && token===localStorage.getItem("token") ? token : null;
});
const mailboxRecents = computed(()=>writerStore.recentAddresses(form.ownerEmail,form.accountId));
const removedSuggestions = computed(()=>writerStore.removedSuggestions[JSON.stringify([form.ownerEmail,form.accountId])] || []);
const attachedFiles = computed(() => form.attachments.filter(file => !file.contentId));
const starChoice = ref(null);
const starRevision = ref(0);
async function readComposeStar() {
  const {draftId,ownerEmail}=form;
  const database=db.value;
  if (draftId && !starChoice.value && database?.name===ownerEmail && userStore.user.email===ownerEmail) {
    const row=await database.draft.get(draftId);
    if (row && !row.deleted && !starChoice.value && database===db.value && form.draftId===draftId &&
        userStore.user.email===ownerEmail) return Boolean(row.mailboxStarred);
  }
  return Boolean(form.mailboxStarred);
}
function chooseStar(value) {
  starChoice.value={value};
  starRevision.value++;
  form.mailboxStarred=value;
}


function commitRecipients() {
  [toField, ccField, bccField].forEach((field) => field.value?.commit());
}
const signatures=useMailSignatures(), managingSignatures=ref(false), managerMounted=ref(false);
const signatureButton=ref(null), menuItems=ref([]), selectedSignature=ref(""), signatureError=ref("");
let signatureGeneration=0, pendingDefault=Promise.resolve(), automaticBaseline="";
async function loadSignatureMenu(visible){
  if(!visible)return;
  const generation=signatureGeneration;
  selectedSignature.value=editor.value?.currentSignature?.() || "";
  signatureError.value="";
  try{
    const data=await signatures.load();
    if(data && generation===signatureGeneration)menuItems.value=data.items;
  }catch{if(generation===signatureGeneration)signatureError.value="Could not load signatures";}
}
async function signatureCommand(command){
  if(command==="manage"){
    managerMounted.value=true;managingSignatures.value=true;return;
  }
  const generation=++signatureGeneration, owner=userStore.user.email;
  await editor.value?.ready?.();
  if(generation!==signatureGeneration || owner!==userStore.user.email || !show.value || sending.value)return;
  const item=command==="none"?null:menuItems.value.find(item=>"insert/"+item.id===command);
  if(command!=="none" && !item)return;
  editor.value?.setSignature?.(item, signatures.data?.beforeQuote, Boolean(form.sendType));
  editor.value?.focus?.();
}
function startSignatureDefault(){
  const generation=signatureGeneration, account=form.accountId, owner=form.ownerEmail;
  pendingDefault=(async()=>{
    let data;
    try{data=await signatures.load();}catch{return;}
    await nextTick();await editor.value?.ready?.();
    if(!data || generation!==signatureGeneration || !show.value || form.ownerEmail!==owner || userStore.user.email!==owner || form.accountId!==account)return;
    menuItems.value=data.items;
    const id=data.defaults[account]?.[form.sendType?"reply":"newMail"];
    const item=data.items.find(item=>item.id===id);
    if(!item || !editor.value?.setSignature)return;
    const pristine=!hasDraftContent(form) || (baseline && draftFingerprint(form)===baseline);
    editor.value.setSignature(item,data.beforeQuote,Boolean(form.sendType),false);
    if(pristine)automaticBaseline=draftFingerprint(form);
  })();
}
const writingStyle=ref({});
let windowContactSeed=false;
function resetForm() {
  windowContactSeed=false;
  writingStyle.value=textStyleCSS(userStore.user.generalSettings?.textStyle);
  clearFormatCaption();
  focusAfterResize=undefined;
  fileGeneration++;
  photosOpen.value = false;
  photoSelection = undefined;
  dragHint.value = "";
  starChoice.value=null;
  recipientNotice.value = null;
  showContacts.value=false;
  lastInput = null;
  loadedSource.value = null;
  restoreFocus = null;
  signatureGeneration++;pendingDefault=Promise.resolve();automaticBaseline="";menuItems.value=[];
  selectedSignature.value="";signatureError.value="";managingSignatures.value=false;
  Object.keys(form).forEach((key) => delete form[key]);
  Object.assign(form, emptyForm());
  [toField, ccField, bccField].forEach((field) => field.value?.clear());
  editingRecipients.value = false;
  quoteExpanded.value = false;
  validateAddresses.value = false;
  sendError.value = "";
  showCc.value = false;
  showBcc.value = false;
  defValue.value = "";
  baseline = "";
  restoredUntouched = false;
  minimized.value = false;
  expanded.value = false;
  editor.value?.clearEditor();
}
function available() {
  if (show.value || preparing.value) {
    restoreCompose();
    ElMessage.info(
      "Your current message is open. Save or discard it before starting another.",
    );
    return false;
  }
  return true;
}
function setSender(sender) {
  const account = sender || (accountStore.currentAccount?.email
    ? accountStore.currentAccount
    : userStore.user.account);
  form.plainText = Boolean(composeMode.value.plainText);
  form.ownerEmail=userStore.user.email;
  form.sendEmail = account.email;
  form.accountId = account.accountId;
  form.name = account.name || userStore.user.name || "";
}
function reveal() {
  subjectCaption.value = form.subject.trim();
  addressExpanded.value = true;
  expanded.value = desktop.value && !props.inline && !props.separateWindow && Boolean(composeMode.value.fullScreen);
  showCc.value = form.cc.length > 0;
  showBcc.value = form.bcc.length > 0;
  show.value = true;
  minimized.value = false;
  nextTick(() => {
    if (!props.inline && props.dockActive) toField.value?.focus();
  });
}
function focusWindow(){
  if (!show.value || props.dockHidden) return;
  if (minimized.value) restoreCompose();
  else if (lastInput?.isConnected && lastInput.getClientRects().length) lastInput.focus();
  else editor.value?.focus();
}
// Only the new writing area gets the account default. Quoted and signed text
// remain sibling blocks and saved draft HTML keeps its own styles.
function initialWritingArea(content="") {
  const css=writingStyle.value;
  if(form.plainText || !Object.keys(css).length)return content;
  const template=document.createElement('template');
  template.innerHTML=content || '<div><br></div>';
  Object.assign(template.content.firstElementChild.style,css);
  return template.innerHTML;
}
function open(person, sender, attachments = []) {
  if (show.value) return focusWindow();
  if (preparing.value) return;
  resetForm();
  setSender(sender);
  if (person && person.accountId !== form.accountId) return;
  form.attachments.push(...attachments);
  defValue.value=initialWritingArea();
  if (person) {
    form.receiveEmail = [person.email];
    rememberPerson(person);
  }
  reveal();
  if (person) nextTick(() => {
    if (props.dockActive) composeRoot.value?.querySelector(".subject-input")?.focus();
  });
  startSignatureDefault();
}
async function openDraft(draft, options) {
  if (!available()) return;
  preparing.value = true;
  try {
    resetForm();
    Object.assign(form, restoreDraft(draft), { subject: draft.subject ?? "" });
    loadedSource.value = options?.source || null;
    if(draft.deliveryError)sendError.value=draft.deliveryError;
    if(draft.schedulingError)sendError.value="Scheduling failed. "+draft.schedulingError;
    form.ownerEmail = userStore.user.email;
    if (!form.sendEmail) {
      const account = [...accountStore.accounts, accountStore.currentAccount, userStore.user.account]
        .find(account => account?.accountId === form.accountId);
      form.sendEmail = account?.email || "";
    }
    if (!form.content && form.text)
      form.content = escapeHTML(form.text).replace(/\r\n?|\n/g, "<br>");
    if (responseHeader.value && form.sendType === "reply")
      form.content = foldLegacyReplyQuote(form.content || "");
    quoteExpanded.value = /\bcloudmail-forwarded-conversation\b/.test(form.content);
    defValue.value = form.content || initialWritingArea();
    reveal();
    await nextTick();
    await editor.value?.ready?.();
    baseline = draftFingerprint(form);
    restoredUntouched = Boolean(draft.cloudDraftId);
  } finally {
    preparing.value = false;
  }
  await nextTick();
  if (!mounted || !props.dockActive) return;
  if (responseHeader.value && !responseSource.value && !form.detachedReply) loadResponseSource();
  if (options?.selectSubject) {
    const subject = composeRoot.value?.querySelector(".subject-input");
    subject?.focus(); subject?.select();
  } else if (responseHeader.value || replyRecipientTitle.value) {
    collapseAddresses();
    editor.value?.resumeDraft?.();
  } else toField.value?.focus();
}
// Older reply drafts stored the generated quote directly after the editable body.
function foldLegacyReplyQuote(content) {
  if (/\bcloudmail-reply-quote\b/.test(content)) return content;
  const doc = new DOMParser().parseFromString(content, "text/html");
  const quote = [...doc.body.children].find(
    (node) =>
      node.tagName === "BLOCKQUOTE" &&
      node.previousElementSibling?.textContent.trim().endsWith("wrote:"),
  );
  if (!quote) return content;
  const attribution = quote.previousElementSibling;
  const wrapper = doc.createElement("div");
  wrapper.className = "cloudmail-reply-quote";
  doc.body.insertBefore(wrapper, attribution);
  wrapper.append(attribution, quote);
  return doc.body.innerHTML;
}
const escapeHTML = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let sourceController;
async function prepareMessage(message, mode, all = false, rowView, conversation) {
  if (!available()) return false;
  preparing.value = true;
  const controller = sourceController = new AbortController();
  const owner=userStore.user.email, token=userStore.authenticatedToken;
  const current = () => (!rowView || rowView.current()) && (!conversation || conversation.current()) && mounted && !controller.signal.aborted && owner===userStore.user.email && token===userStore.authenticatedToken && token===localStorage.getItem("token");
  const cancel=()=>controller.abort();
  rowView?.signal.addEventListener("abort",cancel,{once:true});
  try {
    if (!current()) return false;
    const email = conversation ? message : (rowView || message.trashedAt)
      ? await http.get("/v1/messages/" + message.emailId,{signal:controller.signal,noMsg:true,headers:{Authorization:token}})
      : await emailStore.ensureDetail(message);
    if (!current()) return false;
    if (rowView && (!email || email.emailId!==message.emailId || email.userId!==userStore.user.userId || email.scheduledDraftId ||
        Boolean(email.trashedAt)!==Boolean(message.trashedAt) || (message.accountId && message.accountId!==email.accountId)))
      throw new Error("This message is no longer available here.");
    if (message.trashedAt && (!token || email.userId!==userStore.user.userId || email.scheduledDraftId)) throw new Error("This message is no longer available.");
    if (hasPerm("account:query")) await accountStore.loadAll();
    if (!current()) return false;
    const quote = conversation?.quote || await quotedMessage(email, mode, controller.signal, token);
    if (!current()) return false;
    resetForm();
    setSender();
    loadedSource.value = email;
    form.replyAll = all;
    if (rowView) Object.assign(form,{responseView:"pop",inlineReply:true});
    if (props.inline || rowView) form.responseSourceId = email.emailId;
    const originalAccount =
      accountStore.accounts.find(
        (account) => account.accountId === email.accountId,
      ) ||
      [accountStore.currentAccount, userStore.user.account].find(
        (account) => account?.accountId === email.accountId,
      );
    form.accountId = email.accountId;
    form.sendEmail =
      email.mailboxEmail ||
      message.mailboxEmail ||
      (email.type === 1 ? email.sendEmail : email.toEmail) ||
      form.sendEmail;
    form.name = email.mailboxName || userStore.user.name || "";
    if (originalAccount) {
      form.sendEmail = originalAccount.email;
      form.accountId = originalAccount.accountId;
      form.name = originalAccount.name || userStore.user.name || "";
    }
    form.subject = responseSubject(conversation?.subject ?? email.subject,mode);
    quoteExpanded.value = Boolean(conversation);
    form.sendType = mode;
    form.emailId = mode === "reply" ? email.emailId : 0;
    if (email.trashedAt) form.trashSource = email.emailId;
    Object.assign(form,quote);
    if ((props.inline || rowView) && mode==="forward") form.attachments=quote.attachments.map(file=>({...file,fromResponse:true}));
    if (mode === "reply") {
      Object.assign(form, replyRecipients(email, accountStore.ownAddresses, all));
      if (props.inline || rowView) {
        addResponseNames(email);
      }
    } else if (responseHeader.value) editingRecipients.value = true;
    if (form.plainText) Object.assign(form, plainMarkup(form.content));
    else form.content=initialWritingArea(form.content);
    defValue.value = form.content;
    reveal();
    await nextTick();
    await editor.value?.ready?.();
    // TinyMCE normalizes HTML; compare against its actual representation after loading.
    baseline = draftFingerprint(form);
    startSignatureDefault();
  } catch (error) {
    if (current()) ElMessage.error(error.message || "Could not load the message. Please try again.");
    return false;
  } finally {
    rowView?.signal.removeEventListener("abort",cancel);
    preparing.value = false;
  }
  await nextTick();
  if (!mounted || !props.dockActive) return;
  if ((props.inline || rowView) && mode === "reply") editor.value?.focus?.(true);
  else toField.value?.focus();
  return true;
}
function addResponseNames(source) {
  const names={...form.replyRecipientNames};
  for (const list of [source.recipient,source.cc,source.bcc]) {
    for (const person of mailboxEntries(list)) if (person.name) names[person.address.toLowerCase()]=person.name;
  }
  if (source.sendEmail && source.name) names[source.sendEmail.toLowerCase()]=source.name;
  form.replyRecipientNames=names;
}
async function responseCommand(command) {
  if (sending.value || preparing.value || attaching.value || !show.value) return;
  if (command === "pop" || command === "subject") return moveResponse(command);
  if (command === responseMode.value && (command==="forward" || form.replyAll!==undefined)) {
    editor.value?.focus();
    return;
  }
  await changeResponse(command);
}

async function moveResponse(command) {
  const session=draftSession();
  preparing.value=true;
  try {
    await editor.value?.ready?.();
    await pendingDefault;
    commitRecipients();
    await saveQueue;
    session.check();
    if (!mounted) return;
    const view=command === "subject" ? "subject" : "pop";
    if (props.inline) {
      // The inline instance stays locked until its docked successor is ready.
      clearTimeout(cloudSaveTimer);
      const pristine=!form.draftId && [baseline,automaticBaseline].includes(draftFingerprint(form));
      const saved=pristine ? {...snapshot(),inlineReply:true} : await persistDraft({requireCurrent:true,session,responseView:view});
      session.check();
      const moved=await uiPreferences.writerRef?.openDraft({...saved,responseView:view},{
        source:responseSource.value, selectSubject:view==="subject", handoff:true,
      });
      if (!moved) throw new Error("Could not open the docked reply.");
      show.value=false;
      resetForm();
      emit("closed");
    } else {
      form.responseView=view;
      if (form.draftId) await persistDraft({requireCurrent:true,session});
      preparing.value=false;
      await nextTick();
      const subject=composeRoot.value?.querySelector(".subject-input");
      subject?.focus(); subject?.select();
    }
  } catch (error) { sendError.value=error.message || "Your reply is still open."; }
  finally { preparing.value=false; }
}
async function readResponseSource(id,session,controller) {
  session.check();
  const source=form.trashSource
    ? await http.get("/v1/messages/"+id,{signal:controller.signal,headers:{Authorization:session.token}})
    : await emailStore.ensureDetail({emailId:id});
  session.check();
  if (!source || Number(source.accountId)!==Number(form.accountId) || Number(source.emailId)!==Number(id))
    throw new Error("The original message is no longer available.");
  return source;
}
async function loadResponseSource() {
  const id=form.responseSourceId || form.trashSource || form.emailId;
  if (!id) return;
  const controller=sourceController=new AbortController();
  try {
    const source=await readResponseSource(id,draftSession(),controller);
    if (!controller.signal.aborted && mounted && show.value && (form.responseSourceId || form.trashSource || form.emailId)===id)
      loadedSource.value=source;
  } catch { /* A saved response remains editable when its source is offline. */ }
}
async function changeResponse(command) {
  const id=form.responseSourceId || form.trashSource || form.emailId;
  if (!id || form.detachedReply) { sendError.value="The original message is no longer available."; return; }
  const session=draftSession(), controller=sourceController=new AbortController();
  preparing.value=true;
  try {
    commitRecipients();
    await pendingDefault;
    await saveQueue;
    const source=await readResponseSource(id,session,controller);
    if (controller.signal.aborted || !mounted) return;
    const mode=command==="forward" ? "forward" : "reply";
    if (mode!==form.sendType) {
      const quote=await quotedMessage(source,mode,controller.signal,session.token);
      session.check();
      if (controller.signal.aborted || !mounted) return;
      const html=changeQuotedBody(editor.value?.getContent() ?? form.content, quote.content,form.plainText,mode);
      const attachments=form.attachments.map(file=>({...file}));
      if (mode==="reply" && !form.responseSourceId && attachments.length && source.attList?.length) {
        // Older saved Trash forwards have no origin markers on copied files.
        const original=await quotedMessage(source,"forward",controller.signal,session.token);
        const signatures=await responseFileSignatures(original.attachments.map(file=>({...file,fromResponse:true})));
        await restoreResponseFiles(attachments,signatures);
        session.check();
        if (controller.signal.aborted || !mounted) return;
      }
      const files=attachments.filter(file=>!file.fromResponse);
      form.attachments=[...files,...quote.attachments.map(file=>({...file,fromResponse:true}))];
      form.content=defValue.value=html;
      form.text=plainMarkup(form.content).text;
      form.subject=responseSubject(source.subject,mode);
      subjectCaption.value=form.subject.trim();
      form.emailId=mode==="reply" ? source.emailId : 0;
    }
    loadedSource.value=source;
    form.responseSourceId=id;
    form.sendType=mode;
    form.replyAll=command==="all";
    if (mode==="reply") addResponseNames(source);
    Object.assign(form,mode==="reply" ? replyRecipients(source,accountStore.ownAddresses,form.replyAll) : {receiveEmail:[],cc:[],bcc:[]});
    showCc.value=!!form.cc.length;showBcc.value=!!form.bcc.length;
    quoteExpanded.value=false;
    editingRecipients.value=mode==="forward";
    validateAddresses.value=false;
    sendError.value="";
    await nextTick();
    await persistDraft({requireCurrent:true,session});
    syncCloudDrafts().catch(()=>{});
  } catch (error) { if(!controller.signal.aborted) sendError.value=error.message || "Could not change the response."; }
  finally { preparing.value=false; }
  await nextTick();
  if (mounted && show.value) {
    if (editingRecipients.value) toField.value?.focus();
    else editor.value?.focus();
  }
}
function openReply(email) {
  return prepareMessage(email, "reply");
}
function openReplyAll(email) {
  return prepareMessage(email, "reply", true);
}
function openForward(email, conversation) {
  return prepareMessage(email, "forward",false,undefined,conversation);
}
async function useRichCommand(command, value, selection) {
  if (!form.plainText || !show.value || sending.value) return;
  const currentEditor = await moreCommand("enable-rich");
  if (!currentEditor) return;
  currentEditor.applyPlainSelection(selection);
  if (command === "link") currentEditor.openLink();
  else currentEditor.command(command, value);
}
async function moreCommand(command) {
  const owner = userStore.user.email;
  const generation = signatureGeneration;
  const current = () => show.value && !sending.value && owner === userStore.user.email && generation === signatureGeneration;
  if (!current()) return;
  if (command === "new-label") {
    labelStore.edit = {clientId: crypto.randomUUID(), restoreFocus() {
      if (current()) moreOptions.value?.focus();
    }, onCreated(id) {
      if (current() && !form.labelIds.includes(id)) form.labelIds = [...form.labelIds,id];
    }};
    return;
  }
  if (command === "spell") {
    await editor.value?.ready();
    if (current()) editor.value?.openSpelling();
    return;
  }
  if (command === "manage-labels") {
    if (await saveAndClose()) await router.push({name:"label-settings"});
    return;
  }
  if (command === "fullscreen") {
    const fullScreen = !composeMode.value.fullScreen;
    uiPreferences.composeModes[owner] = {...composeMode.value, fullScreen};
    if (desktop.value && !props.inline && !props.separateWindow) setFullScreen(fullScreen);
    return;
  }
  // An editor command already has a live selection. Switch immediately so a
  // pending signature request cannot move subsequent typing ahead of that selection.
  if (command !== "enable-rich") {
    await pendingDefault;
    await editor.value?.ready();
    if (!current()) return;
  }
  if (command === "print") {
    commitRecipients();
    await printDraft({...form, content:editor.value.getContent()});
    return;
  }
  if (command === "enable-rich" && !form.plainText) return;
  const plainText = !form.plainText;
  const content = editor.value.getContent();
  if (plainText && /<img[\s>]/i.test(content)) {
    try {
      await ElMessageBox.confirm("Plain text removes images from the message body.", "Switch to plain text?", {
        confirmButtonText:"Switch to plain text", cancelButtonText:"Cancel", customClass:"mail-dialog",
      });
    } catch { return; }
    if (!current()) return;
  }
  if (plainText) {
    Object.assign(form, editor.value.toPlain());
    form.attachments = form.attachments.filter(file => !file.contentId);
  } else form.content = richMarkup(content);
  defValue.value = form.content;
  form.plainText = plainText;
  clearFormatCaption();
  formatCaption.value = plainText ? "Plain text" : "Rich text";
  formatCaptionTimer = setTimeout(clearFormatCaption, 1500);
  uiPreferences.composeModes[owner] = {...composeMode.value, plainText};
  await nextTick();
  await editor.value?.ready();
  if (!current() || form.plainText !== plainText) return;
  if (command === "enable-rich") return editor.value;
  editor.value?.focus();
}
function change(content, text) {
  form.content = content;
  form.text = text;
}
// The browser can close a separate window without blurring its address field.
// Include unfinished chip edits in autosave without interrupting typing.
const pendingRecipients = computed(() => {
  if (!props.separateWindow) return {};
  const patch = {}, names = {...form.replyRecipientNames};
  for (const [key,field] of [["receiveEmail",toField],["cc",ccField],["bcc",bccField]]) {
    const change = field.value?.pendingChange();
    if (!change) continue;
    patch.replyRecipientNames = names;
    if (!change.nameEdit) {
      const values = [...form[key]];
      values.splice(change.source ?? values.length,change.source === null ? 0 : 1,...change.people.map(p => p.address));
      patch[key] = values;
    }
    for (const {address,name} of change.people) {
      if (!address) continue;
      if (name) names[address.toLowerCase()] = name;
      else if (change.nameEdit) delete names[address.toLowerCase()];
    }
  }
  return patch;
});
function snapshot() {
  return restoreDraft({...toRaw(form), ...pendingRecipients.value});
}
let saveQueue=Promise.resolve(), pendingWrites=0, saveFailed=false;
function warnUnsaved(event) {
  if (!props.separateWindow || !show.value || !(pendingWrites || saveFailed || attaching.value || sending.value)) return;
  event.preventDefault();
  event.returnValue = "";
}
function persistDraft(options) {
  const operation=saveQueue.catch(()=>{}).then(() => persistDraftNow(options));
  pendingWrites++;
  operation.then(() => { pendingWrites--; saveFailed=false; }, () => { pendingWrites--; saveFailed=true; });
  saveQueue=operation;return operation;
}
async function persistDraftNow({autosave=false, preserveEmpty=false, responseView, ...options} = {}) {
  const draft = snapshot();
  const generatedOnly=draftFingerprint(draft)===automaticBaseline && !draft.labelIds?.length && !draft.mailboxStarred;
  if (autosave && !preserveEmpty && !props.inline && (!hasDraftContent(draft) || generatedOnly)) {
    if (windowContactSeed) {
      saveWindowState(props.separateWindow,{...windowState(props.separateWindow),person:null});
      windowContactSeed=false;
    }
    if (!draft.draftId) return;
    const generation=fileGeneration;
    const recovery = await discardDrafts([draft.draftId], draft);
    recovery.dispose().catch(() => {});
    if (generation!==fileGeneration || form.draftId!==draft.draftId) return;
    // The empty document remains editable. Later typing starts a fresh draft
    // and cannot overwrite the cloud row queued for deletion.
    for (const key of ["draftId","cloudDraftId","clientId","cloudVersion","editToken","starEditBase",
      "sendAttemptId","sendFingerprint","localRevision","syncState","uploadIntent"]) delete form[key];
    return;
  }
  const { attachments, draftId, ...data } = draft;
  if (responseView) data.responseView=responseView;
  if (props.inline && !form.detachedReply) data.inlineReply = true;
  data.createTime =
    draft.createTime || dayjs().utc().format("YYYY-MM-DD HH:mm:ss");
  const choice=starChoice.value;
  const saved=await saveLocalDraft({...data,draftId,attachments}, {...options,preserveStar:!choice});
  if (starChoice.value===choice) {
    starChoice.value=null;
    form.mailboxStarred=Boolean(saved.mailboxStarred);
  }
  Object.assign(form,{draftId:saved.draftId, editToken:saved.editToken, starEditBase:saved.starEditBase, clientId:saved.clientId, cloudDraftId:saved.cloudDraftId, cloudVersion:saved.cloudVersion, syncState:saved.syncState});
  if (saved.detachedReply) Object.assign(form, {emailId:0, sendType:"", inlineReply:false});
  return saved;
}
async function removeSavedDraft() {
  if(form.draftId)await removeLocalDraft(form.draftId);
}
let cloudSaveTimer;
// Track changes to editable values. A save also updates metadata on the form.
const autosaveForm = computed(() => props.separateWindow ? {...form,...pendingRecipients.value} : form);
watch([()=>draftFingerprint(autosaveForm.value), ()=>JSON.stringify(draftFilingFingerprint(form)),
  ()=>starRevision.value, ()=>form.accountId, ()=>form.name, ()=>form.sendType, ()=>form.emailId], ([fingerprint,filing,revision],[,previousFiling,previousRevision])=>{
  if(preparing.value || sending.value || !show.value) return;
  const changedFiling = form.draftId && (filing!==previousFiling || revision!==previousRevision);
  const generatedOnly=fingerprint===automaticBaseline && !form.labelIds?.length && !form.mailboxStarred;
  const skipEmpty=!form.draftId && !pendingWrites && (!hasDraftContent(autosaveForm.value) || generatedOnly);
  if (!changedFiling && (skipEmpty ||
      (restoredUntouched && fingerprint===baseline))) return;
  restoredUntouched = false;
  clearTimeout(cloudSaveTimer);
  const localSave=persistDraft({autosave:true,preserveEmpty:changedFiling}).catch(()=>{form.syncState="offline";});
  cloudSaveTimer=setTimeout(async()=>{
    const draftId = (await localSave)?.draftId;
    if (!draftId || form.draftId !== draftId) return;
    try {
      await syncCloudDrafts();
      const saved = await db.value.draft.get(draftId);
      if (form.draftId === draftId && saved && form.editToken === saved.editToken)
        Object.assign(form, {clientId:saved.clientId, cloudDraftId:saved.cloudDraftId, cloudVersion:saved.cloudVersion, syncState:saved.syncState});
    } catch { if (form.draftId === draftId) form.syncState='offline'; }
  },1000);
});

async function saveAndClose() {
  if (sending.value || attaching.value || preparing.value) return false;
  if (!show.value) return true;
  try {
    await editor.value?.ready?.();
    commitRecipients();
    if(hasDraftContent(form))await pendingDefault;
    clearTimeout(cloudSaveTimer);
    if (!restoredUntouched || draftFingerprint(form) !== baseline) {
      if (hasDraftContent(form) && draftFingerprint(form)!==automaticBaseline && (form.draftId || draftFingerprint(form) !== baseline))
        await persistDraft();
      else await removeSavedDraft();
      syncCloudDrafts().catch(() => {});
    }
    show.value = false;
    resetForm();
    emit("closed");
    return true;
  } catch {
    sendError.value = "Could not save your draft. Your message is still open.";
    return false;
  }
}
async function close() {
  if (showContacts.value) return;
  return saveAndClose();
}
let mounted = true;
async function discard() {
  try { await discardEditor(); }
  catch (error) { sendError.value = error.message || "Could not discard this draft."; }
}
const discardLocked=ref(false);
async function prepareDiscard(session){
  if (!show.value || preparing.value || sending.value || attaching.value)
    throw new Error("Finish the current action before discarding.");
  session.check();
  discardLocked.value=true;
  preparing.value=true;
  try{
    clearTimeout(cloudSaveTimer);
    signatureGeneration++;
    await editor.value?.ready?.();
    commitRecipients();
    await saveQueue.catch(() => {});
    session.check();
    const changed=draftFingerprint(form)!==baseline && draftFingerprint(form)!==automaticBaseline;
    if ((form.draftId && (!restoredUntouched || changed)) || (!form.draftId && changed && hasDraftContent(form)))
      await persistDraft({requireCurrent:true,session});
    return {draftId:form.draftId,editToken:form.editToken,cloudVersion:form.cloudVersion,localRevision:form.localRevision};
  }catch(error){unlockDiscard();throw error;}
}
function unlockDiscard(){discardLocked.value=false;preparing.value=false;}
function finishDiscard(){show.value=false;resetForm();emit("closed");}
async function discardEditor(selected,session=draftSession()){
  if (selected && (!show.value || !selected.includes(form.draftId))) return false;
  const expected=await prepareDiscard(session);
  try {
    if(expected.draftId){
      const recovery=await discardDrafts(selected || [expected.draftId],expected,session);
      feedback.dismissedDrafts(recovery,selected || props.inline ? undefined : async ([id])=>{
        session.check();
        const {readSavedDraft}=await import("@/services/draft-list");
        const draft=await readSavedDraft(id);
        session.check();
        await uiPreferences.writerRef?.openDraft(draft);
      });
    }
    finishDiscard();
    return true;
  }finally{unlockDiscard();}
}
function dismissRecipientError() {
  const notice=recipientNotice.value;
  if (recipientDialog.value?.open) recipientDialog.value.close?.();
  recipientNotice.value=null;
  if (!notice || !show.value || props.dockHidden) return;
  const trigger = notice.trigger;
  if (trigger?.isConnected && !trigger.disabled && trigger.getClientRects().length) {
    if (notice.address) focusRecipients(notice.field,notice.address,false);
    trigger.focus({preventScroll:true});
  } else focusRecipients(notice.field,notice.address);
}
function showRecipientError(message,field,address,trigger){
  if (!recipientNotice.value) {
    recipientNotice.value={message,field,address,trigger};
    nextTick(()=>recipientDialog.value?.showModal());
  }
  return false;
}
function openSchedule(trigger) {
  if (validForSend(trigger)) schedulePicker.value.open(trigger);
}
function validForSend(trigger) {
  if (sending.value || attaching.value || recipientNotice.value) return false;
  commitRecipients();
  const recipients = normalizeRecipients(form);
  if (recipientFields.every(field => recipients[field].length === 0))
    return showRecipientError('Please specify at least one recipient.','receiveEmail',null,trigger);
  validateAddresses.value=true;
  if (recipients.firstInvalid) {
    const {field,address}=recipients.firstInvalid;
    const label={receiveEmail:'To',cc:'Cc',bcc:'Bcc'}[field];
    return showRecipientError(`The address "${address}" in the "${label}" field was not recognized. Please make sure that all addresses are properly formed.`,field,address,trigger);
  }
  if (recipients.errors.receiveEmail) return showRecipientError(recipients.errors.receiveEmail,'receiveEmail',null,trigger);
  recipientFields.forEach((field) => {
    form[field] = recipients[field];
  });
  return true;
}
function scheduledFeedback(result, sendAt, session) {
  if (result.pending) {
    feedback.show("Awaiting scheduling confirmation. Check Scheduled or Drafts when connected.");
    return;
  }
  feedback.show("Send scheduled for " + new Date(sendAt * 1000).toLocaleString() + ".");
  if (!result.scheduled) return;
  const receipt = result.scheduled;
  feedback.notice.scheduledMessage = receipt;
  attachUndo(() => cancelScheduledReceipt(receipt, session), session);
}
function attachUndo(cancel, session) {
  const notice = feedback.notice;
  notice.undoFiling = async () => {
    session.check();
    let moved = false;
    const stop = watch([router.currentRoute, () => accountStore.currentAccountId,
      () => accountStore.currentAccount.allReceive], () => { moved = true; }, {flush:"sync"});
    const canOpen = () => !moved && (feedback.notice === notice || feedback.previousHolds.includes(notice));
    try {
      const restored = await cancel();
      // The cloud cancellation is final even if the local draft cannot yet be reopened.
      try {
        const draft = await restored.localDraft();
        session.check();
        if (draft && !draft.deleted && canOpen()) {
          const {openSavedDraft} = await import("@/services/draft-list");
          await openSavedDraft(draft.draftId, router, "draft", undefined, undefined, () => {
            session.check();
            return canOpen();
          });
        }
      } catch { /* The saved message is available in Drafts. */ }
    } finally { stop(); }
    return "Sending undone. Message returned to Drafts.";
  };
}
function rememberPerson({email,name}) {
  if (!email) return;
  const names={...form.replyRecipientNames}, key=email.toLowerCase();
  if (name && name.toLowerCase()!==key) names[key]=name;
  else delete names[key];
  form.replyRecipientNames=names;
}
function rememberRecipients(recent, accountId) {
  writerStore.rememberAddresses(userStore.user.email,accountId,recent);
}
function recordSent(messages) {
  messages.forEach(message => emailStore.sendScroll?.addItem?.(message));
  emailStore.conversationRevision++;
  userStore.refreshUserInfo();
}
async function followDelivery(delivery, recent, replyTo, subject, quiet=false) {
  const session=draftSession();
  if (!delivery.begin()) return;
  if (!quiet) feedback.show("Sending…");
  const notice=quiet ? {} : feedback.notice;
  notice.subject=subject;
  notice.holding=true;
  if (!quiet && delivery.delay>0) attachUndo(delivery.cancel,session);
  try {
    await new Promise(resolve=>setTimeout(resolve,delivery.delay));
    session.check();
    delete notice.undoFiling;
    let preserved;
    const messages=await delivery.finish().catch(error=>{
      if (!error.sentMessages) throw error;
      preserved=error.message;
      return error.sentMessages;
    });
    session.check();
    if (!messages) {
      if (feedback.notice===notice && !notice.busy) feedback.show("Sending undone. Message returned to Drafts.");
      return;
    }
    if (replyTo) feedback.deliveredReply={emailId:replyTo};
    recordSent(messages);
    rememberRecipients(recent,messages[0]?.accountId);
    if (feedback.notice===notice) {
      feedback.show(preserved || "Message sent");
      if (messages[0]?.emailId) feedback.notice.sentEmailId=messages[0].emailId;
    }
  } catch (error) {
    if (feedback.notice===notice) feedback.show(error.message || "Delivery has not been confirmed. Check Sent.");
  } finally {
    if (feedback.previousHolds.includes(notice) && !notice.busy) feedback.dismiss(notice);
    delivery.end();
  }
}
async function sendEmail(sendAt=null,trigger=null) {
  if (!validForSend(trigger)) return;
  const prompt = sendConfirmation(form);
  if (prompt && !window.confirm(prompt)) {
    editor.value?.focus?.();
    return;
  }
  clearTimeout(cloudSaveTimer);
  sending.value = true;
  sendError.value = "";
  try {
    await editor.value?.ready?.();
    await pendingDefault;
    // Save first so authentication/network failures cannot lose a message or its Bcc recipients.
    const saved = await persistDraft();
    if(sendAt){
      const session=draftSession();
      const result=await scheduleCloudDraft(saved.draftId,sendAt,saved.editToken);
      session.check();
      scheduledFeedback(result,sendAt,session);
      show.value=false;resetForm();emit("closed");return;
    }
    let preservedNotice = "";
    const sent = await sendCloudDraft(saved.draftId,saved.editToken,userStore.undoSeconds).catch(error => {
      if (!error.sentMessages) throw error;
      preservedNotice = error.message;
      return error.sentMessages;
    });
    const recent = recipientFields.flatMap(field => form[field]);
    if (sent.state === 'holding') {
      void followDelivery(sent,recent,form.sendType==="reply" ? form.emailId : 0,form.subject);
      show.value=false;resetForm();emit("closed");return;
    }
    recordSent(sent);
    rememberRecipients(recent,form.accountId);
    feedback.show(preservedNotice || "Message sent");
    if (sent[0]?.emailId) feedback.notice.sentEmailId=sent[0].emailId;
    show.value = false;
    resetForm();
    emit("sent", sent);
  } catch (error) {
    if(sendAt)sendError.value = (error.message || "Could not confirm the send time.")+" Check Scheduled before trying again.";
    else sendError.value = `${error.message || "Could not send your message."} Your message is kept here. Check Sent before retrying if the connection failed.`;
  } finally {
    if(form.draftId) {
      const saved=await db.value.draft.get(form.draftId).catch(()=>null);
      if(saved)Object.assign(form,{cloudDraftId:saved.cloudDraftId,cloudVersion:saved.cloudVersion,syncState:saved.syncState});
    }
    sending.value = false;
  }
}
function chooseFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = () => addFiles(Array.from(input.files), "attachments");
  input.click();
}
async function writeToContact(person) {
  if (!show.value || person.accountId!==form.accountId || userStore.user.email!==form.ownerEmail) return;
  try {
    const session=draftSession();
    const sender={accountId:form.accountId,email:form.sendEmail,name:form.name};
    await openContactWindow({owner:session.owner,sender,person},session,props.separateWindow);
  } catch(error) { sendError.value=error.message || "Could not open a new message."; }
}
function openContacts(field) {
  commitRecipients();
  contactField.value = field;
  showContacts.value = true;
}
function closeContacts(){
  showContacts.value=false;
  if(show.value && !props.dockHidden) focusRecipients(contactField.value);
}
function chooseContact(people){
  form[contactField.value]=people.map(person=>person.email);
  for(const person of people) if(person.name && person.name!==person.email) rememberPerson(person);
}
function keydown(event) {
  if (props.dockHidden || discardLocked.value) return;
  const inside=composeRoot.value?.contains(event.target);
  if(!inside && (props.inline || !props.dockActive || event.target.closest?.('.send,dialog[open],input,textarea,select,[role="dialog"],[role="menu"]'))) return;
  if (labelStore.edit || photosOpen.value || event.target.closest?.(".photo-picker")) return;
  if(managingSignatures.value || scheduling.value || event.target.closest?.(".label-dialog,.recipient-dialog,.schedule-dialog,.signature-dialog,.signature-name-dialog"))return;
  if (event.target.closest?.(".compose-format-popup") || [...document.querySelectorAll(".compose-format-popup")].some(menu=>menu.getClientRects().length)) return;
  if (show.value && !minimized.value && composeRoot.value?.contains(event.target)) composeShortcut(event);
  if (
    event.key === "Tab" &&
    modal.value &&
    !showContacts.value &&
    ![...document.querySelectorAll(".tox-dialog,.el-message-box")].some(
      (node) => node.getClientRects().length,
    )
  ) {
    const controls = [
      ...composeRoot.value.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), textarea, iframe, [tabindex="0"]',
      ),
    ].filter((node) => node.getClientRects().length);
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault();
      controls[0]?.focus();
    }
  }
  if (
    event.defaultPrevented ||
    event.key !== "Escape" ||
    !show.value ||
    showContacts.value ||
    document.querySelector(".el-message-box") ||
    document.querySelector(".tox-dialog")
  )
    return;
  event.preventDefault();
  close();
}
let previousFocus;
watch(modal,async active=>{
  const focusWriting = focusAfterResize;
  focusAfterResize=undefined;
  if (focusWriting) {
    await nextTick();
    if (mounted && show.value && !minimized.value && props.dockActive && !props.dockHidden && modal.value===active)
      focusWriting();
    return;
  }
  if(active){
    previousFocus=document.activeElement;
    const restoring = Boolean(restoreFocus);
    await nextTick();
    if(modal.value && props.dockActive && !restoring && !composeRoot.value?.contains(document.activeElement)) focusWritingField();
    return;
  }
  const origin=previousFocus;
  await nextTick();
  if(!mounted || props.dockHidden || document.querySelector('.send[aria-modal="true"]')) return;
  if(origin?.isConnected && origin.getClientRects().length && !origin.closest('[inert]') &&
      (document.activeElement===document.body || composeRoot.value?.contains(document.activeElement))) origin.focus();
});
function containFocus(event) {
  if (
    modal.value &&
    !composeRoot.value?.contains(event.target) &&
    !event.target.closest(".el-overlay, .tox-tinymce-aux, .compose-format-popup, .photo-picker")
  )
    composeRoot.value?.querySelector("button")?.focus();
}
function resize() {
  desktop.value = window.innerWidth >= 768;
}
let stopStarActions;
function starFromList(id, owner, starred) {
  if (!show.value || form.draftId!==id || form.ownerEmail!==owner) return;
  if (sending.value || preparing.value || attaching.value)
    return Promise.reject(new Error("Wait until the message is ready to change its star."));
  chooseStar(starred);
  return nextTick().then(()=>saveQueue);
}
onMounted(() => {
  if (props.separateWindow) window.addEventListener("beforeunload",warnUnsaved);
  stopStarActions=watchDraftStars(starFromList);
  window.addEventListener("keydown", keydown);
  window.addEventListener("resize", resize);
  document.addEventListener("focusin", containFocus);
});
onUnmounted(() => {
  window.removeEventListener("beforeunload",warnUnsaved);
  sourceController?.abort();
  clearFormatCaption();
  stopStarActions?.();
  mounted = false;
  clearTimeout(cloudSaveTimer);
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("resize", resize);
  document.removeEventListener("focusin", containFocus);
});
watch([()=>form.draftId,minimized,expanded,caption],([draftId,minimized,expanded,caption])=>{
  if (!props.inline) emit("dock-state",{draftId,minimized,expanded,caption});
},{flush:"sync"});
defineExpose({
  responseMode,
  focusBody: () => editor.value?.focus(),
  draftId: computed(() => form.draftId),
  scrollIntoView: () => composeRoot.value?.scrollIntoView({block:"nearest"}),
  followDelivery,
  visible:show,focusWindow,
  ownsFocus:()=>composeRoot.value?.contains(document.activeElement),
  resumeFocus:()=>minimized.value ? composeRoot.value?.querySelector(".compose-caption")?.focus() : focusWindow(),
  prepareDiscard,finishDiscard,unlockDiscard,
  discardEditor,
  open,
  openAttachedMessages({attachments, sender}) { open(null, sender, attachments); },
  openDraft,
  restoreWindow: async (state,draft) => {
    if (draft) await openDraft(draft);
    else {
      open(state.person,state.sender);
      windowContactSeed=Boolean(props.separateWindow && state.person);
    }
    if (typeof state.formatting === "boolean") showFormatting.value = state.formatting;
    if (!draft && typeof state.plainText === "boolean") form.plainText = state.plainText;
    if (!show.value) throw new Error("Could not open the composer.");
  },
  openRowResponse(message,view) { return prepareMessage(message,view.command==="forward" ? "forward" : "reply",view.command==="all",view); },
  openReply,
  openReplyAll,
  openForward,
  saveAndClose,
});
</script>
<style scoped>
.recipient-dialog {
  box-sizing: border-box;
  width: max-content;
  min-width: min(280px, calc(100% - 32px));
  max-width: min(560px, calc(100% - 32px));
  margin: auto;
  padding: 0;
  border: 0;
  border-radius: 28px;
  background: var(--mail-surface, var(--el-bg-color));
  color: var(--el-text-color-primary);
}
.recipient-dialog::backdrop { background: rgb(0 0 0 / 32%); }
.recipient-dialog h2 { margin: 0; padding: 24px 24px 16px; font-size: 24px; line-height: 32px; font-weight: 400; }
.recipient-dialog p { overflow-wrap:anywhere; margin:0; padding:0 24px 20px; color:var(--regular-text-color); font-size:14px; line-height:20px; }
.recipient-dialog form { display:flex; justify-content:flex-end; padding:4px 24px 24px; }
.recipient-dialog button {min-width:68px;height:40px;padding:0 24px;border-radius:20px;border:0;background:var(--send-blue);color:var(--send-ink);font:500 14px/20px Arial,sans-serif;cursor:pointer;}
.recipient-dialog button:hover {background:color-mix(in srgb,var(--send-blue),var(--send-ink) 8%);}
.recipient-dialog button:active {background:color-mix(in srgb,var(--send-blue),var(--send-ink) 16%);}
.compose-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 199;
}
.send {
  position: fixed;
  bottom: 0;
  right: var(--dock-right,48px);
  width: var(--dock-width,clamp(510px,39vw,590px));
  max-width: calc(100vw - 32px);
  z-index: 200;
  color: var(--el-text-color-primary);
}
.send.inline {
  position: relative;
  inset: auto;
  width: 100%;
  max-width: none;
  z-index: auto;
  margin-top: 20px;
}
.write-box {
  background: var(--mail-surface);
  box-shadow:
    0 8px 28px #0003,
    0 1px 5px #0002;
  border-radius: 8px 8px 0 0;
  overflow: hidden;
}
.compose-title {
  height: 40px;
  padding: 0 12px 0 16px;
  background: var(--mail-compose-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.compose-caption {
  font-size: 14px;
  line-height:20px;
  font-weight: 500;
  color: inherit;
  cursor: pointer;
  flex: 1;
  text-align: left;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.window-actions {
  flex: none;
  display: flex;
  gap: 4px;
}
.window-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--regular-text-color);
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
}
.window-actions button:hover {
  background: var(--base-fill);
}
.compose-container {
  display: flex;
  flex-direction: column;
  height: min(512px, calc(100dvh - 100px));
  padding: 0 16px;
}
.compose-fields {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  max-height: 40%;
  overflow: auto;
  flex-shrink: 0;
}
.recipient-summary {
  display: block;
  width: 100%;
  height: 40px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  color: var(--regular-text-color);
  border-bottom: 1px solid var(--compose-divider);
}
.from-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  font-size: 12px;
  color: var(--regular-text-color);
  border-bottom: 1px solid var(--compose-divider);
}
.from-row span:first-child {
  width: 35px;
  flex-shrink: 0;
}
.from-row span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reveal-recipient {
  cursor: pointer;
  color: var(--regular-text-color);
  font-size: 13px;
  padding: 4px;
}
.reveal-recipient:hover {
  text-decoration: underline;
}
.subject-input {
  appearance: none;
  outline: none;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 10px 0;
  font: inherit;
  min-height: 40px;
  width: 100%;
  color: inherit;
  border-bottom: 1px solid var(--compose-divider);
}
.compose-editor {
  flex: 1;
  min-height: 120px;
  padding-top: 8px;
  overflow: hidden;
}
.file-drop-hint {position:absolute;inset:8px;z-index:3;display:flex;gap:12px;align-items:center;justify-content:center;flex-direction:column;border:2px dashed var(--el-color-primary);border-radius:12px;background:color-mix(in srgb,var(--mail-surface) 94%,transparent);color:var(--el-color-primary);pointer-events:none;font-size:18px}
.editor-disabled {
  pointer-events: none;
  opacity: 0.65;
}
.compose-attachments {
  max-height: 100px;
  overflow: auto;
  padding-top: 6px;
}
.attachment-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--base-fill);
  padding: 5px 8px;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 12px;
}
.attachment-chip > span:first-of-type {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-chip button {
  cursor: pointer;
  color: inherit;
  font-size: 18px;
}
.file-size {
  color: var(--regular-text-color);
}
.compose-footer {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 64px;
  flex-shrink: 0;
}
.compose-tool {
  width: 32px;
  height: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--regular-text-color);
  cursor: pointer;
  border-radius: 50%;
}
.compose-tool:hover {
  background: var(--base-fill);
}
.signature-check { width:22px;flex:none;display:inline-flex; }
:global(.signature-menu .el-dropdown-menu) { min-width:216px;max-width:min(340px,90vw); }
:global(.signature-menu .el-dropdown-menu__item) { min-height:32px;overflow-wrap:anywhere; }
.draft-status {
  min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  flex: 1;
  color: var(--regular-text-color);
  font-size: 11px;
}
.send-error {
  color: var(--el-color-danger);
  font-size: 12px;
  max-height: 60px;
  overflow: auto;
}
.expanded {
  top: 40px;
  bottom: 29px;
  left: min(150px, calc((100vw - 600px) / 2));
  right: min(150px, calc((100vw - 600px) / 2));
  width: auto;
  max-width: none;
}
.expanded .write-box {
  height: 100%;
  border-radius: 20px;
}
.expanded .compose-container {
  height: calc(100% - 40px);
}
.minimized {
  top: auto;
  bottom: 0;
  left: auto;
  width: var(--dock-width,328px);
  right:var(--dock-right,48px);
}
.minimized .write-box {
  height: 40px;
  border-radius: 8px 8px 0 0;
}
@media (min-width: 768px) {
  .send:not(.inline):not(.expanded), .send.minimized:not(.inline) { bottom:16px; }
  .send:not(.inline):not(.expanded) .write-box, .send.minimized:not(.inline) .write-box { border-radius:20px; }
  .send:not(.inline):not(.expanded):not(.minimized) .compose-container { height:min(479px, calc(100dvh - 100px)); }
}
@media (max-width: 767px) {
  .send:not(.inline) {
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    max-width: none;
  }
  .write-box,
  .expanded .write-box {
    height: 100%;
    border-radius: 0;
  }
  .window-actions button:nth-child(2) {
    display: none;
  }
  .expanded .compose-container {
    height: calc(100dvh - 56px);
  }
  .compose-title {
    height: 56px;
  }
  .compose-container {
    height: calc(100dvh - 56px);
    padding: 0 16px;
  }
  .send.minimized:not(.inline) {
    top: auto;
    left: auto;
    right: var(--dock-right,8px);
    bottom: 0;
    width: var(--dock-width,min(328px, calc(100% - 16px)));
  }
  .minimized .write-box,
  .minimized .compose-title {
    height: 40px;
  }
}

.inline .write-box {
  border: 1px solid var(--compose-divider);
  border-radius: 16px;
  box-shadow:
    0 1px 3px #0002,
    0 2px 8px #0001;
}
.inline-reply-header {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  flex-shrink: 0;
  padding-top: 4px;
}
.inline-recipients {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--regular-text-color);
  min-width: 0;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
}
.inline-recipients > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-recipients svg {
  flex-shrink: 0;
}
.pop-reply {
  margin-inline-start:auto;
  flex-shrink: 0;
}
.inline .compose-container {
  height: auto;
  padding: 0 20px;
}
.inline .compose-fields {
  max-height: 220px;
}
.inline .compose-editor {
  flex: none;
  height: 140px;
  min-height: 140px;
  padding-top: 8px;
}
.inline .compose-editor.formatting-open {
  height: 190px;
}
.inline .compose-editor.quote-open {
  height: 260px;
}
.inline .compose-footer {
  min-height: 64px;
  gap: 3px;
}
.formatting-toggle {
  font:
    20px Arial,
    sans-serif;
  letter-spacing: -1px;
}
.formatting-toggle[aria-pressed="true"] {
  background: var(--mail-selected);
}
.quote-actions {
  min-height: 24px;
  display: flex;
  align-items: center;
}
.quote-toggle {
  border-radius: 8px;
  background: var(--mail-hover);
  color: var(--regular-text-color);
  font:
    bold 12px/12px Arial,
    sans-serif;
  letter-spacing: 1px;
  padding: 0 5px 2px;
  cursor: pointer;
}
@media (max-width: 767px) {
  .inline .write-box {
    height: auto;
    border-radius: 16px;
  }
  .inline-reply-header {
    padding-left: 16px;
    padding-right: 12px;
  }
  .inline .compose-container {
    padding: 0 16px;
  }
  .inline .draft-status {
    font-size: 10px;
  }
}
.send.separate:not(.inline):not(.expanded) {
  inset:0; margin:0 auto; width:min(100%,1202px); max-width:none;
}
.send.separate:not(.inline):not(.expanded) .write-box {
  height:100%; border-radius:0; box-shadow:none; border-inline:1px solid var(--compose-divider);
}
.send.separate .separate-title { height:36px; padding:0 4px 0 13px; }
.send.separate .compose-caption { cursor:default; }
.send.separate:not(.inline):not(.expanded):not(.minimized) .compose-container { height:calc(100% - 36px); }
</style>

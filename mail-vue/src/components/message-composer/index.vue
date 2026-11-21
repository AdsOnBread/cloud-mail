<template>
  <div v-if="modal" class="compose-backdrop" aria-hidden="true" />
  <section
    @keydown="keydown"
    ref="composeRoot"
    v-show="show"
    class="send"
    :class="{ expanded, minimized, inline: inline }"
    :role="modal ? 'dialog' : undefined"
    :aria-modal="modal || undefined"
    aria-label="Compose message"
  >
    <div class="write-box" :aria-busy="sending || preparing" :inert="preparing || undefined">
      <div v-if="inline" class="inline-reply-header">
        <button
          type="button"
          class="inline-recipients"
          aria-label="Edit reply recipients"
          :aria-expanded="editingRecipients"
          :data-tip="replyRecipientTitle"
          :disabled="sending || attaching"
          @click="editReplyRecipients"
        >
          <Icon icon="material-symbols:reply" width="22" />
          <Icon
            :icon="
              editingRecipients
                ? 'material-symbols:expand-less'
                : 'material-symbols:arrow-drop-down'
            "
            width="18"
          />
          <span>{{ replyRecipientSummary }}</span>
        </button>
        <button
          type="button"
          class="compose-tool inline-close"
          aria-label="Close and save draft"
          data-tip="Save and close reply"
          :disabled="sending || attaching"
          @click="close"
        >
          <Icon icon="material-symbols:close" width="18" />
        </button>
      </div>
      <div v-else class="compose-title">
        <button
          type="button"
          class="compose-caption"
          @click="minimized = false"
        >
          {{
            form.sendType === "reply"
              ? "Reply"
              : form.sendType === "forward"
                ? "Forward"
                : "New Message"
          }}
        </button>
        <div class="window-actions">
          <button
            v-if="!inline"
            type="button"
            :aria-label="minimized ? 'Restore compose' : 'Minimize compose'"
            :data-tip="minimized ? 'Restore' : 'Minimize'"
            @click="minimized = !minimized"
          >
            <Icon icon="material-symbols:remove" width="18" />
          </button>
          <button
            v-if="!inline"
            type="button"
            :aria-label="expanded ? 'Exit full screen' : 'Expand compose'"
            :data-tip="expanded ? 'Exit full screen' : 'Full screen'"
            @click="
              expanded = !expanded;
              minimized = false;
            "
          >
            <Icon
              :icon="
                expanded
                  ? 'material-symbols:close-fullscreen'
                  : 'material-symbols:open-in-full'
              "
              width="16"
            />
          </button>
          <button
            type="button"
            aria-label="Close and save draft"
            data-tip="Close"
            :disabled="sending || attaching"
            @click="close"
          >
            <Icon icon="material-symbols:close" width="18" />
          </button>
        </div>
      </div>
      <div v-show="!minimized" class="compose-container">
        <fieldset
          v-show="!inline || editingRecipients"
          :disabled="sending || attaching"
          class="compose-fields"
        >
          <div v-if="!inline" class="from-row">
            <span>From</span
            ><span :title="form.sendEmail"
              >{{ form.name }} &lt;{{ form.sendEmail }}&gt;</span
            >
          </div>
          <RecipientField
            ref="toField"
            v-model="form.receiveEmail"
            label="To"
            :contacts="writerStore.sendRecipientRecord"
            :error="recipientErrors.receiveEmail"
            @contacts="openContacts('receiveEmail')"
          >
            <button
              v-if="!showCc"
              type="button"
              class="reveal-recipient"
              @click="
                showCc = true;
                nextTick(() => ccField?.focus());
              "
            >
              Cc
            </button>
            <button
              v-if="!showBcc"
              type="button"
              class="reveal-recipient"
              @click="
                showBcc = true;
                nextTick(() => bccField?.focus());
              "
            >
              Bcc
            </button>
          </RecipientField>
          <RecipientField
            v-if="showCc"
            ref="ccField"
            v-model="form.cc"
            label="Cc"
            :contacts="writerStore.sendRecipientRecord"
            :error="recipientErrors.cc"
            @contacts="openContacts('cc')"
          />
          <RecipientField
            v-if="showBcc"
            ref="bccField"
            v-model="form.bcc"
            label="Bcc"
            :contacts="writerStore.sendRecipientRecord"
            :error="recipientErrors.bcc"
            @contacts="openContacts('bcc')"
          />
          <input
            v-if="!inline"
            v-model="form.subject"
            class="subject-input"
            aria-label="Subject"
            placeholder="Subject"
            maxlength="998"
          />
        </fieldset>
        <div
          class="compose-editor" :inert="sending"
          :class="{
            'editor-disabled': sending,
            'formatting-open': inline && !form.plainText && showFormatting,
            'quote-open': inline && quoteExpanded,
          }"
        >
          <tinyEditor
            :key="form.plainText ? 'plain' : 'rich'"
            :plain-text="form.plainText"
            :def-value="defValue"
            mail-compose
            :show-toolbar="!form.plainText && showFormatting"
            :collapse-quote="inline"
            :show-quote="quoteExpanded"
            ref="editor"
            @change="change"
          />
        </div>
        <div v-if="inline && hasQuotedContent" class="quote-actions">
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
        <div v-if="form.attachments.length" class="compose-attachments">
          <div
            v-for="(file, index) in form.attachments"
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
              @click="form.attachments.splice(index, 1)"
            >
              ×
            </button>
          </div>
        </div>
        <p v-if="sendError" class="send-error" role="alert">{{ sendError }}</p>
        <div class="compose-footer">
          <div class="split-send">
          <el-button
            type="primary"
            round
            :loading="sending || attaching"
            @click="sendEmail()"
            >{{ sending ? "Sending…" : "Send" }}</el-button
          >
          <el-dropdown trigger="click" placement="top-start" :show-arrow="false" popper-class="mail-action-menu compose-format-popup">
            <button class="send-options" aria-label="More send options" data-tip="More send options" :disabled="sending || attaching"><Icon icon="material-symbols:arrow-drop-down" width="18"/></button>
            <template #dropdown><el-dropdown-menu><el-dropdown-item @click="validForSend() && schedulePicker.open(composeRoot.querySelector('.send-options'))"><Icon icon="material-symbols:schedule-send-outline" width="18"/>Schedule send</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown></div>
          <button
            type="button"
            v-if="!form.plainText"
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
          <button v-if="!form.plainText" type="button" class="compose-tool" data-compose-link data-tip="Insert link (⌘/Ctrl+K)" aria-label="Insert link" :disabled="sending" @mousedown.prevent @click="editor?.openLink()">
            <Icon icon="material-symbols:link" width="20" />
          </button>
          <button type="button" class="compose-tool" data-tip="Insert emoji" aria-label="Insert emoji" :disabled="sending" @mousedown.prevent @click="editor?.openEmoji()">
            <Icon icon="material-symbols:mood-outline" width="20" />
          </button>
          <button v-if="!form.plainText" type="button" class="compose-tool" data-tip="Insert photo" aria-label="Insert photo" :disabled="sending || attaching" @mousedown.prevent @click="photoInput?.click()">
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
          <el-dropdown trigger="click" placement="top-end" :show-arrow="false" popper-class="mail-action-menu compose-format-popup compose-more-menu" @command="moreCommand">
            <button type="button" class="compose-tool" aria-label="More options" data-tip="More options" :disabled="sending || preparing || attaching">
              <Icon icon="material-symbols:more-vert" width="20"/>
            </button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item command="fullscreen" role="menuitemcheckbox" :aria-checked="Boolean(composeMode.fullScreen)">
                <span class="signature-check"><Icon v-if="composeMode.fullScreen" icon="material-symbols:check" width="18"/></span>Default to full screen
              </el-dropdown-item>
              <el-dropdown-item command="plain" role="menuitemcheckbox" :aria-checked="form.plainText">
                <span class="signature-check"><Icon v-if="form.plainText" icon="material-symbols:check" width="18"/></span>Plain text mode
              </el-dropdown-item>
              <el-dropdown-item command="print" divided><span class="signature-check"></span>Print</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <input ref="photoInput" type="file" :accept="photoTypes.join(',')" hidden @change="insertPhoto" />
          <span class="draft-status">{{
            form.draftId ? ({saving:"Saving…",saved:"Saved",offline:"Saved on this device · Offline",conflict:"Both versions saved",uncertain:"Delivery uncertain"}[form.syncState] || "Saved to Drafts") : ""
          }}</span>
          <button
            type="button"
            class="compose-tool"
            data-tip="Discard draft"
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
    <SchedulePicker ref="schedulePicker" v-model="scheduling" @schedule="sendEmail"/>
    <el-dialog
      v-model="showContacts"
      append-to-body
      title="Recent contacts"
      width="min(480px, calc(100% - 32px))"
      @closed="contactsTabRef?.clearSelection()"
    >
      <p class="contact-target">
        Add to
        {{
          contactField === "receiveEmail"
            ? "To"
            : contactField === "cc"
              ? "Cc"
              : "Bcc"
        }}
      </p>
      <el-table
        ref="contactsTabRef"
        row-key="email"
        :data="contacts"
        max-height="360"
      >
        <el-table-column type="selection" width="40" /><el-table-column
          property="email"
          label="Email address"
        />
      </el-table>
      <template #footer
        ><el-button @click="deleteContact">Remove selected contacts</el-button
        ><el-button type="primary" @click="chooseContact"
          >Select contacts</el-button
        ></template
      >
    </el-dialog>
  </section>
</template>
<script setup>
import { draftSession, discardDrafts, saveLocalDraft, removeLocalDraft, syncCloudDrafts, sendCloudDraft, scheduleCloudDraft } from "@/services/cloud-drafts";
import {useUiStore} from "@/store/ui";
import { inlineDataHTML } from "@/utils/private-files";
import SignatureManager from "@/components/mail-signatures/manager.vue";
import {useMailSignatures} from "@/store/mail-signatures";
import {plainMarkup,richMarkup} from "./plain-text";
import {printDraft} from "./print-draft";
import SchedulePicker from "./schedule.vue";
import {useMailFeedback} from "@/store/mail-feedback";
import tinyEditor from "@/components/tiny-editor/index.vue";
import RecipientField from "@/components/recipient-field/index.vue";
import {
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  toRaw,
  computed,
  watch,
} from "vue";
import { Icon } from "@iconify/vue";
import { useUserStore } from "@/store/user.js";
import { useAccountStore } from "@/store/account.js";
import { useEmailStore } from "@/store/email.js";
import { fileToBase64, formatBytes } from "@/utils/file-utils.js";
import { getIconByName } from "@/utils/icon-utils.js";
import { formatDetailDate } from "@/utils/day.js";
import { userDraftStore } from "@/store/draft.js";
import { useWriterStore } from "@/store/writer.js";
import { hasPerm } from "@/perm/perm.js";
import {
  addresses,
  normalizeRecipients,
  restoreDraft,
  hasDraftContent,
  draftFingerprint,
  replyAllRecipients,
  recipientFields,
} from "@/utils/recipients.js";
import db from "@/db/db.js";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox, ElNotification } from "element-plus";

const props = defineProps({ inline: Boolean });
const emit = defineEmits(["sent", "closed"]);
const composeRoot = ref();
const desktop = ref(window.innerWidth >= 768);
const modal = computed(
  () =>
    show.value &&
    expanded.value &&
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
const photoInput = ref(), schedulePicker=ref(), scheduling=ref(false);
const feedback=useMailFeedback();
const photoTypes = ["image/png","image/jpeg","image/gif","image/webp","image/heic","image/avif"];
async function insertPhoto(event) {
  const input = event.target, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  attaching.value = true;
  try {
    if (!photoTypes.includes(file.type)) throw new Error("Choose a PNG, JPEG, GIF, WebP, HEIC or AVIF image.");
    if (file.size === 0) throw new Error("This photo is empty.");
    const content = editor.value?.getContent?.() ?? form.content ?? "";
    const images = new DOMParser().parseFromString(content,"text/html").images;
    if ([...images].filter(img=>/^(data:image|cid:)/.test(img.getAttribute("src") || "")).length >= 10)
      throw new Error("A message can contain up to 10 inline photos.");
    const bytes = new TextEncoder().encode(JSON.stringify({...form,attachments:[]})).length;
    const files = form.attachments.reduce((sum,attachment)=>sum+(Number(attachment.size)||0),0);
    if (bytes + files + 4*Math.ceil(file.size/3) + 256 > 5*1024*1024)
      throw new Error("This photo would exceed the 5 MiB message limit.");
    const data = await fileToBase64(file, true);
    await editor.value?.ready();
    editor.value?.insertPhoto(data, file.name);
  } catch (e) { sendError.value = e.message || "Could not insert the photo."; }
  finally { attaching.value = false; }
}
const toField = ref();
const ccField = ref();
const bccField = ref();
const show = ref(false);
const editingRecipients = ref(false);
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
  const name = form.replyRecipientNames?.[address.toLowerCase()];
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
const recipientErrors = ref({});
const defValue = ref("");
const showContacts = ref(false);
const contactsTabRef = ref();
const contactField = ref("receiveEmail");
const contacts = computed(() =>
  writerStore.sendRecipientRecord.map((email) => ({ email })),
);
let baseline = "";
let restoredUntouched = false;
const preparing = ref(false);
const emptyForm = () => ({
  sendEmail: "",
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
function resetForm() {
  signatureGeneration++;pendingDefault=Promise.resolve();automaticBaseline="";menuItems.value=[];
  selectedSignature.value="";signatureError.value="";managingSignatures.value=false;
  Object.keys(form).forEach((key) => delete form[key]);
  Object.assign(form, emptyForm());
  [toField, ccField, bccField].forEach((field) => field.value?.clear());
  editingRecipients.value = false;
  quoteExpanded.value = false;
  recipientErrors.value = {};
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
    minimized.value = false;
    ElMessage.info(
      "Your current message is open. Save or discard it before starting another.",
    );
    return false;
  }
  return true;
}
function setSender() {
  const account = accountStore.currentAccount?.email
    ? accountStore.currentAccount
    : userStore.user.account;
  form.plainText = Boolean(composeMode.value.plainText);
  form.ownerEmail=userStore.user.email;
  form.sendEmail = account.email;
  form.accountId = account.accountId;
  form.name = account.name || userStore.user.name || "";
}
function reveal() {
  expanded.value = desktop.value && !props.inline && Boolean(composeMode.value.fullScreen);
  showCc.value = form.cc.length > 0;
  showBcc.value = form.bcc.length > 0;
  show.value = true;
  minimized.value = false;
  nextTick(() => {
    if (!props.inline) toField.value?.focus();
  });
}
function open() {
  if (show.value) {
    minimized.value = false;
    return;
  }
  if (preparing.value) return;
  resetForm();
  setSender();
  reveal();
  startSignatureDefault();
}
async function openDraft(draft) {
  if (!available()) return;
  preparing.value = true;
  try {
    resetForm();
    Object.assign(form, restoreDraft(draft));
    if(draft.schedulingError)sendError.value="Scheduling failed. "+draft.schedulingError;
    form.ownerEmail = userStore.user.email;
    if (!form.sendEmail) {
      const account = [...accountStore.accounts, accountStore.currentAccount, userStore.user.account]
        .find(account => account?.accountId === form.accountId);
      form.sendEmail = account?.email || "";
    }
    if (!form.content && form.text)
      form.content = escapeHTML(form.text).replace(/\r\n?|\n/g, "<br>");
    if (props.inline && form.sendType === "reply")
      form.content = foldLegacyReplyQuote(form.content || "");
    defValue.value = form.content || "";
    reveal();
    await nextTick();
    await editor.value?.ready?.();
    baseline = draftFingerprint(form);
    restoredUntouched = Boolean(draft.cloudDraftId);
  } finally {
    preparing.value = false;
  }
  await nextTick();
  if (props.inline) editor.value?.focus?.(true);
  else toField.value?.focus();
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
async function prepareMessage(message, mode, all = false) {
  if (!available()) return;
  preparing.value = true;
  try {
    const email = await emailStore.ensureDetail(message);
    if (hasPerm("account:query")) await accountStore.loadAll();
    const html =
      (await inlineDataHTML(email.content)) ||
      `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHTML(email.text)}</pre>`;
    resetForm();
    setSender();
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
    form.subject =
      mode === "reply" && !/^re:/i.test(email.subject || "")
        ? `Re: ${email.subject || ""}`
        : email.subject || "";
    form.sendType = mode;
    form.emailId = mode === "reply" ? email.emailId : 0;
    if (mode === "reply") {
      Object.assign(
        form,
        all
          ? replyAllRecipients(email, accountStore.ownAddresses)
          : {
              receiveEmail:
                email.type === 1
                  ? addresses(email.recipient)
                  : [email.sendEmail].filter(Boolean),
              cc: [],
              bcc: [],
            },
      );
      const quote = `<div>${escapeHTML(formatDetailDate(email.createTime))} ${escapeHTML(email.name)} &lt;${escapeHTML(email.sendEmail)}&gt; wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${html}</blockquote>`;
      form.content = `<div><br></div><div class="cloudmail-reply-quote">${quote}</div>`;
      if (props.inline) {
        form.replyRecipientNames = {};
        for (const list of [email.recipient, email.cc]) {
          try {
            for (const recipient of typeof list === "string"
              ? JSON.parse(list || "[]")
              : list || []) {
              if (recipient.address && recipient.name)
                form.replyRecipientNames[recipient.address.toLowerCase()] =
                  recipient.name;
            }
          } catch {
            /* Legacy messages may not have structured recipient names. */
          }
        }
        if (email.sendEmail && email.name)
          form.replyRecipientNames[email.sendEmail.toLowerCase()] = email.name;
      }
    } else form.content = `<div><br></div><div class="cloudmail-reply-quote">${html}</div>`;
    if (form.plainText) Object.assign(form, plainMarkup(form.content));
    defValue.value = form.content;
    reveal();
    await nextTick();
    await editor.value?.ready?.();
    // TinyMCE normalizes HTML; compare against its actual representation after loading.
    baseline = draftFingerprint(form);
    startSignatureDefault();
  } catch (error) {
    ElMessage.error(
      error.message || "Could not load the message. Please try again.",
    );
  } finally {
    preparing.value = false;
  }
  await nextTick();
  if (props.inline) editor.value?.focus?.(true);
  else toField.value?.focus();
}
function openReply(email) {
  return prepareMessage(email, "reply");
}
function openReplyAll(email) {
  return prepareMessage(email, "reply", true);
}
function openForward(email) {
  return prepareMessage(email, "forward");
}
async function moreCommand(command) {
  const owner = userStore.user.email;
  const generation = signatureGeneration;
  const current = () => show.value && !sending.value && owner === userStore.user.email && generation === signatureGeneration;
  if (!current()) return;
  if (command === "fullscreen") {
    const fullScreen = !composeMode.value.fullScreen;
    uiPreferences.composeModes[owner] = {...composeMode.value, fullScreen};
    if (desktop.value && !props.inline) expanded.value = fullScreen;
    return;
  }
  await pendingDefault;
  await editor.value?.ready();
  if (!current()) return;
  if (command === "print") {
    commitRecipients();
    printDraft({...form, content:editor.value.getContent()});
    return;
  }
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
  uiPreferences.composeModes[owner] = {...composeMode.value, plainText};
  await nextTick();
  await editor.value?.ready();
  if (current()) editor.value?.focus();
}
function change(content, text) {
  form.content = content;
  form.text = text;
}
function snapshot() {
  return restoreDraft(toRaw(form));
}
let saveQueue=Promise.resolve();
function persistDraft(options) {
  const operation=saveQueue.catch(()=>{}).then(() => persistDraftNow(options));
  saveQueue=operation;return operation;
}
async function persistDraftNow(options) {
  const draft = snapshot();
  const { attachments, draftId, ...data } = draft;
  if (props.inline && form.sendType === "reply") data.inlineReply = true;
  data.createTime =
    draft.createTime || dayjs().utc().format("YYYY-MM-DD HH:mm:ss");
  const saved=await saveLocalDraft({...data,draftId,attachments}, options);
  Object.assign(form,{draftId:saved.draftId, editToken:saved.editToken, clientId:saved.clientId, cloudDraftId:saved.cloudDraftId, cloudVersion:saved.cloudVersion, syncState:saved.syncState});
  return saved;
}
async function removeSavedDraft() {
  if(form.draftId)await removeLocalDraft(form.draftId);
}
let cloudSaveTimer;
watch(()=>JSON.stringify([draftFingerprint(form),form.accountId,form.name,form.sendType,form.emailId]),()=>{
  if(preparing.value||sending.value||!show.value||!hasDraftContent(form))return;
  if (draftFingerprint(form)===automaticBaseline || (restoredUntouched && draftFingerprint(form) === baseline)) return;
  restoredUntouched = false;
  clearTimeout(cloudSaveTimer);
  const localSave=persistDraft().catch(()=>{form.syncState="offline";});
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
},{deep:true});

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
async function discardEditor(selected, session = draftSession()) {
  if (selected && (!show.value || !selected.includes(form.draftId))) return false;
  if (!show.value || preparing.value || sending.value || attaching.value)
    throw new Error("Finish the current action before discarding.");
  session.check();
  preparing.value = true;
  try {
    clearTimeout(cloudSaveTimer);
    await editor.value?.ready?.();
    commitRecipients();
    await pendingDefault;
    await saveQueue.catch(() => {});
    session.check();
    const changed = draftFingerprint(form) !== baseline && draftFingerprint(form) !== automaticBaseline;
    if ((form.draftId && (!restoredUntouched || changed)) || (!form.draftId && changed && hasDraftContent(form))) await persistDraft({requireCurrent:true, session});
    if (form.draftId) {
      const recovery = await discardDrafts(selected || [form.draftId], {draftId:form.draftId, editToken:form.editToken, cloudVersion:form.cloudVersion, localRevision:form.localRevision}, session);
      feedback.dismissedDrafts(recovery, selected ? undefined : async ([id]) => {
        if (!mounted || props.inline || show.value || preparing.value) return;
        const {readSavedDraft} = await import("@/services/draft-list");
        session.check();
        const draft = await readSavedDraft(id);
        session.check();
        if (mounted && !show.value && !preparing.value) await openDraft(draft);
      });
    }
    show.value = false;
    resetForm();
    emit("closed");
    return true;
  } finally {
    preparing.value = false;
  }
}
function validForSend() {
  if (sending.value || attaching.value) return false;
  commitRecipients();
  const recipients = normalizeRecipients(form);
  recipientErrors.value = recipients.errors;
  if (!recipients.receiveEmail.length)
    recipientErrors.value.receiveEmail = "Enter at least one To recipient.";
  if (Object.keys(recipientErrors.value).length) {
    if (props.inline) {
      editingRecipients.value = true;
      nextTick(() => toField.value?.focus());
    }
    return false;
  }
  recipientFields.forEach((field) => {
    form[field] = recipients[field];
  });
  if (!form.subject.trim()) {
    sendError.value = "Enter a subject.";
    return false;
  }
  if (!(form.plainText ? form.text : form.content).trim()) {
    sendError.value = "Enter a message body.";
    return false;
  }
  return true;
}
async function sendEmail(sendAt=null) {
  if(!validForSend())return;
  clearTimeout(cloudSaveTimer);
  sending.value = true;
  sendError.value = "";
  try {
    await editor.value?.ready?.();
    await pendingDefault;
    // Save first so authentication/network failures cannot lose a message or its Bcc recipients.
    await persistDraft();
    if(sendAt){
      const result=await scheduleCloudDraft(form.draftId,sendAt);
      feedback.show(result.pending?"Awaiting scheduling confirmation. Check Scheduled or Drafts when connected.":"Send scheduled for "+new Date(sendAt*1000).toLocaleString()+".");
      show.value=false;resetForm();emit("closed");return;
    }
    const sent = await sendCloudDraft(form.draftId);
    sent.forEach((message) => emailStore.sendScroll?.addItem?.(message));
    emailStore.conversationRevision++;
    const recent = recipientFields.flatMap((field) => form[field]);
    writerStore.sendRecipientRecord = [
      ...new Set([...recent, ...writerStore.sendRecipientRecord]),
    ].slice(0, 500);
    try {
      await removeSavedDraft();
    } catch {
      ElNotification.warning({
        title: "Message sent",
        message:
          "Could not remove the saved draft. Check Sent before sending it again.",
      });
    }
    userStore.refreshUserInfo();
    ElNotification.success({
      title: "Message sent",
      message: form.subject,
      position: "bottom-right",
    });
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
  input.onchange = async (event) => {
    attaching.value = true;
    try {
      for (const file of event.target.files) {
        if (form.attachments.length >= 10)
          throw new Error("A message can have at most 10 attachments.");
        if (file.size > 4 * 1024 * 1024)
          throw new Error(
            "This file is too large. The complete message must fit the 5 MiB sending limit.",
          );
        const content = await fileToBase64(file);
        form.attachments.push({
          content,
          filename: file.name,
          size: file.size,
          contentType: file.type,
        });
      }
    } catch (error) {
      ElMessage.error(error.message);
    } finally {
      attaching.value = false;
    }
  };
  input.click();
}
function openContacts(field) {
  commitRecipients();
  contactField.value = field;
  showContacts.value = true;
  nextTick(() => {
    contactsTabRef.value?.clearSelection();
    contacts.value
      .filter((contact) => form[field].includes(contact.email))
      .forEach((contact) =>
        contactsTabRef.value.toggleRowSelection(contact, true),
      );
  });
}
function chooseContact() {
  const selected = contactsTabRef.value
    .getSelectionRows()
    .map((contact) => contact.email);
  form[contactField.value] = [
    ...new Set([
      ...form[contactField.value].filter(
        (email) => !writerStore.sendRecipientRecord.includes(email),
      ),
      ...selected,
    ]),
  ];
  showContacts.value = false;
}
async function deleteContact() {
  try {
    await ElMessageBox.confirm(
      "Remove the selected addresses from recent contacts?",
      { confirmButtonText: "Remove", cancelButtonText: "Cancel" },
    );
    const selected = contactsTabRef.value
      .getSelectionRows()
      .map((contact) => contact.email);
    writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(
      (email) => !selected.includes(email),
    );
  } catch {}
}
function keydown(event) {
  if(managingSignatures.value || scheduling.value || event.target.closest?.(".schedule-dialog,.signature-dialog,.signature-name-dialog"))return;
  if (event.target.closest?.(".compose-format-popup") || [...document.querySelectorAll(".compose-format-popup")].some(menu=>menu.getClientRects().length)) return;
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
let blocked = [];
function releaseModal() {
  blocked.forEach(([node, value]) => {
    node.inert = value;
  });
  blocked = [];
}
watch(modal, async (active) => {
  releaseModal();
  if (active) {
    previousFocus = document.activeElement;
    document
      .querySelectorAll(
        ".mail-layout > .mail-header, .mail-layout > .mail-sidebar, .mail-layout > .mail-main, .mobile-compose, .nav-overlay",
      )
      .forEach((node) => {
        blocked.push([node, node.inert]);
        node.inert = true;
      });
    await nextTick();
    composeRoot.value?.querySelector("button")?.focus();
  } else previousFocus?.isConnected && previousFocus.focus();
});
function containFocus(event) {
  if (
    modal.value &&
    !composeRoot.value?.contains(event.target) &&
    !event.target.closest(".el-overlay, .tox-tinymce-aux, .compose-format-popup")
  )
    composeRoot.value?.querySelector("button")?.focus();
}
function resize() {
  desktop.value = window.innerWidth >= 768;
}
onMounted(() => {
  window.addEventListener("keydown", keydown);
  window.addEventListener("resize", resize);
  document.addEventListener("focusin", containFocus);
});
onUnmounted(() => {
  mounted = false;
  clearTimeout(cloudSaveTimer);
  releaseModal();
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("resize", resize);
  document.removeEventListener("focusin", containFocus);
});
defineExpose({
  discardEditor,
  open,
  openDraft,
  openReply,
  openReplyAll,
  openForward,
  saveAndClose,
});
</script>
<style scoped>
.compose-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 199;
}
.send {
  position: fixed;
  bottom: 0;
  right: 48px;
  width: clamp(510px,39vw,590px);
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
  font-weight: 600;
  color: inherit;
  cursor: pointer;
  flex: 1;
  text-align: left;
}
.window-actions {
  display: flex;
  gap: 2px;
}
.window-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--regular-text-color);
  width: 24px;
  height: 28px;
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
  min-height: 68px;
  flex-shrink: 0;
}
.compose-footer .el-button {
  height: 36px;
  min-width: 76px;
  font-weight: 600;
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
:global(.compose-more-menu .el-dropdown-menu) { min-width:228px; padding:8px 0; }
:global(.compose-more-menu .el-dropdown-menu__item) { min-height:32px; font-size:14px; line-height:20px; }
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
.contact-target {
  margin-bottom: 12px;
  color: var(--regular-text-color);
}
.expanded {
  top: 5vh;
  bottom: 5vh;
  left: 10vw;
  right: 10vw;
  width: auto;
  max-width: none;
}
.expanded .write-box {
  height: 100%;
  border-radius: 8px;
}
.expanded .compose-container {
  height: calc(100% - 40px);
}
.minimized {
  top: auto;
  bottom: 0;
  left: auto;
  width: 300px;
}
.minimized .write-box {
  height: 40px;
  border-radius: 8px 8px 0 0;
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
  .minimized {
    top: auto;
    left: auto;
    right: 8px;
    bottom: 0;
    width: 280px;
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
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 8px 16px 0 20px;
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
.inline-close {
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
.inline .compose-footer .el-button {
  height: 40px;
  min-width: 76px;
  font-weight: 500;
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
</style>

<style scoped>
.split-send{display:inline-flex;align-items:stretch;flex-shrink:0}.split-send :deep(.el-button){border-radius:24px 0 0 24px;margin:0}.split-send :deep(.el-dropdown){display:flex}.send-options{height:100%;min-width:29px;background:var(--el-color-primary);color:var(--mail-surface);border-left:1px solid #ffffff70;border-radius:0 24px 24px 0;display:grid;place-items:center;cursor:pointer}.send-options:hover{background:var(--el-color-primary-dark-2)}
</style>

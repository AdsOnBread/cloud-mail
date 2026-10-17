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
    <div class="write-box" :aria-busy="sending">
      <div class="compose-title">
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
            :title="minimized ? 'Restore' : 'Minimize'"
            @click="minimized = !minimized"
          >
            <Icon icon="material-symbols:remove" width="18" />
          </button>
          <button
            v-if="!inline"
            type="button"
            :aria-label="expanded ? 'Exit full screen' : 'Expand compose'"
            :title="expanded ? 'Exit full screen' : 'Full screen'"
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
            title="Close"
            :disabled="sending || attaching"
            @click="close"
          >
            <Icon icon="material-symbols:close" width="18" />
          </button>
        </div>
      </div>
      <div v-show="!minimized" class="compose-container">
        <fieldset :disabled="sending || attaching" class="compose-fields">
          <div class="from-row">
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
            v-model="form.subject"
            class="subject-input"
            aria-label="Subject"
            placeholder="Subject"
            maxlength="998"
          />
        </fieldset>
        <div class="compose-editor" :class="{ 'editor-disabled': sending }">
          <tinyEditor :def-value="defValue" ref="editor" @change="change" />
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
          <el-button
            type="primary"
            round
            :loading="sending || attaching"
            @click="sendEmail"
            >{{ sending ? "Sending…" : "Send" }}</el-button
          >
          <button
            type="button"
            class="compose-tool"
            title="Attach files"
            aria-label="Attach files"
            :disabled="sending || attaching"
            @click="chooseFile"
          >
            <Icon icon="material-symbols:attach-file" width="22" />
          </button>
          <span class="draft-status">{{
            form.draftId ? "Saved to Drafts" : ""
          }}</span>
          <button
            type="button"
            class="compose-tool"
            title="Discard draft"
            aria-label="Discard draft"
            :disabled="sending || attaching"
            @click="discard"
          >
            <Icon icon="material-symbols:delete-outline" width="22" />
          </button>
        </div>
      </div>
    </div>
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
import { inlineDataHTML } from "@/utils/private-files";
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
import { emailSend } from "@/request/email.js";
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
const toField = ref();
const ccField = ref();
const bccField = ref();
const show = ref(false);
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
let preparing = false;
const emptyForm = () => ({
  sendEmail: "",
  receiveEmail: [],
  cc: [],
  bcc: [],
  accountId: -1,
  name: "",
  subject: "",
  content: "",
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
function resetForm() {
  Object.keys(form).forEach((key) => delete form[key]);
  Object.assign(form, emptyForm());
  [toField, ccField, bccField].forEach((field) => field.value?.clear());
  recipientErrors.value = {};
  sendError.value = "";
  showCc.value = false;
  showBcc.value = false;
  defValue.value = "";
  baseline = "";
  minimized.value = false;
  expanded.value = false;
  editor.value?.clearEditor();
}
function available() {
  if (show.value || preparing) {
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
  form.sendEmail = account.email;
  form.accountId = account.accountId;
  form.name = account.name || userStore.user.name || "";
}
function reveal() {
  showCc.value = form.cc.length > 0;
  showBcc.value = form.bcc.length > 0;
  show.value = true;
  minimized.value = false;
  nextTick(() => toField.value?.focus());
}
function open() {
  if (show.value) {
    minimized.value = false;
    return;
  }
  if (preparing) return;
  resetForm();
  setSender();
  reveal();
}
function openDraft(draft) {
  if (!available()) return;
  resetForm();
  Object.assign(form, restoreDraft(draft));
  defValue.value = form.content || "";
  reveal();
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
  preparing = true;
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
      form.content = `<div><br></div><div>${escapeHTML(formatDetailDate(email.createTime))} ${escapeHTML(email.name)} &lt;${escapeHTML(email.sendEmail)}&gt; wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${html}</blockquote>`;
    } else form.content = html;
    defValue.value = form.content;
    reveal();
    await nextTick();
    await editor.value?.ready?.();
    // TinyMCE normalizes HTML; compare against its actual representation after loading.
    baseline = draftFingerprint(form);
  } catch (error) {
    ElMessage.error(
      error.message || "Could not load the message. Please try again.",
    );
  } finally {
    preparing = false;
  }
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
function change(content, text) {
  form.content = content;
  form.text = text;
}
function snapshot() {
  return restoreDraft(toRaw(form));
}
async function persistDraft() {
  const draft = snapshot();
  const { attachments, draftId, ...data } = draft;
  if (props.inline && form.sendType === "reply") data.inlineReply = true;
  data.createTime =
    draft.createTime || dayjs().utc().format("YYYY-MM-DD HH:mm:ss");
  await db.value.transaction("rw", db.value.draft, db.value.att, async () => {
    if (draftId) await db.value.draft.put({ ...data, draftId });
    else form.draftId = await db.value.draft.add(data);
    await db.value.att.put({ draftId: form.draftId, attachments });
  });
  draftStore.refreshList++;
}
async function removeSavedDraft() {
  if (!form.draftId) return;
  await db.value.transaction("rw", db.value.draft, db.value.att, async () => {
    await db.value.draft.delete(form.draftId);
    await db.value.att.delete(form.draftId);
  });
  draftStore.refreshList++;
}
async function saveAndClose() {
  if (sending.value || attaching.value || preparing) return false;
  if (!show.value) return true;
  try {
    await editor.value?.ready?.();
    commitRecipients();
    if (
      hasDraftContent(form) &&
      (!baseline || draftFingerprint(form) !== baseline || form.draftId)
    )
      await persistDraft();
    else await removeSavedDraft();
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
  if (props.inline) return saveAndClose();
  if (!show.value || sending.value || attaching.value || showContacts.value)
    return;
  try {
    await editor.value?.ready?.();
  } catch {
    sendError.value =
      "Could not finish loading the editor. Your draft is still open.";
    return;
  }
  commitRecipients();
  if (!hasDraftContent(form)) {
    try {
      await removeSavedDraft();
      show.value = false;
      resetForm();
    } catch {
      ElMessage.error(
        "Could not remove the empty saved draft. Please try again.",
      );
    }
    return;
  }
  if (!form.draftId && baseline && draftFingerprint(form) === baseline) {
    show.value = false;
    resetForm();
    return;
  }
  try {
    if (!form.draftId) {
      try {
        await ElMessageBox.confirm("Save this message to Drafts?", {
          confirmButtonText: "Save draft",
          cancelButtonText: "Discard",
          distinguishCancelAndClose: true,
        });
      } catch (action) {
        if (action === "cancel") {
          show.value = false;
          resetForm();
        }
        return;
      }
    }
    await persistDraft();
    show.value = false;
    resetForm();
  } catch {
    ElMessage.error("Could not save your draft. Your message is still open.");
  }
}
async function discard() {
  try {
    await ElMessageBox.confirm("Discard this message?", {
      confirmButtonText: "Discard",
      cancelButtonText: "Keep editing",
      type: "warning",
    });
    await editor.value?.ready?.();
    await removeSavedDraft();
    show.value = false;
    resetForm();
    emit("closed");
  } catch (error) {
    if (error instanceof Error)
      ElMessage.error("Could not discard the saved draft. Please try again.");
  }
}
async function sendEmail() {
  if (sending.value || attaching.value) return;
  commitRecipients();
  const recipients = normalizeRecipients(form);
  recipientErrors.value = recipients.errors;
  if (!recipients.receiveEmail.length)
    recipientErrors.value.receiveEmail = "Enter at least one To recipient.";
  if (Object.keys(recipientErrors.value).length) return;
  recipientFields.forEach((field) => {
    form[field] = recipients[field];
  });
  if (!form.subject.trim()) {
    sendError.value = "Enter a subject.";
    return;
  }
  if (!form.content.trim()) {
    sendError.value = "Enter a message body.";
    return;
  }
  sending.value = true;
  sendError.value = "";
  try {
    await editor.value?.ready?.();
    // Save first so authentication/network failures cannot lose a message or its Bcc recipients.
    await persistDraft();
    const sent = await emailSend(snapshot(), () => {});
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
    sendError.value = `${error.message || "Could not send your message."} Your message is kept here. Check Sent before retrying if the connection failed.`;
  } finally {
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
    !event.target.closest(".el-overlay, .tox-tinymce-aux")
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
  releaseModal();
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("resize", resize);
  document.removeEventListener("focusin", containFocus);
});
defineExpose({
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
  width: 560px;
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
.inline .write-box {
  border: 1px solid var(--compose-divider);
  border-radius: 12px;
  box-shadow: none;
}
.inline .compose-container {
  height: 460px;
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
  height: min(620px, calc(100dvh - 120px));
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
  gap: 12px;
  min-height: 68px;
  flex-shrink: 0;
}
.compose-footer .el-button {
  height: 36px;
  min-width: 96px;
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
.draft-status {
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
</style>

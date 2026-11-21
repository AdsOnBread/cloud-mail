<template>
  <div
    class="editor-box"
    :class="{ 'compose-rich-editor': mailCompose, 'editor-box-loading': showLoading, 'hide-toolbar': !showToolbar }"
  >
    <loading class="loading" v-if="showLoading" />
    <textarea
      v-else
      style="outline: none"
      :id="editorId"
      ref="editorRef"
    ></textarea>
    <ComposeSpelling v-if="mailCompose && spelling && spellActive && isInitialized" :editor="editor" v-model:language="spellLanguage" @close="spelling = false" />
    <ComposeFormat v-if="mailCompose && !spelling && showToolbar && isInitialized" :editor="editor" :request-format="plainText ? requestFormat : undefined" />
    <ComposePhoto v-if="mailCompose && !plainText && isInitialized" ref="photoPanel" :editor="editor" @edit-link="link => linkPanel?.openPhoto(link)" />
    <ComposeLink v-if="!plainText && (mailCompose || signatureEditor)" ref="linkPanel" :editor="editor" />
  </div>
</template>

<script setup>
import {
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
  shallowRef,
} from "vue";
import {replaceSignature,signatureId} from "../mail-signatures/content";
import {hasFiles,hasRichSelection} from "../message-composer/files";
import {plainBodyText, plainMarkup, plainSelection, restorePlainSelection} from "../message-composer/plain-text";
import {fonts, formattingShortcut} from "./format-options";
import ComposeSpelling from "./spelling/compose-spelling.vue";
import ComposeFormat from "./compose-format.vue";
import ComposePhoto from "./compose-photo.vue";
import { defaultPhotoWidth, defaultPhotoHeight } from "./photo-size";
import { observeWebPaste } from "./web-paste";
import ComposeLink from "./compose-link.vue";
import loading from "@/components/loading/index.vue";
import { useUiStore } from "@/store/ui.js";

defineExpose({
  clearEditor,
  focus,
  rememberSelection,
  resumeDraft,
  getContent,
  toPlain: () => plainMarkup(editor.value.getBody().innerHTML),
  ready,
  openLink,
  openSpelling: () => { photoPanel.value?.close(); linkPanel.value?.close(); spelling.value = true; },
  setSignature,
  currentSignature: () => editor.value?.initialized ? signatureId(editor.value.getBody()) : "",
  insertEmoji,
  insertPhotos,
  command,
  applyPlainSelection,
});

const props = defineProps({
  defValue: {
    type: String,
    default: "",
  },
  showToolbar: { type: Boolean, default: true },
  mailCompose: Boolean,
  spellActive: Boolean,
  signatureEditor: Boolean,
  plainText: Boolean,
  collapseQuote: Boolean,
  showQuote: Boolean,
  editorId: {
    type: String,
    default: () => `editor-${crypto.randomUUID()}`,
  },
});

const emit = defineEmits(["change", "focus", "rich-command", "compose-keydown", "file-drag", "file-leave", "file-drop", "file-paste"]);
let pendingInit = Promise.resolve();
let themeRevision = 0,
  disposed = false;
async function ready() {
  let current;
  do {
    current = pendingInit;
    await current;
  } while (current !== pendingInit);
}
const spelling = ref(false), spellLanguage = ref("auto");
watch(() => props.spellActive, active => { if (!active) spelling.value = false; });
const editor = shallowRef(null);
const linkPanel = ref(), photoPanel = ref();
function openLink() { photoPanel.value?.close(); linkPanel.value?.open(); }
function setSignature(item, beforeQuote, reply, manual = true) {
  const ed = editor.value;
  if (!ed?.initialized || ed.removed) return;
  const signature = props.plainText && item ? {...item, html:plainMarkup(item.html).content} : item;
  const apply = () => replaceSignature(ed.getBody(), signature, beforeQuote, reply);
  if (manual) ed.undoManager.transact(apply);
  else ed.undoManager.ignore(apply);
  ed.nodeChanged();
  ed.dispatch("change");
}
function insertEmoji(character) {
  if (!isInitialized.value) return false;
  const ed = editor.value;
  ed.focus();
  ed.undoManager.transact(() => {
    if (!ed.getDoc().execCommand("insertText", false, character))
      ed.insertContent(ed.dom.encode(character));
  });
  ed.nodeChanged();
  ed.dispatch("change");
  return true;
}
function requestFormat(name, value) {
  const ed = editor.value;
  emit("rich-command", name, value, plainSelection(ed.getBody(), ed.selection.getRng()));
}
function applyPlainSelection(positions) {
  const ed = editor.value;
  ed.focus();
  ed.selection.setRng(restorePlainSelection(ed.getBody(), positions));
}
function command(name, value) {
  if (!isInitialized.value) return;
  editor.value.focus();
  editor.value.execCommand(name, false, value);
  editor.value.nodeChanged();
}
function insertPhotos(photos) {
  if (props.plainText || !isInitialized.value) return;
  const ed = editor.value;
  ed.focus();
  const html = photos.map(photo => {
    const image = ed.getDoc().createElement("img");
    image.src = photo.src;
    image.alt = photo.name;
    image.style.maxWidth = defaultPhotoWidth;
    image.style.maxHeight = defaultPhotoHeight;
    image.style.height = "auto";
    return image.outerHTML;
  }).join("");
  ed.insertContent(html);
  ed.dispatch("change");
}
const isInitialized = ref(false);
const editorRef = ref(null);
const showLoading = ref(false);
const uiStore = useUiStore();

onMounted(() => {
  pendingInit = initTinyMCE();
});

onBeforeUnmount(() => {
  disposed = true;
  themeRevision++;
  destroyEditor();
});

watch(
  [() => props.defValue, () => props.plainText],
  ([html, plain], [, previousPlain]) => {
    const ed = editor.value;
    if (!isInitialized.value || !ed) return;
    if (plain !== previousPlain) {
      configureComposeMode(ed);
      writeContent(ed, html);
      ed.undoManager.reset();
      ed.dispatch("change");
    } else if (getContent() !== html) writeContent(ed, html);
  },
);

watch(
  () => uiStore.dark,
  async () => {
    const revision = ++themeRevision;
    await ready();
    if (disposed || revision !== themeRevision) return;
    const content = isInitialized.value
      ? getContent()
      : props.defValue;
    destroyEditor();
    await initEditor(content);
  },
);

watch(
  () => props.showQuote,
  () => {
    if (isInitialized.value)
      editor.value?.dom.toggleClass(
        editor.value.getBody(),
        "show-reply-quote",
        props.showQuote,
      );
  },
);

function configureComposeMode(ed) {
  if (!props.mailCompose) return;
  const body = ed.getBody();
  body.setAttribute("contenteditable", props.plainText ? "plaintext-only" : "true");
  for (const [name, value] of Object.entries({paste_as_text:true, paste_data_images:false, paste_block_drop:true, contextmenu:false, text_patterns:false})) {
    if (props.plainText) ed.options.set(name, value);
    else ed.options.unset(name);
  }
}
function writeContent(ed, html) {
  if (props.plainText) ed.getBody().innerHTML = plainMarkup(html).content;
  else ed.setContent(html);
}
function clearEditor() {
  spelling.value = false;
  linkPanel.value?.close();
  photoPanel.value?.close();
  if (isInitialized.value && editor.value) {
    writeContent(editor.value, "");
  }
}

async function initTinyMCE() {
  if (!window.tinymce) {
    showLoading.value = true;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/tinymce/tinymce.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the editor."));
      document.head.appendChild(script);
    });
    showLoading.value = false;
    await nextTick();
  }
  return initEditor();
}

function observeFileTransfers(ed) {
  const doc = ed.getDoc();
  const webPaste = observeWebPaste(ed);
  const handle = event => {
    const transfer = event.clipboardData || event.dataTransfer;
    if (event.type === "paste" && props.plainText && (!hasFiles(transfer) || hasRichSelection(transfer))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = transfer?.getData("text/plain") || plainMarkup(transfer?.getData("text/html")).text;
      if (text) doc.execCommand("insertText", false, text);
      return;
    }
    if (!hasFiles(transfer)) {
      if (event.type === "paste" && !props.plainText) webPaste(event);
      if (props.plainText && event.type === "drop") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.type === "paste" && hasRichSelection(transfer)) return;
    if (event.type === "dragleave") {
      if (!doc.body.contains(event.relatedTarget)) emit("file-leave");
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "drop") {
      const { clientX: x, clientY: y } = event;
      const position = doc.caretPositionFromPoint?.(x, y);
      const range = position ? doc.createRange() : doc.caretRangeFromPoint?.(x, y);
      if (position) { range.setStart(position.offsetNode, position.offset); range.collapse(true); }
      if (range && doc.body.contains(range.startContainer)) ed.selection.setRng(range);
      emit("file-drop", event);
    } else if (event.type === "paste") emit("file-paste", event);
    else emit("file-drag", event);
  };
  const events = ["dragenter", "dragover", "dragleave", "drop", "paste"];
  for (const type of events) doc.addEventListener(type, handle, true);
  ed.on("remove", () => {
    for (const type of events) doc.removeEventListener(type, handle, true);
  });
}

function initEditor(initialContent) {
  pendingInit = window.tinymce.init({
    selector: `#${props.editorId}`,
    statusbar: false,
    body_class: props.mailCompose ? "mail-compose-body" : "",
    height: "100%",

    //relative_urls: false,  //Keep image URLs absolute when they share the site domain
    //remove_script_host: false, // Preserve the hostname in URLs
    forced_root_block: "div",
    skin: `${uiStore.dark ? "oxide-dark" : "oxide"}`,
    content_css: `/tinymce/css/index.css,${uiStore.dark ? "dark" : "default"}`,
    content_style: `body { background: ${uiStore.dark ? "#242529" : "#ffffff"}; color: ${uiStore.dark ? "#e3e3e3" : "#1f1f1f"}; font-family: Arial, Helvetica, sans-serif; font-size:${props.mailCompose ? "13px" : "14px"}; } body[contenteditable="plaintext-only"] { white-space:pre-wrap; font-size:14px } :root {
         --scrollbar-track-color: ${uiStore.dark ? "#141414" : "#FFFFFF"};
         --scrollbar-thumb-color: ${uiStore.dark ? "#8D9095" : "#A8ABB2"};
    } ${props.collapseQuote ? ".cloudmail-reply-quote { display:none; } body.show-reply-quote .cloudmail-reply-quote { display:block; }" : ""}`,
    plugins: "link image advlist lists emoticons fullscreen table preview code",
    ...(props.signatureEditor ? {
      iframe_aria_text:"Signature text", contextmenu:false, paste_data_images:false,relative_urls:false,remove_script_host:false,
      valid_elements:"div[style],p[style],br,strong,b,em,i,u,s,span[style],a[href],ul,ol,li,blockquote,sub,sup",
    } : {}),
    toolbar: props.mailCompose ? false : props.signatureEditor ? "bold italic underline | fontsize forecolor | signaturelink removeformat" :
      "undo redo | bold italic underline | fontsize | forecolor backcolor | alignleft aligncenter alignright alignjustify | outdent indent | bullist numlist | link image emoticons | table code preview fullscreen | removeformat",
    toolbar_location: "bottom",
    toolbar_mode: props.mailCompose ? "floating" : "sliding",
    ...(props.mailCompose ? {
      font_family_formats: fonts.map(([name,family]) => name+"="+family).join(";"),
      relative_urls: false, remove_script_host:false
    } : {}),
    font_size_formats: "8px 10px 12px 14px 16px 18px 24px 36px",
    emoticons_search: false,
    language: "en",
    language_load: false,
    menubar: false,
    license_key: "gpl",
    noneditable_class: "mceNonEditable",
    setup: (ed) => {
      editor.value = ed;
      if (props.signatureEditor) {
        ed.ui.registry.addButton("signaturelink",{icon:"link", tooltip:"Insert link", onAction:openLink});
      }
      if (props.mailCompose) {
        ed.on("keydown", event => {
          if (!props.plainText) return formattingShortcut(ed, event);
          const shortcut = {b:"Bold", i:"Italic", u:"Underline", k:"link"}[event.key.toLowerCase()];
          if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.isComposing && shortcut) {
            event.preventDefault(); event.stopImmediatePropagation();
            requestFormat(shortcut);
          } else formattingShortcut(ed, event, requestFormat);
        }, true);
      }
      if (props.mailCompose || props.signatureEditor) {
        ed.on("keydown", event => {
          if (!props.plainText && (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
            event.preventDefault(); event.stopImmediatePropagation(); openLink();
          }
        }, true);
        ed.on("click", event => {
          if (props.plainText) return;
          if (props.mailCompose && event.target.nodeName === "IMG" && !event.altKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            linkPanel.value?.close();
            photoPanel.value?.open(event.target);
            return;
          }
          const link = ed.dom.getParent(event.target, "a[href]");
          if (link && !event.altKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            linkPanel.value?.open(link, true, {x:event.clientX, y:event.clientY});
          }
        });
      }
      if (props.mailCompose) ed.on("keydown", event => {
        if (props.plainText) return;
        if (event.key !== "Enter" || !event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
        const image = ed.selection.getNode();
        if (image?.nodeName !== "IMG") return;
        event.preventDefault(); event.stopImmediatePropagation();
        linkPanel.value?.close();
        photoPanel.value?.open(image,true);
      }, true);
      if (props.mailCompose) ed.on("keydown", event => emit("compose-keydown", event), true);
      const messageText = () => props.plainText ? plainBodyText(ed.getBody()) : ed.getContent({format:"text"});
      ed.on("init", () => {
        if (disposed) return;
        if (props.mailCompose) observeFileTransfers(ed);
        configureComposeMode(ed);
        writeContent(ed, initialContent ?? props.defValue);
        if (props.collapseQuote)
          ed.dom.toggleClass(ed.getBody(), "show-reply-quote", props.showQuote);
        isInitialized.value = true;
        if (!props.signatureEditor) emit("change", getContent(), messageText());
      });
      ed.on("input change undo redo", () => {
        if (disposed || (props.signatureEditor && !isInitialized.value)) return;
        const content = getContent();
        const text = messageText();
        emit("change", content, text);
      });
      ed.on("focus", () => {
        emit("focus", focus);
      });
    },

    branding: false,
    file_picker_types: "image",
    image_dimensions: false,
    image_description: false,
    link_title: false,
    dialog_type: "none",
    file_picker_callback: (callback, value, meta) => {
      const input = document.createElement("input");
      input.setAttribute("type", "file");
      input.setAttribute("accept", "image/*");

      input.addEventListener("change", async (e) => {
        let file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = () => {
          const id = "blobid" + new Date().getTime();
          const blobCache = tinymce.activeEditor.editorUpload.blobCache;
          const base64 = reader.result.split(",")[1];
          const blobInfo = blobCache.create(id, file, base64);
          blobCache.add(blobInfo);

          callback(blobInfo.blobUri(), { title: file.name });
        };
        reader.readAsDataURL(file);
      });

      input.click();
    },
  });
  return pendingInit;
}

function rememberSelection() {
  const ed = editor.value;
  if (!ed?.initialized || ed.removed) return;
  const bookmark = ed.selection.getBookmark(2, true);
  return () => {
    if (editor.value !== ed || ed.removed) return;
    ed.focus();
    ed.selection.moveToBookmark(bookmark);
  };
}
function resumeDraft() {
  const ed = editor.value;
  if (!ed?.initialized || ed.removed) return;
  ed.focus();
  const body = ed.getBody();
  const boundary = Array.from(body.children).find(node => node.matches(".cloudmail-signature,.cloudmail-reply-quote"));
  const last = boundary ? boundary.previousSibling : body.lastChild;
  const range = body.ownerDocument.createRange();
  if (last) {
    range.selectNodeContents(last);
    if (last.lastChild?.nodeName === "BR") range.setEndBefore(last.lastChild);
  } else range.setStart(body, 0);
  range.collapse(false);
  ed.selection.setRng(range);
}
function focus(start = false) {
  nextTick(() => {
    editor.value?.focus();
    if (start && isInitialized.value)
      editor.value.selection.setCursorLocation(
        editor.value.getBody().firstChild,
        0,
      );
  });
}

function getContent() {
  if (!isInitialized.value) return props.defValue;
  return props.plainText ? plainMarkup(editor.value.getBody().innerHTML).content : editor.value.getContent();
}

function destroyEditor() {
  linkPanel.value?.close();
  photoPanel.value?.close();
  isInitialized.value = false;
  if (editor.value) {
    editor.value.remove();
    editor.value = null;
  }
}
</script>

<style lang="scss" scoped>
.hide-toolbar :deep(.tox-editor-header) {
  display: none;
}
.editor-box {
  position: relative;
  height: 100%;
  width: 100%;
}

.loading {
  margin: auto;
}

.editor-box-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.tox-tbtn.tox-tbtn--select.tox-tbtn--bespoke) {
  width: 80px !important;
}

:deep(.tox.tox-tinymce.tox-fullscreen) {
  padding-right: 15px;
  padding-left: 15px;
  padding-bottom: 15px;
  background: var(--el-bg-color);
  @media (max-width: 767px) {
    padding-right: 10px;
    padding-left: 10px;
    padding-bottom: 10px;
  }
}

:deep(.tox-tinymce) {
  border: none;
  border-radius: 0;
}

:deep(.tox-toolbar__group) {
  padding-left: 0 !important;
  margin: 0 !important;
}

:deep(.tox-tbtn) {
  margin: 0 !important;
}

:deep(.tox .tox-edit-area::before) {
  display: none;
}
.compose-rich-editor { display:flex; flex-direction:column; gap:4px; container-type:inline-size; container-name:compose-editor; }
.compose-rich-editor :deep(.tox-tinymce) { flex:1; min-height:0; width:100%; }
</style>

<style scoped>
:deep(.tox .tox-tbtn) {
  background: transparent;
}
:deep(.tox .tox-tbtn:hover) {
  background: var(--mail-hover);
}
:deep(.tox .tox-tbtn--enabled),
:deep(.tox .tox-tbtn--enabled:hover) {
  background: var(--mail-selected);
}
:deep(.tox .tox-toolbar),
:deep(.tox .tox-toolbar__primary),
:deep(.tox .tox-toolbar__overflow),
:deep(.tox .tox-editor-header) {
  background: var(--mail-surface);
  box-shadow: none;
}
</style>

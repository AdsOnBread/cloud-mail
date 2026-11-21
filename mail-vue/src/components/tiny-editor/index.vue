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
    <ComposeFormat v-if="mailCompose && showToolbar && isInitialized" :editor="editor" />
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
import {plainBodyText, plainMarkup} from "../message-composer/plain-text";
import {fonts, formattingShortcut} from "./format-options";
import ComposeFormat from "./compose-format.vue";
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
  setSignature,
  currentSignature: () => editor.value?.initialized ? signatureId(editor.value.getBody()) : "",
  insertEmoji,
  insertPhoto,
  command,
});

const props = defineProps({
  defValue: {
    type: String,
    default: "",
  },
  showToolbar: { type: Boolean, default: true },
  mailCompose: Boolean,
  signatureEditor: Boolean,
  plainText: Boolean,
  collapseQuote: Boolean,
  showQuote: Boolean,
  editorId: {
    type: String,
    default: () => `editor-${crypto.randomUUID()}`,
  },
});

const emit = defineEmits(["change", "focus", "compose-keydown"]);
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
const editor = shallowRef(null);
const linkPanel = ref();
function openLink() { linkPanel.value?.open(); }
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
  ed.insertContent(ed.dom.encode(character));
  return true;
}
function command(name) {
  if (!isInitialized.value) return;
  editor.value.focus();
  editor.value.execCommand(name);
}
function insertPhoto(data, name) {
  if (props.plainText || !isInitialized.value) return;
  const ed = editor.value;
  ed.focus();
  const image = ed.getDoc().createElement("img");
  image.src = data; image.alt = name; image.style.maxWidth = "100%";
  ed.insertContent(image.outerHTML);
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
  () => props.defValue,
  (newValue) => {
    if (
      isInitialized.value &&
      editor.value &&
      getContent() !== newValue
    ) {
      writeContent(editor.value, newValue);
    }
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

function writeContent(ed, html) {
  if (props.plainText) ed.getBody().innerHTML = plainMarkup(html).content;
  else ed.setContent(html);
}
function clearEditor() {
  linkPanel.value?.close();
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

function initEditor(initialContent) {
  pendingInit = window.tinymce.init({
    selector: `#${props.editorId}`,
    statusbar: false,
    height: "100%",

    //relative_urls: false,  //Keep image URLs absolute when they share the site domain
    //remove_script_host: false, // Preserve the hostname in URLs
    forced_root_block: "div",
    skin: `${uiStore.dark ? "oxide-dark" : "oxide"}`,
    content_css: `/tinymce/css/index.css,${uiStore.dark ? "dark" : "default"}`,
    content_style: `body { background: ${uiStore.dark ? "#242529" : "#ffffff"}; color: ${uiStore.dark ? "#e3e3e3" : "#1f1f1f"}; font-family: Arial, Helvetica, sans-serif; font-size:${props.mailCompose && !props.plainText ? "13px" : "14px"}; ${props.plainText ? "white-space:pre-wrap" : ""} } :root {
         --scrollbar-track-color: ${uiStore.dark ? "#141414" : "#FFFFFF"};
         --scrollbar-thumb-color: ${uiStore.dark ? "#8D9095" : "#A8ABB2"};
    } ${props.collapseQuote ? ".cloudmail-reply-quote { display:none; } body.show-reply-quote .cloudmail-reply-quote { display:block; }" : ""}`,
    plugins: props.plainText ? "emoticons" : "link image advlist lists emoticons fullscreen table preview code",
    ...(props.plainText ? {
      valid_elements: "div[class|data-signature-id],p,br", paste_as_text:true, paste_data_images:false, paste_block_drop:true, contextmenu:false,
    } : {}),
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
      if (props.mailCompose && !props.plainText) ed.on("keydown", event => formattingShortcut(ed,event), true);
      if (props.signatureEditor) {
        ed.ui.registry.addButton("signaturelink",{icon:"link", tooltip:"Insert link", onAction:openLink});
      }
      if (props.plainText) {
        ed.on("keydown", event => {
          if ((event.metaKey || event.ctrlKey) && !event.altKey && ["b","i","u","k"].includes(event.key.toLowerCase())) {
            event.preventDefault(); event.stopImmediatePropagation();
          }
        }, true);
      } else if (props.mailCompose || props.signatureEditor) {
        ed.on("keydown", event => {
          if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
            event.preventDefault(); event.stopImmediatePropagation(); openLink();
          }
        }, true);
        ed.on("click", event => {
          const link = ed.dom.getParent(event.target, "a[href]");
          if (link && !event.altKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            linkPanel.value?.open(link, true, {x:event.clientX, y:event.clientY});
          }
        });
      }
      if (props.mailCompose) ed.on("keydown", event => emit("compose-keydown", event), true);
      const messageText = () => props.plainText ? plainBodyText(ed.getBody()) : ed.getContent({format:"text"});
      ed.on("init", () => {
        if (disposed) return;
        if (props.plainText) ed.getBody().setAttribute("contenteditable","plaintext-only");
        writeContent(ed, initialContent ?? props.defValue);
        if (props.collapseQuote)
          ed.dom.toggleClass(ed.getBody(), "show-reply-quote", props.showQuote);
        isInitialized.value = true;
        emit("change", getContent(), messageText());
      });
      ed.on("input change undo redo", () => {
        if (disposed) return;
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

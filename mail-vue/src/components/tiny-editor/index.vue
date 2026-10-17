<template>
  <div
    class="editor-box"
    :class="{ 'editor-box-loading': showLoading, 'hide-toolbar': !showToolbar }"
  >
    <loading class="loading" v-if="showLoading" />
    <textarea
      v-else
      style="outline: none"
      :id="editorId"
      ref="editorRef"
    ></textarea>
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
import loading from "@/components/loading/index.vue";
import { useUiStore } from "@/store/ui.js";

defineExpose({
  clearEditor,
  focus,
  getContent,
  ready,
});

const props = defineProps({
  defValue: {
    type: String,
    default: "",
  },
  showToolbar: { type: Boolean, default: true },
  collapseQuote: Boolean,
  showQuote: Boolean,
  editorId: {
    type: String,
    default: () => `editor-${crypto.randomUUID()}`,
  },
});

const emit = defineEmits(["change", "focus"]);
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
      editor.value.getContent() !== newValue
    ) {
      editor.value.setContent(newValue);
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
      ? editor.value?.getContent()
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

function clearEditor() {
  if (isInitialized.value && editor.value) {
    editor.value.setContent("");
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
    content_style: `body { background: ${uiStore.dark ? "#242529" : "#ffffff"}; color: ${uiStore.dark ? "#e3e3e3" : "#1f1f1f"}; font-family: Arial, Helvetica, sans-serif; font-size:14px; } :root {
         --scrollbar-track-color: ${uiStore.dark ? "#141414" : "#FFFFFF"};
         --scrollbar-thumb-color: ${uiStore.dark ? "#8D9095" : "#A8ABB2"};
    } ${props.collapseQuote ? ".cloudmail-reply-quote { display:none; } body.show-reply-quote .cloudmail-reply-quote { display:block; }" : ""}`,
    plugins: "link image advlist lists emoticons fullscreen table preview code",
    toolbar:
      "undo redo | bold italic underline | fontsize | forecolor backcolor | alignleft aligncenter alignright alignjustify | outdent indent | bullist numlist | link image emoticons | table code preview fullscreen | removeformat",
    toolbar_location: "bottom",
    toolbar_mode: "sliding",
    font_size_formats: "8px 10px 12px 14px 16px 18px 24px 36px",
    emoticons_search: false,
    language: "en",
    language_load: false,
    menubar: false,
    license_key: "gpl",
    noneditable_class: "mceNonEditable",
    setup: (ed) => {
      editor.value = ed;
      ed.on("init", () => {
        ed.setContent(initialContent ?? props.defValue);
        if (props.collapseQuote)
          ed.dom.toggleClass(ed.getBody(), "show-reply-quote", props.showQuote);
        isInitialized.value = true;
        emit("change", ed.getContent(), ed.getContent({ format: "text" }));
      });
      ed.on("input change", () => {
        const content = ed.getContent();
        const text = ed.getContent({ format: "text" });
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
  return isInitialized.value
    ? editor.value?.getContent() || ""
    : props.defValue;
}

function destroyEditor() {
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

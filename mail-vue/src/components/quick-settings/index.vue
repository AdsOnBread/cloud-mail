<template>
  <dialog
    ref="panel"
    class="quick-settings"
    aria-labelledby="quick-settings-title"
    @cancel.prevent="close"
    @keydown.esc.stop.prevent="close"
  >
    <header>
      <h2 id="quick-settings-title">Quick settings</h2>
      <button
        class="mail-icon"
        aria-label="Close quick settings"
        data-tip="Close"
        autofocus
        @click="close"
      >
        <Icon icon="material-symbols:close" width="20" />
      </button>
    </header>
    <button
      class="all-settings"
      @click="
        close();
        router.push('/settings');
      "
    >
      See all settings
    </button>
    <fieldset>
      <legend>Density</legend>
      <label v-for="[key, title] in choices" :key="key"
        ><input v-model="ui.density" type="radio" name="density" :value="key" />
        {{ title }}
        <span class="density-preview" :class="key" aria-hidden="true"
          ><i /><i /><i
        /></span>
      </label>
    </fieldset>
    <fieldset>
      <legend class="theme-heading">
        Theme
        <button
          ref="viewAll"
          class="view-all"
          :disabled="!theme.ready"
          @click="picker.open()"
        >
          View all
        </button>
      </legend>
      <div class="themes">
        <button
          v-for="item in shortcuts"
          :key="item.id"
          :disabled="!theme.ready"
          :aria-pressed="theme.active.id === item.id"
          @click="apply(item.id)"
        >
          <span
            class="theme-preview"
            :class="item.id"
            :style="{
              backgroundColor: item.color,
              backgroundImage: item.image
                ? 'url(' + item.image + ')'
                : undefined,
            }"
            aria-hidden="true"
            ><i v-if="!item.image" /></span
          >{{ item.id === "light" ? "Light" : item.name }}
        </button>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
    </fieldset>
    <fieldset>
      <legend>Inbox type</legend>
      <label><input type="checkbox" v-model="ui.inboxTabs"/> Show inbox categories</label>
    </fieldset>
  </dialog>
  <ThemePicker ref="picker" @closed="afterPicker" />
</template>
<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useUiStore } from "@/store/ui";
import ThemePicker from "./theme-picker.vue";
import { themes, useMailTheme } from "@/store/mail-theme";
const picker = ref(),
  viewAll = ref(),
  theme = useMailTheme(),
  error = ref("");
const shortcuts = computed(() => [
  themes.find((t) => t.id === "light"),
  themes.find((t) => t.id === "dark"),
  theme.active.image || !["light", "dark"].includes(theme.active.id)
    ? theme.active
    : themes[0],
]);
async function apply(id) {
  try {
    error.value = "";
    await theme.apply(id);
  } catch (e) {
    error.value = e.message || "Could not save this theme.";
  }
}
const ui = useUiStore(),
  router = useRouter(),
  panel = ref();
const choices = [
  ["default", "Default"],
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
];
const small = window.matchMedia("(max-width:899px)");
function display() {
  if (!panel.value || picker.value?.isOpen()) return;
  if (
    panel.value.open &&
    ui.quickSettings &&
    panel.value.matches(":modal") === small.matches
  )
    return;
  if (panel.value.open) panel.value.close();
  if (ui.quickSettings)
    small.matches ? panel.value.showModal() : panel.value.show();
}
function afterPicker() {
  display();
  if (ui.quickSettings) viewAll.value?.focus();
}
function close() {
  ui.quickSettings = false;
  panel.value?.close();
  document.getElementById("mail-settings-trigger")?.focus();
}
watch(() => ui.quickSettings, display, { flush: "post" });
onMounted(() => {
  small.addEventListener("change", display);
  display();
});
onBeforeUnmount(() => {
  small.removeEventListener("change", display);
  ui.quickSettings = false;
});
</script>
<style scoped>
.quick-settings {
  position: fixed;
  inset: 64px 12px 16px auto;
  margin: 0;
  width: 320px;
  max-width: calc(100vw - 16px);
  height: calc(100dvh - 80px);
  max-height: none;
  padding: 16px 0;
  border: 0;
  border-radius: 16px;
  background: var(--mail-surface);
  color: var(--el-text-color-primary);
  box-shadow: 0 1px 3px #3c404333;
  overflow: auto;
  z-index: 125;
}
.quick-settings::backdrop {
  background: #0005;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
h2 {
  font-size: 18px;
  font-weight: 500;
  margin: 0;
}
.all-settings {
  display: block;
  width: calc(100% - 32px);
  margin: 14px 16px 18px;
  padding: 10px;
  border: 1px solid var(--light-border-color);
  border-radius: 20px;
  color: var(--el-color-primary);
  font-weight: 500;
  cursor: pointer;
}
fieldset {
  border: 0;
  border-top: 1px solid var(--light-border-color);
  padding: 18px 20px 12px;
  margin: 0;
}
legend {
  float: left;
  width: 100%;
  padding: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}
label {
  clear: both;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 45px;
  font-size: 14px;
}
input {
  accent-color: var(--el-color-primary);
}
.density-preview {
  display: grid;
  width: 66px;
  height: 32px;
  margin-left: auto;
  align-content: center;
  gap: 4px;
  padding: 0 8px;
  background: var(--mail-read);
  border: 1px solid var(--light-border-color);
  border-radius: 4px;
}
.density-preview i {
  height: 2px;
  background: var(--secondary-text-color);
  width: 85%;
}
.density-preview i:nth-child(2) {
  width: 65%;
}
.density-preview.compact {
  gap: 1px;
}
.density-preview.comfortable {
  gap: 3px;
}
.theme-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.view-all {
  color: var(--el-color-primary);
  cursor: pointer;
  border-radius: 12px;
  padding: 4px 8px;
}
.view-all:hover {
  background: var(--mail-hover);
}
.theme-preview {
  background-size: cover;
  background-position: center;
}
.themes {
  clear: both;
  display: flex;
  gap: 12px;
}
.themes button {
  display: grid;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
  color: inherit;
}
.theme-preview {
  background: #eaf1fb;
  border: 1px solid #bbb;
  border-radius: 6px;
  width: 78px;
  height: 48px;
  padding: 10px 4px 4px 16px;
}
.theme-preview i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: white;
}
.theme-preview.dark {
  background: #18191c;
}
.theme-preview.dark i {
  background: #383a3f;
}
.themes button[aria-pressed="true"] .theme-preview {
  outline: 2px solid var(--el-color-primary);
}
@media (prefers-reduced-motion: no-preference) {
  dialog[open] {
    animation: appear 0.14s ease-out;
  }
  @keyframes appear {
    from {
      opacity: 0;
      transform: translateX(8px);
    }
  }
}
</style>

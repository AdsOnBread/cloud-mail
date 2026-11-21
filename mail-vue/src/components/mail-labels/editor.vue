<template>
  <el-dialog
    :model-value="Boolean(labels.edit)"
    :title="
      labels.edit?.destination ? 'Move to label' : labels.edit?.remove
        ? 'Remove label'
        : labels.edit?.id
          ? 'Edit label'
          : 'New label'
    "
    class="mail-dialog label-dialog"
    :class="{ 'label-name-dialog': !labels.edit?.remove && !labels.edit?.destination }"
    :width="labels.edit?.remove || labels.edit?.destination ? '360px' : 'min(498px, calc(100vw - 32px))'"
    align-center
    append-to-body
    :show-close="false"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    @close="!saving && (labels.edit = null)"
    @opened="input?.focus()"
    @closed="restoreOpener"
  >
    <form @submit.prevent="submit">
      <p v-if="labels.edit?.remove">
        Remove “{{ labels.edit.name }}” from all messages? Your messages will
        stay in their folders.
        <span v-if="hasChildren">Sublabels keep their current names.</span>
      </p>
      <p v-else-if="labels.edit?.destination">Move the selected mail to “{{labels.edit.destination.name}}”.</p>
      <template v-else
        ><label
          class="name-label">Please enter a {{ labels.edit?.id ? "" : "new " }}label name:<input
            ref="input"
            v-model="name"
            :maxlength="Math.max(100, node?.text.length || 0)"
            :disabled="saving"
        /></label>
        <label class="nest-option">
          <span class="check-area"><input v-model="nested" type="checkbox" :disabled="saving" @change="parentId = null" /></span>
          Nest label under:
        </label>
        <el-select
          v-model="parentId"
          class="parent-picker"
          aria-label="Nest label under:"
          placeholder=" "
          popper-class="label-parent-options"
          fit-input-width
          :teleported="false"
          :show-arrow="false"
          :offset="0"
          :disabled="saving"
          @change="nested = true"
        >
          <el-option label="Please select a parent..." value="" disabled />
          <el-option v-for="parent in parents" :key="parent.id" :value="parent.id" :label="parent.name" />
        </el-select>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="saving" @click="labels.edit = null">
          Cancel</button
        ><button
          class="primary"
          :disabled="
            saving ||
            !name.trim() ||
            (nested && !parentId && !labels.edit?.remove && !labels.edit?.destination)
          "
        >
          {{
            labels.edit?.destination ? "Move" : labels.edit?.remove ? "Remove" : labels.edit?.id ? "Save" : "Create"
          }}
        </button>
      </div>
    </form>
  </el-dialog>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { labelTree, inLabelBranch } from "./tree";
import { useRouter, useRoute } from "vue-router";
import { useMailLabels } from "@/store/mail-labels";
import { useEmailStore } from "@/store/email";
const labels = useMailLabels(),
  mail = useEmailStore(),
  router = useRouter(),
  route = useRoute();
const input = ref(),
  name = ref(""),
  error = ref(""),
  saving = ref(false);
const nested = ref(false),
  parentId = ref(null);
const tree = computed(() => labelTree(labels.items));
const node = computed(() => tree.value.byId.get(labels.edit?.id));
const hasChildren = computed(() => Boolean(node.value?.children.length));
const parents = computed(() =>
  labels.items.filter(
    (label) => !node.value || !inLabelBranch(label.name, node.value.label.name),
  ),
);
let opener;
function restoreOpener() { const restore=opener; opener=null; restore?.(); }
watch(
  () => labels.edit,
  (value) => {
    if (value) opener=value.restoreFocus;
    const current = tree.value.byId.get(value?.id);
    name.value = current?.text ?? value?.name ?? "";
    parentId.value = current?.parent?.label.id ?? value?.parentId ?? null;
    nested.value = parentId.value !== null;
    error.value = "";
  },
);
async function submit() {
  if (!labels.edit || saving.value || !name.value.trim()) return;
  const { id, remove, anchors, move } = labels.edit;
  saving.value = true;
  try {
    if (!remove && !labels.edit.destination && nested.value && !parentId.value) return;
    if (remove) {
      await labels.remove(id);
      if (route.name === "label" && Number(route.params.labelId) === id)
        await router.replace("/inbox");
    } else {
      await labels.save(
        id,
        name.value.trim(),
        anchors,
        nested.value ? parentId.value : null,
        move,
      );
    }
    mail.conversationRevision++;
  } catch (e) {
    error.value = e.message || "Could not update label.";
  } finally {
    saving.value = false;
  }
}
</script>
<style>
.label-name-dialog.el-dialog {
  padding: 24px;
  border-radius: 28px;
  box-shadow: none;
}
.label-name-dialog .el-dialog__header { padding: 0 0 16px; }
.label-name-dialog .el-dialog__title { font-size: 24px; line-height: 32px; }
.label-name-dialog .el-dialog__body { line-height: 20px; color: var(--regular-text-color); }
.label-name-dialog .name-label { display: block; font-size: 14px; }
.label-name-dialog .name-label input,
.label-name-dialog .el-select__wrapper {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 56px;
  padding: 0 16px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  box-shadow: inset 0 0 0 1px var(--secondary-text-color);
  font: 16px/24px Arial,sans-serif;
}
.label-name-dialog .name-label input { margin: 8px 0; }
.label-name-dialog .name-label input:hover,
.label-name-dialog .el-select__wrapper.is-hovering { box-shadow: inset 0 0 0 1px currentColor; }
.label-name-dialog .name-label input:focus,
.label-name-dialog .el-select__wrapper.is-focused {
  outline: 0;
  box-shadow: inset 0 0 0 3px var(--mail-blue,var(--el-color-primary));
}
.label-name-dialog .nest-option {
  display: flex;
  align-items: center;
  height: 48px;
  width: fit-content;
  font-size: 14px;
  cursor: pointer;
}
.label-name-dialog .check-area {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin: 0 4px 0 -12px;
  border-radius: 50%;
}
.label-name-dialog .nest-option:hover .check-area,
.label-name-dialog .check-area:focus-within { background: var(--mail-hover); }
.label-name-dialog .check-area input {
  margin: 0;
  width: 18px;
  height: 18px;
  accent-color: var(--mail-blue,var(--el-color-primary));
  cursor: pointer;
}
.label-name-dialog .parent-picker { width: 100%; margin-top: 4px; }
.label-name-dialog .dialog-actions button { min-height: 40px; padding: 0 14px; font-size: 14px; }
.label-name-dialog .dialog-actions button.primary { padding: 0 24px; min-width: 92px; }
.label-name-dialog .dialog-actions button.primary:disabled {
  cursor: default;
  color: color-mix(in srgb,var(--el-text-color-primary) 38%,transparent);
  background: var(--base-fill);
}
.label-parent-options.el-popper { border: 0; border-radius: 4px; }
.label-parent-options .el-select-dropdown__list { padding: 8px 0; }
.label-parent-options .el-select-dropdown__wrap { max-height: min(352px, 42vh); }
.label-parent-options .el-select-dropdown__item { height: 48px; line-height: 48px; padding: 0 16px; }
.label-dialog [role="alert"] { color: var(--mail-draft); }
</style>

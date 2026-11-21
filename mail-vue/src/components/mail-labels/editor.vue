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
    width="360px"
    append-to-body
    :show-close="false"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    @close="!saving && (labels.edit = null)"
    @opened="input?.focus()"
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
          >Please enter a {{ labels.edit?.id ? "" : "new " }}label name<input
            ref="input"
            v-model="name"
            :maxlength="Math.max(100, node?.text.length || 0)"
            :disabled="saving"
        /></label>
        <label class="nest-option"
          ><input v-model="nested" type="checkbox" :disabled="saving" />Nest
          label under</label
        >
        <select
          v-model="parentId"
          :disabled="!nested || saving"
          aria-label="Parent label"
        >
          <option :value="null" disabled>Please select a parent…</option>
          <option v-for="parent in parents" :key="parent.id" :value="parent.id">
            {{ parent.name }}
          </option>
        </select>
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
watch(
  () => labels.edit,
  (value) => {
    const current = tree.value.byId.get(value?.id);
    name.value = current?.text ?? value?.name ?? "";
    parentId.value = current?.parent?.label.id ?? value?.parentId ?? null;
    nested.value = parentId.value !== null;
    error.value = "";
  },
);
async function submit() {
  if (!labels.edit || saving.value || !name.value.trim()) return;
  const { id, remove, anchors, move, onCreated } = labels.edit;
  saving.value = true;
  try {
    if (!remove && !labels.edit.destination && nested.value && !parentId.value) return;
    if (remove) {
      await labels.remove(id);
      if (route.name === "label" && Number(route.params.labelId) === id)
        await router.replace("/inbox");
    } else {
      const saved = await labels.save(
        id,
        name.value.trim(),
        anchors,
        nested.value ? parentId.value : null,
        move,
      );
      if (!id && saved) onCreated?.(saved.id);
    }
    mail.conversationRevision++;
  } catch (e) {
    error.value = e.message || "Could not update label.";
  } finally {
    saving.value = false;
  }
}
</script>
<style scoped>
label {
  display: block;
  color: var(--regular-text-color);
  font-size: 14px;
}
.nest-option {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 4px;
}
.nest-option input {
  accent-color: var(--el-color-primary);
  margin: 0;
}
select:disabled {
  opacity: 0.55;
}
input:not([type="checkbox"]),
select {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 10px;
  margin-top: 8px;
  border: 1px solid var(--secondary-text-color);
  border-radius: 4px;
  background: var(--mail-surface);
  color: inherit;
  font: inherit;
}
[role="alert"] {
  color: var(--mail-draft);
}
</style>

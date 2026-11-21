<template>
  <Teleport to="body">
    <form
      ref="panel"
      class="filter-panel"
      :style="position"
      aria-label="Mail filter"
      role="dialog"
      @submit.prevent="step === 'criteria' ? nextStep() : save()"
      @keydown.esc.prevent.stop="close"
      @keydown.tab="wrapFocus"
    >
      <template v-if="step === 'criteria'">
        <label v-for="[key, label] in fields" :key="key" class="criterion"
          >{{ label }}
          <input
            v-model="criteria[key]"
            type="text"
            :maxlength="['from', 'to'].includes(key) ? 320 : 200"
            autocomplete="off"
          />
        </label>
        <label class="choice"
          ><input v-model="criteria.hasAttachment" type="checkbox" />Has
          attachment</label
        >
      </template>
      <template v-else>
        <button class="back" type="button" :disabled="busy" @click="back">
          « back to search options
        </button>
        <p>When a message is an exact match for your search criteria:</p>
        <fieldset :disabled="busy">
          <label v-for="[key, label] in choices" :key="key" class="choice"
            ><input v-model="actions[key]" type="checkbox" />{{ label }}</label
          >
          <div class="choice">
            <label
              ><input v-model="labelOn" type="checkbox" />Apply the
              label:</label
            >
            <select
              v-model="labelId"
              aria-label="Choose label"
              @change="labelOn = Boolean(labelId)"
            >
              <option :value="null">Choose label...</option>
              <option v-for="l in labels.items" :key="l.id" :value="l.id">
                {{ l.name }}
              </option>
            </select>
          </div>
          <label
            v-for="value in [true, false]"
            :key="String(value)"
            class="choice"
          >
            <input
              type="checkbox"
              :checked="actions.important === value"
              @change="actions.important = $event.target.checked ? value : null"
            />
            {{
              value
                ? "Always mark it as important"
                : "Never mark it as important"
            }}
          </label>
          <div class="choice">
            <label
              ><input v-model="categoryOn" type="checkbox" />Categorize
              as:</label
            >
            <select
              v-model="category"
              aria-label="Choose category"
              @change="categoryOn = Boolean(category)"
            >
              <option value="">Choose category...</option>
              <option v-for="c in inboxCategories" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
          </div>
        </fieldset>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <label v-if="step === 'actions'" class="choice also"
          ><input v-model="applyExisting" :disabled="busy" type="checkbox" />
          {{
            count == null
              ? "Also apply filter to matching conversations."
              : "Also apply filter to " +
                count +
                " matching conversation" +
                (count === 1 ? "" : "s") +
                "."
          }}
        </label>
        <button type="button" class="cancel" :disabled="busy" @click="close">
          Cancel
        </button>
        <button
          type="submit"
          class="primary"
          :disabled="busy || (step === 'criteria' && !hasCriteria)"
        >
          {{
            step === "actions" && rule.version
              ? "Update filter"
              : "Create filter"
          }}
        </button>
      </footer>
    </form>
  </Teleport>
</template>
<script setup>
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from "vue";
import { ElMessage } from "element-plus";
import http from "@/axios";
import { filterSession, useMessageFilters } from "@/store/message-filters";
import { useMailLabels } from "@/store/mail-labels";
import { inboxCategories } from "@/utils/inbox-categories";
import { positionMailboxPopup } from "../mail-popup-position";
const props = defineProps({ rule: { type: Object, required: true } });
const filters = useMessageFilters(),
  labels = useMailLabels(),
  session = filterSession();
const fields = [
  ["from", "From"],
  ["to", "To"],
  ["subject", "Subject"],
  ["words", "Has the words"],
  ["excluded", "Doesn’t have"],
];
const choices = [
  ["archive", "Skip the Inbox (Archive it)"],
  ["read", "Mark as read"],
  ["star", "Star it"],
];
const criteria = reactive({ ...props.rule.criteria }),
  actions = reactive({ ...props.rule.actions });
const labelId = ref(actions.labelId || null),
  labelOn = ref(Boolean(labelId.value));
const category = ref(actions.category || ""),
  categoryOn = ref(Boolean(category.value));
const hasCriteria = computed(
  () => fields.some(([key]) => criteria[key]?.trim()) || criteria.hasAttachment,
);
const step = ref(props.rule.step),
  count = ref(null),
  applyExisting = ref(false),
  busy = ref(false),
  error = ref(""),
  panel = ref(),
  position = ref({});
const origin = document.activeElement;
let alive = true,
  generation = 0;
const current = () =>
  alive && filters.editor?.id === props.rule.id && session.current();
function place() {
  if (!panel.value) return;
  const search = document.querySelector("[role=search]"),
    rect = search?.getBoundingClientRect();
  position.value =
    rect?.width && rect.height
      ? positionMailboxPopup(panel.value, search, 720, search)
      : {
          width: "min(720px,calc(100vw - 16px))",
          left: "50%",
          transform: "translateX(-50%)",
          top: "8px",
          maxHeight: "calc(100dvh - 16px)",
        };
}
async function focusFirst() {
  await nextTick();
  place();
  panel.value?.querySelector("button,input")?.focus({ preventScroll: true });
}
function close() {
  if (busy.value) return;
  filters.editor = null;
  nextTick(() => {
    const target =
      origin?.isConnected && origin.getClientRects().length
        ? origin
        : document.querySelector(
            '[aria-label="More message options"],[data-search-options]',
          );
    target?.focus({ preventScroll: true });
  });
}
function outside(e) {
  if (!panel.value?.contains(e.target)) close();
}
function wrapFocus(e) {
  const items = Array.from(
    panel.value.querySelectorAll(
      "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
    ),
  );
  if (e.shiftKey && e.target === items[0]) {
    e.preventDefault();
    items.at(-1)?.focus();
  } else if (!e.shiftKey && e.target === items.at(-1)) {
    e.preventDefault();
    items[0]?.focus();
  }
}
async function preview() {
  const run = ++generation;
  count.value = null;
  try {
    if (!current()) return;
    let data;
    do {
      if (!current() || run !== generation) return;
      data = await http.post(
        "/v1/filters/preview",
        { ...criteria },
        session.config,
      );
    } while (data.preparing);
    if (current() && run === generation) count.value = data.conversations;
  } catch {
    /* The filter can still be saved when its optional preview is unavailable. */
  }
}
function nextStep() {
  if (!hasCriteria.value) return;
  step.value = "actions";
  error.value = "";
  focusFirst();
  preview();
}
function back() {
  generation++;
  step.value = "criteria";
  error.value = "";
  focusFirst();
}
async function save() {
  if (busy.value || !current()) return;
  const selected = {};
  for (const [key] of choices) if (actions[key]) selected[key] = true;
  if (typeof actions.important === "boolean")
    selected.important = actions.important;
  if (labelOn.value && !labels.items.some((l) => l.id === labelId.value)) {
    error.value = "Choose a label.";
    return;
  }
  if (categoryOn.value && !category.value) {
    error.value = "Choose a category.";
    return;
  }
  if (labelOn.value) selected.labelId = labelId.value;
  if (categoryOn.value) selected.category = category.value;
  if (!Object.keys(selected).length) {
    error.value = "Select at least one filter action.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await filters.save(session, {
      id: props.rule.id,
      version: props.rule.version,
      criteria: { ...criteria },
      actions: selected,
      applyExisting: applyExisting.value,
    });
    if (current()) {
      busy.value = false;
      ElMessage.success(
        props.rule.version
          ? "Your filter was updated."
          : "Your filter was created.",
      );
      close();
    }
  } catch (e) {
    if (current()) error.value = e.message || "Could not save the filter.";
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  focusFirst();
  if (step.value === "actions") preview();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", place);
});
onBeforeUnmount(() => {
  alive = false;
  document.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("resize", place);
});
watch(error, () => nextTick(place));
</script>
<style scoped>
.filter-panel {
  position: fixed;
  z-index: 2400;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px;
  background: var(--mail-surface);
  color: var(--el-text-color-primary);
  border: 1px solid var(--light-border-color);
  box-shadow: 0 2px 6px #0003;
  font:
    14px/20px Arial,
    sans-serif;
}
.criterion {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 24px;
  margin-bottom: 20px;
  align-items: start;
}
.criterion input {
  width: 100%;
  min-width: 0;
  border: 0;
  border-bottom: 1px solid var(--light-border-color);
  border-radius: 0;
  background: transparent;
  font: inherit;
  color: inherit;
}
.criterion input:focus {
  outline: 0;
  box-shadow: inset 0 -2px var(--el-color-primary);
}
.back,
.cancel {
  color: var(--el-color-primary);
  cursor: pointer;
}
.back {
  padding: 0;
  text-decoration: underline;
}
.filter-panel p {
  margin: 18px 0 12px;
}
.filter-panel fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.choice,
.choice label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
}
.choice input[type="checkbox"] {
  height: 16px;
  width: 16px;
  margin: 0;
  accent-color: var(--el-color-primary);
  flex-shrink: 0;
}
.choice select {
  max-width: 50%;
  color: inherit;
  background: var(--mail-surface);
  border: 1px solid var(--light-border-color);
  border-radius: 4px;
  padding: 2px 6px;
}
footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 22px;
}
.also {
  margin-right: auto;
}
.primary,
.cancel {
  padding: 0 16px;
  border-radius: 20px;
  height: 36px;
  font-weight: 500;
}
.primary {
  background: var(--el-color-primary);
  color: var(--mail-surface);
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.45;
  cursor: default;
}
.filter-panel [role="alert"] {
  color: var(--el-color-danger);
}
@media (max-width: 600px) {
  .filter-panel {
    padding: 16px;
  }
  .criterion {
    grid-template-columns: minmax(70px, 24%) minmax(0, 1fr);
    gap: 10px;
  }
  .also {
    width: 100%;
  }
}
</style>

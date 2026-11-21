<template>
  <section class="filter-settings" aria-label="Filter settings">
    <SettingsTabs />
    <div class="rules">
      <p>The following filters are applied to all incoming mail:</p>
      <p v-if="error" role="alert">
        {{ error }} <button @click="load">Retry</button>
      </p>
      <p v-else-if="loading" role="status">Loading filters…</p>
      <table v-else-if="rows.length" aria-label="Saved filters">
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>
              <div><b>Matches:</b> {{ describe(r.criteria) }}</div>
              <div><b>Do this:</b> {{ actionText(r.actions) }}</div>
            </td>
            <td class="row-actions">
              <button @click="store.open(r.criteria, r)">edit</button
              ><button @click="remove(r)">delete</button>
            </td>
          </tr>
        </tbody>
      </table>
      <button @click="store.open()">Create a new filter</button>
    </div>
  </section>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import http from "@/axios";
import { filterSession, useMessageFilters } from "@/store/message-filters";
import { useMailLabels } from "@/store/mail-labels";
import { useUserStore } from "@/store/user";
import SettingsTabs from "./tabs.vue";
const store = useMessageFilters(),
  labels = useMailLabels(),
  user = useUserStore(),
  rows = ref([]),
  loading = ref(false),
  error = ref("");
let generation = 0;
function describe(c) {
  return [
    ["from", "from:"],
    ["to", "to:"],
    ["subject", "subject:"],
    ["words", ""],
    ["excluded", "-"],
  ]
    .filter(([key]) => c[key])
    .map(([key, prefix]) => prefix + c[key])
    .concat(c.hasAttachment ? ["has:attachment"] : [])
    .join(" ");
}
function actionText(a) {
  return [
    a.archive && "Skip Inbox",
    a.read && "Mark as read",
    a.star && "Star it",
    a.labelId &&
      "Apply label “" +
        (labels.items.find((l) => l.id === a.labelId)?.name ||
          "Removed label") +
        "”",
    typeof a.important === "boolean" &&
      (a.important ? "Mark as important" : "Never mark as important"),
    a.category && "Categorize as " + a.category,
  ]
    .filter(Boolean)
    .join(", ");
}
async function load() {
  const run = ++generation,
    s = filterSession();
  rows.value = [];
  error.value = "";
  loading.value = true;
  if (!s.current()) return;
  try {
    const data = await http.get("/v1/filters", s.config);
    if (run === generation && s.current()) rows.value = data;
  } catch (e) {
    if (run === generation && s.current())
      error.value = e.message || "Could not load filters.";
  } finally {
    if (run === generation) loading.value = false;
  }
}
async function remove(r) {
  const run = generation,
    s = filterSession();
  try {
    await ElMessageBox.confirm(
      "Delete this filter?",
      "Confirm filter deletion",
      { confirmButtonText: "Delete", cancelButtonText: "Cancel" },
    );
  } catch {
    return;
  }
  if (run !== generation || !s.current()) return;
  try {
    await http.delete("/v1/filters/" + r.id, {
      ...s.config,
      params: { version: r.version },
    });
    if (s.current()) store.revision++;
  } catch (e) {
    if (run === generation && s.current())
      error.value = e.message || "Could not delete the filter.";
  }
}
watch(() => [store.revision, user.user.userId, user.authenticatedToken], load, {
  immediate: true,
});
function storage(e) {
  if ((e.key === "token" || e.key === null) && !filterSession().current()) {
    generation++;
    rows.value = [];
    error.value = "Your signed-in account changed. Reload to see its filters.";
    loading.value = false;
  }
}
onMounted(() => window.addEventListener("storage", storage));
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener("storage", storage);
});
</script>
<style scoped>
.filter-settings {
  height: 100%;
  overflow: auto;
  color: var(--el-text-color-primary);
  font:
    14px/20px Arial,
    sans-serif;
}
.rules {
  padding: 12px 20px;
}
.rules table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0 16px;
}
.rules td {
  padding: 8px 4px;
  border-bottom: 1px solid var(--light-border-color);
  overflow-wrap: anywhere;
}
.row-actions {
  text-align: right;
  white-space: nowrap;
}
.rules button {
  color: var(--el-color-primary);
  cursor: pointer;
  text-decoration: underline;
  margin-right: 10px;
}
.rules p[role="alert"] {
  color: var(--el-color-danger);
}
</style>

<template>
  <dialog
    ref="dialog"
    class="contact-picker"
    aria-label="Select contacts"
    @cancel.prevent="dismiss"
    @keydown.esc.stop.prevent="dismiss"
    @close="emit('close')"
  >
    <header>
      <h2>
        <Icon icon="material-symbols:account-circle" width="24" />Select
        contacts
      </h2>
      <label class="contact-search"
        ><Icon icon="material-symbols:search" width="20" />
        <input
          v-model="query"
          autofocus
          type="search"
          placeholder="Search for contacts"
          aria-label="Search for contacts"
          :maxlength="maxPersonTerm"
        />
      </label>
      <button
        class="icon"
        type="button"
        aria-label="Close contact picker"
        data-tip="Close"
        @click="dismiss"
      >
        <Icon icon="material-symbols:close" width="20" />
      </button>
    </header>
    <div class="actions">
      <label
        ><input
          type="checkbox"
          :checked="allVisible"
          :indeterminate="someVisible && !allVisible"
          :disabled="!visible.length"
          @change="toggleVisible($event.target.checked)"
        />Select all</label
      >
      <button
        v-if="removable.length"
        type="button"
        class="text-button"
        @click="confirmRemove.showModal()"
      >
        Remove from recent contacts
      </button>
    </div>
    <div class="people" :aria-busy="loading">
      <p class="group-name">
        {{ query.trim() ? "Search results" : "Recent contacts" }} ({{
          visible.length
        }})
      </p>
      <label
        v-for="person in visible"
        :key="key(person.email)"
        class="person"
        :class="{ picked: chosen.has(key(person.email)) }"
      >
        <input
          type="checkbox"
          :aria-label="person.email"
          :checked="chosen.has(key(person.email))"
          @change="toggle(person, $event.target.checked)"
        />
        <span class="person-name">{{
          person.name === person.email
            ? person.email.split("@")[0]
            : person.name
        }}</span>
        <span class="address">{{ person.email }}</span>
      </label>
      <p v-if="failed" role="status">
        Couldn’t load mailbox contacts.
        <button type="button" class="text-button" @click="retry++">
          Retry
        </button>
      </p>
      <p v-else-if="!visible.length" role="status">
        {{
          loading
            ? "Loading contacts…"
            : query.trim()
              ? "No matching contacts"
              : "No recent contacts"
        }}
      </p>
    </div>
    <footer>
      <span aria-live="polite">{{
        chosen.size ? chosen.size + " selected" : ""
      }}</span>
      <button type="button" class="text-button" @click="dismiss">Cancel</button>
      <button
        type="button"
        class="insert"
        :disabled="!dirty && !chosen.size"
        @click="insert"
      >
        Insert
      </button>
    </footer>
    <dialog
      ref="confirmRemove"
      class="forget-dialog"
      aria-label="Remove recent contacts"
      @keydown.esc.stop.prevent="confirmRemove.close()"
    >
      <h3>Remove from recent contacts?</h3>
      <p>These addresses will be hidden from suggestions for this mailbox.</p>
      <form method="dialog">
        <button autofocus>Cancel</button
        ><button type="button" @click="forget">Remove</button>
      </form>
    </dialog>
  </dialog>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { Icon } from "@iconify/vue";
import { useMailboxPeople } from "@/services/mailbox-people";
import { useUserStore } from "@/store/user";
import {
  maxPersonTerm,
  personSearchKey,
} from "../../../../shared/mail-search-people";
import { isEmail } from "@/utils/verify-utils";

const props = defineProps({
  addresses: { type: Array, required: true },
  names: Object,
  recent: { type: Array, required: true },
  removed: { type: Array, required: true },
  owner: { type: String, required: true },
  accountId: { type: Number, required: true },
});
const emit = defineEmits(["insert", "forget", "close"]);
const user = useUserStore(),
  token = user.authenticatedToken,
  owner = props.owner,
  account = props.accountId;
const current = () =>
  owner &&
  owner === user.user.email &&
  owner === props.owner &&
  account === props.accountId &&
  token &&
  token === user.authenticatedToken &&
  token === localStorage.getItem("token");
const key = (address) => address.trim().toLowerCase();
function named(email) {
  const id = key(email);
  const name =
    props.names && Object.hasOwn(props.names, id) ? props.names[id] : "";
  return { email, name: (typeof name === "string" && name) || email };
}
const initial = new Set(props.addresses.map(key));
const chosen = ref(
  new Map(props.addresses.map((email) => [key(email), named(email)])),
);
const dirty = computed(
  () =>
    chosen.value.size !== initial.size ||
    [...initial].some((id) => !chosen.value.has(id)),
);
const query = ref("");
const {remote,loading,failed,retry} = useMailboxPeople(query,account,token,current);
const dialog = ref(),
  confirmRemove = ref();
onMounted(() => {
  if (current()) dialog.value.showModal();
  else emit("close");
});
function dismiss() {
  dialog.value?.close();
}
watch(
  [
    () => user.authenticatedToken,
    () => user.user.email,
    () => props.accountId,
    () => props.owner,
  ],
  () => {
    if (!current()) dismiss();
  },
  { flush: "sync" },
);
watch(remote, (people) => {
  for (const person of people) {
    const id = key(person.email), selected = chosen.value.get(id);
    if (selected && selected.name === selected.email && person.name && person.name !== person.email)
      chosen.value.set(id, {email:selected.email, name:person.name});
  }
});
const visible = computed(() => {
  const entries = new Map(),
    matching = new Set(),
    hidden = new Set(props.removed.map(key)),
    term = personSearchKey(query.value.trim());
  // Keep off-screen selections when a different search returns. Existing draft
  // recipients also remain editable if they aren't in the mailbox directory.
  for (const person of [
    ...props.addresses.map(named),
    ...props.recent.map(named),
    ...remote.value,
    ...chosen.value.values(),
  ]) {
    const id = key(person.email);
    if (!initial.has(id) && (hidden.has(id) || !isEmail(person.email)))
      continue;
    if (
      [person.name, person.email].some((text) =>
        personSearchKey(text).includes(term),
      )
    )
      matching.add(id);
    const old = entries.get(id);
    if (!old || old.name === old.email) entries.set(id, person);
  }
  return [...entries]
    .filter(([id]) => matching.has(id))
    .map(([id, person]) => chosen.value.get(id) || person);
});
const allVisible = computed(
  () =>
    visible.value.length > 0 &&
    visible.value.every((p) => chosen.value.has(key(p.email))),
);
const someVisible = computed(() =>
  visible.value.some((p) => chosen.value.has(key(p.email))),
);
const removable = computed(() =>
  [...chosen.value.values()]
    .map((p) => p.email)
    .filter((email) => isEmail(email) && !props.removed.includes(key(email))),
);
function toggle(person, checked) {
  if (checked) chosen.value.set(key(person.email), person);
  else chosen.value.delete(key(person.email));
}
function toggleVisible(checked) {
  for (const person of visible.value) toggle(person, checked);
}
function forget() {
  if (!current()) return dismiss();
  const addresses = removable.value;
  emit("forget", addresses);
  for (const email of addresses)
    if (!initial.has(key(email))) chosen.value.delete(key(email));
  confirmRemove.value.close();
}
function insert() {
  if (current()) emit("insert", [...chosen.value.values()]);
  dismiss();
}
</script>

<style scoped>
dialog {
  box-sizing: border-box;
  margin: auto;
  border: 0;
  color: var(--el-text-color-primary);
  background: var(--mail-surface);
  font:
    14px/20px Arial,
    sans-serif;
  box-shadow: 0 8px 30px #0003;
}
dialog::backdrop {
  background: rgb(32 33 36 / 38%);
}
.contact-picker {
  padding: 0;
  width: min(720px, calc(100vw - 32px));
  height: min(530px, calc(100dvh - 40px));
  border-radius: 12px;
}
.contact-picker[open] {
  display: flex;
  flex-direction: column;
}
header,
.actions,
footer,
.contact-search,
h2,
.actions label {
  display: flex;
  align-items: center;
}
header {
  padding: 16px 16px 12px 22px;
  gap: 16px;
}
h2 {
  gap: 10px;
  font-size: 20px;
  font-weight: 500;
  margin: 0;
  white-space: nowrap;
}
h2 svg {
  color: var(--mail-blue, var(--el-color-primary));
}
.contact-search {
  min-width: 0;
  flex: 1;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  color: var(--regular-text-color);
  background: var(--mail-search);
  border-radius: 6px;
}
.contact-search:focus-within {
  box-shadow: inset 0 0 0 1px var(--mail-blue, var(--el-color-primary));
}
.contact-search input {
  background: transparent;
  width: 100%;
  min-width: 0;
  outline: 0;
  color: inherit;
  font: inherit;
}
button {
  cursor: pointer;
}
.icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
}
.icon:hover,
.text-button:hover {
  background: var(--mail-hover);
}
.actions {
  justify-content: space-between;
  gap: 8px;
  min-height: 48px;
  padding: 0 22px;
  border-bottom: 1px solid var(--light-border-color);
}
.actions label {
  gap: 14px;
  cursor: pointer;
}
input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--mail-blue, var(--el-color-primary));
  cursor: pointer;
}
.people {
  overflow: auto;
  min-height: 0;
  flex: 1;
}
.people p {
  padding: 0 22px;
}
.group-name {
  display: flex;
  align-items: center;
  min-height: 40px;
  margin: 0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.35px;
  text-transform: uppercase;
  color: var(--regular-text-color);
}
.person {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  padding: 0 22px;
  min-height: 48px;
  cursor: pointer;
}
.person:hover,
.person:focus-within {
  background: var(--mail-hover);
}
.person.picked {
  background: var(--mail-selected);
}
.person span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.address {
  color: var(--regular-text-color);
}
footer {
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--light-border-color);
}
footer span {
  margin-right: auto;
  color: var(--regular-text-color);
}
.text-button,
.insert,
.forget-dialog button {
  min-height: 36px;
  border-radius: 18px;
  padding: 0 16px;
  font-weight: 500;
  color: var(--mail-blue, var(--el-color-primary));
}
.insert {
  background: var(--mail-blue, var(--el-color-primary));
  color: white;
}
.insert:disabled {
  opacity: 0.45;
  cursor: default;
}
.forget-dialog {
  max-width: min(360px, calc(100vw - 40px));
  border-radius: 20px;
  padding: 24px;
}
.forget-dialog h3 {
  margin: 0;
  font-size: 18px;
}
.forget-dialog form {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 600px) {
  header {
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 16px;
  }
  .contact-search {
    order: 3;
    flex-basis: 100%;
  }
  header .icon {
    margin-left: auto;
  }
  .person {
    grid-template-columns: 16px minmax(0, 1fr);
    row-gap: 0;
    padding-block: 6px;
  }
  .person input {
    grid-row: 1 / 3;
  }
  .address {
    grid-column: 2;
    font-size: 13px;
  }
  .actions,
  .person {
    padding-inline: 16px;
  }
}
</style>

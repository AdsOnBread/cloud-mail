<template>
  <section
    class="contacts-panel"
    aria-label="Mailbox contacts"
    @keydown.esc.stop="back"
  >
    <header>
      <button
        ref="backButton"
        v-if="person || searching"
        class="mail-icon"
        aria-label="Back to contacts"
        data-tip="Back"
        @click="back"
      >
        <Icon icon="material-symbols:arrow-back" width="20" />
      </button>
      <input
        v-if="searching && !person"
        ref="search"
        v-model="query"
        type="search"
        aria-label="Search contacts"
        placeholder="Search contacts"
        :maxlength="maxPersonTerm"
      />
      <h2 v-else>Contacts</h2>
      <button
        v-if="!searching && !person"
        ref="searchButton"
        class="mail-icon"
        aria-label="Search contacts"
        data-tip="Search"
        @click="startSearch"
      >
        <Icon icon="material-symbols:search" width="20" />
      </button>
      <a
        class="mail-icon"
        href="https://contacts.google.com/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Google Contacts in a new tab"
        data-tip="Open Google Contacts in a new tab"
        ><Icon icon="material-symbols:open-in-new" width="18"
      /></a>
      <button
        class="mail-icon"
        aria-label="Close side panel"
        data-tip="Close side panel"
        @click="emit('close')"
      >
        <Icon icon="material-symbols:close" width="20" />
      </button>
    </header>
    <div v-if="person" class="contact-info">
      <span class="avatar large">{{ initial(person) }}</span>
      <h3>{{ displayName(person) }}</h3>
      <p>{{ person.email }}</p>
      <button v-perm="'email:send'" class="compose-contact" @click="compose">
        <Icon icon="material-symbols:mail-outline" width="18" />Send email
      </button>
    </div>
    <div v-else ref="list" class="people">
      <h3>{{ query.trim() ? "Search results" : "Recent contacts" }}</h3>
      <button
        v-for="entry in people"
        :key="entry.email"
        class="person"
        @click="show(entry)"
      >
        <span class="avatar" aria-hidden="true">{{ initial(entry) }}</span>
        <span class="identity"
          ><strong>{{ displayName(entry) }}</strong
          ><small>{{ entry.email }}</small></span
        >
      </button>
      <p v-if="failed" role="alert">
        Couldn’t load mailbox contacts.
        <button class="retry" @click="retry++">Retry</button>
      </p>
      <p v-else-if="!people.length" role="status">
        {{
          loading
            ? "Loading contacts…"
            : query.trim()
              ? "No matching contacts"
              : "No recent contacts"
        }}
      </p>
    </div>
  </section>
</template>
<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { Icon } from "@iconify/vue";
import {
  maxPersonTerm,
  personSearchKey,
} from "../../../../shared/mail-search-people";
import { isEmail } from "@/utils/verify-utils";
import { useUserStore } from "@/store/user";
import { useAccountStore } from "@/store/account";
import { useUiStore } from "@/store/ui";
import { useWriterStore } from "@/store/writer";
import { useMailboxPeople } from "@/services/mailbox-people";
const props = defineProps({ accountId: { type: Number, required: true } });
const emit = defineEmits(["close"]);
const user = useUserStore(),
  accounts = useAccountStore(),
  writer = useWriterStore(),
  ui = useUiStore();
const owner = user.user.email,
  token = user.authenticatedToken,
  account = props.accountId;
const current = () =>
  !!owner &&
  owner === user.user.email &&
  token &&
  token === user.authenticatedToken &&
  token === localStorage.getItem("token") &&
  account ===
    (accounts.currentAccount?.accountId || user.user.account?.accountId);
const query = ref(""),
  searching = ref(false),
  person = ref(null),
  search = ref(),
  searchButton = ref(),
  backButton = ref(),
  list = ref();
const { remote, loading, failed, retry } = useMailboxPeople(
  query,
  account,
  token,
  current,
);
const displayName = (entry) =>
  entry.name && entry.name !== entry.email
    ? entry.name
    : entry.email.split("@")[0];
const initial = (entry) =>
  Array.from(displayName(entry).trim())[0]?.toUpperCase();
const people = computed(() => {
  if (!current()) return [];
  const term = personSearchKey(query.value.trim()),
    byEmail = new Map();
  const hidden = new Set(
    writer.removedSuggestions[JSON.stringify([owner, account])] || [],
  );
  for (const entry of [
    ...remote.value,
    ...writer.recentAddresses(owner, account).map((email) => ({ email })),
  ]) {
    const key = entry.email.toLowerCase();
    if (
      isEmail(entry.email) &&
      !hidden.has(key) &&
      !byEmail.has(key) &&
      [entry.email, entry.name || ""].some((value) =>
        personSearchKey(value).includes(term),
      )
    )
      byEmail.set(key, entry);
  }
  return [...byEmail.values()].sort((a, b) =>
    displayName(a).localeCompare(displayName(b)),
  );
});
let lastEmail,
  scroll = 0;
function startSearch() {
  searching.value = true;
  nextTick(() => search.value?.focus());
}
function show(entry) {
  lastEmail = entry.email;
  scroll = list.value.scrollTop;
  person.value = entry;
  nextTick(() => backButton.value?.focus());
}
function back() {
  if (person.value) {
    person.value = null;
    nextTick(() => {
      if (!list.value) return;
      list.value.scrollTop = scroll;
      const index = people.value.findIndex(
        (entry) => entry.email === lastEmail,
      );
      const row = list.value.querySelectorAll(".person")[index];
      (row || search.value || searchButton.value)?.focus({
        preventScroll: true,
      });
    });
  } else if (searching.value) {
    query.value = "";
    searching.value = false;
    nextTick(() => searchButton.value?.focus());
  } else emit("close");
}
function compose() {
  if (person.value && current())
    ui.writerRef?.open({ ...person.value, accountId: account });
}
onMounted(() => searchButton.value?.focus({ preventScroll: true }));
</script>
<style scoped>
.contacts-panel {
  position: fixed;
  top: 64px;
  right: 56px;
  bottom: 16px;
  width: 320px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  z-index: 101;
  background: var(--mail-surface);
  color: var(--el-text-color-primary);
  border-radius: 16px;
  overflow: hidden;
}
header {
  height: 64px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 8px 0 16px;
  gap: 2px;
  border-bottom: 1px solid var(--light-border-color);
}
h2 {
  font:
    500 16px/24px Arial,
    sans-serif;
  flex: 1;
}
header .mail-icon {
  width: 36px;
  height: 36px;
  flex: none;
}
header input {
  width: 0;
  min-width: 0;
  flex: 1;
  background: transparent;
  font:
    16px Arial,
    sans-serif;
  color: inherit;
}
.people {
  overflow: auto;
  min-height: 0;
  padding-bottom: 12px;
}
.people h3 {
  padding: 16px 20px 8px;
  font:
    500 13px/20px Arial,
    sans-serif;
  color: var(--regular-text-color);
}
.person {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  cursor: pointer;
  text-align: left;
}
.person:is(:hover, :focus-visible) {
  background: var(--mail-hover);
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--mail-selected);
  color: var(--el-text-color-primary);
  font:
    500 16px Arial,
    sans-serif;
}
.identity {
  min-width: 0;
}
.identity strong,
.identity small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity strong {
  font:
    500 14px/20px Arial,
    sans-serif;
}
.identity small,
.people p,
.contact-info p {
  color: var(--regular-text-color);
  font:
    13px/20px Arial,
    sans-serif;
}
.people p {
  padding: 12px 20px;
}
.retry {
  color: var(--el-color-primary);
  cursor: pointer;
}
.contact-info {
  text-align: center;
  padding: 24px 20px;
  overflow: auto;
  overflow-wrap: anywhere;
}
.large {
  margin: 0 auto 16px;
  width: 64px;
  height: 64px;
  font-size: 28px;
}
.contact-info h3 {
  font:
    400 20px/28px Arial,
    sans-serif;
}
.contact-info p {
  margin: 8px 0 20px;
}
.compose-contact {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--secondary-text-color);
  border-radius: 20px;
  padding: 9px 16px;
  cursor: pointer;
}
.compose-contact:hover {
  background: var(--mail-hover);
}
</style>

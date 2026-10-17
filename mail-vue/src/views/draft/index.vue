<template>
  <emailScroll ref="scroll"
               :allow-star="false"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               :star-cancel="starCancel"
               @jump="jumpContent"
               actionLeft="6px"
               :show-account-icon="false"
               :show-first-loading="false"
               :showStar="false"
               @delete-draft="deleteDraft"
               :type="'draft'"
  >
    <template #name="props">
      <span class="send-email">{{ [...(props.email.receiveEmail || []), ...(props.email.cc || []), ...(props.email.bcc || [])].join(', ') || '(' + $t('noRecipient') + ')' }}</span>
    </template>
    <template #subject="props">
      {{ props.email.subject || '(' + $t('noSubject') + ')' }}
    </template>
  </emailScroll>
</template>

<script setup>
import emailScroll from "@/components/email-scroll/index.vue"
import {emailDelete} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, ref, watch, toRaw} from "vue";
import {useUiStore} from "@/store/ui.js";
import {userDraftStore} from "@/store/draft.js";
import db from "@/db/db.js"

defineOptions({
  name: 'draft'
})

const draftStore = userDraftStore();
const uiStore = useUiStore();
const scroll = ref({})

watch(() => draftStore.refreshList, async () => {
  const {list} = await getEmailList();
    scroll.value.emailList.length = 0
    scroll.value.handleList(list);
    scroll.value.emailList.push(...list)
})

function getEmailList() {
  return new Promise((resolve, reject) => {
    db.value.draft.orderBy('createTime').reverse().toArray().then(list => {
      resolve({list})
    })
  })
}

async function deleteDraft(draftIds) {
  await db.value.transaction('rw', db.value.draft, db.value.att, async () => {
    await db.value.draft.bulkDelete(draftIds);
    await db.value.att.bulkDelete(draftIds);
  });
  draftStore.refreshList++
}

async function jumpContent(email) {
  const att = await db.value.att.get(email.draftId)
  email.attachments = att?.attachments || []
  uiStore.writerRef.openDraft(email);
}

</script>
<style>
.send-email {
  font-weight: normal;
}
</style>

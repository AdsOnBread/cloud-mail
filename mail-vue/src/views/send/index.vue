<template>
  <emailScroll :request-key="requestKey" ref="sendScroll"
               :cancel-success="cancelStar"
               :star-success="addStar"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               show-status
               actionLeft="4px"
               :star-cancel="starCancel"
               @jump="jumpContent"
               :time-sort="params.timeSort"
               :type="'send'"
  >
    <template #first>
      <button type="button" class="sort-button" :title="params.timeSort ? 'Oldest first' : 'Newest first'" :aria-label="params.timeSort ? 'Sort newest first' : 'Sort oldest first'" @click="changeTimeSort"><Icon :icon="params.timeSort ? 'material-symbols:arrow-upward' : 'material-symbols:arrow-downward'" width="20" /></button>
    </template>
  </emailScroll>
</template>

<script setup>
import { useMailSearchStore } from '@/store/mail-search.js';
import { computed } from 'vue';
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import emailScroll from "@/components/email-scroll/index.vue"
import {emailList, emailDelete} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, onMounted, reactive, ref, watch} from "vue";
import router from "@/router/index.js";
import {Icon} from "@iconify/vue";

defineOptions({
  name: 'send'
})

const emailStore = useEmailStore();
const mailSearch = useMailSearchStore();
const accountStore = useAccountStore();
const sendScroll = ref({})
const params = reactive({
  timeSort: 0,
})
const requestKey = computed(() => [accountStore.currentAccountId, accountStore.currentAccount.allReceive, params.timeSort, mailSearch.query].join("|"));

onMounted(() => {
  emailStore.sendScroll = sendScroll;
})



function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1

}

function jumpContent(email) {
  emailStore.contentData.email = emailStore.toContentEmail(email)
  emailStore.contentData.delType = 'logic'
  emailStore.contentData.showStar = true
  emailStore.contentData.showReply = true
  router.push('/mail')
}

function addStar(email) {
  emailStore.starScroll?.addItem(email)
}

function cancelStar(email) {
  emailStore.starScroll?.deleteEmail([email.emailId])
}

function getEmailList(emailId, size) {
  const accountId =  accountStore.currentAccountId;
  const allReceive = accountStore.currentAccount.allReceive;
  const q = mailSearch.query;
  const timeSort = params.timeSort;
  return emailStore.fetchList(full =>
    emailList(accountId, allReceive, emailId, timeSort, size, 1, full, q)
  ).then(data => {
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  })
}

</script>

<style scoped>
.sort-button { display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--regular-text-color); width:32px; height:32px; border-radius:50%; }
.sort-button:hover { background:var(--mail-hover); }
</style>
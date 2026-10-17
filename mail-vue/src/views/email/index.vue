<template>
  <emailScroll :request-key="requestKey" ref="scroll"
               :cancel-success="cancelStar"
               :star-success="addStar"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               :star-cancel="starCancel"
               :time-sort="params.timeSort"
               :email-read="emailRead"
               :show-unread="true"
               actionLeft="4px"
               @jump="jumpContent"
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
import {useSettingStore} from "@/store/setting.js";
import emailScroll from "@/components/email-scroll/index.vue"
import {emailList, emailDelete, emailLatest, emailRead} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, onMounted, onUnmounted, reactive, ref} from "vue";
import {sleep} from "@/utils/time-utils.js";
import router from "@/router/index.js";
import {Icon} from "@iconify/vue";
import { useRoute } from 'vue-router'

defineOptions({
  name: 'email'
})

const route = useRoute();
const emailStore = useEmailStore();
const mailSearch = useMailSearchStore();
const accountStore = useAccountStore();
const settingStore = useSettingStore();
const scroll = ref({})
const params = reactive({
  timeSort: 0,
})
const requestKey = computed(() => [accountStore.currentAccountId, accountStore.currentAccount.allReceive, params.timeSort, mailSearch.query].join("|"));

onMounted(() => {
  emailStore.emailScroll = scroll;
  latest()
})




function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1

}

function jumpContent(email) {
  emailStore.contentData.email = emailStore.toContentEmail(email)
  emailStore.contentData.delType = 'logic'
  emailStore.contentData.showUnread = true
  emailStore.contentData.showStar = true
  emailStore.contentData.showReply = true
  router.push('/mail')
}

const existIds = new Set();
let stopped = false;
onUnmounted(() => { stopped = true; });

async function latest() {
  while (!stopped) {

    let autoRefresh = settingStore.settings.autoRefresh;
    await sleep(autoRefresh > 1 ? autoRefresh * 1000 : 3000);

    if (stopped) break;
    if (route.name !== 'email' || mailSearch.query) {
      continue;
    }

    const latestId = scroll.value.latestEmail?.emailId

    if (!scroll.value.firstLoad && autoRefresh > 1) {
      try {
        const accountId = accountStore.currentAccountId
        const allReceive = scroll.value.latestEmail?.allReceive
        const curTimeSort = params.timeSort
        let list = []

        //Only request more messages when the last message belongs to the current account, or the list is empty
        if (accountId === scroll.value.latestEmail?.reqAccountId) {
          list = await emailLatest(latestId, accountId, allReceive);
        }

        //Apply the response only if the account, time order, and message filter are unchanged
        if (!mailSearch.query && accountId === accountStore.currentAccountId && params.timeSort === curTimeSort && allReceive === accountStore.currentAccount.allReceive) {
          if (list.length > 0) {
            emailStore.applyFullList(list)

            for (let email of list) {

              email.reqAccountId = accountId;
              email.allReceive = allReceive;

              if (!existIds.has(email.emailId)) {

                existIds.add(email.emailId)
                scroll.value.addItem(email)

                await sleep(50)
              }

            }

          }

        }
      } catch (e) {
        if (e.code === 401 || e.code === 403) {
          settingStore.settings.autoRefresh = 0;
        }
        console.error(e)
      }
    }
  }
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
    emailList(accountId, allReceive, emailId, timeSort, size, 0, full, q)
  ).then(data => {
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  })
}

</script>
<style>
.sort-button { display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--regular-text-color); width:32px; height:32px; border-radius:50%; }
.sort-button:hover { background:var(--mail-hover); }
</style>

<template>
  <emailScroll :request-key="requestKey" type="star" ref="scroll"
               :allow-star="false"
               :cancel-success="cancelStar"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               :star-cancel="starCancel"
               @jump="jumpContent"
               actionLeft="6px"
               :show-account-icon="false"
  />
</template>

<script setup>
import { useMailSearchStore } from '@/store/mail-search.js';
import { computed } from 'vue';
import emailScroll from "@/components/email-scroll/index.vue"
import {emailDelete} from "@/request/email.js";
import {starAdd, starCancel, starList} from "@/request/star.js";
import {useEmailStore} from "@/store/email.js";
import {defineOptions, onMounted, ref} from "vue";
import router from "@/router/index.js";

defineOptions({
  name: 'star'
})

const scroll = ref({})
const emailStore = useEmailStore();
const mailSearch = useMailSearchStore();
const requestKey = computed(() => mailSearch.query);

function jumpContent(email) {
  emailStore.contentData.email = emailStore.toContentEmail(email)
  emailStore.contentData.delType = 'logic'
  emailStore.contentData.showStar = true
  emailStore.contentData.showReply = true
  router.push('/mail')
}

function getEmailList(emailId, size) {
  const q = mailSearch.query;
  return emailStore.fetchList(full => starList(emailId, size, full, q))
}

function cancelStar(email) {
  emailStore.cancelStarEmailId = email.emailId
  scroll.value.deleteEmail([email.emailId])
}

onMounted(() => {
  emailStore.starScroll = scroll
})

</script>

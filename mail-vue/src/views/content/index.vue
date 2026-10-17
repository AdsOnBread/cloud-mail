<template><ConversationView v-if="route.query.emailId" /><LegacyMessage v-else /></template>
<script setup>
import { useRoute } from 'vue-router';
import ConversationView from '@/components/conversation-view/index.vue';
import LegacyMessage from '@/components/legacy-message/index.vue';
const route=useRoute();
</script>

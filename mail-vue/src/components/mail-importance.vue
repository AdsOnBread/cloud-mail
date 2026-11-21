<template>
  <button
    type="button"
    class="mail-icon importance-marker"
    role="switch"
    :aria-checked="Boolean(reason)"
    aria-label="Important"
    :aria-description="explanation"
    :data-tip="explanation"
    :disabled="disabled"
    @click="$emit('toggle', !reason)"
  >
    <Icon :icon="reason ? 'material-symbols:label-important' : 'material-symbols:label-important-outline'" width="18" />
  </button>
</template>
<script setup>
import { computed } from "vue";
import { Icon } from "@iconify/vue";
const props = defineProps({ reason: String, disabled: Boolean });
defineEmits(["toggle"]);
const explanation = computed(() => ({
  user: "Important because you marked it as important.",
  reply: "Important because you replied to this conversation.",
}[props.reason] || "Click to mark as important."));
</script>
<style scoped>
.importance-marker { color: var(--secondary-text-color); vertical-align: middle; }
.importance-marker[aria-checked="true"] { color: #e9a900; }
</style>

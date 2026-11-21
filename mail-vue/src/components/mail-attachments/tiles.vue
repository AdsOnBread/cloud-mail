<template>
  <section v-if="files.length" class="attachment-section" aria-label="Attachments">
    <strong class="attachment-count">{{files.length===1 ? "One attachment" : files.length+" Attachments"}}</strong>
    <div class="attachment-list">
      <AttachmentTile v-for="file in files" :key="file.attachmentId || file.attId || file.key" :file="file"
        @preview="preview=file" @error="$emit('error',$event)"/>
    </div>
    <FilePreview v-if="preview" :file="preview" @close="preview=null"/>
  </section>
</template>
<script setup>
import {ref} from "vue";
import AttachmentTile from "./tile.vue";
import FilePreview from "./preview.vue";
defineProps({files:{type:Array,required:true}});
defineEmits(["error"]);
const preview=ref(null);
</script>
<style scoped>
.attachment-section {margin-top:16px;padding-top:12px;border-top:1px dotted var(--light-border-color)}
.attachment-count {display:block;margin-bottom:12px;font:600 14px/20px Arial,sans-serif;color:var(--regular-text-color)}
.attachment-list {display:flex;flex-wrap:wrap;gap:16px;min-width:0}
</style>

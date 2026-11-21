<template>
  <el-dialog :model-value="Boolean(labels.edit)" :title="labels.edit?.remove ? 'Remove label' : labels.edit?.id ? 'Edit label' : 'New label'" class="mail-dialog label-dialog" width="360px" append-to-body :show-close="false" :close-on-click-modal="!saving" :close-on-press-escape="!saving" @close="!saving && (labels.edit=null)" @opened="input?.focus()">
    <form @submit.prevent="submit">
      <p v-if="labels.edit?.remove">Remove “{{ labels.edit.name }}” from all messages? Your messages will stay in their folders.</p>
      <label v-else>Please enter a label name<input ref="input" v-model="name" maxlength="100" :disabled="saving" /></label>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="dialog-actions"><button type="button" :disabled="saving" @click="labels.edit=null">Cancel</button><button class="primary" :disabled="saving || !name.trim()">{{ labels.edit?.remove ? 'Remove' : labels.edit?.id ? 'Save' : 'Create' }}</button></div>
    </form>
  </el-dialog>
</template>
<script setup>
import { ref, watch } from "vue";
import { useRouter,useRoute } from "vue-router";
import { useMailLabels } from "@/store/mail-labels";
import { useEmailStore } from "@/store/email";
const labels=useMailLabels(), mail=useEmailStore(), router=useRouter(), route=useRoute();
const input=ref(), name=ref(""), error=ref(""), saving=ref(false);
watch(()=>labels.edit, value=>{name.value=value?.name || ""; error.value="";});
async function submit() {
  if (!labels.edit || saving.value || !name.value.trim()) return;
  const {id,remove}=labels.edit; saving.value=true;
  try {
    if (remove) {
      await labels.remove(id);
      if (route.name==="label" && Number(route.params.labelId)===id) await router.replace("/inbox");
    } else await labels.save(id,name.value.trim());
    mail.conversationRevision++;
  } catch(e) {error.value=e.message || "Could not update label.";}
  finally {saving.value=false;}
}
</script>
<style scoped>
label { display:block; color:var(--regular-text-color); font-size:14px; }
input { width:100%; padding:9px 10px; margin-top:8px; border:1px solid var(--secondary-text-color); border-radius:4px; background:var(--mail-surface); color:inherit; font:inherit; }
[role=alert]{color:var(--mail-draft)}
</style>

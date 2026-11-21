<template>
  <section class="label-settings" aria-label="Label settings">
    <SettingsTabs/>
    <p v-if="error || labels.error || labels.systemError" role="alert">{{ error || labels.error || labels.systemError }} <button class="action" @click="reload">Retry</button></p>
    <table aria-label="System labels">
      <thead><tr><th scope="col">System labels</th><th scope="col" colspan="3">Show in label list</th></tr></thead>
      <tbody>
        <tr><th scope="row">Inbox</th><td colspan="3"></td></tr>
        <tr v-for="folder in folders" :key="folder.id">
          <th scope="row">{{folder.name}}</th><td colspan="3">
            <button v-for="mode in folder.conditional ? modes : basic" :key="mode" class="action" :aria-pressed="folderMode(folder,labels.system)===mode"
              :disabled="busy || !labels.systemReady || Boolean(labels.systemError)" @click="save(()=>labels.setSystem(folder.id,mode))">{{names[mode]}}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <table aria-label="Custom labels">
      <thead><tr><th scope="col">Labels</th><th scope="col">Show in label list</th><th scope="col">Show in message list</th><th scope="col">Actions</th></tr></thead>
      <tbody>
        <tr><td colspan="4"><button class="create-label" @click="labels.edit={}">Create new label</button></td></tr>
        <tr v-for="label in labels.items" :key="label.id">
          <th scope="row">{{label.name}}</th>
          <td v-for="list in ['sidebar','messages']" :key="list">
            <button v-for="mode in list==='sidebar'?modes:basic" :key="mode" class="action" :disabled="busy"
              :aria-pressed="(label[list] || 'show')===mode"
              @click="save(()=>labels.setDisplay(label.id,list,mode))">{{names[mode]}}</button>
          </td>
          <td><button class="action" :aria-label="'Remove '+label.name" @click="labels.edit={...label,remove:true}">remove</button><button class="action" :aria-label="'Edit '+label.name" @click="labels.edit={...label}">edit</button></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
<script setup>
import {computed,onMounted,ref} from 'vue';
import {hasPerm} from '@/perm/perm';
import {useMailLabels} from '@/store/mail-labels';
import {systemFolders,folderMode} from '@/components/mail-labels/system-folders';
import SettingsTabs from './tabs.vue';
const labels=useMailLabels(),busy=ref(false),error=ref('');
const basic=['show','hide'],modes=[...basic,'unread'],names={show:'show',hide:'hide',unread:'show if unread'};
const folders=computed(()=>systemFolders.filter(folder=>!folder.permission || hasPerm(folder.permission)));
function reload(){error.value='';return Promise.all([labels.load(),labels.loadSystem()]);}
onMounted(reload);
async function save(action){
  if(busy.value)return;
  const owner=labels.owner;
  busy.value=true;error.value='';
  try {await action();}
  catch(e){if(owner===labels.owner)error.value=e.message || 'Could not save this setting.';}
  finally{busy.value=false;}
}
</script>
<style scoped>
.label-settings{height:100%;overflow:auto;color:var(--el-text-color-primary)}
table{border-spacing:0;border-collapse:collapse;width:min(100%,800px);font:14px/20px Arial,sans-serif;text-align:left}
th,td{padding:5px 12px;vertical-align:middle;text-align:left}th:first-child,td:first-child{padding-left:20px}
thead th{height:44px;font-weight:600;border-bottom:1px solid var(--light-border-color);vertical-align:bottom}
tbody th{font-weight:400;overflow-wrap:anywhere;width:32%}tbody td{border-bottom:1px solid var(--light-border-color)}tbody th{border-bottom:1px solid var(--light-border-color)}
.action{color:var(--el-color-primary);cursor:pointer;text-decoration:underline;background:transparent;padding:2px 0;margin-right:8px;font:inherit}.action[aria-pressed=true]{color:inherit;text-decoration:none;font-weight:600}.action:disabled{cursor:default}
.create-label{font:inherit;border:1px solid var(--light-border-color);border-radius:4px;padding:4px 12px;cursor:pointer;color:inherit;background:var(--base-fill)}
p[role=alert]{margin:12px 20px;color:var(--mail-draft)}
@media(max-width:600px){table{font-size:13px;table-layout:fixed}thead th:first-child,tbody th{width:27%}th,td,th:first-child,td:first-child{padding:5px 4px}.action{margin-right:5px}.settings-head{padding-left:12px}}
</style>

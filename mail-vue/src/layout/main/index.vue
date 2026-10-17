<template>
  <div class="mail-surface">
    <router-view v-slot="{ Component, route }">
      <keep-alive :include="['email','all-email','send','sys-setting','star','user','role','analysis','reg-key','draft']">
        <component :is="Component" :key="route.name" class="main-view" />
      </keep-alive>
    </router-view>
  </div>
</template>
<script setup>
import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {watch} from "vue";

const settingStore = useSettingStore()
const uiStore = useUiStore();

let elNotification = null

watch(() => uiStore.changeNotice, () => {

  const settings = settingStore.settings

  let data = {
    notice: settings.notice,
    noticeWidth: settings.noticeWidth,
    noticeTitle: settings.noticeTitle,
    noticeContent: settings.noticeContent,
    noticeType: settings.noticeType,
    noticeDuration: settings.noticeDuration,
    noticePosition: settings.noticePosition,
    noticeOffset: settings.noticeOffset
  }

  showNotice(data)
})

watch(() => uiStore.changePreview, () => {
  showNotice(uiStore.previewData)
})

function showNotice(data) {

  if (data.notice === 1 || !data.noticeContent?.trim()) {
    return;
  }

  if (elNotification) {
    elNotification.close()
  }

  const style = document.createElement('style');
  style.innerHTML = `
  .custom-notice.el-notification {
    --el-notification-width: min(${data.noticeWidth}px,calc(100% - 30px)) !important;
  }
  `;

  document.head.appendChild(style);

  elNotification = ElNotification({
    title: data.noticeTitle,
    message: `<div style="width: 100%;height: 100%;">${data.noticeContent}</div>`,
    type: data.noticeType === 'none' ? '' : data.noticeType,
    duration: data.noticeDuration,
    position: data.noticePosition,
    offset: data.noticeOffset,
    dangerouslyUseHTMLString: true,
    customClass: 'custom-notice'
  })
}

</script>
<style scoped>
.mail-surface { height:100%; min-height:0; border-radius:16px; background:var(--mail-surface); overflow:hidden; }
.main-view { height:100%; min-width:0; overflow:auto; }
@media (max-width:767px) { .mail-surface { border-radius:0; } }
</style>

<template>
  <Teleport to="body"
    ><div
      v-if="visible"
      id="mail-control-tip"
      role="tooltip"
      class="mail-control-tip"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      {{ label }}
    </div></Teleport
  >
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref } from "vue";
const visible = ref(false),
  label = ref(""),
  x = ref(0),
  y = ref(0);
let timer, target;
function hide() {
  clearTimeout(timer);
  visible.value = false;
  target = null;
}
function enter(event) {
  const button = event.target.closest?.("[data-tip]");
  if (!button || button.disabled || event.pointerType === "touch") {
    hide();
    return;
  }
  if (target === button) return;
  hide();
  target = button;
  timer = setTimeout(() => {
    if (!button.isConnected || !button.getClientRects().length) return;
    const rect = button.getBoundingClientRect();
    label.value = button.dataset.tip;
    const margin = Math.min(innerWidth / 2, label.value.length * 3.8 + 12);
    x.value = Math.min(
      innerWidth - margin,
      Math.max(margin, rect.left + rect.width / 2),
    );
    y.value =
      rect.bottom + 6 > innerHeight - 30 ? rect.top - 32 : rect.bottom + 6;
    visible.value = true;
  }, 450);
}
function leave(event) {
  if (target && !target.contains(event.relatedTarget)) hide();
}
const events = {
  pointerover: enter,
  pointerout: leave,
  focusin: enter,
  focusout: leave,
  pointerdown: hide,
  keydown: hide,
  scroll: hide,
};
onMounted(() => {
  for (const [type, listener] of Object.entries(events))
    document.addEventListener(type, listener, true);
});
onBeforeUnmount(() => {
  hide();
  for (const [type, listener] of Object.entries(events))
    document.removeEventListener(type, listener, true);
});
</script>
<style scoped>
.mail-control-tip {
  position: fixed;
  transform: translateX(-50%);
  z-index: 5000;
  padding: 4px 8px;
  border-radius: 4px;
  background: #353638;
  color: white;
  font:
    500 12px/18px Arial,
    sans-serif;
  pointer-events: none;
  white-space: nowrap;
}
</style>

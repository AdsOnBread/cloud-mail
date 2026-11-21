<template>
  <Teleport to="body"
    ><div
      v-if="visible"
      ref="tip"
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
import { onMounted, onBeforeUnmount, nextTick, ref } from "vue";
const tip = ref(null);
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
  timer = setTimeout(async () => {
    if (!button.isConnected || !button.getClientRects().length) return;
    const rect = button.getBoundingClientRect();
    label.value = button.dataset.tip;
    visible.value = true;
    await nextTick();
    if (!tip.value || target !== button) return;
    const margin = tip.value.offsetWidth / 2 + 4;
    x.value = Math.min(
      innerWidth - margin,
      Math.max(margin, rect.left + rect.width / 2),
    );
    y.value =
      rect.bottom + 8 + tip.value.offsetHeight > innerHeight
        ? Math.max(4, rect.top - tip.value.offsetHeight - 8)
        : rect.bottom + 8;
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
  background: #3c4043;
  box-shadow: 0 1px 3px #0002;
  max-width: calc(100vw - 8px);
  overflow-wrap: anywhere;
  color: white;
  font:
    500 12px/18px Arial,
    sans-serif;
  pointer-events: none;
  line-height: 16px;
}
</style>

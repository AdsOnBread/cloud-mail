<template>
  <button
    ref="trigger"
    :id="id"
    :class="triggerClass"
    :disabled="disabled"
    type="button"
    :aria-label="label"
    :data-tip="tooltip || label"
    :aria-haspopup="role"
    :aria-expanded="modelValue"
    :aria-controls="modelValue ? id + '-popup' : undefined"
    @mousedown.prevent
    @click="modelValue ? closeToTrigger() : emit('update:modelValue', true)"
    @keydown.down.prevent="emit('update:modelValue', true)"
    @keydown.up.prevent="emit('update:modelValue', true)"
  >
    <slot name="trigger" />
  </button>
  <Teleport to="body"
    ><div
      v-if="modelValue"
      ref="panel"
      :id="id + '-popup'"
      :role="role"
      :aria-label="panelLabel || label"
      :class="['compose-format-popup', panelClass]"
      class="format-popup"
      :style="positionStyle"
      @keydown.esc.stop.prevent="closeToTrigger"
      @keydown.tab="tabOut"
    >
      <slot /></div
  ></Teleport>
</template>
<script setup>
import { nextTick, ref, useId, watch } from "vue";
const props = defineProps({
  modelValue: Boolean,
  triggerClass: String,
  disabled: Boolean,
  label: String,
  tooltip: String,
  panelLabel: String,
  role: { type: String, default: "menu" },
  panelClass: String,
  centered: Boolean,
});
const emit = defineEmits(["update:modelValue", "open", "ready"]);
const id = useId(),
  trigger = ref(null),
  panel = ref(null),
  positionStyle = ref({ visibility: "hidden" });
function position() {
  if (!trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect(),
    box = panel.value.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0,
    top = viewport?.offsetTop || 0;
  const right =
      left + (viewport?.width || document.documentElement.clientWidth),
    bottom = top + (viewport?.height || document.documentElement.clientHeight);
  const x = props.centered ? anchor.left + (anchor.width - box.width) / 2 : anchor.left;
  const gap = props.centered ? 8 : 6;
  const spaceAbove = Math.max(0, anchor.top - gap - top - 6);
  const spaceBelow = Math.max(0, bottom - 6 - anchor.bottom - gap);
  // Use the full list height even when the previous viewport made it scroll.
  const height = Math.max(box.height, panel.value.scrollHeight);
  const above = height <= spaceAbove || (height > spaceBelow && spaceAbove >= spaceBelow);
  const maxHeight = props.centered ? (above ? spaceAbove : spaceBelow) : bottom - top - 12;
  const y = above ? anchor.top - gap - Math.min(height, maxHeight) : anchor.bottom + gap;
  positionStyle.value = {
    maxHeight: Math.max(0, maxHeight) + "px",
    maxWidth: Math.max(0, right - left - 12) + "px",
    left: Math.max(left + 6, Math.min(x, right - box.width - 6)) + "px",
    top: Math.max(top + 6, Math.min(y, bottom - Math.min(height, maxHeight) - 6)) + "px",
  };
}
function closeToTrigger() {
  emit("update:modelValue", false);
  trigger.value?.focus({ preventScroll: true });
}
function tabOut(event) {
  const controls = [
    ...panel.value.querySelectorAll("input:not(:disabled), button:not(:disabled)"),
  ].filter((b) => b.tabIndex >= 0);
  const edge = event.shiftKey ? controls[0] : controls.at(-1);
  const beyondEdge = event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  if (props.role === "menu" || event.target === edge ||
      (edge?.compareDocumentPosition(event.target) & beyondEdge)) closeToTrigger();
}
watch(
  () => props.modelValue,
  async (open, old, cleanup) => {
    if (!open) return;
    let live = true;
    const outside = (event) => {
      if (
        !panel.value?.contains(event.target) &&
        !trigger.value?.contains(event.target)
      )
        emit("update:modelValue", false);
    };
    const iframeFocus = () => {
      if (document.activeElement?.tagName === "IFRAME")
        emit("update:modelValue", false);
    };
    const resize = new ResizeObserver(position);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("blur", iframeFocus);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    cleanup(() => {
      live = false;
      resize.disconnect();
      positionStyle.value = { visibility: "hidden" };
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      window.removeEventListener("blur", iframeFocus);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
    });
    emit("open");
    await nextTick();
    if (!live || !panel.value || !trigger.value) return;
    resize.observe(panel.value);
    resize.observe(trigger.value);
    position();
    await nextTick();
    if (live) emit("ready");
  },
);
</script>
<style scoped>
.format-popup {
  position: fixed;
  z-index: 2400;
  box-sizing: border-box;
  max-width: calc(100vw - 12px);
  max-height: calc(100dvh - 12px);
  overflow: auto;
  background: var(--mail-surface);
  color: var(--el-text-color-primary);
  border: 0;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(60, 64, 67, .3), 0 2px 6px 2px rgba(60, 64, 67, .15);
  animation: format-popup-in 0.1s ease-out;
}
@media (forced-colors: active) {
  .format-popup {outline: 1px solid CanvasText;}
  .format-popup :deep(button:focus-visible) {outline: 2px solid Highlight; outline-offset: -2px;}
}
@keyframes format-popup-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .format-popup {
    animation: none;
  }
}
</style>

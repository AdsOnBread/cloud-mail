<template>
  <el-popover
    v-model:visible="visible"
    trigger="click"
    placement="top-start"
    :show-arrow="false"
    :width="iconsOnly ? 44 : 174"
    :popper-class="
      'compose-format-popup format-choice-popup ' +
      (iconsOnly ? 'format-align-menu' : 'format-type-menu')
    "
    @show="onShow"
  >
    <template #reference>
      <button
        ref="trigger"
        type="button"
        :aria-label="label"
        :data-tip="tooltip"
        aria-haspopup="menu"
        :aria-expanded="visible"
        @mousedown.prevent
        @keydown.down.prevent="visible = true"
        @keydown.up.prevent="visible = true"
      >
        <slot /><Icon icon="material-symbols:arrow-drop-down" width="14" />
      </button>
    </template>
    <div
      ref="menu"
      class="choices"
      role="menu"
      :aria-label="label"
      @keydown="navigate"
    >
      <button
        v-for="(item, i) in choices"
        :key="item.value"
        type="button"
        role="menuitemradio"
        :aria-label="item.name"
        :aria-checked="item.value === value"
        :tabindex="i === position ? 0 : -1"
        :title="item.tooltip"
        @focus="position = i"
        @mousedown.prevent
        @click="choose(item.value)"
      >
        <Icon v-if="iconsOnly" :icon="item.icon" width="20" />
        <template v-else
          ><span class="check-slot"
            ><Icon
              v-if="item.value === value"
              icon="material-symbols:check"
              width="18"
          /></span>
          <span :style="item.style">{{ item.name }}</span></template
        >
      </button>
    </div>
  </el-popover>
</template>
<script setup>
import { nextTick, ref } from "vue";
import { Icon } from "@iconify/vue";
const props = defineProps({
  label: String,
  tooltip: String,
  choices: Array,
  value: String,
  iconsOnly: Boolean,
});
const emit = defineEmits(["open", "choose"]);
const visible = ref(false),
  position = ref(0),
  trigger = ref(null),
  menu = ref(null);
function focusAt(index) {
  position.value = index;
  menu.value?.children[index]?.focus({ preventScroll: true });
  menu.value?.children[index]?.scrollIntoView({ block: "nearest" });
}
async function onShow() {
  emit("open");
  await nextTick();
  if (visible.value)
    focusAt(
      Math.max(
        0,
        props.choices.findIndex((item) => item.value === props.value),
      ),
    );
}
function choose(value) {
  visible.value = false;
  emit("choose", value);
}
function navigate(event) {
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
    }
    visible.value = false;
    trigger.value?.focus({ preventScroll: true });
    return;
  }
  const n = props.choices.length;
  const index = {
    ArrowDown: (position.value + 1) % n,
    ArrowUp: (position.value + n - 1) % n,
    Home: 0,
    End: n - 1,
  }[event.key];
  if (index === undefined) return;
  event.stopPropagation();
  event.preventDefault();
  focusAt(index);
}
</script>
<style scoped>
.choices {
  max-height: min(370px, 55vh);
  overflow: auto;
  padding: 4px 0;
}
.choices button {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  color: var(--el-text-color-primary);
  text-align: left;
  font:
    14px/1 Arial,
    sans-serif;
  cursor: pointer;
}
.choices button:hover,
.choices button:focus-visible {
  outline: 0;
  background: var(--mail-hover);
}
.choices button span {
  white-space: nowrap;
}
.check-slot {
  width: 18px;
  display: inline-flex;
  justify-content: center;
  margin-right: 12px;
}
:global(.format-choice-popup.el-popover) {
  padding: 0;
  min-width: 0;
  background: var(--mail-surface);
  border: 1px solid var(--light-border-color);
  border-radius: 6px;
  box-shadow: 0 2px 6px #0003;
}
:global(.format-align-menu [aria-checked="true"]) {
  color: var(--el-color-primary);
  background: var(--mail-selected);
}
</style>

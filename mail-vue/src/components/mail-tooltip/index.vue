<template>
  <Teleport to="body"
    ><div
      v-if="visible"
      ref="tip"
      id="mail-control-tip"
      role="tooltip"
      class="mail-control-tip"
      :style="{ left: x + 'px', top: y + 'px', visibility: placed ? 'visible' : 'hidden' }"
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
const placed=ref(false);
const descriptionId="mail-control-tip";
let timer,target,size,attributes,pointerTimer,pointerFocus=false;
function descriptions(button) {
  return (button.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
}
function hide() {
  clearTimeout(timer);
  size?.disconnect();
  attributes?.disconnect();
  if (target && visible.value) {
    const other=descriptions(target).filter(id=>id!==descriptionId);
    if (other.length) target.setAttribute('aria-describedby',other.join(' '));
    else target.removeAttribute('aria-describedby');
  }
  visible.value=false;
  placed.value=false;
  target=null;
}
function available(button) {
  return button.isConnected && button.dataset.tip && !button.disabled && button.getClientRects().length;
}
function position() {
  if (!target || !tip.value) return;
  if (!available(target)) return hide();
  const rect=target.getBoundingClientRect(),box=tip.value.getBoundingClientRect();
  const viewport=window.visualViewport;
  const left=viewport?.offsetLeft || 0, top=viewport?.offsetTop || 0;
  const right=left+(viewport?.width || innerWidth),bottom=top+(viewport?.height || innerHeight);
  const above=rect.top-box.height-8,below=rect.bottom+8;
  const preferAbove=target.closest('[data-tip-placement]')?.dataset.tipPlacement==='top';
  x.value=Math.max(left+4+box.width/2,Math.min(rect.left+rect.width/2,right-4-box.width/2));
  y.value=Math.max(top+4,Math.min((preferAbove && above>=top+4) || below+box.height>bottom-4 ? above : below,bottom-4-box.height));
  placed.value=true;
}
async function reveal(button) {
  if (target!==button || !available(button)) return hide();
  label.value=button.dataset.tip;
  visible.value=true;
  await nextTick();
  if (target!==button || !tip.value) return;
  button.setAttribute('aria-describedby',[...new Set([...descriptions(button),descriptionId])].join(' '));
  size=new ResizeObserver(position);
  size.observe(button);
  size.observe(tip.value);
  attributes=new MutationObserver(()=>{
    if (!available(button)) return hide();
    label.value=button.dataset.tip;
  });
  attributes.observe(button,{attributes:true,attributeFilter:['data-tip','hidden','disabled']});
  position();
}
function enter(event) {
  if (event.type==='focusin' && pointerFocus) return;
  const button=event.target.closest?.('[data-tip]');
  if (!button || button.disabled || event.pointerType==='touch') return hide();
  if (target===button) return;
  hide();
  target=button;
  timer=setTimeout(()=>reveal(button),450);
}
function leave(event) {
  if (target?.contains(event.target) && !target.contains(event.relatedTarget)) hide();
}
function pointerDown(){clearTimeout(pointerTimer);pointerFocus=true;hide();}
function pointerEnd(){
  // Focus caused by a tap or click occurs during the gesture. A subsequent
  // Tab can originate inside the editor iframe, outside this document.
  clearTimeout(pointerTimer);
  pointerTimer=setTimeout(()=>{pointerFocus=false;},0);
}
function keyDown(){pointerFocus=false;hide();}
const events={pointerover:enter,pointerout:leave,focusin:enter,focusout:leave,pointerdown:pointerDown,pointerup:pointerEnd,pointercancel:pointerEnd,click:pointerEnd,keydown:keyDown,scroll:hide};
onMounted(()=>{
  for (const [type,listener] of Object.entries(events)) document.addEventListener(type,listener,true);
  window.addEventListener('blur',hide);
  window.addEventListener('resize',hide);
  window.visualViewport?.addEventListener('resize',hide);
  window.visualViewport?.addEventListener('scroll',hide);
});
onBeforeUnmount(()=>{
  clearTimeout(pointerTimer);
  hide();
  for (const [type,listener] of Object.entries(events)) document.removeEventListener(type,listener,true);
  window.removeEventListener('blur',hide);
  window.removeEventListener('resize',hide);
  window.visualViewport?.removeEventListener('resize',hide);
  window.visualViewport?.removeEventListener('scroll',hide);
});
</script>
<style scoped>
.mail-control-tip {
  position: fixed;
  box-sizing:border-box;
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

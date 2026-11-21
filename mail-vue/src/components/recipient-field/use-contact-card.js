import {nextTick,onBeforeUnmount,ref,shallowRef} from "vue";

// Reader headers and compose windows share one active card per document.
let active;
export function dismissContactCard() { active?.close(); }

export function useContactCard() {
  const target=shallowRef(null),pinned=ref(false),card=ref();
  let timer;
  function hold() {clearTimeout(timer);}
  function close(restore=false) {
    hold();
    const trigger=target.value?.trigger;
    if (active?.close===close) active=null;
    target.value=null;pinned.value=false;
    if (restore && trigger?.isConnected) trigger.focus({preventScroll:true});
  }
  async function open(next,focus=false) {
    if (!next.anchor?.getClientRects().length || (!focus && document.querySelector(".recipient-menu"))) return;
    if (active && active.close!==close) {
      if (!focus && active.pinned.value) return;
      active.close();
    }
    hold();
    active={close,pinned};
    target.value=next;pinned.value=focus;
    if (focus) {await nextTick();card.value?.focus();}
  }
  function hover(event,show) {
    if (event.pointerType!=="mouse" || pinned.value) return;
    hold();timer=setTimeout(show,500);
  }
  function leave() {
    hold();
    if (!pinned.value) timer=setTimeout(()=>{
      if (!card.value?.containsFocus()) close();
    },180);
  }
  onBeforeUnmount(()=>close());
  return {target,pinned,card,hold,close,open,hover,leave};
}

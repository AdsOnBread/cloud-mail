<template>
  <section ref="panel" class="mail-help-panel" role="dialog" aria-modal="false" aria-label="Help" :style="positionStyle"
    @keydown.esc.stop.prevent="escape">
    <header>
      <button type="button" tabindex="0" v-if="article || searching || notice" class="panel-icon back" aria-label="Back" @click="back">
        <Icon icon="material-symbols:arrow-back" width="20"/>
      </button>
      <h2><button type="button" tabindex="0" ref="handle" class="drag-title" aria-label="Move Help panel" :aria-describedby="instructionId"
        :aria-pressed="Boolean(keyboardOrigin)" @blur="keyboardOrigin=null" @keydown="moveKey" @pointerdown="startDrag" @pointermove="drag"
        @pointerup="endDrag" @lostpointercapture="endDrag">Help</button></h2>
      <button type="button" tabindex="0" class="panel-icon close" aria-label="Close Help panel" @click="emit('close')"><Icon icon="material-symbols:close" width="20"/></button>
    </header>
    <span class="sr-only" :id="instructionId">Press Space to move the Help panel with the arrow keys. Press Space again to finish, or Escape to cancel.</span>
    <div ref="scroller" class="help-scroll">
      <article v-if="article">
        <h3 ref="pageHeading" tabindex="-1">{{article.title}}</h3>
        <ol><li v-for="step in article.steps" :key="step">{{step}}</li></ol>
        <RouterLink tabindex="0" :to="{name:article.route}" @click="emit('close')">{{article.action}}</RouterLink>
      </article>
      <article v-else-if="notice">
        <h3 ref="pageHeading" tabindex="-1">Announcements</h3>
        <p>No announcements right now.</p>
      </article>
      <template v-else>
        <div class="resources">
          <h3 v-if="!searching">Popular help resources</h3>
          <label v-else class="help-search"><Icon icon="material-symbols:search" width="20"/>
            <input ref="field" v-model="query" type="search" aria-label="Search Help" placeholder="Search Help" autocomplete="off"/>
          </label>
          <ul>
            <li v-for="topic in matches" :key="topic.id">
              <button type="button" tabindex="0" :data-help-topic="topic.id" @click="read(topic)"><span class="article-icon"><Icon icon="material-symbols:article-outline" width="18"/></span>{{topic.title}}</button>
            </li>
          </ul>
          <p v-if="!matches.length" role="status">No matching help articles.</p>
          <button type="button" tabindex="0" v-if="!searching" ref="searchTrigger" class="help-search search-start" @click="search">
            <Icon icon="material-symbols:search" width="20"/>Search Help
          </button>
        </div>
        <section class="more-help">
          <h3>Need more help?</h3>
          <button type="button" tabindex="0" @click="emit('shortcuts')"><Icon icon="material-symbols:keyboard-outline" width="20"/>Keyboard shortcuts</button>
        </section>
      </template>
    </div>
  </section>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue';
import {Icon} from '@iconify/vue';
import {hasPerm} from '@/perm/perm';
import {helpTopics} from './topics';

const props=defineProps({initial:String}), emit=defineEmits(['close','shortcuts']);
const panel=ref(), handle=ref(), scroller=ref(), field=ref(), pageHeading=ref(), searchTrigger=ref();
const instructionId=useId(), query=ref(''), searching=ref(false), notice=ref(props.initial==='notice'), topicId=ref('');
const available=computed(()=>helpTopics.filter(topic=>!topic.permission || hasPerm(topic.permission)));
const article=computed(()=>available.value.find(topic=>topic.id===topicId.value));
const matches=computed(()=>{
  const words=query.value.toLowerCase().trim().split(/\s+/);
  return available.value.filter(topic=>{
    const text=[topic.title,...topic.steps].join(' ').toLowerCase();
    return words.every(word=>text.includes(word));
  });
});
let returnScroll=0;
function read(topic) {
  returnScroll=scroller.value.scrollTop;
  topicId.value=topic.id;
  nextTick(()=>{ if(scroller.value) scroller.value.scrollTop=0;pageHeading.value?.focus({preventScroll:true}); });
}
function search() {
  searching.value=true;
  nextTick(()=>field.value?.focus());
}
function back() {
  if(article.value) {
    const id=topicId.value;
    topicId.value='';
    nextTick(()=>{
      if(!scroller.value) return;
      scroller.value.scrollTop=returnScroll;
      scroller.value.querySelector('[data-help-topic="'+id+'"]')?.focus({preventScroll:true});
    });
  } else if(notice.value) { notice.value=false;nextTick(()=>handle.value?.focus()); }
  else { searching.value=false;query.value='';nextTick(()=>searchTrigger.value?.focus()); }
}
watch(available,topics=>{
  if(topicId.value && !topics.some(topic=>topic.id===topicId.value)) { topicId.value='';nextTick(()=>handle.value?.focus()); }
});

const position=ref(null), keyboardOrigin=ref(null);
let pointer=null;
const positionStyle=computed(()=>position.value ? {left:position.value.x+'px',top:position.value.y+'px',right:'auto',bottom:'auto'} : {});
function placed(x,y) {
  const r=panel.value.getBoundingClientRect(),v=window.visualViewport;
  const left=v?.offsetLeft || 0, top=v?.offsetTop || 0;
  return {x:Math.max(left,Math.min(x,left+(v?.width ?? document.documentElement.clientWidth)-r.width)),
    y:Math.max(top,Math.min(y,top+(v?.height ?? document.documentElement.clientHeight)-r.height))};
}
function fit() {
  if(!position.value || !panel.value) return;
  position.value=placed(position.value.x,position.value.y);
}
function startDrag(event) {
  if(!event.isPrimary || event.button!==0) return;
  const r=panel.value.getBoundingClientRect();
  pointer={id:event.pointerId,x:event.clientX-r.left,y:event.clientY-r.top};
  keyboardOrigin.value=null;
  handle.value.setPointerCapture(event.pointerId);
}
function drag(event) {
  if(pointer?.id===event.pointerId) position.value=placed(event.clientX-pointer.x,event.clientY-pointer.y);
}
function endDrag(event) {
  if(pointer?.id===event.pointerId) pointer=null;
}
function moveKey(event) {
  if(event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  const r=panel.value.getBoundingClientRect();
  if(event.key===' ' || event.key==='Enter') {
    event.preventDefault();
    if(!event.repeat) keyboardOrigin.value=keyboardOrigin.value ? null : {position:position.value};
  } else if(keyboardOrigin.value && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
    event.preventDefault();event.stopPropagation();
    position.value=placed(r.left+({ArrowLeft:-16,ArrowRight:16}[event.key]||0),
      r.top+({ArrowUp:-16,ArrowDown:16}[event.key]||0));
  } else if(event.key==='Tab') keyboardOrigin.value=null;
}
function escape() {
  if(keyboardOrigin.value) { position.value=keyboardOrigin.value.position; keyboardOrigin.value=null;fit(); }
  else emit('close');
}
onMounted(()=>{
  handle.value.focus({preventScroll:true});
  window.addEventListener('resize',fit);
  window.visualViewport?.addEventListener('resize',fit);
  window.visualViewport?.addEventListener('scroll',fit);
});
onBeforeUnmount(()=>{
  window.removeEventListener('resize',fit);
  window.visualViewport?.removeEventListener('resize',fit);
  window.visualViewport?.removeEventListener('scroll',fit);
});
</script>
<style scoped>
.mail-help-panel{position:fixed;box-sizing:border-box;right:22px;bottom:10px;z-index:1900;width:min(360px,calc(100vw - 20px));height:min(572px,calc(100dvh - 20px));display:flex;flex-direction:column;overflow:hidden;border-radius:12px;background:white;color:#1f1f1f;box-shadow:0 4px 16px #0004,0 1px 4px #0002;font:16px/24px Arial,sans-serif;animation:help-appear .14s ease-out}
@keyframes help-appear{from{opacity:0}to{opacity:1}}
header{display:grid;grid-template-columns:40px minmax(0,1fr) 40px;align-items:center;flex:none;min-height:64px;padding:0 12px}
h2{margin:0;grid-column:2;font:500 22px/28px Arial,sans-serif;text-align:center}
.drag-title{display:block;width:100%;height:50px;touch-action:none;cursor:grab;user-select:none;font:inherit}
.drag-title:is(:active,[aria-pressed=true]){cursor:grabbing}
.panel-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:50%;cursor:pointer}.panel-icon:is(:hover,:focus-visible){background:#f0f1f1}
.close{grid-column:3}.back{grid-column:1}
.help-scroll{min-height:0;overflow:auto;overscroll-behavior:contain}
.resources,.more-help,article{padding:8px 16px 16px}
h3{font:600 16px/24px Arial,sans-serif;margin:0 0 6px}
ul{list-style:none;margin:0;padding:0}
li button,.more-help button,.help-search{display:flex;align-items:center;gap:12px;text-align:start;min-height:54px;width:100%;font:inherit}
li button,.more-help button,.search-start{cursor:pointer}
li button{border-radius:8px;padding:8px 0}
li button:is(:hover,:focus-visible),.more-help button:hover{background:#f5f6f7}
.article-icon{flex:none;display:grid;place-items:center;border-radius:50%;width:36px;height:36px;background:#edf2fc;color:#315fa6}
.help-search{border-radius:28px;background:#f1f1f1;height:48px;min-height:48px;gap:18px;padding:0 16px;margin:12px 0 0}
.help-search input{width:0;flex:1;font:inherit;color:inherit}.help-search:focus-within{outline:2px solid #0b57d0}
.more-help{border-top:6px solid #f1f1f1;padding-top:14px}
.more-help button{color:#0b57d0;gap:10px}
article h3{font-size:20px;line-height:26px}
article ol{padding-inline-start:22px;margin:16px 0}article li{margin-bottom:12px}
article a{color:#0b57d0;text-decoration:underline}
.sr-only{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap}
@media(max-width:420px){.mail-help-panel{right:10px}}
@media(prefers-reduced-motion:reduce){.mail-help-panel{animation:none}}
@media(forced-colors:active){.mail-help-panel,.help-search{border:1px solid CanvasText}}
</style>
<style>
.mail-header[inert] .mail-help-panel{visibility:hidden}
html.dark .mail-help-panel{background:var(--mail-surface);color:var(--el-text-color-primary)}
html.dark .mail-help-panel :is(.help-search,li button:hover,li button:focus-visible,.panel-icon:hover,.panel-icon:focus-visible,.more-help button:hover){background:var(--mail-hover)}
html.dark .mail-help-panel .more-help{border-color:var(--light-border-color)}
html.dark .mail-help-panel .article-icon{background:#30445e;color:#b7d1ff}
html.dark .mail-help-panel :is(article a,.more-help button){color:#a8c7fa}
</style>

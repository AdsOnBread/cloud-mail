<template>
  <div>
    <button v-if="hasRemoteImages && !remote" class="remote-toggle" @click="remote = true">Load remote images</button>
    <p v-if="error" role="status">{{ error }}</p>
    <div v-if="paragraphs" class="plain-paragraphs"><p v-for="(line,index) in paragraphs" :key="index">{{ line }}</p></div>
    <div v-else-if="flow" class="natural-flow"><Flow/></div>
    <iframe v-else-if="documentHTML" :key="documentHTML" :srcdoc="documentHTML" title="Email message" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" />
  </div>
</template>
<script setup>
import {naturalFlow} from './natural-flow';
import { ref, shallowRef, watch, onUnmounted } from 'vue'
import { useUiStore } from '@/store/ui.js'
import { privateFileURL, storedKey } from '@/utils/private-files'
const props = defineProps({ naturalFlow: Boolean, html: { type: String, required: true }, resolveFileUrl: { type: Function, default: privateFileURL }, fileKey: { type: Function, default: storedKey } })
const remote = ref(false)
const hasRemoteImages = ref(false)
const uiStore = useUiStore()
const documentHTML = ref('')
const paragraphs = ref(null), flow=shallowRef(null);
const Flow=()=>flow.value;
// Short, plain paragraphs can flow with the conversation using Vue's text escaping.
// Everything with formatting, attributes, links or media uses the isolated document.
function plainParagraphs(doc) {
  if (doc.head.children.length || doc.body.attributes.length || doc.documentElement.attributes.length) return null
  const nodes = [...doc.body.childNodes].filter(node=>node.nodeType!==3 || node.textContent.trim())
  if (!nodes.length || !nodes.every(node=>node.nodeName==='P' && !node.attributes.length &&
    [...node.childNodes].every(child=>child.nodeType===3 || (child.nodeName==='BR' && !child.attributes.length)))) return null
  return nodes.map(node=>[...node.childNodes].map(child=>child.nodeName==='BR'?'\n':child.textContent.replace(/[\t\n\f\r ]+/g,' ')).join(''))
}
const error = ref('')
let urls = []
let generation = 0
watch(() => [props.html, props.naturalFlow, remote.value, uiStore.dark], async () => {
  const current = ++generation
  const created = []
  const doc = new DOMParser().parseFromString(props.html, 'text/html')
  const plain=plainParagraphs(doc);
  const safeFlow=props.naturalFlow && !plain ? naturalFlow(doc) : null;
  doc.querySelectorAll('script,iframe,object,embed,form,meta,base,link,svg,math').forEach(e => e.remove())
  doc.querySelectorAll('*').forEach(e => Array.from(e.attributes).forEach(a => {
    if (/^on/i.test(a.name) || ['srcdoc','srcset','ping'].includes(a.name) || (/^(href|src|action)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value))) e.removeAttribute(a.name)
  }))
  doc.querySelectorAll('a').forEach(a => { a.target='_blank';a.rel='noopener noreferrer' })
  error.value = ''
  hasRemoteImages.value = Array.from(doc.images).some(image => !props.fileKey(image.getAttribute('src')) && /^(https?:)?\/\//i.test(image.getAttribute('src') || ''))
  await Promise.all(Array.from(doc.images).map(async image => {
    const key=props.fileKey(image.getAttribute('src'))
    if (!key) return
    try { const url=await props.resolveFileUrl(key);created.push(url);image.src=url } catch { image.removeAttribute('src');error.value='Some inline images are unavailable.' }
  }))
  if (current !== generation) { created.forEach(URL.revokeObjectURL);return }
  paragraphs.value=plain;flow.value=safeFlow;
  urls.forEach(URL.revokeObjectURL);urls=created
  const sources=remote.value ? 'https: http:' : ''
  const dir=(doc.body.dir || doc.documentElement.dir).toLowerCase()
  const lang=doc.body.lang || doc.documentElement.lang
  const direction=['rtl','ltr','auto'].includes(dir) ? ` dir="${dir}"` : ''
  const language=/^[a-z0-9-]{1,63}$/i.test(lang) ? ` lang="${lang}"` : ''
  documentHTML.value=`<!doctype html><html${direction}${language}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: ${sources}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;margin:0;background:${uiStore.dark ? '#242529' : '#fff'};color:${uiStore.dark ? '#e3e3e3' : '#1f1f1f'}}img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:#007aff}</style></head><body>${doc.body.innerHTML}</body></html>`
}, {immediate:true})
onUnmounted(() => { generation++;urls.forEach(URL.revokeObjectURL) })
</script>
<style scoped>
.natural-flow {font:14px/1.6 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}
.natural-flow :deep(blockquote) {margin:0 0 0 .8ex;border-inline-start:1px solid var(--light-border-color);padding-inline-start:1ex}
.plain-paragraphs { font:14px/1.6 Arial,Helvetica,sans-serif; overflow-wrap:anywhere; }
.plain-paragraphs p { margin:0 0 1em; white-space:pre-line; }
.plain-paragraphs p:last-child { margin-bottom:0; }
iframe{display:block;width:100%;min-height:280px;border:0;background:transparent;border-radius:0}.remote-toggle{border:0;background:transparent;color:#007aff;padding:10px 0;cursor:pointer;font:inherit}
</style>

<template>
  <div>
    <button v-if="hasRemoteImages && !remote" class="remote-toggle" @click="remote = true">Load remote images</button>
    <p v-if="error" role="status">{{ error }}</p>
    <iframe v-if="documentHTML" :key="documentHTML" :srcdoc="documentHTML" title="Email message" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" />
  </div>
</template>
<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useUiStore } from '@/store/ui.js'
import { privateFileURL, storedKey } from '@/utils/private-files'
const props = defineProps({ html: { type: String, required: true } })
const remote = ref(false)
const hasRemoteImages = ref(false)
const uiStore = useUiStore()
const documentHTML = ref('')
const error = ref('')
let urls = []
let generation = 0
watch(() => [props.html, remote.value, uiStore.dark], async () => {
  const current = ++generation
  const created = []
  const doc = new DOMParser().parseFromString(props.html, 'text/html')
  doc.querySelectorAll('script,iframe,object,embed,form,meta,base,link,svg,math').forEach(e => e.remove())
  doc.querySelectorAll('*').forEach(e => Array.from(e.attributes).forEach(a => {
    if (/^on/i.test(a.name) || ['srcdoc','srcset','ping'].includes(a.name) || (/^(href|src|action)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value))) e.removeAttribute(a.name)
  }))
  doc.querySelectorAll('a').forEach(a => { a.target='_blank';a.rel='noopener noreferrer' })
  error.value = ''
  hasRemoteImages.value = Array.from(doc.images).some(image => !storedKey(image.getAttribute('src')) && /^(https?:)?\/\//i.test(image.getAttribute('src') || ''))
  await Promise.all(Array.from(doc.images).map(async image => {
    const key=storedKey(image.getAttribute('src'))
    if (!key) return
    try { const url=await privateFileURL(key);created.push(url);image.src=url } catch { image.removeAttribute('src');error.value='Some inline images are unavailable.' }
  }))
  if (current !== generation) { created.forEach(URL.revokeObjectURL);return }
  urls.forEach(URL.revokeObjectURL);urls=created
  const sources=remote.value ? 'https: http:' : ''
  documentHTML.value=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: ${sources}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;margin:0;background:${uiStore.dark ? '#242529' : '#fff'};color:${uiStore.dark ? '#e3e3e3' : '#1f1f1f'}}img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:#007aff}</style></head><body>${doc.body.innerHTML}</body></html>`
}, {immediate:true})
onUnmounted(() => { generation++;urls.forEach(URL.revokeObjectURL) })
</script>
<style scoped>
iframe{display:block;width:100%;min-height:280px;border:0;background:transparent;border-radius:0}.remote-toggle{border:0;background:transparent;color:#007aff;padding:10px 0;cursor:pointer;font:inherit}
</style>

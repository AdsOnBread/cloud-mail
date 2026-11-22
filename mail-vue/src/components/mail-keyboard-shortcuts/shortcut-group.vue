<template>
  <section v-if="items.length" class="shortcut-group">
    <h3>{{title}}</h3>
    <dl><div v-for="item in items" :key="item.keys">
      <dt><template v-for="(part,i) in item.keys.split(/ (then|\+|\/) /)" :key="i"><span v-if="i%2" class="join"> {{ part }} </span><kbd v-else>{{ part }}</kbd></template> <span aria-hidden="true">:</span></dt>
      <dd>{{item.label}}</dd>
    </div></dl>
  </section>
</template>
<script setup>
defineProps({title:String,items:Array});
</script>
<style scoped>
.shortcut-group{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:baseline;column-gap:.3em;margin:0;font:14px/normal Arial,sans-serif}
h3{grid-column:2;font:700 14px/normal Arial,sans-serif;color:#dd0;margin:0;padding-top:.8em}
dl,dl>div{display:contents}
dt,dd{margin:0;padding-top:.15em}dt{text-align:end;font-weight:bold;white-space:nowrap}
kbd{color:#dd0;font:bold 14px/normal "Courier New",monospace}.join{font-size:12px}
</style>

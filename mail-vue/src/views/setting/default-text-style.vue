<template>
  <div class="style-editor">
    <div ref="toolbar" class="style-toolbar" role="toolbar" aria-label="Default text formatting" :inert="disabled">
      <FormatPicker label="Font" :choices="fontOptions" :value="model.font" @choose="change('font',$event,'Font')">
        <span class="font-name">{{model.font}}</span>
      </FormatPicker>
      <FormatPicker label="Text size" :choices="sizeOptions" :value="model.size" size-preview @choose="change('size',$event,'Text size')">
        <Icon icon="material-symbols:format-size" width="18"/>
      </FormatPicker>
      <FormatPopup v-model="colorsOpen" label="Text color" role="dialog" panel-label="Default text color" centered
        @ready="focusColor">
        <template #trigger><Icon icon="material-symbols:format-color-text" width="18"/><Icon icon="material-symbols:arrow-drop-down" width="14"/></template>
        <div ref="palette" class="default-style-colors">
          <ColorGrid title="Text color" :colors="colors" :columns="8" :selected="model.color || '#000000'" @choose="change('color',$event,'Text color')"/>
        </div>
      </FormatPopup>
      <button type="button" aria-label="Remove formatting" data-tip="Remove formatting" @click="model={...defaultTextStyle}">
        <Icon icon="material-symbols:format-clear" width="18"/>
      </button>
    </div>
    <div class="sample-text" :style="textStyleCSS(model)">This is what your body text will look like.</div>
  </div>
</template>
<script setup>
import {ref} from 'vue';
import {Icon} from '@iconify/vue';
import FormatPicker from '@/components/tiny-editor/format-picker.vue';
import FormatPopup from '@/components/tiny-editor/format-popup.vue';
import ColorGrid from '@/components/mail-labels/color-grid.vue';
import {colorRows,defaultTextStyle,fonts,sizes,textStyleCSS} from '../../../../shared/mail-text-style';
const model=defineModel({type:Object,required:true});
defineProps({disabled:Boolean});
const toolbar=ref(null),palette=ref(null),colorsOpen=ref(false);
const colors=colorRows.flat();
const fontOptions=fonts.map(([name,fontFamily])=>({name,value:name,style:{fontFamily}}));
const sizeOptions=sizes.map(([name,fontSize])=>({name,value:name,style:{fontSize}}));
function focusColor(){palette.value?.querySelector('[tabindex="0"]')?.focus();}
function change(key,value,trigger){
  model.value={...model.value,[key]:value};
  colorsOpen.value=false;
  toolbar.value.querySelector(`[aria-label="${trigger}"]`)?.focus({preventScroll:true});
}
</script>
<style scoped>
.style-toolbar{display:inline-flex;align-items:center;gap:4px;padding:4px 6px;background:var(--mail-hover);border-radius:4px;max-width:100%}
.style-toolbar :deep(button){display:inline-flex;align-items:center;justify-content:center;height:24px;padding:2px;color:inherit;background:transparent;border:0;border-radius:3px;font:14px/20px Arial,sans-serif;cursor:pointer}
.style-toolbar :deep(button:hover),.style-toolbar :deep(button[aria-expanded=true]){background:var(--mail-hover)}
.font-name{min-width:73px;text-align:start}
.sample-text{margin-top:8px;font:13px/1.4 Arial,sans-serif;overflow-wrap:anywhere}
.default-style-colors{width:160px;padding:8px;box-sizing:border-box}
.default-style-colors :deep(.color-grid){gap:0}
.default-style-colors :deep(button){height:18px;border:0;border-radius:0}
.default-style-colors :deep(button:nth-child(-n+16)){margin-bottom:6px}
</style>

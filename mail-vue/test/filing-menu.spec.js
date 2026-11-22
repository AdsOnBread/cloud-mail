import {expect,it} from "vitest";
import {mount} from "@vue/test-utils";
import {createPinia} from "pinia";
import {createMemoryHistory,createRouter} from "vue-router";
import Picker from "../src/components/mail-labels/picker.vue";
import {useUserStore} from "../src/store/user";
import {useMailLabels} from "../src/store/mail-labels";

it("preserves mixed label choices across searches and applies to the original selection",async()=>{
  const pinia=createPinia();
  const router=createRouter({history:createMemoryHistory(),routes:[{path:"/",component:{template:"<div/>"}}]});
  useUserStore(pinia).authenticatedToken="picker-test";localStorage.setItem("token","picker-test");
  const labels=useMailLabels(pinia);
  labels.items=[{id:1,name:"Projects"},{id:2,name:"Receipts"}];
  const wrapper=mount(Picker,{
    attachTo:document.body,
    props:{rows:[{lastEmailId:30,labelIds:[1]},{lastEmailId:44,labelIds:[]}]},
    global:{plugins:[pinia,router],stubs:{Icon:true,ElPopover:{props:["visible"],template:'<div><slot name="reference"/><slot v-if="visible"/></div>'}}},
  });
  try {
    wrapper.vm.show();
    await wrapper.vm.$nextTick();
    const input=wrapper.get('[aria-label="Search labels"]');
    await input.setValue("pro");
    let option=wrapper.get('[role="menuitemcheckbox"]');
    expect(option.attributes("aria-checked")).toBe("mixed");
    await input.trigger("keydown",{key:"ArrowDown"});
    expect(document.activeElement).toBe(option.element);
    await option.trigger("click");
    await input.setValue("receipt");
    option=wrapper.get('[role="menuitemcheckbox"]');
    await option.trigger("click");
    await wrapper.findAll('[role="menuitem"]').find(item=>item.text()==="Apply").trigger("click");
    expect(wrapper.emitted("apply")).toEqual([[{add:[1,2],remove:[]},[30,44]]]);
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Label as"].mail-icon').element);
  } finally { wrapper.unmount();localStorage.removeItem("token"); }
});

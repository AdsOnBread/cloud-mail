import {expect,it,vi} from 'vitest';
import {flushPromises,mount} from '@vue/test-utils';
import {createPinia} from 'pinia';
import CategoryOptions from '../src/components/mail-labels/category-options.vue';
import {categoryFolders} from '../src/utils/inbox-categories';
import {useMailLabels} from '../src/store/mail-labels';

it('keeps a failed message visibility choice open for retry and leaves sidebar visibility independent',async()=>{
  const pinia=createPinia(),labels=useMailLabels(pinia);
  labels.systemReady=true;
  labels.system={social:'show'};
  const save=vi.spyOn(labels,'setSystem').mockRejectedValueOnce(new Error('Please retry')).mockResolvedValueOnce();
  const wrapper=mount(CategoryOptions,{
    props:{folder:categoryFolders.find(folder=>folder.id==='social'),restoreFocus:vi.fn()},
    global:{plugins:[pinia],stubs:{Icon:true,ElPopover:{props:['visible'],template:'<div><slot name="reference"/><slot v-if="visible"/></div>'}}},
  });
  try {
    await wrapper.get('.category-trigger').trigger('keydown',{key:'ArrowDown'});
    const sidebar=wrapper.get('[aria-label="In label list"]');
    const messages=wrapper.get('[aria-label="In message list"]');
    expect(sidebar.get('[aria-checked="true"]').text()).toBe('Show');
    expect(messages.get('[aria-checked="true"]').text()).toBe('Hide');
    const show=messages.findAll('button')[0];
    await show.trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Please retry');
    expect(messages.get('[aria-checked="true"]').text()).toBe('Hide');
    await show.trigger('click');
    await flushPromises();
    expect(save.mock.calls).toEqual([['messages-social','show'],['messages-social','show']]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(labels.optionsAnchor).toBe(null);
  } finally {wrapper.unmount();}
});

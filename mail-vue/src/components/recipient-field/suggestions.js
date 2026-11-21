import {computed, nextTick, ref, watch} from 'vue';
import http from '@/axios';
import {isEmail} from '@/utils/verify-utils';
import {maxPersonTerm, personSearchKey} from '../../../../shared/mail-search-people';
import {positionMailboxPopup} from '../mail-popup-position';

export function useRecipientSuggestions(props, pending, input, editing, choose) {
  const panel=ref(), position=ref({}), typing=ref(false), people=ref([]), active=ref(-1);
  const query=computed(()=>typing.value && props.owner && props.accountId>0 ? pending.value.trim() : '');
  const options=computed(()=>{
    const needle=personSearchKey(query.value);
    if (!needle || needle.length>maxPersonTerm) return [];
    const omit=new Set([...props.otherRecipients,...props.modelValue.filter((_,index)=>index!==editing.value)].map(personSearchKey));
    const named=new Map(people.value.map(person=>[personSearchKey(person.email),person]));
    const known=[...props.recent,...Object.keys(props.names || {})].map(email=>{
      const name=props.names?.[email.toLowerCase()];
      return named.get(personSearchKey(email)) || {email,name:typeof name==='string' && name || email};
    });
    const result=[];
    for (const person of [...known,...people.value]) {
      const key=personSearchKey(person.email);
      if (omit.has(key) || !isEmail(person.email) ||
        ![person.name,person.email].some(text=>personSearchKey(text).includes(needle))) continue;
      omit.add(key);
      result.push(person);
      if (result.length===8) break;
    }
    return result;
  });
  function close() { typing.value=false; active.value=-1; }
  watch([()=>props.owner,()=>props.accountId],close,{flush:'sync'});
  watch(query,(term,_,cleanup)=>{
    people.value=[];
    if (!term || term.length>maxPersonTerm) return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const result=await http.get('/v1/search/people',{params:{folder:'compose',field:'any',accountId:props.accountId,q:term},
          noMsg:true,signal:controller.signal});
        if (!controller.signal.aborted) people.value=result;
      } catch { /* The field still accepts typed addresses offline. */ }
    },140);
    cleanup(()=>{clearTimeout(timer);controller.abort()});
  },{flush:'sync'});
  function place() {
    if (panel.value && input.value) position.value=positionMailboxPopup(panel.value,input.value,420,input.value);
  }
  watch([options,query],([items,term],[previous,previousTerm])=>{
    const selected=term===previousTerm ? previous?.[active.value] : null;
    const retained=selected ? items.findIndex(person=>person.email===selected.email) : -1;
    const exact=items.findIndex(person=>person.email.toLowerCase()===query.value.toLowerCase());
    active.value=retained>=0 ? retained : exact>=0 ? exact : items.length && !isEmail(query.value) ? 0 : -1;
    nextTick(place);
  },{flush:'sync'});
  watch(()=>Boolean(options.value.length), (open,_,cleanup)=>{
    if (!open) return;
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
    cleanup(()=>{
      window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);
      window.visualViewport?.removeEventListener('resize',place);window.visualViewport?.removeEventListener('scroll',place);
    });
  });
  function pick(person) { close();choose(person); }
  function keys(event) {
    const items=options.value;
    if (!items.length || event.shiftKey) return false;
    if (event.key==='Escape') close();
    else if (items.length && ['ArrowDown','ArrowUp'].includes(event.key)) {
      active.value=event.key==='ArrowDown' ? (active.value+1)%items.length :
        (active.value<=0 ? items.length-1 : active.value-1);
      panel.value?.children[active.value]?.scrollIntoView?.({block:'nearest'});
    } else if (items[active.value] && ['Enter','Tab'].includes(event.key)) pick(items[active.value]);
    else return false;
    event.preventDefault();event.stopPropagation();return true;
  }
  function highlighted(text) {
    const start=personSearchKey(text).indexOf(personSearchKey(query.value));
    return start<0 ? [text,'',''] : [text.slice(0,start),text.slice(start,start+query.value.length),text.slice(start+query.value.length)];
  }
  return {panel,position,typing,options,active,keys,close,pick,highlighted};
}

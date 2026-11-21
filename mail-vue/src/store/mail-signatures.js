import {defineStore} from 'pinia';
import http from '@/axios';
import {useUserStore} from './user';

const session = () => JSON.stringify([useUserStore().user.email,localStorage.getItem('token')]);
export const useMailSignatures = defineStore('mail-signatures',{
  state:()=>({owner:'',data:null,pending:null,checked:0,generation:0}),
  actions:{
    async load(fresh=false) {
      const owner=session();
      if(this.owner!==owner){
        this.owner=owner;this.data=null;this.pending=null;this.checked=0;this.generation++;
      }
      if(this.pending)return this.pending;
      if(!fresh && this.data && Date.now()-this.checked<30000)return this.data;
      const generation=this.generation;
      const request=http.get('/v1/signatures',{noMsg:true,timeout:5000}).then(data=>{
        if(session()!==owner || generation!==this.generation)return null;
        this.data=data;this.checked=Date.now();return data;
      }).finally(()=>{if(this.pending===request)this.pending=null;});
      this.pending=request;
      return request;
    },
    async save(value){
      const owner=this.owner;
      if(owner!==session())throw new Error('The signed-in account changed.');
      const data=await http.put('/v1/signatures',value,{noMsg:true});
      if(owner!==session())throw new Error('The signed-in account changed.');
      this.generation++;this.pending=null;this.checked=Date.now();this.data=data;
      return data;
    }
  }
});

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
      const request=http.get('/v1/signatures',{noMsg:true,timeout:5000,headers:{Authorization:localStorage.getItem('token')}}).then(data=>{
        if(session()!==owner || this.owner!==owner)return null;
        if(generation!==this.generation)return this.data;
        this.data=data;this.checked=Date.now();return data;
      }).catch(error=>{
        if(session()===owner && this.owner===owner && this.generation!==generation && this.data)return this.data;
        throw error;
      }).finally(()=>{if(this.pending===request)this.pending=null;});
      this.pending=request;
      return request;
    },
    rememberSaved(data){
      if(this.owner!==session() || (this.data?.version ?? 0)>data.version)return;
      this.generation++;this.pending=null;this.checked=Date.now();this.data=data;
    },
    async save(value){
      const owner=this.owner;
      if(owner!==session())throw new Error('The signed-in account changed.');
      const data=await http.put('/v1/signatures',value,{noMsg:true,headers:{Authorization:localStorage.getItem('token')}});
      if(owner!==session())throw new Error('The signed-in account changed.');
      this.rememberSaved(data);
      return data;
    }
  }
});

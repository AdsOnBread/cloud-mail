import { defineStore } from "pinia";
import http from "@/axios";
import { conversationAction } from "@/request/conversation";
const path = "/email/conversation/labels";

function labelAPI(store) {
  const owner=store.owner, token=store.sessionToken;
  const check=()=>{
    if (!owner || !token || owner!==store.owner || token!==store.sessionToken || token!==localStorage.getItem('token'))
      throw new Error('Your signed-in account changed. Reload to manage labels.');
  };
  async function call(method,path,...args) {
    check();
    const result=await http[method](path,...args,{noMsg:true,headers:{Authorization:token}});
    check();
    return result;
  }
  return {get:path=>call('get',path),delete:path=>call('delete',path),
    post:(path,body)=>call('post',path,body),put:(path,body)=>call('put',path,body)};
}

export const useMailLabels = defineStore("mail-labels", {
  state: () => ({
    items: [],
    system: {}, systemRequest:0, systemReady:false, systemError:"", moved:null,
    recentColors: [],
    optionsAnchor: null,
    colorRequest: 0,
    error: "",
    edit: null,
    applied: null,
    revealed: null,
    displayChanged: null,
    owner: "",
    sessionToken:null,
    request: 0,
  }),
  actions: {
    bindSession(owner,token) {
      if (this.owner===owner && this.sessionToken===token)return;
      // Only bind a new credential after loginUserInfo has identified its owner.
      const next={request:this.request+1,systemRequest:this.systemRequest+1,colorRequest:this.colorRequest+1};
      this.$reset();
      this.$patch(next);
      this.owner=owner;
      this.sessionToken=token;
    },
    async load(owner = this.owner) {
      if(owner!==this.owner)return;
      const request = ++this.request;
      this.error = "";
      if (!owner) return;
      try {
        const items = await labelAPI(this).get(path);
        if (request === this.request) this.items = items;
      } catch (e) {
        if (request === this.request)
          this.error = e.message || "Could not load labels.";
      }
    },
    async loadSystem(owner=this.owner) {
      const request=++this.systemRequest;
      if (!owner) return;
      try {
        const choices=await labelAPI(this).get('/v1/system-labels');
        if (request===this.systemRequest && owner===this.owner) {this.system=choices;this.systemReady=true;this.systemError="";}
      } catch(e) {
        if (request===this.systemRequest && owner===this.owner) this.systemError=e.message || "Could not load folder settings.";
      }
    },
    async setSystem(folder,mode) {
      const owner=this.owner;
      await labelAPI(this).put('/v1/system-labels/'+folder,{mode});
      if (owner===this.owner) {++this.systemRequest;this.system={...this.system,[folder]:mode};}
    },
    async save(id, name, anchors = [], parentId = null, move = null) {
      const owner = this.owner;
      const destination=move && this.edit?.destination;
      const creation=move || (this.edit?.onCreated ? this.edit : null);
      if (creation && !destination) {
        const intent=JSON.stringify([name,parentId]);
        if (creation.intent && creation.intent!==intent) creation.clientId=crypto.randomUUID();
        creation.intent=intent;
      }
      const label = destination || (id
        ? await labelAPI(this).put(path + "/" + id, { name, parentId })
        : await labelAPI(this).post(path, { name, parentId, ...(creation ? {clientId:creation.clientId} : {}) }));
      if (owner !== this.owner) return;
      ++this.request;
      this.items = [
        ...this.items.filter((item) => item.id !== id && item.id !== label.id),
        { ...this.items.find(item => item.id === label.id), ...label },
      ].sort((a, b) => a.name.localeCompare(b.name));
      if (move) {
        // The label can outlive a failed move. Keep its ID for a retry.
        this.edit = {...this.edit,destination:label,name:label.name,move};
        if (move.trash) await labelAPI(this).post('/v1/messages/move-from-trash',{emailIds:move.ids,labelId:label.id,clientId:move.clientId});
        else await conversationAction('move',move.ids,{labelId:label.id,fromLabelId:move.fromLabelId,clientId:move.clientId},labelAPI(this));
        if (this.owner===owner) this.moved={...move,labelId:label.id};
      } else if (anchors.length) {
        const trash=Boolean(this.edit?.trash);
        this.edit = { ...this.edit, id: label.id, name: label.name };
        const ops={add:[label.id],remove:[]};
        if (trash) await labelAPI(this).post("/v1/messages/trash-labels",{emailIds:anchors,...ops});
        else await conversationAction("label",anchors,ops,labelAPI(this));
        if (this.owner === owner)
          this.applied = { anchors: [...anchors], labelId: label.id, ...(trash ? {trash:true} : {}) };
      }
      if (owner !== this.owner) return;
      if (creation === this.edit) creation?.onCreated?.(label.id);
      this.edit = null;
      await this.load(owner);
      if(owner===this.owner)this.revealed={id:label.id};
    },
    async setDisplay(id, list, mode, ownsFocus) {
      const owner = this.owner;
      const changed = await labelAPI(this).put(path + "/" + id + "/display", { list, mode });
      if (owner !== this.owner) return;
      const item = this.items.find(label => label.id === id);
      const restore = ownsFocus?.();
      if (item) item[list] = changed[list];
      await this.load(owner);
      if (owner===this.owner && restore) this.displayChanged={id};
    },
    async loadRecentColors() {
      const request = ++this.colorRequest;
      try {
        const recent = await labelAPI(this).get("/email/conversation/label-colors");
        if (request === this.colorRequest) this.recentColors = recent;
      } catch { /* The palette remains usable when history is offline. */ }
    },
    async setColor(id, background, foreground, custom = false) {
      const owner = this.owner;
      const changed = await labelAPI(this).put(path + "/" + id + "/color", { background, foreground, custom });
      if (owner !== this.owner) return;
      const item = this.items.find(label => label.id === id);
      if (item) Object.assign(item, changed);
      if (custom) {
        ++this.colorRequest;
        this.recentColors = [{ background, foreground }, ...this.recentColors.filter(pair =>
          pair.background !== background || pair.foreground !== foreground)].slice(0, 6);
      }
      await this.load(owner);
    },
    async remove(id) {
      const owner = this.owner;
      await labelAPI(this).delete(path + "/" + id);
      if (owner !== this.owner) return;
      ++this.request;
      this.items = this.items.filter((item) => item.id !== id);
      this.edit = null;
      await this.load(owner);
    },
  },
});

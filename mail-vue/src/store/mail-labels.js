import { defineStore } from "pinia";
import http from "@/axios";
import { conversationAction } from "@/request/conversation";
const path = "/email/conversation/labels";

export const useMailLabels = defineStore("mail-labels", {
  state: () => ({
    items: [],
    system: {}, systemRequest:0, systemError:"", moved:null,
    recentColors: [],
    optionsAnchor: null,
    colorRequest: 0,
    error: "",
    edit: null,
    applied: null,
    revealed: null,
    displayChanged: null,
    owner: "",
    request: 0,
  }),
  actions: {
    async load(owner = this.owner) {
      if (this.owner !== owner) {
        this.items = [];
        this.system = {}; this.systemRequest++; this.systemError=""; this.moved=null;
        this.optionsAnchor = null;
        this.recentColors = [];
        this.colorRequest++;
        this.edit = null;
        this.applied = null;
        this.revealed = null;
        this.displayChanged = null;
        this.owner = owner;
      }
      const request = ++this.request;
      this.error = "";
      if (!owner) return;
      try {
        const items = await http.get(path, { noMsg: true });
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
        const choices=await http.get('/v1/system-labels',{noMsg:true});
        if (request===this.systemRequest && owner===this.owner) {this.system=choices;this.systemError="";}
      } catch(e) {
        if (request===this.systemRequest && owner===this.owner) this.systemError=e.message || "Could not load folder settings.";
      }
    },
    async setSystem(folder,mode) {
      const owner=this.owner;
      await http.put('/v1/system-labels/'+folder,{mode},{noMsg:true});
      if (owner===this.owner) {++this.systemRequest;this.system={...this.system,[folder]:mode};}
    },
    async save(id, name, anchors = [], parentId = null, move = null) {
      const owner = this.owner;
      const label = move && this.edit?.destination || (id
        ? await http.put(path + "/" + id, { name, parentId }, { noMsg: true })
        : await http.post(path, { name, parentId }, { noMsg: true }));
      if (owner !== this.owner) return;
      ++this.request;
      this.items = [
        ...this.items.filter((item) => item.id !== id && item.id !== label.id),
        { ...this.items.find(item => item.id === label.id), ...label },
      ].sort((a, b) => a.name.localeCompare(b.name));
      if (move) {
        // The label can outlive a failed move. Keep its ID for a retry.
        this.edit = {...this.edit,destination:label,name:label.name,move};
        if (move.trash) await http.post('/v1/messages/move-from-trash',{emailIds:move.ids,labelId:label.id},{noMsg:true});
        else await conversationAction('move',move.ids,{labelId:label.id,fromLabelId:move.fromLabelId});
        if (this.owner===owner) this.moved={...move,labelId:label.id};
      } else if (anchors.length) {
        this.edit = { ...this.edit, id: label.id, name: label.name };
        await conversationAction("label", anchors, {
          add: [label.id],
          remove: [],
        });
        if (this.owner === owner)
          this.applied = { anchors: [...anchors], labelId: label.id };
      }
      if (owner !== this.owner) return;
      this.edit = null;
      await this.load(owner);
      if(owner===this.owner)this.revealed={id:label.id};
    },
    async setDisplay(id, list, mode, ownsFocus) {
      const owner = this.owner;
      const changed = await http.put(path + "/" + id + "/display", { list, mode }, { noMsg: true });
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
        const recent = await http.get("/email/conversation/label-colors", { noMsg: true });
        if (request === this.colorRequest) this.recentColors = recent;
      } catch { /* The palette remains usable when history is offline. */ }
    },
    async setColor(id, background, foreground, custom = false) {
      const owner = this.owner;
      const changed = await http.put(path + "/" + id + "/color", { background, foreground, custom }, { noMsg: true });
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
      await http.delete(path + "/" + id, { noMsg: true });
      if (owner !== this.owner) return;
      ++this.request;
      this.items = this.items.filter((item) => item.id !== id);
      this.edit = null;
      await this.load(owner);
    },
  },
});

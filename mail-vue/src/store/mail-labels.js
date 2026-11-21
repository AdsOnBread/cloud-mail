import { defineStore } from "pinia";
import http from "@/axios";
import { conversationAction } from "@/request/conversation";
const path = "/email/conversation/labels";

export const useMailLabels = defineStore("mail-labels", {
  state: () => ({
    items: [],
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
    async save(id, name, anchors = [], parentId = null) {
      const owner = this.owner;
      const label = id
        ? await http.put(path + "/" + id, { name, parentId }, { noMsg: true })
        : await http.post(path, { name, parentId }, { noMsg: true });
      if (owner !== this.owner) return;
      ++this.request;
      this.items = [
        ...this.items.filter((item) => item.id !== id && item.id !== label.id),
        { ...this.items.find(item => item.id === label.id), ...label },
      ].sort((a, b) => a.name.localeCompare(b.name));
      if (anchors.length) {
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
    async setDisplay(id, list, mode) {
      const owner = this.owner;
      const changed = await http.put(path + "/" + id + "/display", { list, mode }, { noMsg: true });
      if (owner !== this.owner) return;
      const item = this.items.find(label => label.id === id);
      if (item) item[list] = changed[list];
      await this.load(owner);
      if (owner===this.owner) this.displayChanged={id};
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

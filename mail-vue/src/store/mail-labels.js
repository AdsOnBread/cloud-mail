import { defineStore } from "pinia";
import http from "@/axios";
import { conversationAction } from "@/request/conversation";
const path = "/email/conversation/labels";

export const useMailLabels = defineStore("mail-labels", {
  state: () => ({
    items: [],
    error: "",
    edit: null,
    applied: null,
    owner: "",
    request: 0,
  }),
  actions: {
    async load(owner = this.owner) {
      if (this.owner !== owner) {
        this.items = [];
        this.edit = null;
        this.applied = null;
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
    async save(id, name, anchors = []) {
      const owner = this.owner;
      const label = id
        ? await http.put(path + "/" + id, { name }, { noMsg: true })
        : await http.post(path, { name }, { noMsg: true });
      if (owner !== this.owner) return;
      ++this.request;
      this.items = [
        ...this.items.filter((item) => item.id !== id && item.id !== label.id),
        label,
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

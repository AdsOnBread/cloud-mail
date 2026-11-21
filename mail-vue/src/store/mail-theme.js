import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import db from "@/db/db";
import { useUiStore } from "./ui";

export const themes = [
  {
    id: "orbital-sunset",
    name: "Orbital sunset",
    image: "/themes/orbital-sunset.jpg",
  },
  { id: "aurora", name: "Aurora", image: "/themes/aurora.jpg" },
  { id: "himalayas", name: "Himalayas", image: "/themes/himalayas.jpg" },
  { id: "light", name: "Default", color: "#f6f8fc" },
  { id: "dark", name: "Dark", color: "#1b1b1f" },
  { id: "blue", name: "Blue", color: "#bfd9f2" },
  { id: "soft-gray", name: "Soft Gray", color: "#dce0e2" },
  { id: "lavender", name: "Lavender", color: "#e0cdea" },
  { id: "rose", name: "Rose", color: "#f2d1d7" },
  { id: "wasabi", name: "Wasabi", color: "#d6dfac" },
  { id: "spearmint", name: "Spearmint", color: "#c7e5d7" },
  { id: "seafoam", name: "Seafoam", color: "#bee2e4" },
];

export const useMailTheme = defineStore("mail-theme", () => {
  const ui = useUiStore(),
    selected = ref("base"),
    photoURL = ref(""),
    ready = ref(false);
  let generation = 0;
  function updatePhoto(blob) {
    if (photoURL.value) URL.revokeObjectURL(photoURL.value);
    photoURL.value = blob ? URL.createObjectURL(blob) : "";
  }
  watch(
    db,
    async (database) => {
      const request = ++generation;
      selected.value = "base";
      ready.value = false;
      updatePhoto(null);
      try {
        const record = await database.meta.get("mailTheme");
        if (request !== generation) return;
        updatePhoto(record?.photo);
        selected.value = record?.theme || "base";
        if (selected.value !== "base") ui.setDark(selected.value === "dark");
      } catch {
        /* The default palette works even when browser storage is unavailable. */
      } finally {
        if (request === generation) ready.value = true;
      }
    },
    { immediate: true, flush: "sync" },
  );

  const active = computed(() => {
    if (selected.value === "photo" && photoURL.value)
      return { id: "photo", name: "My photo", image: photoURL.value };
    return (
      themes.find((t) => t.id === selected.value) ||
      themes.find((t) => t.id === (ui.dark ? "dark" : "light"))
    );
  });
  async function apply(id, photo) {
    const database = db.value;
    if (!ready.value) throw new Error("Your theme is still loading.");
    await database.transaction("rw", database.meta, async () => {
      const storedPhoto =
        photo || (await database.meta.get("mailTheme"))?.photo;
      if (id === "photo" && !storedPhoto)
        throw new Error("Choose a photo first.");
      await database.meta.put({
        key: "mailTheme",
        theme: id,
        photo: storedPhoto,
      });
    });
    if (db.value !== database) return;
    if (photo) updatePhoto(photo);
    selected.value = id;
    ui.setDark(id === "dark");
  }
  return { active, photoURL, ready, apply };
});

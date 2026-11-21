export const inboxCategories = [
  { id: "primary", name: "Primary", icon: "inbox-outline", color: "#0b57d0" },
  {
    id: "promotions",
    name: "Promotions",
    icon: "sell-outline",
    color: "#188038",
  },
  { id: "social", name: "Social", icon: "group-outline", color: "#1a73e8" },
  { id: "updates", name: "Updates", icon: "info-outline", color: "#b06000" },
  { id: "forums", name: "Forums", icon: "forum-outline", color: "#a142f4" },
];

export const categoryFolders = [
  {id:"purchases", name:"Purchases", icon:"shopping-bag-outline", defaultMode:"show"},
  ...["social","updates","forums","promotions"].map(id => ({
    ...inboxCategories.find(item => item.id === id), defaultMode:"hide",
  })),
];
export const categoryMessageKey = id => "messages-" + id;

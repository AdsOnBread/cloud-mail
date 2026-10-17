import http from "@/axios/index.js";
export const conversationList = (params) =>
  http.get("/email/conversations", { params });
export const conversationMessages = (params) =>
  http.get("/email/conversation/messages", { params });
export const conversationAction = (action, emailIds, extra = {}) =>
  http.post(`/email/conversation/${action}`, { emailIds, ...extra });

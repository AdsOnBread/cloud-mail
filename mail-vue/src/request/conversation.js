import http from "@/axios/index.js";
export const conversationList = (params, token) =>
  http.get("/email/conversations", { params, ...(token ? {headers:{Authorization:token}} : {}) });
export const conversationMessages = (params) =>
  http.get("/email/conversation/messages", { params });
export const conversationAction = (action, emailIds, extra = {}, client = http, config) =>
  client.post(`/email/conversation/${action}`, { emailIds, ...extra }, config);
export const labelUnreadCounts = (params) =>
  http.get("/email/conversation/label-unread", { params, noMsg: true });

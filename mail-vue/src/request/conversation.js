import {useUserStore} from "@/store/user";
import http from "@/axios/index.js";
export const conversationList = (params, token) =>
  http.get("/email/conversations", { params, ...(token ? {headers:{Authorization:token}} : {}) });
export const conversationMessages = (params) =>
  http.get("/email/conversation/messages", { params });
export async function conversationAction(action,emailIds,extra={},client=http,config) {
  if (client===http) {
    const token=useUserStore().authenticatedToken;
    if (!token || token!==localStorage.getItem("token") || (config?.headers?.Authorization && config.headers.Authorization!==token))
      throw new Error("Your signed-in account changed. Reopen this mailbox.");
    config={...config,headers:{...config?.headers,Authorization:token}};
  }
  return client.post(`/email/conversation/${action}`,{emailIds,...extra},config);
}
export const labelUnreadCounts = (params) =>
  http.get("/email/conversation/label-unread", { params, noMsg: true });

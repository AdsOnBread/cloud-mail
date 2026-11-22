import {useUserStore} from "@/store/user";
import http from "@/axios/index.js";
export const conversationList = (params, token) =>
  http.get("/email/conversations", { params, ...(token ? {headers:{Authorization:token}} : {}) });
export const conversationMessages = (params, config) =>
  http.get("/email/conversation/messages", { ...config, params });
// A lost response can leave the action committed while its Undo token is still in transit.
let muteSession=null;
let muteRequests=new Map();
export async function conversationAction(action,emailIds,extra={},client=http,config) {
  if (client===http) {
    const token=useUserStore().authenticatedToken;
    if (!token || token!==localStorage.getItem("token") || (config?.headers?.Authorization && config.headers.Authorization!==token))
      throw new Error("Your signed-in account changed. Reopen this mailbox.");
    config={...config,headers:{...config?.headers,Authorization:token}};
    if (token!==muteSession) { muteSession=token; muteRequests=new Map(); }
    if (action==='mute' || action==='unmute') {
      const pending=muteRequests;
      const key=JSON.stringify([action,...[...emailIds].sort((a,b)=>a-b)]);
      const requestId=pending.get(key) || crypto.randomUUID();
      pending.set(key,requestId);
      const result=await client.post('/email/conversation/'+action,{emailIds,...extra,requestId},config);
      if (pending.get(key)===requestId) pending.delete(key);
      return result;
    }
  }
  return client.post(`/email/conversation/${action}`,{emailIds,...extra},config);
}
export const labelUnreadCounts = (params) =>
  http.get("/email/conversation/label-unread", { params, noMsg: true });

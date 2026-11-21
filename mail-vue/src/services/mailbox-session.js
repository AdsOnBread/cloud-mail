import { useUserStore } from "@/store/user";

export function mailboxSession() {
  const user = useUserStore();
  const token = localStorage.getItem("token");
  const owner = user.user.email;
  const check = () => {
    if (!owner || !token || user.user.email !== owner ||
        user.authenticatedToken !== token || localStorage.getItem("token") !== token) {
      throw new Error("The signed-in user changed. Draft synchronization stopped.");
    }
  };
  return {owner, token, check};
}

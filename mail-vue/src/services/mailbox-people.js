import { ref, watch } from "vue";
import http from "@/axios";

// Callers are scoped to one mounted mailbox. Cancel the previous request as soon
// as the search changes, even when its replacement is still being debounced.
export function useMailboxPeople(query, account, token, current) {
  const remote = ref([]),
    loading = ref(false),
    failed = ref(false),
    retry = ref(0);
  watch(
    [() => query.value.trim(), retry],
    ([term], _, cleanup) => {
      remote.value = [];
      failed.value = false;
      if (!current() || !account) return;
      const controller = new AbortController();
      loading.value = true;
      const timer = setTimeout(
        async () => {
          try {
            const result = await http.get("/v1/search/people", {
              params: {
                folder: "compose",
                field: "any",
                view: "picker",
                accountId: account,
                q: term,
              },
              headers: { Authorization: token },
              signal: controller.signal,
              noMsg: true,
            });
            if (current() && !controller.signal.aborted) remote.value = result;
          } catch {
            if (current() && !controller.signal.aborted) failed.value = true;
          } finally {
            if (!controller.signal.aborted) loading.value = false;
          }
        },
        term ? 140 : 0,
      );
      cleanup(() => {
        clearTimeout(timer);
        controller.abort();
      });
    },
    { immediate: true },
  );
  return { remote, loading, failed, retry };
}

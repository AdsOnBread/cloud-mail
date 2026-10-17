/** A refresh invalidates every older page; old completions cannot release the new request lock. */
export function createRequestGuard() {
  let generation = 0;
  let pending = false;
  return {
    begin(refresh = false) {
      if (!refresh && pending) return null;
      if (refresh) generation++;
      pending = true;
      return generation;
    },
    current(token) { return token === generation; },
    finish(token) { if (token === generation) pending = false; },
  };
}

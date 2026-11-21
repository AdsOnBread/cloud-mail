// During a switch the next window can acquire the mailbox before Vue releases
// the previous one. Restore the original state only after the last owner exits.
const locks = new WeakMap();

export function lockComposeBackground() {
  const nodes = [...document.querySelectorAll(
    '.mail-layout > .mail-header, .mail-layout > .mail-sidebar, .mail-layout > .mail-main, .mobile-compose, .nav-overlay',
  )];
  for (const node of nodes) {
    const lock = locks.get(node) || { count: 0, original: node.inert };
    lock.count++;
    locks.set(node, lock);
    node.inert = true;
  }
  return () => {
    for (const node of nodes.splice(0)) {
      const lock = locks.get(node);
      if (--lock.count === 0) {
        node.inert = lock.original;
        locks.delete(node);
      }
    }
  };
}

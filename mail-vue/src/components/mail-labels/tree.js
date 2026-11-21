// SQLite's NOCASE collation folds ASCII letters. Use the same identity for paths.
function pathKey(name) {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function inLabelBranch(path, root) {
  const key = pathKey(path),
    branch = pathKey(root);
  const suffix=key.slice(branch.length+1);
  return key===branch || (key.startsWith(branch+"/") && suffix.length>0 && !suffix.startsWith("/"));
}

// A slash-containing label without a matching ancestor remains accessible at the root.
export function labelTree(items) {
  const byPath = new Map(),
    byId = new Map(),
    roots = [];
  for (const label of items) {
    const node = { label, text: label.name, parent: null, children: [] };
    byPath.set(pathKey(label.name), node);
    byId.set(label.id, node);
  }
  for (const node of byId.values()) {
    const path = pathKey(node.label.name);
    for (
      let slash = path.lastIndexOf("/");
      slash > 0;
      slash = path.lastIndexOf("/", slash - 1)
    ) {
      if (slash === path.length - 1 || path[slash+1] === "/") continue;
      const parent = byPath.get(path.slice(0, slash));
      if (!parent) continue;
      node.parent = parent;
      node.text = node.label.name.slice(slash + 1);
      break;
    }
    (node.parent?.children || roots).push(node);
  }
  return { roots, byId };
}

export function openLabelRows(tree, expanded) {
  const rows = [],
    pending = tree.roots.map((node) => ({ node, depth: 0 })).reverse();
  while (pending.length) {
    const row = pending.pop();
    rows.push(row);
    if (expanded.has(row.node.label.id)) {
      for (let i = row.node.children.length - 1; i >= 0; i--)
        pending.push({ node: row.node.children[i], depth: row.depth + 1 });
    }
  }
  return rows;
}

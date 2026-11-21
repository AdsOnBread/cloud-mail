import { describe, it, expect } from "vitest";
import {
  labelTree,
  openLabelRows,
  inLabelBranch,
} from "../src/components/mail-labels/tree";
describe("nested labels", () => {
  const labels = [
    "Projects",
    "projects/Design",
    "Projects/Design/April",
    "Projects/Archive/June",
    "[Imap]/Outbox",
    "Projects/",
    "Ä",
    "ä/May",
  ].map((name, i) => ({ name, id: i + 1 }));
  it("shows standalone paths, groups by an existing ancestor and uses the database's case folding", () => {
    const tree = labelTree(labels);
    expect(tree.byId.get(2).parent.label.id).toBe(1);
    expect(tree.byId.get(3).parent.label.id).toBe(2);
    expect(tree.byId.get(4).text).toBe("Archive/June");
    expect(tree.byId.get(5).parent).toBeNull();
    expect(tree.byId.get(6).text).toBe("Projects/");
    expect(tree.byId.get(8).parent).toBeNull();
    expect(inLabelBranch("ProjectsX/May", "Projects")).toBe(false);
    expect(inLabelBranch("projects/Design", "Projects")).toBe(true);
  });
  it("uses branch expansion for navigation and keeps independently visible children reachable", () => {
    expect(
      openLabelRows(labelTree(labels), new Set([1])).map(
        (row) => row.node.label.id,
      ),
    ).toEqual([1, 2, 4, 5, 6, 7, 8]);
    expect(
      openLabelRows(labelTree(labels.slice(1)), new Set()).find(
        (row) => row.node.label.id === 2,
      )?.node.text,
    ).toBe("projects/Design");
  });
});

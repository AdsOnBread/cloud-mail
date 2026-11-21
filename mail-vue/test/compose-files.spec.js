import { expect, it } from "vitest";
import { planFiles, hasRichSelection } from "../src/components/message-composer/files";
const form = { attachments: [], subject: "Photo", text: "" };
const file = (name, type, size) => ({ name, type, size });

it("checks wrapped MIME size and includes the contents of older attachments that have no saved size", () => {
  const large = file("draft.pdf", "application/pdf", 3900000);
  expect(() => planFiles([large], "auto", form, "")).toThrow("5 MiB");
  const original = { filename: "old.bin", contentType: "application/octet-stream", content: "AAAA".repeat(400000) };
  expect(() => planFiles([{...large,size:2800000}], "auto", {...form,attachments:[original]}, "")).toThrow("5 MiB");
  expect(planFiles([{...large,size:2500000}], "auto", {...form,attachments:[original]}, "").attachments).toHaveLength(1);
});

it("keeps photos inline in rich mail and attaches files in plain text, counting each kind independently", () => {
  const png = file("screen.png","image/png",10), pdf=file("page.pdf","application/pdf",200);
  expect(planFiles([png,pdf],"auto",form,"")).toEqual({ photos:[png], attachments:[pdf] });
  expect(planFiles([png],"auto",{...form,plainText:true},"").attachments).toEqual([png]);
  expect(() => planFiles([png],"photos",form,'<img src="data:image/png;base64,AA==">'.repeat(10))).toThrow("10 inline");
  expect(planFiles([png],"attachments",form,"").attachments).toEqual([png]);
  expect(() => planFiles([pdf],"photos",form,"")).toThrow("Choose");
});

it("keeps formatted clipboard text when an application also puts a bitmap on the clipboard", () => {
  expect(hasRichSelection({getData:()=>"<b>Two words</b>"})).toBe(true);
  expect(hasRichSelection({getData:()=>'<style>img{max-width:100%}</style><img src="file:///image.png">'})).toBe(false);
});

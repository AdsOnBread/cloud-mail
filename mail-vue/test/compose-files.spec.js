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

it('measures local draft size using UTF-8 and one decoded file for repeated inline photos',async()=>{
 const {draftSearchBytes}=await import('../src/components/message-composer/files');
 const {sizeCriterion,matchesSize,storedMessageBytes}=await import('../../shared/mail-search-size');
 const photo='data:image/png;base64,YWJj', cid='0'.repeat(36);
 const f={subject:'☁',text:'é',content:'<img src="'+photo+'"><img src="'+photo+'">'};
 const canonical={...f,content:f.content.replaceAll(photo,'cid:'+cid)};
 const expected=storedMessageBytes(canonical,7);
 const attachment={filename:'note',content:'YWJjZA=='};
 expect(draftSearchBytes(f,[attachment])).toBe(expected);
 expect(draftSearchBytes(f,[attachment,{contentId:cid,content:photo}])).toBe(expected);
 expect(matchesSize(1048576,sizeCriterion({sizeValue:'1',sizeUnit:'MB'}))).toBe(false);
 expect(matchesSize(0,sizeCriterion({sizeValue:'0',sizeOperator:'smaller'}))).toBe(false);
 expect(sizeCriterion({sizeValue:'1.2'})).toBeNull();
});

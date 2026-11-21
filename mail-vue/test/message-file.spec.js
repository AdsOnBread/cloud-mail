// @vitest-environment node
import {describe, it, expect} from "vitest";
import PostalMime from "postal-mime";
import {messageFile, messageFilename} from "../src/utils/message-file";

const signal = new AbortController().signal;
const base = {
  emailId: 1, type: 0, userId: 1, name: "鈴木, 明", sendEmail: "ada@example.net",
  recipient: '[{"address":"reader@example.net","name":"Reed, Kim"}]',
  cc: ["second@example.net"], bcc: ["private@example.net"], toEmail: "reader@example.net",
  subject: "📬 Résumé ".repeat(15).trim(), createTime: "2020-02-29 13:45:46",
  messageId: "<world@example.net>", inReplyTo: "<hello@example.net>", relation: "<old@example.net> <hello@example.net>",
  text: "Hello there.\nThanks!", content: '<p>Hello <b>there</b>.</p><img src="{{domain}}attachments/one.png">',
};
describe("Download message", () => {
  it("round-trips the selected message, inline images, long names and attached bytes through a mail parser", async () => {
    const name = 'Résumé du projet 日本語 (雪) 📨.bin';
    const bytes = new Uint8Array(32001).map((_, i) => i % 256);
    const attList = [
      {attId: 100, filename: name, mimeType: "application/octet-stream", disposition: "attachment"},
      {attId: 101, filename: "snow.png", mimeType: "image/png", type: 1, contentId: "<snow@local>", key: "attachments/one.png"},
      {attId: 102, filename: "empty.txt", mimeType: "text/plain"},
    ];
    const read = f => new Blob([f.attId === 100 ? bytes : f.attId === 101 ? "image" : ""]);
    const file = await messageFile({...base, attList}, 1, read, signal);
    const mail = await PostalMime.parse(await file.arrayBuffer());
    expect(mail.from).toMatchObject({address: base.sendEmail, name: base.name});
    expect(mail.to[0].name).toBe("Reed, Kim");
    expect(mail.cc[0].address).toBe(base.cc[0]);
    expect(mail.bcc).toBeUndefined();
    expect(mail.subject).toBe(base.subject);
    expect(mail.date).toBe("2020-02-29T13:45:46.000Z");
    expect(mail.inReplyTo).toBe(base.inReplyTo);
    expect(mail.references).toBe(base.relation);
    expect(mail.text.trim().replace(/\r\n/g,"\n")).toBe(base.text);
    expect(mail.html).toContain('src="cid:snow@local"');
    expect(mail.attachments.map(f => f.filename)).toEqual(["snow.png", name, "empty.txt"]);
    expect(mail.attachments[0].contentId).toBe("<snow@local>");
    expect(new Uint8Array(mail.attachments[1].content)).toEqual(bytes);
    expect(mail.attachments[2].content.byteLength).toBe(0);
    expect((await file.text()).split("\r\n").every(line => line.length <= 998)).toBe(true);
  });
  it("exports Bcc only for the signed-in sender, and keeps a header-like subject in the subject field", async () => {
    for (const [type,owner,visible] of [[0,1,false],[1,2,false],[1,1,true]]) {
      const file = await messageFile({...base, type, subject:"Status\r\nCc: someone@example.net", content:"", text:""}, owner, null, signal);
      const mail = await PostalMime.parse(await file.arrayBuffer());
      expect(mail.bcc?.[0]?.address).toBe(visible ? base.bcc[0] : undefined);
      expect(mail.cc).toHaveLength(1);
      expect(mail.subject).toBe("Status Cc: someone@example.net");
    }
  });
  it("fails the whole download if a part is missing or canceled", async () => {
    await expect(messageFile({...base, attList:[{}]},1,()=>Promise.reject(new Error("Missing file")),signal)).rejects.toThrow("Missing file");
    await expect(messageFile(base,1,null,AbortSignal.abort())).rejects.toThrow();
  });
  it("retains the extension and bounds the filename in UTF-8 bytes", () => {
    expect(messageFilename(" /Q3: results? ")).toBe("_Q3_ results_.eml");
    expect(messageFilename("...")).toBe("(no subject).eml");
    expect(Buffer.byteLength(messageFilename("雪".repeat(200)))).toBeLessThan(256);
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import {changeQuotedBody} from "../src/components/message-composer/response";
import {plainMarkup} from "../src/components/message-composer/plain-text";
import { quotedMessage, quotedConversation } from "../src/components/message-composer/quoted-message";
import { attachmentBlob } from "@/components/mail-attachments/content";

vi.mock("@/components/mail-attachments/content", () => ({
  attachmentBlob: vi.fn(),
}));

const logo = {
  filename: "logo.png",
  contentId: "<logo>",
  mimeType: "image/png",
  disposition: "inline",
};
const report = {
  filename: "report.txt",
  mimeType: "text/plain",
  disposition: "attachment",
};
const message = {
  sendEmail: "maya@example.net",
  name: "Maya <Team>",
  subject: "Report & forecast",
  recipient: ["to@example.net"],
  cc: ["copy@example.net"],
  bcc: ["hidden@example.net"],
  content:
    '<p>Forecast</p><img src="cid:logo"><img src="cid:missing" alt="Old logo">',
  attList: [logo, report],
};
const signal = new AbortController().signal;
beforeEach(() => {
  attachmentBlob.mockReset().mockImplementation(
    async file => new Blob([file === logo ? "png" : "report"])
  );
});

it("keeps inline images and forward file bytes while quoting only visible recipient headers", async () => {
  const { content, attachments } = await quotedMessage(
    message,
    "forward",
    signal,
    "session",
  );
  expect(content).toContain("Maya &lt;Team&gt;");
  expect(content).toContain("Report &amp; forecast");
  expect(content).toContain("Cc: copy@example.net");
  expect(content).not.toContain("hidden@example.net");
  expect(content).toContain("data:image/png;base64,cG5n");
  expect(content).toContain("Old logo");
  expect(attachments).toEqual([
    {
      filename: "report.txt",
      size: 6,
      contentType: "text/plain",
      content: "data:text/plain;base64,cmVwb3J0",
    },
  ]);
  expect(attachmentBlob).toHaveBeenCalledWith(report, signal, false, "session");
});

it("allows replies with a missing logo but reports an unavailable forwarded file", async () => {
  attachmentBlob.mockRejectedValue(new Error("File unavailable"));
  const { content, attachments } = await quotedMessage(
    message,
    "reply",
    signal,
    "session",
  );
  expect(content).toContain("[Inline image unavailable]");
  expect(attachments).toEqual([]);
  expect(attachmentBlob).toHaveBeenCalledTimes(1);
  await expect(
    quotedMessage(message, "forward", signal, "session"),
  ).rejects.toThrow("File unavailable");
});

it("stops a canceled request before it reads attachments", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    quotedMessage(message, "forward", controller.signal, "session"),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(attachmentBlob).not.toHaveBeenCalled();
});

it.each([true,false])("keeps authored and quoted edits through a response switch in plain text %s", async plain=>{
  const source={...message,attList:[],content:"<p>First line</p><p>Second line</p>"};
  const reply=(await quotedMessage(source,"reply",signal,"session")).content;
  const forward=(await quotedMessage(source,"forward",signal,"session")).content;
  const edited="<p>Authored line</p>"+reply.replace("First line","Edited line");
  const switched=changeQuotedBody(plain ? plainMarkup(edited).content : edited,forward,plain,"forward");
  const back=changeQuotedBody(switched,reply,plain,"reply");
  for (const body of [switched,back]) {
    expect(body).toContain("Authored line");
    expect(body).toContain("Edited line");
    expect(body).toContain("Second line");
    expect(body).not.toContain("First line");
  }
  expect(plainMarkup(switched).text).toContain("Edited line\nSecond line");
  expect(plainMarkup(back).text).toContain("> Edited line\n> Second line");
  expect(back).not.toContain("Forwarded message");
});

it("forwards every original in order under one subject and keeps authored text on a switch to Reply", async () => {
  const next={...message,subject:"Re: Report",content:"<p>Second update</p>",attList:[]};
  const forward=await quotedConversation("Report & forecast",[message,next],signal,"session");
  expect(forward.content.match(/Subject:/g)).toHaveLength(1);
  expect(forward.content).toContain("Subject: Report &amp; forecast");
  expect(forward.content.indexOf("Forecast")).toBeLessThan(forward.content.indexOf("Second update"));
  expect(forward.content.match(/From:/g)).toHaveLength(2);
  expect(forward.content).not.toContain("hidden@example.net");
  expect(forward.attachments.map(f=>f.filename)).toEqual(["report.txt"]);
  const reply=(await quotedMessage(next,"reply",signal,"session")).content;
  for (const plain of [false,true]) {
    const draft="<p>My introduction</p>"+forward.content;
    const result=changeQuotedBody(plain ? plainMarkup(draft).content : draft,reply,plain,"reply");
    expect(result).toContain("My introduction");
    expect(result).toContain("Second update");
    expect(result).not.toMatch(/Forwarded Conversation|cloudmail-forwarded-conversation|Forecast/);
  }
});
it("rejects an incomplete conversation if a referenced image or an attachment cannot be read", async () => {
  for (const unavailable of [logo,report]) {
    attachmentBlob.mockImplementation(async file=>{
      if (file===unavailable) throw new Error("File unavailable");
      return new Blob(["bytes"]);
    });
    await expect(quotedConversation("Report",[message],signal,"session")).rejects.toThrow("File unavailable");
  }
});
it("counts distinct inline images across messages, matching cloud draft storage", async () => {
  const messages=Array.from({length:11},(_,i)=>({...message,content:'<img src="cid:logo">',attList:[{...logo,filename:i+".png"}]}));
  attachmentBlob.mockImplementation(async file=>new Blob([file.filename]));
  await expect(quotedConversation("Photos",messages,signal,"session")).rejects.toThrow("10 inline photos");
  messages[10].attList=messages[0].attList;
  const quote=await quotedConversation("Photos",messages,signal,"session");
  expect(quote.content.match(/data:image\/png;base64,/g)).toHaveLength(11);
});

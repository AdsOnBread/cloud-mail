import {expect,it,vi} from "vitest";
import {flushPromises} from "@vue/test-utils";
import {queueThumbnail} from "../src/components/mail-attachments/thumbnail-queue";

it("shares two slots and skips off-screen thumbnails before their turn",async()=>{
  const controllers=Array.from({length:4},()=>new AbortController());
  const release=[],started=[];
  controllers.forEach((controller,index)=>queueThumbnail(()=>new Promise(resolve=>{
    started.push(index);
    release[index]=resolve;
  }),controller.signal));
  await flushPromises();
  expect(started).toEqual([0,1]);
  controllers[2].abort();
  release[0]();
  await flushPromises();
  expect(started).toEqual([0,1,3]);
  release[1]();release[3]();
  await flushPromises();
  const canceled=vi.fn();
  queueThumbnail(canceled,controllers[2].signal);
  await flushPromises();
  expect(canceled).not.toHaveBeenCalled();
});

import { expect, it } from "vitest";
import { photoDimensions } from "../src/components/tiny-editor/photo-size";

it("fits the compose area, preserves orientation and never enlarges a small photo", () => {
  expect(photoDimensions(960,480,495,true)).toEqual({width:198,height:99});
  expect(photoDimensions(960,480,495,false)).toEqual({width:495,height:248});
  expect(photoDimensions(960,480,948,true)).toEqual({width:206,height:103});
  expect(photoDimensions(960,480,948,false)).toEqual({width:515,height:258});
  expect(photoDimensions(480,960,948,false)).toEqual({width:258,height:515});
  expect(photoDimensions(960,480,150,false)).toEqual({width:150,height:75});
  expect(photoDimensions(4,3,495,true)).toEqual({width:4,height:3});
  expect(photoDimensions(0,0,495,true)).toBeNull();
});

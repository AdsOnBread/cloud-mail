import {expect,it} from "vitest";
import {labelSuggestions} from "../src/utils/search-labels";

const destinations=["Client","Client Visits","Client Visits/Receipts","Inbox"].map(name=>({name}));

it("completes partial names and preserves search terms for a nested or quoted label",()=>{
  expect(labelSuggestions("vis",destinations).map(item=>item.name)).toEqual(["Client Visits","Client Visits/Receipts"]);
  expect(labelSuggestions("CLIENT Visits/Receipts overdue -paid",destinations)).toEqual([
    {name:"Client Visits/Receipts",query:"overdue -paid"},
  ]);
  expect(labelSuggestions('"Client Visits" overdue',destinations)).toEqual([{name:"Client Visits",query:"overdue"}]);
  expect(labelSuggestions("Missing",destinations)).toEqual([]);
});

import { describe, expect, it } from "vitest";
import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { countLabel, LIMIT, matchStarts } from "./search-panel";

const state = (doc: string) => EditorState.create({ doc });

describe("matchStarts", () => {
  it("finds every match, case-insensitive by default", () => {
    expect(matchStarts(new SearchQuery({ search: "ab" }), state("ab AB xab"))).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 7, to: 9 },
    ]);
  });

  it("finds nothing for an empty or invalid query", () => {
    expect(matchStarts(new SearchQuery({ search: "" }), state("abc"))).toEqual([]);
    expect(matchStarts(new SearchQuery({ search: "(", regexp: true }), state("(("))).toEqual([]);
  });

  it("stops one past the limit", () => {
    expect(matchStarts(new SearchQuery({ search: "a" }), state("a".repeat(LIMIT + 50)))).toHaveLength(LIMIT + 1);
  });
});

describe("countLabel", () => {
  const m = [
    { from: 0, to: 2 },
    { from: 5, to: 7 },
    { from: 9, to: 11 },
  ];

  it("names the selected match", () => {
    expect(countLabel(m, { from: 5, to: 7 }, "ab")).toBe("2/3");
    expect(countLabel(m, { from: 9, to: 11 }, "ab")).toBe("3/3");
  });

  it("shows a dash while no match is selected", () => {
    expect(countLabel(m, { from: 4, to: 4 }, "ab")).toBe("–/3");
    expect(countLabel(m, { from: 5, to: 6 }, "ab")).toBe("–/3");
  });

  it("is empty with no query and 0 with no match", () => {
    expect(countLabel([], { from: 0, to: 0 }, "")).toBe("");
    expect(countLabel([], { from: 0, to: 0 }, "x")).toBe("0");
  });

  it("caps the total", () => {
    const many = Array.from({ length: LIMIT + 1 }, (_, i) => ({ from: i, to: i + 1 }));
    expect(countLabel(many, { from: 0, to: 1 }, "a")).toBe(`1/${LIMIT}+`);
  });
});

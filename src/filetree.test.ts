import { describe, expect, it } from "vitest";
import { addPaths, ancestors, buildTree, filterPaths, clipKey, findNode, itemsLabel, menuSpot, pasteFolder } from "./filetree";

const FILES = ["src/main.ts", "README.md", ".github/workflows/check.yml", "src/app.ts", "src-tauri/src/lib.rs", "docs/a10.md", "docs/a9.md"];

describe("file tree", () => {
  it("puts folders first, then files, by name", () => {
    const root = buildTree(FILES);
    expect(root.children.map((c) => c.name)).toEqual([".github", "docs", "src", "src-tauri", "README.md"]);
    expect(findNode(root, "src")!.children.map((c) => c.name)).toEqual(["app.ts", "main.ts"]);
    expect(findNode(root, "docs")!.children.map((c) => c.name)).toEqual(["a9.md", "a10.md"]);
    expect(findNode(root, "src-tauri/src/lib.rs")).toMatchObject({ dir: false, path: "src-tauri/src/lib.rs" });
    expect(findNode(root, "nope/x")).toBeNull();
    expect(findNode(root, "")).toBe(root);
  });

  it("keeps a folder listed whole closed until its contents arrive", () => {
    const root = buildTree([".env", ".env.docker", "node_modules/", "src/a.ts"]);
    expect(root.children.map((c) => c.name)).toEqual(["node_modules", "src", ".env", ".env.docker"]);
    const nm = findNode(root, "node_modules")!;
    expect(nm).toMatchObject({ dir: true, lazy: true, children: [] });
    expect(findNode(root, "src")!.lazy).toBeFalsy();
    addPaths(root, ["node_modules/x/", "node_modules/a.js"]);
    expect(nm.lazy).toBe(false);
    expect(nm.children.map((c) => c.name)).toEqual(["x", "a.js"]);
    expect(findNode(root, "node_modules/x")).toMatchObject({ dir: true, lazy: true });
  });

  it("filters by every word, file-name hits first", () => {
    expect(filterPaths(FILES, "lib")).toEqual(["src-tauri/src/lib.rs"]);
    expect(filterPaths(FILES, "src ts")).toEqual(["src/app.ts", "src/main.ts"]);
    expect(filterPaths(FILES, "src lib")).toEqual(["src-tauri/src/lib.rs"]);
    expect(filterPaths(FILES, "md")[0]).toBe("README.md");
    expect(filterPaths(FILES, "  ")).toEqual([]);
  });

  it("lists the folders above a path", () => {
    expect(ancestors("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestors("c.ts")).toEqual([]);
  });

  it("counts items in Polish", () => {
    expect([1, 2, 4, 5, 12, 13, 22, 25, 104].map(itemsLabel)).toEqual([
      "1 element",
      "2 elementy",
      "4 elementy",
      "5 elementów",
      "12 elementów",
      "13 elementów",
      "22 elementy",
      "25 elementów",
      "104 elementy",
    ]);
  });
});

describe("copying a file", () => {
  const key = (k: Partial<KeyboardEvent>) => ({ code: "KeyC", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k });

  it("takes ⌘C / ⌘V on macOS, Ctrl (+Shift) +C / +V elsewhere", () => {
    expect(clipKey(key({ metaKey: true }), "mac")).toBe("copy");
    expect(clipKey(key({ metaKey: true, code: "KeyV" }), "mac")).toBe("paste");
    expect(clipKey(key({ ctrlKey: true }), "mac")).toBeNull();
    expect(clipKey(key({ ctrlKey: true }), "linux")).toBe("copy");
    expect(clipKey(key({ ctrlKey: true, shiftKey: true }), "linux")).toBe("copy");
    expect(clipKey(key({ ctrlKey: true, code: "KeyV" }), "windows")).toBe("paste");
    expect(clipKey(key({ ctrlKey: true, shiftKey: true, code: "KeyV" }), "linux")).toBe("paste");
    expect(clipKey(key({ metaKey: true }), "linux")).toBeNull();
    expect(clipKey(key({ ctrlKey: true, altKey: true }), "linux")).toBeNull();
    expect(clipKey(key({ ctrlKey: true, code: "KeyX" }), "linux")).toBeNull();
  });

  it("pastes into a folder, or next to a file", () => {
    expect(pasteFolder("src/app", true)).toBe("src/app");
    expect(pasteFolder("src/app/main.ts", false)).toBe("src/app");
    expect(pasteFolder("README.md", false)).toBe("");
    expect(pasteFolder("", true)).toBe("");
  });

  it("keeps the menu inside the tree", () => {
    const tree = { left: 700, top: 40, right: 950, bottom: 600 };
    expect(menuSpot(720, 100, { width: 160, height: 30 }, tree)).toEqual({ left: 720, top: 100 });
    expect(menuSpot(900, 100, { width: 160, height: 30 }, tree)).toEqual({ left: 790, top: 100 });
    expect(menuSpot(900, 590, { width: 160, height: 30 }, tree)).toEqual({ left: 790, top: 570 });
    // Wider than the tree: its left edge stays in.
    expect(menuSpot(720, 100, { width: 300, height: 30 }, tree)).toEqual({ left: 700, top: 100 });
  });
});

// The side panel's file column: a project's folders and files, a name
// filter, and `?text` to search inside the files.

import { api } from "./api";
import { addPaths, ancestors, buildTree, clipKey, filterPaths, findNode, menuSpot, pasteFolder, type TreeNode } from "./filetree";
export { itemsLabel } from "./filetree";
import { t } from "./i18n";
import { PLATFORM } from "./platform";
import { escapeHtml } from "./tile";

export interface TreeEvents {
  /** A file was picked: show it. */
  file(rel: string): void;
  /** A folder was picked ("" = the project itself). */
  folder(rel: string): void;
  /** Double click on a file: open it in an editor. */
  edit(rel: string): void;
  /** ⌘C or the right-click menu on a file: the file to the clipboard. Without it, neither. */
  copy?(rel: string): void;
  /** ⌘V or the menu: the clipboard's files into the folder `dir` ("" = the project). */
  paste?(dir: string): void;
}

export class FileTree {
  readonly el: HTMLElement;
  project: string | null = null;
  private filter: HTMLInputElement;
  private list: HTMLElement;
  private files: string[] = [];
  private root: TreeNode = buildTree([]);
  private expanded = new Set<string>();
  private selected: string | null = null;
  /** Results of a `?text` search, when one is shown. */
  private found: string[] | null = null;
  private searchTimer: number | undefined;
  /** A file's right-click menu, while open. */
  private menu: HTMLElement | null = null;
  /** Stops the open menu's listeners on the window. */
  private unlisten: () => void = () => undefined;
  private loading = 0;
  /** The files of `project` are in (or failed to come). */
  private ready: Promise<void> = Promise.resolve();

  constructor(private on: TreeEvents) {
    this.el = document.createElement("div");
    this.el.className = "side-tree";
    this.el.innerHTML = `
      <input class="tree-filter" spellcheck="false" />
      <div class="tree-list"></div>`;
    this.filter = this.el.querySelector(".tree-filter")!;
    this.list = this.el.querySelector(".tree-list")!;
    this.filter.placeholder = t("tree.filter");
    this.filter.addEventListener("input", () => this.onFilter());
    this.filter.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.filter.value) {
          this.filter.value = "";
          this.onFilter();
        } else this.filter.blur();
      } else if (e.key === "Enter") {
        const first = this.list.querySelector<HTMLElement>(".tree-row[data-file]");
        if (first) this.pick(first.dataset.path!, false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.list.querySelector<HTMLElement>(".tree-row")?.focus();
      }
    });
    this.list.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
      if (row) this.pick(row.dataset.path!, row.dataset.file === undefined);
    });
    this.list.addEventListener("dblclick", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".tree-row[data-file]");
      if (row) this.on.edit(row.dataset.path!);
    });
    this.list.addEventListener("contextmenu", (e) => {
      if (!this.on.copy && !this.on.paste) return;
      e.preventDefault();
      if (!this.project) return;
      // A row, or the empty space under them: the project itself.
      const row = (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
      const r = row?.getBoundingClientRect();
      // The menu key: no pointer, so under the row.
      const at = e.clientX || e.clientY || !r ? { x: e.clientX, y: e.clientY } : { x: r.left + 16, y: r.bottom };
      this.openMenu(row, at.x, at.y);
    });
    this.list.addEventListener("scroll", () => this.closeMenu());
    this.list.addEventListener("keydown", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
      if (!row) return;
      const clip = clipKey(e);
      const file = row.dataset.file !== undefined;
      if ((clip === "copy" && file && this.on.copy) || (clip === "paste" && this.on.paste)) {
        e.preventDefault();
        e.stopPropagation();
        if (clip === "copy") return this.on.copy?.(row.dataset.path!);
        return this.on.paste?.(pasteFolder(row.dataset.path!, !file));
      }
      const move = (to: Element | null) => (to as HTMLElement | null)?.focus();
      if (e.key === "ArrowDown") move(row.nextElementSibling);
      else if (e.key === "ArrowUp") move(row.previousElementSibling ?? this.filter);
      else if (e.key === "Enter") this.pick(row.dataset.path!, row.dataset.file === undefined);
      else if (e.key === "ArrowRight" && row.dataset.file === undefined && !this.expanded.has(row.dataset.path!)) {
        this.pick(row.dataset.path!, true);
      } else if (e.key === "ArrowLeft" && this.expanded.has(row.dataset.path!)) this.pick(row.dataset.path!, true);
      else return;
      e.preventDefault();
    });
  }

  /**
   * Show `path`'s files; keeps the state when it is already shown. Resolves
   * once they are in, also for a second call while they are still coming.
   */
  load(path: string | null, force = false): Promise<void> {
    if (path === this.project && !force) return this.ready;
    this.closeMenu(); // its file is of the project going away
    this.project = path;
    this.expanded.clear();
    this.selected = null;
    this.found = null;
    this.files = [];
    this.root = buildTree([]);
    this.render();
    const ticket = ++this.loading;
    this.ready = path ? this.fetch(path, ticket) : Promise.resolve();
    return this.ready;
  }

  private async fetch(path: string, ticket: number): Promise<void> {
    const files = await api.projectFiles(path).catch(() => []);
    if (ticket !== this.loading) return; // another project was picked meanwhile
    this.files = files.filter((f) => !f.endsWith("/"));
    this.root = buildTree(files);
    this.render();
  }

  /** The same project's files again (after a paste), its open folders kept open. */
  async refresh(): Promise<void> {
    const project = this.project;
    if (!project) return;
    this.ready = this.fetch(project, ++this.loading);
    await this.ready;
    // A folder listed whole (`node_modules/`) is closed again: its contents come when it is opened.
    for (const path of this.expanded) if (findNode(this.root, path)?.lazy) this.expanded.delete(path);
    this.render();
  }

  focusFilter(): void {
    this.filter.focus();
    this.filter.select();
  }

  /** Children count of a folder ("" = the project). */
  count(rel: string): number {
    return findNode(this.root, rel)?.children.length ?? 0;
  }

  /** Mark a file as the one shown, unfolding the tree down to it. */
  reveal(rel: string): void {
    for (const a of ancestors(rel)) this.expanded.add(a);
    this.selected = rel;
    this.render();
  }

  private pick(rel: string, dir: boolean): void {
    this.selected = rel;
    const node = dir ? findNode(this.root, rel) : null;
    if (node?.lazy && !this.expanded.has(rel)) return void this.openLazy(node);
    if (dir) {
      if (this.expanded.has(rel)) this.expanded.delete(rel);
      else this.expanded.add(rel);
      this.on.folder(rel);
    } else {
      this.on.file(rel);
    }
    this.render();
    this.list.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(rel)}"]`)?.focus();
  }

  /** A folder listed whole (`node_modules/`): read it, then open it. */
  private async openLazy(node: TreeNode): Promise<void> {
    const project = this.project;
    if (!project) return;
    const entries = await api.projectDir(project, node.path).catch(() => []);
    if (this.project !== project) return; // another project was picked meanwhile
    node.lazy = false;
    addPaths(this.root, entries);
    this.files.push(...entries.filter((f) => !f.endsWith("/")));
    if (this.selected === node.path) this.pick(node.path, true);
  }

  /**
   * The menu at (x, y), kept inside the tree: "Copy file" on a file, "Paste"
   * into a folder, next to a file, or into the project under the rows (no `row`).
   */
  private openMenu(row: HTMLElement | null, x: number, y: number): void {
    this.closeMenu();
    const rel = row?.dataset.path ?? "";
    const file = row?.dataset.file !== undefined;
    row?.focus();
    const mod = PLATFORM === "mac" ? "⌘" : "Ctrl+";
    const item = (m: string, label: string, key: string) =>
      `<button data-m="${m}">${escapeHtml(label)}<span class="keys">${mod}${key}</span></button>`;
    const items = [
      file && this.on.copy ? item("copy", t("tree.copyFile"), "C") : "",
      this.on.paste ? item("paste", t("tree.paste"), "V") : "",
    ].join("");
    if (!items) return;
    const menu = document.createElement("div");
    menu.className = "tree-menu";
    menu.innerHTML = items;
    document.body.append(menu);
    const spot = menuSpot(x, y, menu.getBoundingClientRect(), this.el.getBoundingClientRect());
    menu.style.left = `${spot.left}px`;
    menu.style.top = `${spot.top}px`;
    this.menu = menu;
    const done = (back: boolean) => {
      this.closeMenu();
      if (back && row?.isConnected) row.focus();
    };
    menu.addEventListener("click", (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>("[data-m]")?.dataset.m;
      if (!m) return;
      done(true);
      if (m === "copy") this.on.copy?.(rel);
      else this.on.paste?.(pasteFolder(rel, !file));
    });
    menu.addEventListener("keydown", (e) => {
      const buttons = [...menu.querySelectorAll<HTMLElement>("button")];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape" || e.key === "Tab") done(true);
      else if (e.key === "ArrowDown") buttons[(at + 1) % buttons.length].focus();
      else if (e.key === "ArrowUp") buttons[(at - 1 + buttons.length) % buttons.length].focus();
      else return;
      e.preventDefault();
    });
    // A press anywhere else, or the window losing the focus, closes it.
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) done(false);
    };
    const away = () => done(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", away);
    this.unlisten = () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", away);
    };
    menu.querySelector<HTMLElement>("button")!.focus();
  }

  private closeMenu(): void {
    if (!this.menu) return;
    this.unlisten();
    this.unlisten = () => undefined;
    this.menu.remove();
    this.menu = null;
  }

  private onFilter(): void {
    clearTimeout(this.searchTimer);
    const q = this.filter.value;
    if (q.startsWith("?")) {
      const text = q.slice(1).trim();
      if (!text || !this.project) {
        this.found = [];
        return this.render();
      }
      const project = this.project;
      this.searchTimer = window.setTimeout(async () => {
        const found = await api.searchFiles(project, text).catch(() => []);
        if (this.filter.value === q && this.project === project) {
          this.found = found;
          this.render();
        }
      }, 250);
      return;
    }
    this.found = null;
    this.render();
  }

  /** Labels in the current language (Options changed it). */
  relabel(): void {
    this.filter.placeholder = t("tree.filter");
    this.render();
  }

  private render(): void {
    const q = this.filter.value;
    if (!this.project) {
      this.list.innerHTML = `<div class="tree-empty dim">${t("tree.pickTile")}</div>`;
      return;
    }
    if (q.trim() && !q.startsWith("?")) return this.flat(filterPaths(this.files, q), t("tree.noMatch"));
    if (q.startsWith("?")) return this.flat(this.found ?? [], this.found ? t("tree.nothingFound") : t("tree.searching"));
    const rows: string[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        rows.push(this.row(n.path, n.name, n.dir, depth));
        if (n.dir && this.expanded.has(n.path)) walk(n.children, depth + 1);
      }
    };
    walk(this.root.children, 0);
    this.list.innerHTML = rows.join("") || `<div class="tree-empty dim">${this.files.length ? "" : t("tree.loading")}</div>`;
  }

  private flat(paths: string[], empty: string): void {
    this.list.innerHTML =
      paths
        .map((p) => {
          const at = p.lastIndexOf("/");
          return this.row(p, p.slice(at + 1), false, 0, at > 0 ? p.slice(0, at) : "");
        })
        .join("") || `<div class="tree-empty dim">${empty}</div>`;
  }

  private row(path: string, name: string, dir: boolean, depth: number, where = ""): string {
    const open = dir && this.expanded.has(path);
    const cls = `tree-row${path === this.selected ? " sel" : ""}${dir ? " dir" : ""}${open ? " open" : ""}`;
    return `<div class="${cls}" tabindex="-1" data-path="${escapeHtml(path)}"${dir ? "" : " data-file"} style="padding-left:${8 + depth * 14}px">
      <span class="tree-icon">${dir ? "›" : ""}</span><span class="tree-name">${escapeHtml(name)}</span>${
        where ? `<span class="tree-where">${escapeHtml(where)}</span>` : ""
      }</div>`;
  }
}

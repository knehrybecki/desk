// Side panel: links, local files, Markdown and diagrams next to the terminals.
// The page itself is a second native webview (no access to desk's commands)
// that Rust keeps over `.side-view`; this file draws the bar above it, tells
// Rust where that box is, and edits text files in desk's own window.

import { listen } from "@tauri-apps/api/event";
import { api, type PreviewBounds } from "./api";
import { t } from "./i18n";
import { keysIn } from "./keys";
import { PLATFORM, shortcut } from "./platform";
import { toast } from "./ui";
import { isLocal, mention, normalize, rendered, shownView, staleView } from "./address";
import { FileTree, itemsLabel } from "./treeview";
import { escapeHtml } from "./tile";
import { createEditor, type Editor } from "./editor";
import { editorChoice, seedText } from "./find-view";
import { FindPanel } from "./find-panel";

const WIDTH_KEY = "desk.sideWidth";
const TREE_KEY = "desk.sideTree";

/** What the panel needs from the rest of desk. */
export interface SideContext {
  /** Folder of the active session's project, if any. */
  project(): string | null;
  /** Type text into the active session (no Enter). */
  insert(text: string): void;
  /** A plain terminal in this folder. */
  terminal(path: string): void;
  /** Where web pages open outside desk (Layout.browser). */
  browser(): string;
  /** What a plain click on a terminal link does (Layout.linkClick). */
  linkClick(): string;
  /** The program that opens files at a line, "" = the panel's own editor (Layout.fileEditor). */
  fileEditor(): string;
}


/**
 * What the main window drives: the panel at the side (`Side`), or its stand-in
 * that talks to the files window (files-window-panel.ts).
 */
export interface Panel {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  readonly filesShown: boolean;
  browse(): void;
  toggle(): void;
  toggleFiles(): void;
  showFiles(): void;
  showFind(seed?: string): void;
  projectChanged(): void;
  relabel(): void;
  browserChanged(): Promise<void>;
  open(link: string, project?: string): Promise<void>;
  close(): void;
  /** The file being edited or the address shown, else null (what a switch shows again). */
  shown(): string | null;
  /** Another host takes over: close, and let go of what lives outside this page (the native preview, the window). */
  handOver(): Promise<void>;
  /** Where web pages open outside desk (Layout.browser). */
  browserPref(): string;
  /** What a plain click on a terminal link does (Layout.linkClick). */
  linkClickPref(): string;
}

const REVEAL = ({ mac: "side.revealMac", windows: "side.revealWindows", linux: "side.revealLinux" } as const)[PLATFORM];

/** The panel the helpers below reach: the side panel, or the files window's stand-in. */
let current: Panel | null = null;

/** The main window switched where the panel lives (Options). */
export function setCurrentPanel(panel: Panel): void {
  current = panel;
}

/** Open a link or a local file in the panel (from a terminal link, ⌘F...). */
export function preview(link: string): Promise<void> {
  return current ? current.open(link) : Promise.reject(t("side.notReady"));
}

/** A project file in the panel (⌘F, ⌥↵). */
export function previewFile(path: string, file: string): Promise<void> {
  return current ? current.open(file, path) : Promise.reject(t("side.notReady"));
}

/** A link outside desk: a web page in Brave / Chrome (Options), a file in its default app. */
export function openOutside(link: string): Promise<void> {
  return api.openExternal(link, current?.browserPref());
}

/** What a plain click on a terminal link does: "desk", "browser" or "none". */
export function linkClickMode(): string {
  return current?.linkClickPref() ?? "desk";
}

export class Side implements Panel {
  readonly el: HTMLElement;
  private view: HTMLElement;
  private address: HTMLInputElement;
  private editBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  /** A webview exists in Rust (it may be hidden). */
  private created = false;
  private covered = false;
  /** Editing this file in desk's window instead of showing the page. */
  private editing: { path: string; text: string; editor: Editor } | null = null;
  /** A folder card is shown instead of the page (absolute path). */
  private folder: string | null = null;
  private tree: FileTree;
  /**
   * Find in Files: a popup; a picked hit opens here (or in the program from Options).
   * None in the files window: the main window owns the popup.
   */
  private find: FindPanel | null = null;
  /** In the files window: fills it, no splitter, × hides the window. */
  private detached: boolean;
  /** Detached: the window is hidden (it starts so, until a command shows it). */
  private windowHidden = true;
  /** Something the host may report changed (the file shown, the buttons). */
  private changed: () => void;
  /** What had the focus when the search opened; closing it without a file gives it back. */
  private beforeFind: HTMLElement | null = null;
  /** "Brave" / "Chrome", or null when web pages go to the system browser. */
  private browserName: string | null = null;
  /** The page has a password field: offer the real browser and its password manager. */
  private login = false;

  constructor(
    private onLayout: () => void,
    private ctx: SideContext,
    opts: { detached?: boolean; changed?: () => void } = {},
  ) {
    setCurrentPanel(this);
    this.detached = opts.detached ?? false;
    this.changed = opts.changed ?? (() => undefined);
    this.el = document.createElement("aside");
    this.el.className = this.detached ? "side detached" : "side";
    this.el.hidden = !this.detached;
    this.el.innerHTML = `
      <div class="splitter"></div>
      <div class="side-head">
        <button data-a="back">‹</button>
        <button data-a="forward">›</button>
        <button data-a="reload">⟳</button>
        <input class="side-address" spellcheck="false" />
        <button data-a="login" class="side-login" hidden></button>
        <button data-a="save" class="side-save" hidden></button>
        <button data-a="attach">@</button>
        <button data-a="edit">✎</button>
        <button data-a="external">↗</button>
        <button data-a="files">☰</button>
        <button data-a="close">×</button>
      </div>
      <div class="side-body"><div class="side-view"><div class="side-empty dim" data-hint></div></div></div>`;
    this.view = this.el.querySelector(".side-view")!;
    this.address = this.el.querySelector(".side-address")!;
    this.editBtn = this.el.querySelector('[data-a="edit"]')!;
    this.saveBtn = this.el.querySelector('[data-a="save"]')!;
    this.tree = new FileTree({
      file: (rel) => void this.openInTree(rel),
      folder: (rel) => void this.showFolder(rel),
      edit: (rel) => void this.openAt(rel, 1, this.tree.project ?? undefined),
      copy: (rel) => void this.copyFile(rel),
      paste: (dir) => void this.pasteFiles(dir),
    });
    if (!this.detached) {
      const find: FindPanel = new FindPanel({
        open: (file, line, project) => {
          find.close();
          void this.openAt(file, line, project);
        },
        closed: (back) => {
          const before = this.beforeFind;
          this.beforeFind = null;
          // Esc or a click outside: typing goes on where it was (the terminal), not into nothing.
          if (back && before?.isConnected) before.focus();
        },
      });
      this.find = find;
    }
    this.el.querySelector(".side-body")!.append(this.tree.el);
    this.relabel();
    let treeShown = true;
    try {
      treeShown = localStorage.getItem(TREE_KEY) !== "0";
    } catch {
      // default: shown
    }
    this.tree.el.hidden = !treeShown;
    this.view.addEventListener("click", (e) => {
      const f = (e.target as HTMLElement).closest<HTMLElement>("[data-f]")?.dataset.f;
      if (!f || !this.folder) return;
      if (f === "attach") this.attach(this.folder);
      else if (f === "terminal") this.ctx.terminal(this.folder);
      else if (f === "reveal") void api.revealPath(this.folder).catch(this.fail);
    });
    // The files window fills its window: the side panel's saved width is not for it.
    if (!this.detached) {
      try {
        const w = Number(localStorage.getItem(WIDTH_KEY));
        if (w > 0) this.el.style.width = `${w}px`;
      } catch {
        // storage unavailable: default width
      }
    }

    this.el.querySelector(".side-head")!.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
      if (a === "close") this.close();
      else if (a === "files") this.toggleTree();
      else if (a === "attach") this.attach(this.folder ?? this.editing?.path ?? this.address.value);
      else if (a === "edit") void (this.editing ? this.stopEditing() : this.edit());
      else if (a === "save") void this.save();
      else if (a === "external" && this.address.value) void openOutside(this.editing?.path ?? this.address.value).catch(this.fail);
      else if (a === "login" && this.address.value) void openOutside(this.address.value).catch(this.fail);
      else if ((a === "back" || a === "forward" || a === "reload") && this.created && !this.editing) {
        void api.previewNav(a).catch(this.fail);
      }
    });
    this.address.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.open(normalize(this.address.value));
      if (e.key === "Escape") this.address.blur();
    });
    this.splitter();
    new ResizeObserver(() => this.place()).observe(this.view);
    window.addEventListener("resize", () => this.place());
    // A native view sits above the page: hide it while a dialog or the lock covers it.
    new MutationObserver(() => this.cover()).observe(document.body, { childList: true });
    this.covered = document.querySelector(".overlay, .lock-screen") !== null;
    // Heard from any window: a side panel the files window took over must not follow that window's page.
    void listen<boolean>("preview-login", (e) => {
      if (current !== this) return;
      this.login = e.payload;
      this.syncButtons();
    });
    void listen<string>("preview-url", (e) => {
      if (current !== this) return;
      if (document.activeElement !== this.address && !this.editing) this.address.value = e.payload;
      this.syncButtons();
    });
  }

  /** The file tree on the left of the view instead of the right (Layout.treeLeft). */
  setTreeLeft(left: boolean): void {
    this.el.querySelector(".side-body")!.classList.toggle("tree-left", left);
  }

  /** Labels in the current language: at start and when Options change it. */
  relabel(): void {
    const titles: [string, string][] = [
      [".splitter", t("side.resize")],
      ['[data-a="back"]', t("side.back")],
      ['[data-a="forward"]', t("side.forward")],
      ['[data-a="reload"]', t("side.reload")],
      ['[data-a="save"]', t("side.saveTitle", { keys: shortcut("⌘S") })],
      ['[data-a="attach"]', t("side.attach")],
      ['[data-a="edit"]', t("side.edit")],
      ['[data-a="external"]', t("side.external")],
      ['[data-a="files"]', t("side.files", { keys: keysIn("⌘F") })],
      ['[data-a="close"]', t("side.close")],
    ];
    for (const [sel, title] of titles) this.el.querySelector<HTMLElement>(sel)!.title = title;
    this.saveBtn.textContent = t("side.save");
    this.address.placeholder = t("side.address");
    const hint = this.view.querySelector<HTMLElement>("[data-hint]");
    if (hint) hint.textContent = t("side.empty");
    this.tree.relabel();
    this.find?.relabel();
    if (this.isOpen) this.syncButtons();
  }

  /** A file of the tree's project to the clipboard, as a file to paste. */
  private async copyFile(rel: string): Promise<void> {
    const project = this.tree.project;
    if (!project) return;
    try {
      await api.copyFile(project, rel);
      toast(t("tree.copied", { name: rel.slice(rel.lastIndexOf("/") + 1) }), { kind: "ok", topic: "clipboard" });
    } catch (err) {
      toast(t("tree.copyError", { err: String(err) }), { kind: "error", topic: "clipboard" });
    }
  }

  /** The clipboard's files into `dir` of the tree's project, then shown in the tree. */
  private async pasteFiles(dir: string): Promise<void> {
    const project = this.tree.project;
    if (!project) return;
    let pasted: string[];
    try {
      pasted = await api.pasteFiles(project, dir);
    } catch (err) {
      return toast(t("tree.pasteError", { err: String(err) }), { kind: "error", topic: "clipboard" });
    }
    const where = dir || (project.split(/[\\/]/).filter(Boolean).pop() ?? project);
    const name = pasted.length === 1 ? pasted[0].slice(pasted[0].lastIndexOf("/") + 1) : itemsLabel(pasted.length);
    toast(t("tree.pasted", { name, where }), { kind: "ok", topic: "clipboard" });
    if (this.tree.project !== project) return;
    await this.tree.refresh();
    if (pasted[0]) this.tree.reveal(pasted[0]);
    // A folder's card shown: its count of items again.
    if (this.folder?.startsWith(project)) {
      void this.showFolder(this.folder.slice(project.length).split(/[\\/]/).filter(Boolean).join("/"));
    }
  }

  private attach(path: string): void {
    const text = mention(this.tree.project, path);
    if (text) this.ctx.insert(text);
    else toast(t("side.unsafePath"), { kind: "warn" });
  }

  get isOpen(): boolean {
    return this.detached ? !this.windowHidden : !this.el.hidden;
  }

  /** Detached: the host shows or hides the window (its own close button, the lock). */
  windowVisible(visible: boolean): void {
    if (!this.detached || this.windowHidden === !visible) return;
    if (visible) {
      // Shown again: the native page was hidden with the window (sync), so show it too.
      this.show(); // clears the flag, loads the tree, reports
      this.sync();
      this.place();
      return;
    }
    this.windowHidden = true;
    this.sync();
    this.onLayout();
  }

  /** The file being edited, else the address shown; null for nothing and for a folder card (shownView). */
  shown(): string | null {
    return shownView({ editing: this.editing?.path ?? null, folder: this.folder, created: this.created, address: this.address.value });
  }

  /** The panel is open with the file tree in it (the top bar's folder is pressed). */
  get filesShown(): boolean {
    return this.isOpen && !this.tree.el.hidden;
  }

  /** The top bar's folder: the project's files, or the panel away when they show. */
  toggleFiles(): void {
    if (this.filesShown) this.close();
    else this.showFiles();
  }

  /** `link`, or with `project` a file relative to that project. */
  async open(link: string, project?: string): Promise<void> {
    if (!link.trim()) return;
    if (this.editing && !(await this.stopEditing())) return;
    this.folder = null;
    this.show();
    try {
      this.address.value = project
        ? await api.previewFile(project, link, this.bounds())
        : await api.openPreview(link, this.bounds());
      this.created = true;
      this.view.replaceChildren();
      // A new page shows at once: hide it again if a dialog is open.
      this.sync();
      // Code and plain text open for editing; rendered documents stay a preview (✎ edits them).
      if (isLocal(this.address.value) && !rendered(this.address.value)) await this.edit(true);
    } catch (err) {
      this.fail(err);
      throw err;
    } finally {
      this.syncButtons();
    }
  }

  browserPref(): string {
    return this.ctx.browser();
  }

  linkClickPref(): string {
    return this.ctx.linkClick();
  }

  /** The browser setting changed (or desk started): name it on the ↗ button. */
  async browserChanged(): Promise<void> {
    this.browserName = await api.browserName(this.ctx.browser()).catch(() => null);
    this.syncButtons();
  }

  /** The browser button: the panel at its address bar, ready for a URL. */
  browse(): void {
    this.show();
    this.sync();
    this.address.focus();
    this.address.select();
  }

  /**
   * ⌘W: show or hide. It opens on the active project (see `follow`), at the
   * address bar while no page was opened, ready for a link.
   */
  toggle(): void {
    if (this.isOpen) return this.close();
    this.reveal();
  }

  /**
   * Show the panel, never hide it: the other window's ⌘W / folder when it
   * believes this one is closed (it may be open by the time that arrives).
   */
  reveal(): void {
    this.show();
    this.sync();
    void this.follow(true).then(() => {
      if (this.created || !this.isOpen) return;
      this.address.focus();
      this.address.select();
    });
  }

  close(): void {
    if (this.detached) {
      // Always ask Rust: the flag may be stale (minimized, restored).
      this.windowHidden = true;
      void api.filesWindowHide().catch(this.fail);
    } else if (!this.isOpen) {
      return;
    } else {
      this.el.hidden = true;
    }
    this.sync();
    this.onLayout();
  }

  /**
   * The files window takes the panel over: close, and close the native page
   * too. It is one view for both windows, so a late call from here (bounds,
   * visible, nav) must not reach it once it lives there: this panel forgets it.
   * Stop editing first (`stopEditing`): an edit open here is dropped.
   */
  async handOver(): Promise<void> {
    // Its Find in Files popup too: the new host has its own, and a hit here would open in a panel out of the page.
    this.find?.close();
    this.close();
    this.editing?.editor.destroy();
    this.editing = null;
    this.created = false;
    this.folder = null;
    this.login = false;
    this.address.value = "";
    this.view.innerHTML = `<div class="side-empty dim" data-hint>${escapeHtml(t("side.empty"))}</div>`;
    this.syncButtons();
    await api.previewClose().catch(() => undefined);
  }

  private show(): void {
    if (this.isOpen) return;
    if (this.detached) this.windowHidden = false;
    else this.el.hidden = false;
    if (!this.tree.el.hidden) void this.tree.load(this.ctx.project());
    this.onLayout();
  }

  /** ⌘F: the panel with the active project's files, filter focused. */
  showFiles(): void {
    this.show();
    if (this.tree.el.hidden) this.toggleTree();
    this.sync();
    void this.follow(true);
    this.tree.focusFilter();
  }

  /** The active session moved to another project: its files in the tree. */
  projectChanged(): void {
    if (this.isOpen) void this.follow(false);
  }

  /**
   * The tree on the active project, and the view with it: a folder card of
   * another project gives way to this project's, and so does an empty view
   * or another project's file when ⌘F / ⌘W open the panel (`opening`).
   */
  private async follow(opening: boolean): Promise<void> {
    const project = this.ctx.project();
    await this.tree.load(project);
    if (!project || this.tree.project !== project || !this.isOpen) return;
    const shown = this.editing?.path ?? (this.created ? this.address.value : "");
    if (staleView(project, { folder: this.folder, shown }, opening)) await this.showFolder("");
  }

  private toggleTree(): void {
    this.tree.el.hidden = !this.tree.el.hidden;
    this.rememberTree();
    if (!this.tree.el.hidden) void this.tree.load(this.ctx.project());
    this.changed(); // the host's filesShown follows (no-op in the side panel)
  }

  private rememberTree(): void {
    try {
      localStorage.setItem(TREE_KEY, this.tree.el.hidden ? "0" : "1");
    } catch {
      // not remembered
    }
  }

  /**
   * A project file (relative path) at `line`: in the panel's editor, or in the
   * program set in Options (Layout.fileEditor).
   */
  async openAt(file: string, line: number, project?: string): Promise<void> {
    project ??= this.ctx.project() ?? this.tree.project ?? undefined;
    if (!project) return;
    if (editorChoice(this.ctx.fileEditor()) === "program") {
      await api.openFileAt(project, file, line).catch((err) => toast(String(err), { kind: "error" }));
      return;
    }
    try {
      await this.open(file, project);
    } catch {
      return; // open() already showed the error
    }
    // A rendered document stays a preview until edited; one desk does not edit stays a page, no error.
    if (!this.editing) await this.edit(true);
    this.editing?.editor.goTo(line);
    this.editing?.editor.focus(); // type right away
  }

  /** ⇧⌘F: the search popup for the active project, the input focused. */
  showFind(seed?: string): void {
    if (!this.find) return;
    const active = document.activeElement;
    if (!this.find.isOpen && active instanceof HTMLElement && !this.find.el.contains(active)) this.beforeFind = active;
    const project = this.ctx.project() ?? this.tree.project;
    this.find.open(project, seed ?? (this.find.isOpen ? undefined : this.editorSelection()));
  }

  /** A one-line selection in the open editor, if any. */
  private editorSelection(): string | undefined {
    const view = this.editing?.editor.view;
    if (!view) return undefined;
    const { from, to } = view.state.selection.main;
    return seedText(view.state.sliceDoc(from, to));
  }

  private async openInTree(rel: string): Promise<void> {
    const project = this.tree.project;
    if (!project) return;
    await this.open(rel, project).catch(() => undefined);
  }

  /** A folder's card: what is in it and what to do with it. */
  private async showFolder(rel: string): Promise<void> {
    const project = this.tree.project;
    if (!project) return;
    if (this.editing && !(await this.stopEditing())) return;
    const sep = project.includes("\\") ? "\\" : "/";
    const path = rel ? project + sep + rel.split("/").join(sep) : project;
    this.folder = path;
    const name = rel ? rel.slice(rel.lastIndexOf("/") + 1) : (project.split(/[\\/]/).filter(Boolean).pop() ?? project);
    this.view.innerHTML = `<div class="folder-card">
      <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>
      <div class="folder-name">${escapeHtml(name)}</div>
      <div class="dim">${itemsLabel(this.tree.count(rel))}</div>
      <div class="folder-actions">
        <button data-f="attach">${t("side.addToSession")}</button>
        <button data-f="terminal">${t("side.terminalHere")}</button>
        <button data-f="reveal">${t(REVEAL)}</button>
      </div></div>`;
    this.address.value = path;
    this.sync();
    this.syncButtons();
  }

  /** The page is visible when the panel is open, nothing covers it and no file is being edited. */
  private sync(): void {
    if (this.created) void api.previewVisible(this.isOpen && !this.covered && !this.editing && !this.folder);
  }

  private syncButtons(): void {
    this.changed();
    const local = isLocal(this.editing?.path ?? this.address.value);
    this.editBtn.hidden = !!this.folder || !local;
    this.el.querySelector<HTMLElement>('[data-a="attach"]')!.hidden = !this.folder && !local;
    this.editBtn.textContent = this.editing ? t("side.preview") : "✎";
    this.editBtn.title = this.editing ? t("side.saveAndPreview") : t("side.edit");
    this.saveBtn.hidden = !this.editing;
    this.saveBtn.classList.toggle("dirty", this.dirty());
    const ext = this.el.querySelector<HTMLElement>('[data-a="external"]')!;
    const web = !local && !this.folder && /^https?:/i.test(this.address.value);
    ext.textContent = web && this.browserName ? `↗ ${this.browserName}` : "↗";
    ext.title = web
      ? this.browserName
        ? t("side.openIn", { browser: this.browserName })
        : t("side.openInSystem")
      : t("side.openDefault");
    const login = this.el.querySelector<HTMLElement>('[data-a="login"]')!;
    login.hidden = !this.login || !web || !!this.editing;
    login.textContent = this.browserName ? t("side.loginIn", { browser: this.browserName }) : t("side.login");
    login.title = t("side.loginTitle");
  }

  private dirty(): boolean {
    return this.editing !== null && this.editing.editor.value() !== this.editing.text;
  }

  /**
   * Edit the shown file in desk's own window, with syntax colors. `quiet`: it
   * was opened for editing on its own, so a file that is not text just stays
   * in the preview.
   */
  private async edit(quiet = false): Promise<void> {
    const path = this.address.value;
    let text: string;
    try {
      text = await api.readText(path);
    } catch (err) {
      if (!quiet) toast(t("side.editError", { err: String(err) }), { kind: "error" });
      return;
    }
    if (this.address.value !== path || this.editing) return; // another file meanwhile
    const box = document.createElement("div");
    box.className = "side-editor";
    this.view.replaceChildren(box);
    const editor = createEditor(box, text, path.split(/[\\/]/).pop() ?? path, {
      change: () => this.syncButtons(),
      save: () => void this.save(),
    });
    this.editing = { path, text, editor };
    this.sync();
    this.syncButtons();
    if (!quiet) editor.focus();
  }

  private async save(): Promise<boolean> {
    const ed = this.editing;
    if (!ed) return true;
    const text = ed.editor.value();
    if (text === ed.text) return true; // unchanged: leave the file (and its date) alone
    try {
      await api.writeText(ed.path, text);
      ed.text = text;
      this.syncButtons();
      return true;
    } catch (err) {
      toast(t("side.saveError", { err: String(err) }), { kind: "error" });
      return false;
    }
  }

  /** Back to the page: save first, then show it again, reloaded. False: the save failed (a toast says why). */
  async stopEditing(reload = true): Promise<boolean> {
    if (!this.editing) return true; // nothing to save, the page stays as it is
    if (!(await this.save())) return false;
    this.editing?.editor.destroy();
    this.editing = null;
    this.view.replaceChildren();
    this.sync();
    this.syncButtons();
    // `reload` false: the panel is handed over right after (a mode switch), nothing to show again.
    if (reload && this.created) void api.previewNav("reload").catch(this.fail);
    return true;
  }

  private bounds(): PreviewBounds {
    const r = this.view.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  private place(): void {
    if (this.created && this.isOpen) void api.previewBounds(this.bounds());
  }

  private cover(): void {
    const covered = document.querySelector(".overlay, .lock-screen") !== null;
    if (covered === this.covered) return;
    this.covered = covered;
    this.sync();
  }

  private fail = (err: unknown): void => {
    if (this.created) return toast(t("side.previewError", { err: String(err) }), { kind: "error" });
    const msg = document.createElement("div");
    msg.className = "side-empty dim";
    msg.textContent = String(err);
    this.view.replaceChildren(msg);
  };

  private splitter(): void {
    const bar = this.el.querySelector<HTMLElement>(".splitter")!;
    bar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = this.el.getBoundingClientRect().width;
      const move = (ev: PointerEvent) => {
        const max = window.innerWidth - 320;
        const w = Math.min(max, Math.max(280, startW + startX - ev.clientX));
        this.el.style.width = `${w}px`;
      };
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        try {
          localStorage.setItem(WIDTH_KEY, String(Math.round(this.el.getBoundingClientRect().width)));
        } catch {
          // not remembered
        }
        this.onLayout();
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
  }
}

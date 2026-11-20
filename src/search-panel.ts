// The editor's search bar (⌘F / Ctrl+F in the panel's editor and in the Find
// in Files preview), drawn like desk's own Find in Files: one row with the
// query, how many matches there are and which one is selected, the toggles and
// the arrows; the replace row only when the file can be edited.

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { t } from "./i18n";
import { PLATFORM } from "./platform";

/** More matches than this are counted as "LIMIT+" (the count is redone on each edit). */
export const LIMIT = 9999;

/** Start offsets of the matches of `query` in `state`, at most LIMIT + 1. */
export function matchStarts(query: SearchQuery, state: EditorState): { from: number; to: number }[] {
  if (!query.valid) return [];
  const out: { from: number; to: number }[] = [];
  const cursor = query.getCursor(state);
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    out.push({ from: r.value.from, to: r.value.to });
    if (out.length > LIMIT) break;
  }
  return out;
}

/** "3/12", "–/12" while no match is selected, "0" for none, "" with no query. */
export function countLabel(matches: { from: number; to: number }[], sel: { from: number; to: number }, query: string): string {
  if (!query) return "";
  const total = matches.length > LIMIT ? `${LIMIT}+` : String(matches.length);
  if (!matches.length) return "0";
  // Binary search: the match the selection covers exactly.
  let lo = 0;
  let hi = Math.min(matches.length, LIMIT) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = matches[mid];
    if (m.from < sel.from) lo = mid + 1;
    else if (m.from > sel.from) hi = mid - 1;
    else return m.to === sel.to ? `${mid + 1}/${total}` : `–/${total}`;
  }
  return `–/${total}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

class DeskSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private query: SearchQuery;
  private find: HTMLInputElement;
  private replace: HTMLInputElement;
  private count: HTMLElement;
  private toggles: Record<"caseSensitive" | "wholeWord" | "regexp", HTMLButtonElement>;
  private matches: { from: number; to: number }[] = [];

  constructor(private view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom = el("div", "cm-search desk-search");
    this.dom.addEventListener("keydown", (e) => this.keydown(e));
    // A click on a button keeps the focus in the field (WebKit would move it to <body>).
    this.dom.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) e.preventDefault();
    });

    const row = el("div", "ds-row");
    const field = el("div", "ds-field");
    this.find = el("input", "ds-input", { "main-field": "true", spellcheck: "false", autocomplete: "off", name: "search" });
    this.find.placeholder = t("search.find");
    this.find.setAttribute("aria-label", t("search.find"));
    this.count = el("span", "ds-count");
    field.append(this.find, this.count);

    const toggle = (label: string, title: string) => {
      const b = el("button", "ds-toggle", { type: "button", "aria-pressed": "false" });
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", () => {
        b.classList.toggle("on");
        this.commit();
      });
      return b;
    };
    this.toggles = {
      caseSensitive: toggle("Aa", t("search.case")),
      wholeWord: toggle("W", t("search.word")),
      regexp: toggle(".*", t("search.regexp")),
    };
    const button = (label: string, title: string, run: () => void, cls = "ds-btn") => {
      const b = el("button", cls, { type: "button", "aria-label": title });
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", run);
      return b;
    };
    row.append(
      field,
      this.toggles.caseSensitive,
      this.toggles.wholeWord,
      this.toggles.regexp,
      el("span", "ds-sep"),
      button("↑", t("search.prev"), () => findPrevious(view)),
      button("↓", t("search.next"), () => findNext(view)),
      button("×", t("search.close"), () => closeSearchPanel(view), "ds-btn ds-close"),
    );
    this.dom.append(row);

    this.replace = el("input", "ds-input", { spellcheck: "false", autocomplete: "off", name: "replace" });
    this.replace.placeholder = t("search.replace");
    this.replace.setAttribute("aria-label", t("search.replace"));
    if (!view.state.readOnly) {
      const second = el("div", "ds-row");
      const rfield = el("div", "ds-field");
      rfield.append(this.replace);
      second.append(
        rfield,
        button(t("search.replaceOne"), t("search.replaceOneTitle"), () => replaceNext(view), "ds-btn ds-text"),
        button(t("search.replaceAll"), t("search.replaceAllTitle", { keys: PLATFORM === "mac" ? "⌘↵" : "Ctrl↵" }), () => replaceAll(view), "ds-btn ds-text"),
      );
      this.dom.append(second);
    }

    this.find.addEventListener("input", () => this.commit());
    this.replace.addEventListener("input", () => this.commit());
    this.show(this.query);
  }

  mount(): void {
    this.find.select();
  }

  update(u: ViewUpdate): void {
    let recount = u.docChanged;
    for (const tr of u.transactions)
      for (const e of tr.effects)
        if (e.is(setSearchQuery) && !e.value.eq(this.query)) {
          this.show(e.value);
          recount = false; // show() counted
        }
    if (recount) this.recount();
    else if (u.selectionSet) this.label();
  }

  private keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, "search-panel")) return e.preventDefault();
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (e.target === this.find) (e.shiftKey ? findPrevious : findNext)(this.view);
    else if (e.target === this.replace) (e.metaKey || e.ctrlKey ? replaceAll : replaceNext)(this.view);
  }

  /** The fields as a query: to the editor when it changed. */
  private commit(): void {
    const query = new SearchQuery({
      search: this.find.value,
      replace: this.replace.value,
      caseSensitive: this.toggles.caseSensitive.classList.contains("on"),
      wholeWord: this.toggles.wholeWord.classList.contains("on"),
      regexp: this.toggles.regexp.classList.contains("on"),
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.syncToggles();
    this.recount();
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  /** A query set from outside (⌘F with a selection): into the fields. */
  private show(query: SearchQuery): void {
    this.query = query;
    this.find.value = query.search;
    this.replace.value = query.replace;
    this.toggles.caseSensitive.classList.toggle("on", query.caseSensitive);
    this.toggles.wholeWord.classList.toggle("on", query.wholeWord);
    this.toggles.regexp.classList.toggle("on", query.regexp);
    this.syncToggles();
    this.recount();
  }

  private syncToggles(): void {
    for (const b of Object.values(this.toggles)) b.setAttribute("aria-pressed", String(b.classList.contains("on")));
  }

  private recount(): void {
    this.matches = matchStarts(this.query, this.view.state);
    this.label();
  }

  private label(): void {
    const bad = !!this.query.search && !this.query.valid;
    const { from, to } = this.view.state.selection.main;
    this.count.textContent = bad ? "!" : countLabel(this.matches, { from, to }, this.query.search);
    this.count.title = bad ? t("search.badRegexp") : "";
    this.dom.classList.toggle("ds-none", bad || (!!this.query.search && !this.matches.length));
  }
}

/** For `search({ createPanel })`. */
export function createSearchPanel(view: EditorView): Panel {
  return new DeskSearchPanel(view);
}

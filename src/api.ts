// Typed wrappers around the Rust commands (src-tauri/src/lib.rs).
import { Channel, invoke } from "@tauri-apps/api/core";

export interface Project {
  path: string;
  name: string;
  lastActiveMs: number;
  isGit: boolean;
  worktreeOf: string | null;
  claudeSessions: number;
}

/** Sessions of a card one under another, side by side, or one at a time. */
export type CardMode = "stack" | "row" | "tabs";

export interface GrepHit {
  file: string;
  line: number;
  text: string;
  /** Matches in `text` as [start, end) UTF-16 ranges. */
  marks: [number, number][];
  /** UTF-16 units of the line cut off before `text` (0 when not cut; else `text` starts with "…"). */
  cut: number;
}

export interface GrepResult {
  hits: GrepHit[];
  files: number;
  /** The search stopped at the cap. */
  more: boolean;
}

export interface GrepOptions {
  case: boolean;
  word: boolean;
  regex: boolean;
}

export interface Layout {
  version: number;
  lanes: string[][];
  autostart: string[];
  extraFolders: string[];
  notifications: boolean;
  colors: Record<string, number>;
  agents: CustomAgent[];
  projectsDir: string | null;
  /** Command of each ⌘U "run" session, by session key. */
  runs: Record<string, string>;
  /** Card of a session opened inside another project's card (⌘R conversations), by key. */
  cards: Record<string, string>;
  /** desk places new projects (a lane of their own while there is room) and drops empty lanes. */
  autoLayout: boolean;
  /** Width of each lane, as a weight (index = lane). */
  widths: number[];
  /** Height of a project's card in its lane, as a weight, by card. */
  heights: Record<string, number>;
  /** Room of a session in its card, as a weight, by session key. */
  sizes: Record<string, number>;
  /** How a card shows its sessions, by card: "row" side by side, "tabs" one at a time. */
  modes: Record<string, CardMode>;
  /** The session a card in tabs shows, by card. */
  tabs: Record<string, string>;
  /** Color theme id (themes.ts). */
  theme: string;
  /** Web pages outside desk: "auto" (Brave, then Chrome), "brave", "chrome", "system". */
  browser: string;
  /** A plain click on a terminal link: "desk", "browser" or "none" (links.ts). */
  linkClick: string;
  /** Terminal font size in px. */
  fontSize: number;
  /** Size of the window's own text and bars, not terminals (ui-scale.ts). */
  uiScale: number;
  /** Size of the tile header buttons (ui-scale.ts). */
  tileIconScale: number;
  /** Session keys whose tiles are folded to their header. */
  minimized: string[];
  /** Names given to tiles by hand, by session key. */
  titles: Record<string, string>;
  /** Claude conversations saved under a name, by project path, then by conversation id (saved.ts). */
  saved: Record<string, Record<string, string>>;
  /** ⌘` slides the window down from the top of the screen. */
  dropdown: boolean;
  /** Height of the dropped-down window, percent of the screen. */
  dropdownHeight: number;
  /** The dropdown goes up when another app takes the focus. */
  dropdownAutohide: boolean;
  /** Its shortcut as an accelerator, "Super+Backquote" (hotkey.ts). */
  dropdownHotkey: string;
  /** How long it slides, ms (0: no slide). */
  dropdownAnimation: number;
  /** desk's shortcuts changed in Options, by binding id (keys.ts). */
  keys: Record<string, string>;
  /** Linux: shortcuts on Start (Super) like ⌘ on macOS, instead of Ctrl+Shift. */
  superKeys: boolean;
  /** A right click in a terminal opens tmux's menu (split, swap, kill...). */
  tmuxMenu: boolean;
  /** Interface language, "pl" or "en" (i18n.ts); "" until the first launch picks one. */
  language: string;
  /** Program that opens a Find in Files result at its line; "" is the built-in editor. */
  fileEditor: string;
  /** The files panel lives in a window of its own instead of at the side (files-window-panel.ts). */
  filesWindow: boolean;
  /** The file tree on the left of the files panel instead of the right. */
  treeLeft: boolean;
  /** Ctrl+G in Claude rewrites the prompt with the company LLM (prompt_ai.rs). */
  promptAi: PromptAi;
  /** Claude accounts (accounts.ts); the first one is the default. */
  claudeAccounts: ClaudeAccount[];
  /** The account each Claude session was started with, by session key. */
  tileAccounts: Record<string, string>;
  /** The account new Claude sessions of a project use, by project path. */
  projectAccounts: Record<string, string>;
  /** What desk does when hot (thermal.ts, thermal.rs Mode). */
  thermalMode: ThermalMode;
  /** Slow the sessions while the CPU is hotter than this, °C (thermal.ts). */
  thermalLimit: number;
  /** The fan steps in modes "together" and "fans" (thermal.rs Step). */
  fanSteps: FanStep[];
  /** A fan step comes down this many °C below its limit (thermal.rs StepDown). */
  fanMargin: number;
  /** …and no sooner than this many seconds after the last change. */
  fanWait: number;
  /** Emergency stop: from `emergencyAt` °C the work in every session freezes until resumed by hand (thermal.rs Halt). */
  emergencyOn: boolean;
  emergencyAt: number;
  /** `emergencyAt` was saved knowing the stop watches the hottest core (layout.rs migrates files without it). */
  emergencyForCores?: boolean;
  /** The temperature chip's colours; null: from the slowing limit or the first fan step (thermal.ts). */
  thermalColors: ThermalColors | null;
  /** Parts of the temperature chip's panel hidden in Options (cpu-view.ts CpuPart); empty: all shown. */
  cpuHidden: string[];
  /** The usage popover: one view at a time, or everything at once (usage-popover.ts). */
  usageLayout: UsageLayout;
  /** How a session's share of the 5-hour window is worked out (usage_share.rs). */
  usageShare: UsageShare;
  /** Docker servers shown in the Docker panel (docker.rs). */
  dockerHosts: DockerHost[];
  /** What each Docker tile shows, by session key; Rust builds the command. */
  docker: Record<string, DockerTile>;
  /** Servers the Upload panel sends to (upload.rs). */
  uploadHosts: UploadHost[];
  /** What each Upload tile sends, by session key; Rust builds the command. */
  uploads: Record<string, UploadTile>;
}

/** A server added in Options → Upload; `key` is an optional ssh key path. */
export interface UploadHost {
  host: string;
  user: string;
  key: string;
  /** How files go to this server; missing in older layouts means rsync. */
  method?: UploadMethod;
}

/** rsync (resumable, needs rsync on the server) or scp (for servers without it). */
export type UploadMethod = "rsync" | "scp";

/** An Upload tile: one file of the project sent to `user@host`. */
export interface UploadTile {
  host: string;
  user: string;
  file: string;
}

/** A Docker server added in Options: a name and its `-H` address. */
export interface DockerHost {
  name: string;
  url: string;
}

/** A Docker tile: logs of a container or compose project, or a shell in a container. */
export interface DockerTile {
  host: string;
  target: string;
  kind: "logs" | "projectLogs" | "shell" | "deploy";
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  /** Docker's lowercase state: running, exited, restarting, paused, created, dead... */
  state: string;
  status: string;
  project: string | null;
  service: string | null;
  /** Label com.docker.compose.project.working_dir: the folder compose was started from (on the server). */
  workingDir: string | null;
}

/** Branch (null: detached) and number of uncommitted changes of a local folder. */
export interface GitSummary {
  branch: string | null;
  dirty: number;
}

/** One row per tag; `<none>` stays literal for repository and tag. */
export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerNamed {
  name: string;
  driver: string;
}

export interface DockerHostView {
  name: string;
  url: string;
  error: string | null;
  containers: DockerContainer[];
  images: DockerImage[];
  networks: DockerNamed[];
  volumes: DockerNamed[];
}

/** `cli` false: no docker command; then `hosts` is empty and `compose` false. */
export interface DockerOverview {
  cli: boolean;
  compose: boolean;
  hosts: DockerHostView[];
}

/** What desk does when hot: nothing, slow its sessions, the fan steps, or both. */
export type ThermalMode = "off" | "slow" | "together" | "fans";

/** The temperature chip is yellow from `warm` and red from `hot`, °C. */
export interface ThermalColors {
  warm: number;
  hot: number;
}

/** From `celsius` (the average reading) the fans run at `percent` of their maximum. */
export interface FanStep {
  celsius: number;
  percent: number;
}

export type UsageLayout = "tabs" | "all";
export type UsageShare = "cost" | "transcripts";

/** A Claude Code config folder with its own login (accounts.rs). */
export interface ClaudeAccount {
  id: string;
  name: string;
  /** As typed in Options ("~/.claude-prywatne"); "" = Claude Code's default. */
  dir: string;
}

/** Where an account lives and who is logged in on it. */
export interface AccountInfo {
  id: string;
  dir: string;
  email: string | null;
}

export interface PromptAi {
  enabled: boolean;
  /** OpenAI-compatible server: base, /v1 or the full chat endpoint. */
  url: string;
  model: string;
}

/** A newer desk release. */
export interface Update {
  version: string;
  url: string;
  /** desk can install it itself; else the release page opens. */
  installable: boolean;
}

/** Where the side panel's page sits in the window (CSS pixels). */
export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RunTarget {
  source: string;
  command: string;
}

export interface CustomAgent {
  id: string;
  command: string;
}

export interface AgentInfo {
  id: string;
  command: string;
  installed: boolean;
  /** Not installed, but desk installs it when a tile opens it. */
  installable: boolean;
  builtin: boolean;
}

/** A GitHub repo the user can clone (`gh` login). */
export interface GithubRepo {
  fullName: string;
  description: string | null;
  private: boolean;
}

export interface SessionInfo {
  slug: string;
  path: string;
  agent: string;
  instance: number;
}

export type HookState = "working" | "waiting" | "idle" | "exited";

export interface SessionState {
  slug: string;
  state: HookState;
  event: string;
  ts: number;
  message: string | null;
  /** The Claude Code conversation in the tile. */
  sessionId: string | null;
}

/** A Claude Code conversation held in a project (⌘S). */
export interface Conversation {
  id: string;
  /** From `/rename`, else the one Claude Code gave it. */
  title: string | null;
  /** The first message typed in it, on one line. */
  prompt: string;
  branch: string | null;
  modifiedMs: number;
  /** The Claude account it was held on; it resumes there. */
  account: string;
}

export interface Bootstrap {
  layout: Layout;
  sessions: SessionInfo[];
  states: SessionState[];
  home: string;
  /** layout.json as it really is on this system (Options' footer). */
  layoutPath: string;
  /** Where "new project" suggests creating folders until one is chosen. */
  projectsDir: string;
  /** macOS or Linux without tmux: sessions end when desk closes. */
  tmuxMissing: boolean;
}

export interface TileInfo {
  path: string;
  branch: string | null;
}

export type CoffeeLevel = "off" | "awake" | "lid";

export interface CoffeeStatus {
  level: CoffeeLevel;
  helperInstalled: boolean;
  sleepDisabled: boolean;
  stoppedBecause: string | null;
}

/** CPU temperature and desk slowing its sessions while hot (thermal.rs). */
export interface ThermalStatus {
  /** Hottest CPU sensor, °C; null when desk cannot read one here. */
  celsius: number | null;
  /** Slowing limit; 0: this mode never slows. */
  limit: number;
  /** The fan steps; empty: this mode never uses the fans. */
  fanSteps: FanStep[];
  /** The step desk wants the fans at now (index into fanSteps); null: auto. */
  fanStep: number | null;
  /** A step comes down this many °C below its limit (Options). */
  fanMargin: number;
  /** Too hot: desk is slowing its sessions. */
  slowed: boolean;
  /** Processes slowed (the sessions and everything they started). */
  processes: number;
  /** Why desk cannot slow anything here, if it cannot. */
  cannotSlow: string | null;
  /** The fans, when the mode uses them. */
  fans: FanStatus | null;
  /** The emergency stop's limit, °C; 0: off. */
  emergency: number;
  /** The emergency stop tripped: the sessions' work is frozen until resumed. */
  halted: boolean;
  /** Processes frozen. */
  frozen: number;
  /** Programs typed at a shell prompt left running (freezing would hand the terminal to the shell); what they started is frozen. */
  jobs: number;
  /** What the emergency stop compares with its limit (the hottest of celsius and cores), °C; null while it is off. */
  hottest: number | null;
  /** The CPU core sensors alone (macOS, as in Stats), °C; null while the stop is off or where desk has none. */
  cores: number | null;
  /** Why the stop tripped; null while it has not. */
  haltedBy: "temperature" | "system" | null;
  /** What the emergency stop watches here (thermal.rs Sees). */
  sees: StopSees;
}

/** What the emergency stop watches on this computer: the cores (and desk's sensor and macOS), desk's
 * sensor and macOS (a chip desk does not know), only macOS (an Intel Mac), the CPU sensor (Linux,
 * Windows), or nothing. */
export type StopSees = "cores" | "sensor" | "system" | "cpu" | "nothing";

/** The session working the CPU hardest now (busiest.rs). */
export interface Busiest {
  path: string;
  agent: string;
  instance: number;
  /** % of one core (400: four cores' worth). */
  percent: number;
  /** The program in it using the most. */
  program: string;
}

/** A desk session, as tiles are keyed (sessions.ts Spec). */
export interface SessionRef {
  path: string;
  agent: string;
  instance: number;
}

/** One point of the CPU history: when (Unix seconds) and how busy, % of all cores. */
export interface CpuSample {
  at: number;
  user: number;
  system: number;
}

export interface TopProcess {
  pid: number;
  name: string;
  /** % of one core, as top counts. */
  percent: number;
  /** The desk session it runs in; null: not desk's. */
  session: SessionRef | null;
}

/** The temperature chip's panel (cpu.rs). */
export interface CpuDetails {
  cores: number;
  /** 1, 5 and 15 minutes; null on Windows. */
  load: [number, number, number] | null;
  /** The last 10 minutes, a point every 5 s, oldest first. */
  history: CpuSample[];
  /** null: not read (the panel hides its top processes). */
  top: TopProcess[] | null;
  busiest: Busiest | null;
}

/** The fans while a mode uses them (fans.rs). */
export interface FanStatus {
  /** The percent desk set and still holds; null: not desk's. */
  percent: number | null;
  /** The fastest fan now. */
  rpm: number | null;
  maxRpm: number | null;
  /** Why desk is not driving them while it wants to. */
  problem: string | null;
}

/** For Options: can desk drive this Mac's fans, and is the permission installed. */
export interface FanInfo {
  /** Why the fan modes are greyed out, if they are. */
  unsupported: string | null;
  consent: "missing" | "outdated" | "installed";
  /** The fastest fan's maximum, rpm; null where the fans do not read. */
  maxRpm: number | null;
}

export interface UsageWindow {
  label: string;
  usedPercent: number;
  /** Unix seconds. */
  resetsAt: number;
  /** Anthropic's grading: "normal", "warning" or "critical"; null when unknown. */
  severity: string | null;
}

/** A weekly limit of one model (Fable), on top of the plan's weekly one. */
export interface ModelLimit {
  name: string;
  usedPercent: number;
  /** Unix seconds. */
  resetsAt: number;
  severity: string | null;
  /** Points of the plan's weekly limit this model used, and the most it may use. */
  shareOfWeekly: number | null;
  allowanceOfWeekly: number | null;
}

export interface FiveHourReset {
  available: boolean;
  /** Unix seconds. */
  nextAvailableAt: number | null;
}

export interface SavedReset {
  label: string;
  left: number;
  total: number;
  /** Unix seconds. */
  endsAt: number | null;
  /** Works only at a usage limit. */
  requiresLimit: boolean;
}

/** Resets on offer (Claude Code's /limit-reset); desk only shows them. */
export interface Resets {
  fiveHour: FiveHourReset | null;
  saved: SavedReset[];
}

export interface Usage {
  agent: string;
  /** The Claude account, with two or more of them. */
  account: string | null;
  windows: UsageWindow[];
  models: ModelLimit[];
  /** Usage credits take over at a limit; null when unknown. */
  credits: boolean | null;
  resets: Resets | null;
}

/** A limit's reading in desk's history: a window ("5h") or a model ("Fable"). */
export interface LimitSample {
  t: number;
  agent: string;
  account: string | null;
  label: string;
  pct: number;
  resets: number;
}

/** A Claude session's status line input (usage_sessions.rs). */
export interface SessionStatus {
  slug: string;
  sessionId: string;
  transcript: string;
  account: string;
  model: string;
  modelId: string;
  effort: string | null;
  fast: boolean;
  /** Dollars since the session started, at API prices. */
  cost: number;
  contextPercent: number | null;
  cacheWarm: boolean | null;
  /** Unix seconds. */
  cacheExpiresAt: number | null;
  recacheTokens: number | null;
  /** Every model the session used, its subagents too (`model` is only today's), dearest first. */
  models: ModelCost[];
}

export interface ShareRow {
  /** The desk session; null for one outside desk. */
  slug: string | null;
  label: string;
  /** Of what the 5-hour window used; the rows add up to 1. */
  fraction: number;
}

export interface Share {
  mode: UsageShare;
  /** Largest first. */
  rows: ShareRow[];
  /** desk was not recording when the window began. */
  incomplete: boolean;
}

/** What one model cost over a stretch of time (usage_transcripts.rs ModelCost). */
export interface ModelCost {
  model: string;
  /** Dollars at API prices. */
  cost: number;
  tokens: number;
}

export interface UsageDetails {
  history: LimitSample[];
  /** Unix seconds of desk's oldest kept reading. */
  recordingSince: number | null;
  sessions: SessionStatus[];
  share: Share | null;
}

export interface PtyExit {
  id: number;
  slug: string;
}

export const api = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  /** Which of rsync and ssh are installed. */
  uploadTools: () => invoke<{ rsync: boolean; scp: boolean; ssh: boolean }>("upload_tools"),
  /** Host names from /etc/hosts, to suggest in Options (none on Windows). */
  uploadSuggestions: () => invoke<string[]>("upload_suggestions"),
  /** Size in bytes of a project file and the name it gets on the server (the
   *  canonical file's: a symlink's target); rejects when it is refused (outside the project, not a file). */
  uploadFileSize: (path: string, file: string) => invoke<{ size: number; name: string }>("upload_file_size", { path, file }),
  /** Whether rsync still runs in the session `slug` (tmux or native). */
  uploadRunning: (slug: string) => invoke<boolean>("upload_running", { slug }),
  dockerOverview: () => invoke<DockerOverview>("docker_overview"),
  /** `docker image rm` of a tag or id on one server; never --force. Rejects with Docker's error. */
  dockerImageRm: (host: string, image: string) => invoke<void>("docker_image_rm", { host, image }),
  /** `docker restart` of one container on one server. Rejects with Docker's error. */
  dockerRestart: (host: string, container: string) => invoke<void>("docker_restart", { host, container }),
  /** Branch and dirty count of a local folder; null when it is not a git repository (or git timed out). */
  gitStatusSummary: (path: string) => invoke<GitSummary | null>("git_status_summary", { path }),
  /** Text search in a project's files (max 500 hits); `marks` are UTF-16 ranges. Rejects with a message (bad regex, may span lines). */
  grepFiles: (path: string, query: string, o: GrepOptions) =>
    invoke<GrepResult>("grep_files", { path, query, case: o.case, word: o.word, regex: o.regex }),
  /** Text of `file` (relative to the project) for the read-only Find preview. Rejects with a message. */
  readProjectText: (path: string, file: string) => invoke<string>("read_project_text", { path, file }),
  /** Open `file` (relative to the project) at `line` in the configured file editor. Rejects with a message. */
  openFileAt: (path: string, file: string, line: number) => invoke<void>("open_file_at", { path, file, line }),
  /** Check that a file-editor command can be run. Rejects with a message. */
  checkFileEditor: (cmd: string) => invoke<void>("check_file_editor", { cmd }),
  /** Of the given folders, those holding a compose file (where a deploy may run). */
  composeDirs: (paths: string[]) => invoke<string[]>("compose_dirs", { paths }),
  /** Server of the saved prompt-rewriting VPN config, null when none (the key never leaves Rust). */
  promptAiVpn: () => invoke<string | null>("prompt_ai_vpn"),
  /** Save a pasted WireGuard .conf ("" removes it); returns its server. */
  setPromptAiVpn: (conf: string) => invoke<string | null>("set_prompt_ai_vpn", { conf }),
  /** Linux: the window takes Start+key for desk's shortcuts (linux_keys.rs). */
  setSuperKeys: (on: boolean) => invoke<void>("set_super_keys", { on }),
  /** The prompt pill's "Cofnij": the next Ctrl+G in that session puts the draft back. */
  promptAiUndo: (slug: string) => invoke<void>("prompt_ai_undo", { slug }),
  listProjects: (extra: string[]) => invoke<Project[]>("list_projects", { extra }),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  /** `resume`: a Claude conversation's id, to pick it up again (⌘S). */
  /** `restore`: a tile of the saved layout at startup; Claude resumes its last conversation if the session is gone. */
  /** `account`: the Claude account (accounts.ts) a new Claude session starts on. */
  /** `startDeploy`: a start confirmed by a click: a deploy or an upload; else Rust refuses to start `compose up` / `rsync` (a live session still attaches). */
  openSession: (
    path: string,
    agent: string,
    instance: number,
    command: string | undefined,
    resume: string | undefined,
    restore: boolean,
    account: string | undefined,
    startDeploy: boolean,
  ) =>
    invoke<string>("open_session", {
      path,
      agent,
      instance,
      command: command ?? null,
      resume: resume ?? null,
      restore,
      account: account || null,
      startDeploy,
    }),
  /** The project's newest Claude conversations (⌘S). */
  /** `saved`: ids of the project's saved conversations, listed however old. */
  recentConversations: (path: string, saved: string[]) => invoke<Conversation[]>("recent_conversations", { path, saved }),
  projectFiles: (path: string) => invoke<string[]>("project_files", { path }),
  /** One folder of a project: files, and folders as `rel/name/`. */
  projectDir: (path: string, rel: string) => invoke<string[]>("project_dir", { path, rel }),
  previewFile: (path: string, file: string, bounds: PreviewBounds) =>
    invoke<string>("preview_file", { path, file, bounds }),
  runTargets: (path: string) => invoke<RunTarget[]>("run_targets", { path }),
  listAgents: () => invoke<AgentInfo[]>("list_agents"),
  createProject: (parent: string, name: string, git: boolean) =>
    invoke<string>("create_project", { parent, name, git }),
  githubRepos: () => invoke<GithubRepo[]>("github_repos"),
  cloneProject: (parent: string, name: string, repo: string) =>
    invoke<string>("clone_project", { parent, name, repo }),
  killSession: (slug: string) => invoke<void>("kill_session", { slug }),
  saveLayout: (layout: Layout) => invoke<void>("save_layout", { layout }),
  tileInfo: (paths: string[]) => invoke<TileInfo[]>("tile_info", { paths }),
  ptyAttach: (slug: string, cols: number, rows: number, onData: Channel<ArrayBuffer>) =>
    invoke<number>("pty_attach", { slug, cols, rows, onData }),
  ptyWrite: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  /** Where the files of the last drag are (macOS; empty elsewhere). */
  droppedPaths: () => invoke<string[]>("dropped_paths"),
  ptyResize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  ptyClose: (id: number) => invoke<void>("pty_close", { id }),
  thermalStatus: () => invoke<ThermalStatus>("thermal_status"),
  /** After an emergency stop; rejected, with the reason, while the CPU is still too hot. */
  thermalResume: () => invoke<ThermalStatus>("thermal_resume"),
  /** The temperature chip's panel; the first call takes 0.4 s. */
  /** Without `processes` no process is read (the panel hides them). */
  cpuDetails: (processes: boolean) => invoke<CpuDetails>("cpu_details", { processes }),
  fansInfo: () => invoke<FanInfo>("fans_info"),
  /** The one admin password prompt for the fans. */
  fansInstall: () => invoke<FanInfo>("fans_install"),
  fansUninstall: () => invoke<FanInfo>("fans_uninstall"),
  coffeeStatus: () => invoke<CoffeeStatus>("coffee_status"),
  coffeeSet: (level: CoffeeLevel) => invoke<CoffeeStatus>("coffee_set", { level }),
  coffeeRestore: () => invoke<CoffeeStatus>("coffee_restore"),
  coffeeUninstall: () => invoke<CoffeeStatus>("coffee_uninstall"),
  lockDesk: () => invoke<void>("lock_desk"),
  /** `password`: the account password typed on the lock screen (Linux). */
  unlockDesk: (password?: string) => invoke<void>("unlock_desk", { password: password ?? null }),
  isLocked: () => invoke<boolean>("is_locked"),
  /** The files window: make it or show and focus it; refused while desk is locked. */
  filesWindowOpen: () => invoke<void>("files_window_open"),
  /** The files window: hide it (its state is kept). */
  filesWindowHide: () => invoke<void>("files_window_hide"),
  /** The files window: close it for good (the mode was switched off). */
  filesWindowDestroy: () => invoke<void>("files_window_destroy"),
  /** The files window: bring the main window to the front. */
  focusMainWindow: () => invoke<void>("focus_main_window"),
  /** Quit desk (the page asks first); refused while locked. */
  quitDesk: () => invoke<void>("quit_desk"),
  /** Register or drop ⌘` and refit the dropped-down window, as layout.json says. */
  dropdownApply: () => invoke<void>("dropdown_apply"),
  /** From the dropdown back to the ordinary window; the shortcut stays on. */
  dropdownLeave: () => invoke<void>("dropdown_leave"),
  /** Show a link in the side panel at `bounds`; resolves to what its address bar shows. */
  openPreview: (url: string, bounds: PreviewBounds) => invoke<string>("open_preview", { url, bounds }),
  previewBounds: (bounds: PreviewBounds) => invoke<void>("preview_bounds", { bounds }),
  previewVisible: (visible: boolean) => invoke<void>("preview_visible", { visible }),
  previewClose: () => invoke<void>("preview_close"),
  previewNav: (action: "back" | "forward" | "reload") => invoke<void>("preview_nav", { action }),
  /** Text of a file shown in the side panel, to edit it there. */
  readText: (path: string) => invoke<string>("read_text", { path }),
  /** Files of a project whose text contains `query`. */
  searchFiles: (path: string, query: string) => invoke<string[]>("search_files", { path, query }),
  /** Show a file or folder in Finder / Explorer / the file manager. */
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  /** A project's file to the clipboard as a file (paste it in a folder, a chat, an email). */
  copyFile: (path: string, file: string) => invoke<void>("copy_file", { path, file }),
  /** The clipboard's files into the folder `dir` of a project ("" = the project); where they went. */
  pasteFiles: (path: string, dir: string) => invoke<string[]>("paste_files", { path, dir }),
  writeText: (path: string, text: string) => invoke<void>("write_text", { path, text }),
  /** A web page in Brave / Chrome / the system browser (`browser`, see Layout), a file in its default app. */
  openExternal: (url: string, browser?: string) => invoke<void>("open_external", { url, browser }),
  /** "Brave" or "Chrome" when that is where web pages go; null = the system browser. */
  browserName: (browser: string) => invoke<string | null>("browser_name", { browser }),
  updateCheck: () => invoke<Update | null>("update_check"),
  /** Downloads `version`, starts it and quits desk. */
  updateInstall: (version: string) => invoke<void>("update_install", { version }),
  chatDir: () => invoke<string>("chat_dir"),
  gitBranches: (path: string) => invoke<string[]>("git_branches", { path }),
  gitSwitch: (path: string, branch: string) => invoke<void>("git_switch", { path, branch }),
  usage: (agents: string[]) => invoke<Usage[]>("usage", { agents }),
  /** The usage popover's history, sessions and (unless null) share of the 5-hour window. */
  usageDetails: (agent: string, account: string | null, share: UsageShare | null) =>
    invoke<UsageDetails>("usage_details", { agent, account, share }),
  usageModels: (agent: string, account: string | null, from: number, to: number) =>
    invoke<ModelCost[]>("usage_models", { agent, account, from, to }),
  /** Each Claude account's folder and login (Options). */
  claudeAccounts: () => invoke<AccountInfo[]>("claude_accounts"),
};

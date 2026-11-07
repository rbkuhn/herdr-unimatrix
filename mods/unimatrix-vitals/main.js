// Unimatrix hive vitals: drone counts by status, the drone with the least context left (CORTEX),
// the 5-hour quota (LINK), a load trace (drones processing over the last 6 minutes), the
// hive clock and uptime, and the current sector's git: branch, ahead/behind, uncommitted files.
// Reads the statusLine cache (data/traveler/sessions); runs `git status` in the shown space's
// folder (on its machine) every 10 s while the window is in front.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, exec, panes, readTextFile, run, spaces, theme, watchFolder, window } from "herdr";
import { appLabel, cachePath, gauge, parseCache } from "./lib.js";

const HOME = appHome();
const SESSIONS_DIR = `${HOME}/data/traveler/sessions`;
const HUD = "Silkscreen";
const GREEN = "#36e27a";
const RED = "#ff3b30";
const CYAN = "#4fe3e0";
const AMBER = "#e8b13a";
const IDLE = "#4d8a77";
const SAMPLES = 36; // one every 10 s: six minutes

const two = (n) => String(n).padStart(2, "0");
const hms = (s) => `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
const levelColor = (p, stale) => (p === null ? IDLE : p < 15 ? RED : p < 30 ? AMBER : stale ? "#2fae73" : GREEN);

function folderOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// A segmented LED bar: `n` lamps, lit up to `pct`.
function lamps(pct, n, color, w = 6, h = 9) {
  const lit = pct === null ? 0 : Math.round((pct / 100) * n);
  const out = [];
  for (let i = 0; i < n; i++) out.push(div().w(w).h(h).flex_none().bg(i < lit ? color : "#0a2019").border(1).border_color(i < lit ? color : "#123a2e"));
  return h_flex().gap(1).flex_none().children(out);
}

const label = (text, color) => div().font_family(HUD).text_size(7).text_color(color).child(text);

export default class Vitals extends View {
  init(_props, cx) {
    this.start = Date.now();
    this.cache = {};
    this.load = [];
    this.git = null;
    this.gitAt = 0;
    this.watching = false;
    cx.timer.every(1000, (cx) => {
      const sp = spaces().find((s) => s.active);
      if (sp?.id !== this.space || (window()?.active && Date.now() - this.gitAt > 10000)) this.refreshGit(cx);
      if (window()?.active) cx.notify();
    });
    cx.timer.every(10000, (cx) => {
      this.load.push(agents().filter((a) => a.status === "working").length);
      if (this.load.length > SAMPLES) this.load.shift();
      this.read(cx);
      this.watch(cx);
    });
    this.load.push(agents().filter((a) => a.status === "working").length);
    this.read(cx);
    this.watch(cx);
    this.refreshGit(cx);
  }

  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      let quick = 0;
      for (;;) {
        let changed;
        const started = Date.now();
        try { changed = await watchFolder(SESSIONS_DIR); } catch { break; }
        quick = Date.now() - started < 500 && (changed ?? []).length === 0 ? quick + 1 : 0;
        if (quick >= 3) break;
        this.read(cx);
      }
      this.watching = false;
    });
  }

  read(cx) {
    const wanted = agents().filter((a) => !appLabel(a.app)?.builder).map((a) => ({ a, path: cachePath(HOME, a.address) })).filter((w) => w.path);
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) next[w.a.address] = parseCache(await readTextFile(w.path).catch(() => null));
      this.cache = next;
      cx.notify();
    });
  }

  refreshGit(cx) {
    if (this.gitBusy) return;
    const sp = spaces().find((s) => s.active);
    this.space = sp?.id;
    this.gitAt = Date.now();
    const cwd = sp ? folderOf(sp, panes()) : null;
    if (!cwd) { this.git = null; return; }
    this.gitBusy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on: sp.machine ?? null });
        if (r.code !== 0) this.git = null;
        else {
          const g = { branch: null, ahead: 0, behind: 0, dirty: 0, staged: 0, upstream: false };
          for (const line of r.stdout.split("\n")) {
            if (line.startsWith("# branch.head ")) g.branch = line.slice(14);
            else if (line.startsWith("# branch.upstream ")) g.upstream = true;
            else if (line.startsWith("# branch.ab ")) { const [a, b] = line.slice(12).split(" "); g.ahead = Math.abs(parseInt(a, 10)) || 0; g.behind = Math.abs(parseInt(b, 10)) || 0; }
            else if (line && !line.startsWith("# ")) { g.dirty++; if (/^[12] [MADRC]/.test(line)) g.staged++; }
          }
          this.git = g;
        }
      } catch { /* machine away: keep the last answer */ }
      this.gitBusy = false;
      cx.notify();
    });
  }

  tile(word, n, color, status, t) {
    const first = agents().find((a) => (status === "idle" ? !["blocked", "working", "done"].includes(a.status) : a.status === status));
    return v_flex().id(`vt-${status}`).flex_1().min_w(0).h(44).items_center().justify_center().gap(2)
      .bg(n && status === "blocked" ? "#2a07059c" : "#020c0ad0").border(1).border_color(n ? `${color}88` : "#0d2a22")
      .when(Boolean(first), (el) => el.cursor_pointer().hover((s) => s.bg("#0a2a21")).on_click(() => run("agent.focus", { terminal: first.address })))
      .child(div().font_family(HUD).font_weight(700).text_size(17).text_color(n ? color : t.dim)
        .when(n > 0 && status === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 700 })).child(two(n)))
      .child(label(word, n ? color : t.dim));
  }

  render() {
    const t = theme();
    const all = agents();
    const now = Math.floor(Date.now() / 1000);
    const count = (s) => all.filter((a) => (s === "idle" ? !["blocked", "working", "done"].includes(a.status) : a.status === s)).length;
    // Lowest cortex among drones with a reading; LINK from the freshest reading (the quota is shared).
    let low = null, fresh = null;
    for (const a of all) {
      const c = this.cache[a.address];
      if (!c) continue;
      if (c.hp !== null && (low === null || c.hp < low.c.hp)) low = { a, c };
      if (c.sp !== null && (fresh === null || c.updatedAt > fresh.updatedAt)) fresh = c;
    }
    const cortex = low ? gauge(low.c.hp, low.c.updatedAt, now) : { text: "—", pct: null, stale: false };
    const link = fresh ? gauge(fresh.sp, fresh.updatedAt, now) : { text: "—", pct: null, stale: false };
    const sp = spaces().find((s) => s.active);
    const g = this.git;
    const peak = Math.max(1, ...this.load);
    const d = new Date();
    const bars = [];
    for (let i = 0; i < SAMPLES; i++) {
      const v = this.load[i - (SAMPLES - this.load.length)] ?? null;
      bars.push(div().flex_1().min_w(1).h(v === null ? 1 : Math.max(1, Math.round((v / peak) * 22))).bg(v ? GREEN : "#123a2e"));
    }
    const row = (k, v, color) => h_flex().h(14).gap(6).items_center().child(div().w(58).flex_none().font_family(HUD).text_size(7).text_color(t.dim).child(k)).child(div().flex_1().min_w(0).truncate().text_size(11).text_color(color ?? t.foreground).child(v));
    return v_flex().id("unimatrix-vitals").size_full().min_h(0).px(10).pt(8).pb(8).gap(7).text_color(t.foreground).text_size(12)
      .child(h_flex().h(14).gap(7).items_center()
        .child(div().w(3).h(10).bg(RED))
        .child(div().font_family(HUD).font_weight(700).text_size(9).text_color(GREEN).child("HIVE VITALS"))
        .child(div().flex_1().h(1).bg("#174d3c"))
        .child(div().font_family(HUD).text_size(9).text_color(GREEN).child(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`)))
      .child(h_flex().gap(4)
        .child(this.tile("INPUT", count("blocked"), RED, "blocked", t))
        .child(this.tile("PROC", count("working"), GREEN, "working", t))
        .child(this.tile("DONE", count("done"), CYAN, "done", t))
        .child(this.tile("REGEN", count("idle"), IDLE, "idle", t)))
      .child(v_flex().gap(3)
        .child(h_flex().gap(6).items_center().child(label("CORTEX MIN", t.dim)).child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.muted).child(low ? low.a.tab_name : "no reading")))
        .child(h_flex().gap(6).items_center().child(lamps(cortex.pct, 20, levelColor(cortex.pct, cortex.stale))).child(div().text_size(11).text_color(levelColor(cortex.pct, cortex.stale)).child(cortex.stale ? `${cortex.text}*` : cortex.text))))
      .child(v_flex().gap(3)
        .child(h_flex().gap(6).items_center().child(label("LINK QUOTA", t.dim)).child(div().flex_1().min_w(0).text_size(10.5).text_color(t.muted).child("5-hour window")))
        .child(h_flex().gap(6).items_center().child(lamps(link.pct, 20, levelColor(link.pct, link.stale))).child(div().text_size(11).text_color(levelColor(link.pct, link.stale)).child(link.stale ? `${link.text}*` : link.text))))
      .child(v_flex().gap(3)
        .child(h_flex().gap(6).items_center().child(label("HIVE LOAD", t.dim)).child(div().flex_1().h(1).bg("#0d2a22")).child(label(`UPTIME ${hms(Math.floor((Date.now() - this.start) / 1000))}`, t.dim)))
        .child(h_flex().h(24).gap(1).items_end().px(2).pb(1).bg("#020c0ad0").border(1).border_color("#0d2a22").children(bars)))
      .child(v_flex().gap(2).pt(2).border_t(1).border_color("#0d2a22")
        .child(row("SECTOR", sp?.name ?? "—", "#c2ffd9"))
        .child(row("BRANCH", g?.branch ? `${g.branch}${g.upstream ? "" : "  (no upstream)"}` : g === null ? "not a repo" : "—", g?.branch ? GREEN : t.dim))
        .child(row("SYNC", g ? `${g.ahead} ahead · ${g.behind} behind` : "—", g && (g.ahead || g.behind) ? AMBER : t.muted))
        .child(row("CHANGES", g ? (g.dirty ? `${g.dirty} uncommitted · ${g.staged} staged` : "clean") : "—", g?.dirty ? AMBER : g ? GREEN : t.dim)));
  }
}

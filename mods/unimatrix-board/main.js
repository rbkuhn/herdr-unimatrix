// Unimatrix triage board: every agent as a compact drone card, sorted into status lanes
// (AWAITING INPUT, PROCESSING, COMPLETE, REGENERATING). Lanes with drones share the width by
// how many they hold; empty lanes shrink to a slim label. Faces are sprite strips stepped by
// an 80 ms clock (Herdr's image() shows only an animated file's first frame). Cortex = context
// left, Link = 5-hour quota left, from the statusLine cache in data/traveler/sessions.
// Reads cache files only: no commands, no network.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, playSound, readTextFile, run, setAgentOrder, spaces, theme, watchFolder, window } from "herdr";
import { CLASS_TITLE, animPath, appLabel, assignJobs, cachePath, designation, gauge, jobIn, parseCache, remoteCachePath, tabNames } from "./lib.js";

const HOME = appHome();
const SESSIONS_DIR = `${HOME}/data/traveler/sessions`;
const JOBS_FILE = `${HOME}/mods/unimatrix-board/jobs.json`;
const BLIP = "mods/unimatrix-rail/sounds/blip.mp3";
const FACE = 60;
const HUD = "Silkscreen";
const GREEN = "#36e27a";
const RED = "#ff3b30";
const CYAN = "#4fe3e0";
const IDLE = "#4d8a77";
const EDGE = "#174d3c";
const LANES = [
  { id: "blocked", label: "AWAITING INPUT", short: "INPUT", color: RED },
  { id: "working", label: "PROCESSING", short: "PROC", color: GREEN },
  { id: "done", label: "COMPLETE", short: "DONE", color: CYAN },
  { id: "idle", label: "REGENERATING", short: "REGEN", color: IDLE },
];
const laneOf = (a) => (a.status === "blocked" || a.status === "working" || a.status === "done" ? a.status : "idle");

// The face: one strip per role and state, slid one frame at a time.
function face(a, job, now, color) {
  const state = a.status === "working" || a.status === "blocked" || a.status === "done" ? a.status : "rest";
  const anim = animPath(job, state);
  const shell = div().relative().size(FACE).flex_none().overflow_hidden().bg("#000000").border(1).border_color(color);
  if (anim) {
    const i = Math.floor(now / anim.ms) % anim.frames;
    return shell.child(image(anim.path).absolute().top(0).left(-i * FACE).w(FACE * anim.frames).h(FACE));
  }
  const p = a.program;
  if (!p?.icon) return shell;
  return shell.child((p.tint ? svg(p.icon).text_color(GREEN) : image(p.icon)).absolute().left(16).top(16).size(28));
}

// A micro power bar: a 2-letter word, a thin bar, the number. Amber under 30%, red under 15%.
function bar(word, g, t) {
  const color = g.pct === null ? t.dim : g.pct < 15 ? RED : g.pct < 30 ? "#e8b13a" : g.stale ? "#2fae73" : GREEN;
  const fill = g.pct === null ? 0 : Math.max(1, Math.round((g.pct / 100) * 64));
  return h_flex().h(9).gap(4).items_center()
    .child(div().w(12).flex_none().font_family(HUD).text_size(6.5).text_color(t.dim).child(word))
    .child(div().relative().w(64).h(4).flex_none().bg("#0a2019").border(1).border_color("#123a2e")
      .child(div().absolute().left(0).top(0).h(2).w(fill).bg(color)))
    .child(div().flex_none().text_size(9.5).text_color(g.pct === null ? t.dim : color).child(g.stale ? `${g.text}*` : g.text));
}

// HUD corner brackets on a card.
function brackets(color) {
  const b = (w, h) => div().absolute().w(w).h(h).bg(color);
  return [
    b(7, 2).top(-1).left(-1), b(2, 7).top(-1).left(-1),
    b(7, 2).bottom(-1).right(-1), b(2, 7).bottom(-1).right(-1),
  ];
}

export default class Board extends View {
  init(_props, cx) {
    this.jobs = {};
    this.cache = {};
    this.remote = {};
    this.seen = new Set();
    this.watching = false;
    this.clock = 0;
    this.tick = 0;
    cx.timer.every(80, (cx) => {
      this.clock++;
      if (agents().length === 0) return;
      if (window()?.active || this.clock % 3 === 0) cx.notify();
    });
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      try { const p = JSON.parse(text); if (p && typeof p === "object" && !Array.isArray(p)) this.jobs = p; } catch {}
      cx.notify();
    });
    this.load(cx);
    this.loadRemote(cx);
    this.watch(cx);
    cx.timer.every(30000, (cx) => {
      this.load(cx);
      this.watch(cx);
      if (++this.tick % 2 === 0) this.loadRemote(cx);
    });
  }

  // Re-read the cache when the statusline writes it; the 30 s timer retries a failed watch.
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
        this.load(cx);
      }
      this.watching = false;
    });
  }

  load(cx) {
    const wanted = [];
    for (const a of agents()) {
      const path = cachePath(HOME, a.address);
      if (path === null) continue;
      this.seen.add(a.address);
      wanted.push({ address: a.address, path });
    }
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) next[w.address] = parseCache(await readTextFile(w.path).catch(() => null));
      this.cache = next;
      cx.notify();
    });
  }

  loadRemote(cx) {
    const wanted = [];
    for (const a of agents()) {
      const r = remoteCachePath(a.address);
      if (r === null) continue;
      this.seen.add(a.address);
      wanted.push({ address: a.address, ...r });
    }
    if (wanted.length === 0) return;
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) next[w.address] = parseCache(await readTextFile(w.path, { on: w.on }).catch(() => null));
      this.remote = next;
      cx.notify();
    });
  }

  card(a, index, total, lane, now, t) {
    const cache = this.cache[a.address] ?? this.remote[a.address] ?? null;
    const job = jobIn(a.tab_name, this.assigned);
    const label = appLabel(a.app);
    const edge = a.focused ? GREEN : lane.id === "blocked" ? RED : EDGE;
    const nameColor = lane.id === "blocked" ? "#ff8a7a" : a.focused ? "#c2ffd9" : t.foreground;
    return h_flex()
      .id(`um-${a.address}`)
      .relative()
      .w(222)
      .h(74)
      .flex_none()
      .p(6)
      .gap(8)
      .items_center()
      .bg(a.focused ? "#062019f2" : "#020c0ae8")
      .border(1)
      .border_color(a.focused ? `${GREEN}aa` : lane.id === "blocked" ? `${RED}88` : "#0d2a22")
      .cursor_pointer()
      .hover((s) => s.bg("#0a2a21f2"))
      .on_click(() => {
        playSound(BLIP);
        run("agent.focus", { terminal: a.address });
      })
      .children(brackets(edge))
      // Awaiting input: a red frame that breathes over the card.
      .when(lane.id === "blocked", (el) => el.child(div().absolute().top(-1).left(-1).right(-1).bottom(-1).border(1).border_color(RED).loop("opacity", { from: 0.1, to: 1, period: 900 })))
      .child(face(a, job, this.ms, lane.id === "blocked" ? RED : a.focused ? GREEN : EDGE))
      .child(
        v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(5).items_center()
            .child(div().flex_none().font_family(HUD).text_size(6.5).text_color(lane.color).child(designation(index, total)))
            .child(div().flex_1().min_w(0).truncate().font_family(HUD).text_size(6.5).text_color("#ff3b30b0").child(job ? (CLASS_TITLE[job] ?? "").replace(" Drone", "").toUpperCase() : "")))
          .child(div().w_full().min_w(0).truncate().font_weight(700).text_size(12.5).text_color(nameColor).child(a.tab_name || a.address))
          .child(div().w_full().min_w(0).truncate().text_size(9.5).text_color(t.dim).child(cache?.name ?? a.space_name ?? ""))
          .when(!label?.builder, (el) => el
            .child(bar("CX", gauge(cache ? cache.hp : null, cache ? cache.updatedAt : null, now), t))
            .child(bar("LK", gauge(cache ? cache.sp : null, cache ? cache.updatedAt : null, now), t))),
      );
  }

  lane(lane, list, order, total, now, t) {
    const empty = list.length === 0;
    const pulse = lane.id === "blocked" && !empty;
    const head = h_flex().id(`lane-${lane.id}`).h(18).flex_none().gap(6).items_center().px(6)
      .child(div().size(6).flex_none().bg(empty ? `${lane.color}55` : lane.color).when(pulse, (el) => el.loop("opacity", { from: 0.2, to: 1, period: 700 })))
      .child(div().flex_none().font_family(HUD).font_weight(700).text_size(8).text_color(empty ? t.dim : lane.color).child(empty ? lane.short : lane.label))
      .when(!empty, (el) => el.child(div().flex_1().h(1).bg(`${lane.color}40`)))
      .child(div().flex_none().font_family(HUD).text_size(8).text_color(empty ? t.dim : lane.color).child(String(list.length).padStart(2, "0")))
      // Clicking a lane's header goes to its first drone (for AWAITING INPUT: the longest waiting).
      .when(!empty, (el) => el.cursor_pointer().on_click(() => { playSound(BLIP); run("agent.focus", { terminal: list[0].address }); }));
    const body = empty
      ? v_flex().flex_1().items_center().justify_center().gap(4)
        .child(div().w(1).h(28).bg(`${lane.color}30`))
        .child(div().font_family(HUD).text_size(7).text_color(`${lane.color}70`).child("CLEAR"))
        .child(div().w(1).h(28).bg(`${lane.color}30`))
      : h_flex().id(`lane-body-${lane.id}`).flex_1().min_h(0).flex_wrap().content_start().gap(7).px(6).pt(2).pb(6).overflow_y_scrollbar()
        .children(list.map((a) => this.card(a, order.indexOf(a), total, lane, now, t)));
    return v_flex().h_full().min_w(0).py(4)
      .when(empty, (el) => el.w(64).flex_none())
      .when(!empty, (el) => el.flex_1().flex_grow(list.length).min_w(240))
      .bg(pulse ? "#1a050480" : "#01090880")
      .border(1).border_color(pulse ? `${RED}66` : "#0d2a22")
      .child(head)
      .child(body);
  }

  render(cx) {
    const t = theme();
    const all = agents();
    this.assigned = assignJobs(tabNames(spaces(), all), this.jobs);
    const fresh = all.filter((a) => !this.seen.has(a.address));
    if (fresh.some((a) => cachePath(HOME, a.address) !== null)) this.load(cx);
    if (fresh.some((a) => remoteCachePath(a.address) !== null)) this.loadRemote(cx);
    // Blocked: longest waiting first (lowest seq). Other lanes keep tab order.
    const groups = Object.fromEntries(LANES.map((l) => [l.id, all.filter((a) => laneOf(a) === l.id)]));
    groups.blocked.sort((a, b) => a.seq - b.seq);
    const order = LANES.flatMap((l) => groups[l.id]);
    setAgentOrder(order.map((a) => a.address));
    this.ms = Date.now();
    const now = Math.floor(this.ms / 1000);
    // Designations follow the collective's own (tab) order, so they don't change with status.
    const roster = [...all];
    return v_flex().id("unimatrix-board").size_full().min_h(0).px(8).pt(5).pb(7).gap(4).text_color(t.foreground).text_size(12)
      .child(h_flex().h(14).flex_none().gap(8).items_center()
        .child(div().w(3).h(10).bg(RED))
        .child(div().font_family(HUD).font_weight(700).text_size(9).text_color(GREEN).child("TRIAGE MATRIX"))
        .child(div().w(6).h(9).bg(GREEN).loop("opacity", { from: 0, to: 1, period: 1000 }))
        .child(div().flex_1().h(1).bg("#174d3c"))
        .when(groups.blocked.length > 0, (el) => el.child(div().font_family(HUD).text_size(8).text_color(RED).loop("opacity", { from: 0.3, to: 1, period: 700 }).child(`${groups.blocked.length} AWAITING INPUT`)))
        .child(div().font_family(HUD).text_size(8).text_color(t.dim).child(`${all.length} DRONES LINKED`)))
      .child(all.length === 0
        ? h_flex().flex_1().items_center().justify_center().font_family(HUD).text_size(9).text_color(t.dim).child("NO DRONES LINKED. AWAITING ASSIMILATION.")
        : h_flex().flex_1().min_h(0).gap(6).children(LANES.map((l) => this.lane(l, groups[l.id], roster, roster.length, now, t))));
  }
}

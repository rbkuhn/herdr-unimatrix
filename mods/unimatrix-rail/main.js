// Unimatrix sector rail: a 112px column, its spaces grouped per computer, each in its own colour. The rotating brand cube on top, then every space as its
// pixel-art location with a status lamp (its most urgent agent) and an amber dot when its repo
// has uncommitted files, then + (new space), settings and add machine. Click selects a sector,
// right-click opens its menu; the tooltip says its name, branch and changes.
// Runs `git status` in each space's folder (on that space's machine) at most every 20 s while
// the window is in front.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, hc, machines, openOverlay, panes, readTextFile, run, spaces, theme, updates, window } from "herdr";

const PLACES = ["cube", "sphere", "alcove", "planet", "nexus", "vortex"];
const PLACES_FILE = `${appHome()}/mods/unimatrix-rail/places.json`;
const ART = "mods/unimatrix-rail/art";
const HUD = "Silkscreen";
const GREEN = "#36e27a";
const RED = "#ff3b30";
const AMBER = "#e8b13a";
const CUBE = 34, CUBE_FRAMES = 36, CUBE_MS = 90;
const ICON = 50;
const LAMP = { blocked: RED, working: GREEN, done: "#4fe3e0" };
// Each computer gets its own colour: this one green, the others in order of their spaces.
const REMOTE_COLORS = ["#4fc3ff", "#ffb347", "#c38bff", "#ff6ad5", "#f4e04d"];

const placeFor = (name, places) =>
  `${ART}/${PLACES.includes(places[name]) ? places[name] : PLACES[[...name].reduce((n, c) => n + c.codePointAt(0), 0) % PLACES.length]}.png`;

// Where a space is now: its first terminal's live folder, else where it was made.
function folderOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

export default class Rail extends View {
  init(_props, cx) {
    this.places = {};
    this.git = {}; // space id -> { dirty, branch, ahead, behind } | null
    this.tick = 0;
    this.last = 0;
    cx.spawn(async (cx) => {
      const text = await readTextFile(PLACES_FILE).catch(() => null);
      try { const p = JSON.parse(text); if (p && typeof p === "object" && !Array.isArray(p)) this.places = p; } catch {}
      cx.notify();
    });
    // The cube turns on its own gentle clock: every frame while in front, every 4th otherwise.
    cx.timer.every(CUBE_MS, (cx) => { if (window()?.active || ++this.tick % 4 === 0) cx.notify(); });
    cx.timer.every(1000, (cx) => {
      const ids = spaces().map((s) => s.id).join(",");
      if (ids !== this.ids || (window()?.active && Date.now() - this.last > 20000)) this.refresh(cx);
    });
    this.refresh(cx);
    // Host names for remote machines (their Herdr names are often bare IPs).
    this.hosts = {};
    const loadHosts = (cx) => cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) {
          const next = {};
          for (const m of JSON.parse(r.stdout).machines ?? []) if (m.name) next[m.name] = { host: m.host || null, state: m.state || null };
          this.hosts = next; cx.notify();
        }
      } catch {}
    });
    loadHosts(cx);
    cx.timer.every(30000, loadHosts);
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    this.last = Date.now();
    const ps = panes();
    const list = spaces().map((s) => ({ id: s.id, on: s.machine ?? null, cwd: folderOf(s, ps) }));
    this.ids = spaces().map((s) => s.id).join(",");
    cx.spawn(async (cx) => {
      const next = {};
      for (const s of list) {
        if (!s.cwd) { next[s.id] = null; continue; }
        try {
          const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd: s.cwd, on: s.on });
          if (r.code !== 0) { next[s.id] = null; continue; }
          const g = { dirty: 0, branch: null, ahead: 0, behind: 0 };
          for (const line of r.stdout.split("\n")) {
            if (line.startsWith("# branch.head ")) g.branch = line.slice(14);
            else if (line.startsWith("# branch.ab ")) { const [a, b] = line.slice(12).split(" "); g.ahead = Math.abs(parseInt(a, 10)) || 0; g.behind = Math.abs(parseInt(b, 10)) || 0; }
            else if (line && !line.startsWith("# ")) g.dirty++;
          }
          next[s.id] = g;
        } catch { next[s.id] = this.git[s.id] ?? null; }
      }
      this.git = next;
      this.busy = false;
      cx.notify();
    });
  }

  cube() {
    const i = Math.floor(Date.now() / CUBE_MS) % CUBE_FRAMES;
    return div().relative().size(CUBE).flex_none().overflow_hidden()
      .child(image(`${ART}/cube.webp`).absolute().top(0).left(-i * CUBE).w(CUBE * CUBE_FRAMES).h(CUBE));
  }

  sector(s, i, t, color) {
    const on = s.active;
    const g = this.git[s.id];
    const lamp = LAMP[s.status];
    const tip = [s.name, g?.branch ? `branch ${g.branch}${g.ahead ? `, ${g.ahead} ahead` : ""}${g.behind ? `, ${g.behind} behind` : ""}` : null, g?.dirty ? `${g.dirty} uncommitted` : null, s.machine ? `on ${s.machine}` : null].filter(Boolean).join(" · ");
    const name = s.name;
    return v_flex().id(`sector-${s.id}`).w(92).flex_none().items_center().gap(2).py(4)
      .bg(on ? `${color}26` : "#00000000").border(1).border_color(on ? color : "#00000000")
      .hover((st) => st.bg("#0a2a21cc")).cursor_pointer().tooltip(tip)
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } }); })
      .child(div().relative().size(ICON).flex_none()
        .child(image(placeFor(s.name, this.places)).size(ICON).opacity(on ? 1 : 0.72))
        .when(Boolean(lamp), (el) => el.child(div().absolute().top(0).right(0).size(8).bg(lamp).border(1).border_color("#000000")
          .when(s.status === "blocked", (l) => l.loop("opacity", { from: 0.2, to: 1, period: 700 }))))
        .when(Boolean(g?.dirty), (el) => el.child(div().absolute().bottom(1).left(0).h(9).px(2).bg("#000000c0").font_family(HUD).text_size(6).text_color(AMBER).child(`±${g.dirty > 99 ? "99" : g.dirty}`))))
      .child(div().font_family(HUD).text_size(6).text_color(on ? color : t.dim).child(`S-${String(i + 1).padStart(3, "0")}`))
      .child(div().max_w(88).truncate().text_size(10).font_weight(on ? 700 : 500).text_color(on ? "#ffffff" : t.muted).child(name));
  }

  render() {
    const t = theme();
    const list = spaces();
    const icon = (id, file, tip, action) => div().id(id).size(28).flex_none().flex().items_center().justify_center().text_color(t.dim)
      .hover((s) => s.bg("#0a2a21").text_color(GREEN)).tooltip(tip).cursor_pointer().on_click(action).child(svg(`mods/unimatrix-rail/${file}.svg`).size(14));
    // One framed block per computer: a coloured header naming it, then its spaces on a stripe of
    // the same colour. This computer first, then the others in the order their spaces come.
    const groups = [];
    list.forEach((s, i) => {
      const key = s.machine ?? null;
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push(g = { key, spaces: [] });
      g.spaces.push({ s, i });
    });
    groups.sort((a, b) => (a.key === null ? -1 : b.key === null ? 1 : 0));
    const known = machines();
    let r = 0;
    const items = groups.map((g) => {
      const color = g.key === null ? GREEN : REMOTE_COLORS[r++ % REMOTE_COLORS.length];
      const info = g.key === null ? null : this.hosts?.[g.key];
      const offline = g.key !== null && (info?.state === "unreachable" || known.find((m) => m.name === g.key)?.layout === "unavailable");
      const label = g.key === null ? "THIS PC" : (info?.host || g.key);
      const tip = g.key === null ? "This computer" : `${info?.host ? `${info.host} (${g.key})` : g.key}${offline ? " · can't be reached" : ""}`;
      return v_flex().w(104).flex_none().items_center().gap(3).pb(4)
        .bg(`${color}0d`).border_l(3).border_color(offline ? `${color}55` : color)
        .child(v_flex().id(`machine-${g.key ?? "local"}`).w_full().flex_none().px(4).py(3).gap(1)
          .bg(`${color}${offline ? "18" : "2e"}`).tooltip(tip)
          .child(div().w_full().truncate().text_size(9).font_weight(700).text_color(offline ? t.muted : color).child(label))
          .child(h_flex().gap(4).items_center()
            .child(div().size(5).flex_none().bg(offline ? RED : color))
            .child(div().font_family(HUD).text_size(6).text_color(offline ? RED : t.dim)
              .child(offline ? "OFFLINE" : `${g.spaces.length} SPACE${g.spaces.length === 1 ? "" : "S"}`))))
        .children(g.spaces.map(({ s, i }) => this.sector(s, i, t, color)));
    });
    return v_flex().id("unimatrix-rail").size_full().items_center().text_color(t.foreground)
      .child(v_flex().w_full().h(58).flex_none().items_center().justify_center().gap(1).bg("#010807d8").border_b(1).border_color("#174d3c")
        .child(this.cube())
        .child(h_flex().gap(2).items_center().child(div().w(2).h(6).bg(RED)).child(div().font_family(HUD).font_weight(700).text_size(7).text_color(GREEN).child("HERDR"))))
      .child(h_flex().w_full().h(20).flex_none().justify_center().items_center().gap(3)
        .child(div().font_family(HUD).text_size(6.5).text_color(GREEN).child("SECTORS"))
        .child(div().font_family(HUD).text_size(6.5).text_color(t.dim).child(String(list.length).padStart(2, "0"))))
      .child(v_flex().id("sectors").w_full().flex_1().min_h(0).items_center().gap(4).py(2).overflow_y_scrollbar().gap(8).children(items)
        .child(div().id("space-new").w(50).h(26).flex_none().flex().items_center().justify_center().border(1).border_color("#174d3c").border_dashed().text_color(t.dim)
          .hover((s) => s.text_color(GREEN).border_color(GREEN)).tooltip("New space").cursor_pointer().on_click(() => run("space.new")).child(svg("mods/unimatrix-rail/plus.svg").size(13))))
      .child(v_flex().w_full().flex_none().items_center().gap(2).py(6).bg("#010807d8").border_t(1).border_color("#174d3c")
        .child(icon("search", "search", "Find anything", () => run("mod.open", { name: "picker" })))
        .child(div().relative().child(icon("settings", "settings", "Settings", () => run("app.settings")))
          .when(Boolean(updates().app.ready), (el) => el.child(div().absolute().top(3).right(3).size(5).bg(GREEN))))
        .child(icon("machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" }))));
  }
}

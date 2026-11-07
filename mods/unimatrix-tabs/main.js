import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, spaces, panes, run, openOverlay, theme, window, shared, layout, settings, appHome, readTextFile } from "herdr";
import { assignJobs, jobIn, portraitPath, tabNames } from "./lib.js";

const JOBS_FILE = `${appHome()}/mods/unimatrix-board/jobs.json`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.jobs = {};
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.jobs = parsed; } catch {}
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const assigned = assignJobs(tabNames(spaces(), agents()), this.jobs);
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const portrait = portraitPath(jobIn(c.name, assigned));
      return h_flex().id(`tab-${c.id}`).relative().h(32).pl(3).pr(9).gap(7).items_center().flex_none().text_size(12)
        .border(1).border_color(c.active ? "#36e27a" : "#0d2a22").bg(c.active ? "#062019f2" : "#020c0ad8").text_color(c.active ? "#c2ffd9" : t.muted).font_weight(c.active ? 700 : 500)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(c.active, el => el.child(div().absolute().left(-1).right(-1).bottom(-1).h(2).bg("#36e27a")))
        .when(Boolean(portrait), el => el.child(image(portrait).size(26).flex_none().border(1).border_color(c.status === "blocked" ? t.blocked : "#174d3c")))
        .when(!portrait && Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "inbox"];
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(7).gap(4).flex_none().items_center()
        .text_size(7.5).font_family("Silkscreen").border(1).border_color(on ? "#36e27a" : "#0d2a22").bg(on ? "#062019f2" : "#020c0ad8").text_color(on ? "#c2ffd9" : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(image(icon).size(18).flex_none()).child(label.toUpperCase());
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(4).items_center().border_b(1).border_color("#174d3c")
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/unimatrix-tabs/art/files.png")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/unimatrix-tabs/art/changes.png")))
      .child(panelButton("inbox", "Inbox", "mods/unimatrix-tabs/art/inbox.png"))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/unimatrix-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/unimatrix-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/unimatrix-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}

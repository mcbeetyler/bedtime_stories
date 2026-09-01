/* ============================================================
   The Bedtime Story Machine — front end
   Plain JS, no build step. Edit CONFIG below to fit your family.
   ============================================================ */

const CONFIG = {
  // Who's listening tonight. First entry is the default. The box under the
  // chips accepts anything ("4-year-old who loves unicorns and poop jokes").
  audiences: ["3-year-old boy", "4-year-old girl", "both kids"],
  vibes: ["silly & giggly", "gentle & sleepy", "epic adventure", "totally bonkers", "spooky but cozy"],
  lengths: [
    { label: "Short", beats: 12 },
    { label: "Medium", beats: 20 },
    { label: "Long", beats: 30 },
  ],
};

// Backup menu, used only if the API can't be reached.
const FALLBACK_MENU = {
  heroes: ["a brave little fox", "a sleepy dragon", "a monster truck with a cowboy hat", "a unicorn with pink hooves", "a puppy lifeguard", "a fairy in a rose-petal boat", "a baby t-rex", "a kitten in a tutu"],
  places: ["a candy garden", "a busy construction site", "a cloud castle", "a beach with pink sand", "a treehouse with a slide", "a snowy mountain rescue base", "a fairy tea party", "a farm with a big red barn"],
  problems: ["the rainbow got tangled in a tree", "a baby duck fell in the mud", "all the sparkles ran out", "a shoe is stuck in the sandbox", "the moon fell into the pond", "somebody hid the queen's crowns", "a balloon flew too high", "the flowers stopped humming"],
  wildcards: ["a singing seashell", "a giggly baby cloud", "a magic hairbrush", "a bouncy magic ball", "a friendly frog", "a giant roll of toilet paper", "a shiny gold star sticker", "a cat wearing five hats"],
};

const STORY_FIELDS = ["hero", "place", "problem", "wildcard"];
const MENU_KEY = { hero: "heroes", place: "places", problem: "problems", wildcard: "wildcards" };
const LABELS = {
  audience: "Who's listening",
  hero: "The Hero",
  place: "The Place",
  problem: "The Problem",
  wildcard: "A Wildcard",
  vibe: "The Vibe",
  length: "How long",
};
const STATUS_TEXT = {
  loading: "dreaming up tonight's ideas…",
  fresh: "tonight's fresh ideas ✦",
  cached: "tonight's ideas ✦",
  error: "couldn't reach the story cloud — using the backup list",
};

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const todayKey = () => new Date().toISOString().slice(0, 10);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / quota — ignore */
    }
  },
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Minimal markdown for story beats: **bold** and *italics*. HTML is escaped first.
const md = (s) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");

// ---------------------------------------------------------------- state

const prefs = store.get("bsm:prefs", {});

let night = store.get("bsm:night", false) === true;

function applyNight() {
  document.body.classList.toggle("night", night);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = night ? "#060409" : "#160f2b";
  const btn = $("#btn-night");
  if (btn) btn.textContent = night ? "☾ Undim" : "☾ Dim";
}

function toggleNight() {
  night = !night;
  store.set("bsm:night", night);
  applyNight();
}

const state = {
  audience: CONFIG.audiences.includes(prefs.audience) ? prefs.audience : CONFIG.audiences[0],
  audienceCustom: typeof prefs.audienceCustom === "string" ? prefs.audienceCustom : "",
  menu: FALLBACK_MENU,
  menuStatus: "loading", // loading | fresh | cached | error
  pick: { hero: "", place: "", problem: "", wildcard: "" },
  custom: { hero: "", place: "", problem: "", wildcard: "" },
  vibe: CONFIG.vibes.includes(prefs.vibe) ? prefs.vibe : CONFIG.vibes[0],
  length: CONFIG.lengths.some((l) => l.label === prefs.length) ? prefs.length : CONFIG.lengths[1].label,
  story: store.get("bsm:lastStory", null),
  storyStatus: "idle", // idle | loading | error
  error: "",
};

const savePrefs = () =>
  store.set("bsm:prefs", {
    audience: state.audience,
    audienceCustom: state.audienceCustom,
    vibe: state.vibe,
    length: state.length,
  });

const currentAudience = () => state.audienceCustom.trim() || state.audience;
const valueOf = (field) => state.custom[field].trim() || state.pick[field];
const menuOptions = (field) => {
  const list = state.menu[MENU_KEY[field]];
  return Array.isArray(list) && list.length ? list : FALLBACK_MENU[MENU_KEY[field]];
};

// ---------------------------------------------------------------- api

async function api(payload) {
  const res = await fetch("/api/story", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let menuRequest = 0; // ignore stale responses if the audience changes mid-fetch

async function loadMenu({ force = false } = {}) {
  const audience = currentAudience();
  const cacheKey = `bsm:menu:${todayKey()}:${audience.toLowerCase()}`;
  const cached = force ? null : store.get(cacheKey, null);
  if (cached) {
    applyMenu(cached, "cached");
    return;
  }

  const id = ++menuRequest;
  state.menuStatus = "loading";
  renderMenuStatus();
  setBusy(true);
  try {
    const menu = await api({ kind: "menu", audience });
    if (id !== menuRequest) return;
    store.set(cacheKey, menu);
    applyMenu(menu, "fresh");
  } catch (err) {
    if (id !== menuRequest) return;
    state.menuStatus = "error";
    state.error = err.message;
    renderMenuStatus();
  } finally {
    if (id === menuRequest) setBusy(false);
  }
}

function applyMenu(menu, status) {
  state.menu = menu;
  state.menuStatus = status;
  STORY_FIELDS.forEach((f) => {
    if (!menuOptions(f).includes(state.pick[f])) state.pick[f] = "";
  });
  renderMenuStatus();
  STORY_FIELDS.forEach(renderChips);
}

async function tellStory() {
  const length = CONFIG.lengths.find((l) => l.label === state.length) || CONFIG.lengths[1];
  state.storyStatus = "loading";
  state.error = "";
  renderStory();
  $("#story").scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const story = await api({
      kind: "story",
      audience: currentAudience(),
      vibe: state.vibe,
      beats: length.beats,
      hero: valueOf("hero"),
      place: valueOf("place"),
      problem: valueOf("problem"),
      wildcard: valueOf("wildcard"),
    });
    state.story = story;
    state.storyStatus = "idle";
    store.set("bsm:lastStory", story);
  } catch (err) {
    state.storyStatus = "error";
    state.error = err.message;
  }
  renderStory();
}

function surprise() {
  STORY_FIELDS.forEach((f) => {
    state.pick[f] = rand(menuOptions(f));
    state.custom[f] = "";
    $(`#custom-${f}`).value = "";
    renderChips(f);
  });
  state.vibe = rand(CONFIG.vibes);
  savePrefs();
  renderChips("vibe");
}

// ---------------------------------------------------------------- render
// The builder is built once; only chip rows, the status line and the story
// card re-render. Inputs are never replaced, so typing never loses focus.

function fieldHtml(name, { custom = false, spark = false } = {}) {
  return `
    <div class="field${spark ? " spark" : ""}" data-field="${name}">
      <label for="${custom ? `custom-${name}` : `chips-${name}`}">${LABELS[name]}</label>
      <div class="chips" id="chips-${name}"></div>
      ${custom ? `<input class="custom" id="custom-${name}" type="text" placeholder="…or type your own" autocomplete="off" autocapitalize="off" enterkeyhint="done">` : ""}
    </div>`;
}

function buildBuilder() {
  const b = $("#builder");
  b.innerHTML = `
    <div class="menubar">
      <span class="status" id="menu-status"></span>
      <button type="button" class="btn small" id="btn-newideas">↻ New ideas</button>
    </div>
    ${fieldHtml("audience", { custom: true })}
    ${STORY_FIELDS.map((f) => fieldHtml(f, { custom: true, spark: true })).join("")}
    ${fieldHtml("vibe")}
    ${fieldHtml("length")}
    <div class="actions">
      <button type="button" class="btn" id="btn-surprise">↻ Surprise me</button>
      <button type="button" class="btn primary" id="btn-story">✨ Tell me a story</button>
    </div>`;

  $("#custom-audience").value = state.audienceCustom;

  b.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) onChip(chip.closest(".field").dataset.field, chip.dataset.v);
  });

  STORY_FIELDS.forEach((f) => {
    $(`#custom-${f}`).addEventListener("input", (e) => {
      state.custom[f] = e.target.value;
      if (state.custom[f].trim() && state.pick[f]) {
        state.pick[f] = "";
        renderChips(f);
      }
    });
  });

  const aud = $("#custom-audience");
  aud.addEventListener("input", () => {
    state.audienceCustom = aud.value;
    renderChips("audience");
  });
  aud.addEventListener("change", () => {
    savePrefs();
    loadMenu();
  });

  b.querySelectorAll(".custom").forEach((inp) =>
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") inp.blur();
    })
  );

  $("#btn-newideas").addEventListener("click", () => loadMenu({ force: true }));
  $("#btn-surprise").addEventListener("click", surprise);
  $("#btn-story").addEventListener("click", tellStory);
}

function onChip(field, value) {
  if (field === "audience") {
    state.audience = value;
    state.audienceCustom = "";
    $("#custom-audience").value = "";
    savePrefs();
    renderChips("audience");
    loadMenu();
    return;
  }
  if (field === "vibe") {
    state.vibe = value;
    savePrefs();
    renderChips("vibe");
    return;
  }
  if (field === "length") {
    state.length = value;
    savePrefs();
    renderChips("length");
    return;
  }
  state.pick[field] = state.pick[field] === value ? "" : value; // tap again to clear
  state.custom[field] = "";
  $(`#custom-${field}`).value = "";
  renderChips(field);
}

function chipModel(field) {
  if (field === "audience") return { options: CONFIG.audiences, selected: state.audienceCustom.trim() ? "" : state.audience };
  if (field === "vibe") return { options: CONFIG.vibes, selected: state.vibe };
  if (field === "length") return { options: CONFIG.lengths.map((l) => l.label), selected: state.length };
  return { options: menuOptions(field), selected: state.pick[field] };
}

function renderChips(field) {
  const { options, selected } = chipModel(field);
  $(`#chips-${field}`).innerHTML = options
    .map((o) => `<button type="button" class="chip${o === selected ? " on" : ""}" data-v="${escapeHtml(o)}">${escapeHtml(o)}</button>`)
    .join("");
}

function renderMenuStatus() {
  const el = $("#menu-status");
  el.textContent = STATUS_TEXT[state.menuStatus];
  el.className = `status ${state.menuStatus}`;
  $("#btn-newideas").disabled = state.menuStatus === "loading";
}

function setBusy(on) {
  $("#builder").classList.toggle("busy", on);
}

function storyText() {
  const s = state.story;
  return `${s.title}\n\n${s.beats.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}`;
}

function renderStory() {
  const el = $("#story");
  const btn = $("#btn-story");
  btn.disabled = state.storyStatus === "loading";
  btn.textContent = state.storyStatus === "loading" ? "Conjuring…" : "✨ Tell me a story";

  if (state.storyStatus === "loading") {
    el.innerHTML = `
      <div class="paper loading">
        <h2>Conjuring a story…</h2>
        <p class="pulse">the sparks are swirling ✨</p>
        <p>long stories can take half a minute</p>
      </div>`;
    return;
  }

  let html = "";
  if (state.storyStatus === "error") html += `<p class="err">${escapeHtml(state.error || "Something went wrong.")}</p>`;

  if (state.story) {
    const beats = state.story.beats
      .map((b, i) => {
        const ask = /^ask the kids/i.test(b.replace(/^[*_\s]+/, ""));
        return `<li class="beat${ask ? " ask" : ""}"><span class="n">${i + 1}</span><span>${md(b)}</span></li>`;
      })
      .join("");
    html += `
      <article class="paper">
        <div class="paper-top">
          <h2>${escapeHtml(state.story.title)}</h2>
          <button type="button" class="btn small" id="btn-night">${night ? "☾ Undim" : "☾ Dim"}</button>
        </div>
        <ol class="beats">${beats}</ol>
        <div class="foot">
          <span>✦ Now add the silly voices — that part's all you.</span>
          <span class="foot-btns">
            <button type="button" class="btn small" id="btn-copy">Copy</button>
            <button type="button" class="btn small" id="btn-again">Another one</button>
          </span>
        </div>
      </article>`;
  }

  el.innerHTML = html;

  const copy = $("#btn-copy");
  if (copy) {
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(storyText());
        copy.textContent = "Copied!";
        setTimeout(() => (copy.textContent = "Copy"), 1500);
      } catch {
        copy.textContent = "Can't copy here";
      }
    });
  }
  const again = $("#btn-again");
  if (again) again.addEventListener("click", tellStory);
  const nightBtn = $("#btn-night");
  if (nightBtn) nightBtn.addEventListener("click", toggleNight);
}

// ---------------------------------------------------------------- extras

function makeStars(n = 50) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "star";
    const size = (Math.random() * 2 + 1).toFixed(1);
    s.style.cssText = `width:${size}px;height:${size}px;top:${(Math.random() * 100).toFixed(1)}%;left:${(Math.random() * 100).toFixed(1)}%;animation-delay:${(Math.random() * 4).toFixed(2)}s;animation-duration:${(2 + Math.random() * 3).toFixed(2)}s`;
    frag.appendChild(s);
  }
  $("#stars").appendChild(frag);
}

function installHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone || store.get("bsm:hintDismissed", false)) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const p = document.createElement("p");
  p.className = "hint";
  p.innerHTML = `${
    ios
      ? "Tip: tap Share, then “Add to Home Screen” to install this as an app."
      : "Tip: open the browser menu and tap “Add to Home screen” to install this as an app."
  } <button type="button" id="hint-dismiss">got it</button>`;
  $("main").appendChild(p);
  $("#hint-dismiss").addEventListener("click", () => {
    store.set("bsm:hintDismissed", true);
    p.remove();
  });
}

// Drop yesterday's cached menus so localStorage doesn't grow forever.
function pruneMenuCache() {
  try {
    const keep = `bsm:menu:${todayKey()}:`;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("bsm:menu:") && !k.startsWith(keep))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

// ---------------------------------------------------------------- init

applyNight();
buildBuilder();
["audience", "vibe", "length", ...STORY_FIELDS].forEach(renderChips);
renderMenuStatus();
renderStory();
makeStars();
installHint();
pruneMenuCache();
registerServiceWorker();
loadMenu();

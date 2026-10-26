/* PalengkeLink – website. Every screen reads from and saves to the database through the API (src/routes/index.js). */

// ---------- Session + API ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
// The login is an HttpOnly cookie set by the server: this script cannot read it (so an injected script cannot steal it),
// and the browser sends it with every /api request by itself.
store.set("pl_token", null);   // remove the token older versions kept in localStorage
const session = { user: null, avatar: null };
const cache = {};   // last loaded lists, used to fill the edit forms

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    // X-Requested-With proves the request comes from this website (see routes/index.js)
    headers: { "content-type": "application/json", "x-requested-with": "PalengkeLink" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.user && !path.startsWith("/auth/")) logout("Your session ended. Please sign in again.");
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
const get = (path) => api("GET", path);
const role = () => session.user?.role;

// ---------- Pages: which roles see them in the menu ----------
const PAGES = {
  dashboard:   { icon: "📊", label: "Dashboard",   roles: ["admin", "staff"] },
  home:        { icon: "🏠", label: "Home",        roles: ["vendor"] },
  profile:     { icon: "👤", label: "My Profile",  roles: ["vendor"], open: ["admin", "staff", "vendor"] },
  vendors:     { icon: "🧑‍🌾", label: "Vendors",   roles: ["admin"] },
  stalls:      { icon: "🏪", label: "Stalls",      roles: ["admin", "staff", "vendor"] },
  payments:    { icon: "💳", label: "Payments",    roles: ["admin", "vendor"] },
  products:    { icon: "🧺", label: "Products",    roles: ["admin", "vendor"] },
  inspections: { icon: "📋", label: "Inspections", roles: ["admin", "staff"] },
  maintenance: { icon: "🔧", label: "Maintenance", roles: ["admin", "staff", "vendor"] },
  directory:   { icon: "🏬", label: "Directory",   roles: ["admin", "staff", "vendor"] },
  users:       { icon: "🔑", label: "Accounts",    roles: ["admin"] },
  account:     { icon: "⚙️", label: "Account",     roles: ["admin", "staff", "vendor"] },
};
const canOpen = (page) => PAGES[page] && (PAGES[page].open || PAGES[page].roles).includes(role());
const homePage = () => (role() === "vendor" ? "home" : "dashboard");

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesoShort = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });   // for big stat numbers
const day = (d) => (d ? new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const month = (d) => new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "long", timeZone: "UTC" });
const today = () => new Date().toISOString().slice(0, 10);
const nice = (s) => String(s ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const opts = (list) => list.map((x) => [x, nice(x)]);
const ROLE_NAMES = { admin: "Admin / Market Manager", staff: "Market Staff / Inspector", vendor: "Vendor" };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Magandang umaga" : h < 18 ? "Magandang hapon" : "Magandang gabi"; };

const BAD = ["unpaid", "failed", "suspended", "inactive", "out_of_stock", "declined"];
const WARN = ["open", "in_progress", "vacant", "maintenance", "partial", "pending"];
const badge = (s) => `<span class="b ${BAD.includes(s) ? "x" : WARN.includes(s) ? "w" : ""}">${esc(nice(s))}</span>`;
const btn = (act, id, text, cls = "sm alt") => `<button class="${cls}" data-act="${act}" data-id="${id}">${text}</button>`;
const head = (title, buttons = "", sub = "") =>
  `<div class="head"><div><h2>${title}</h2>${sub ? `<small class="mut">${sub}</small>` : ""}</div><div class="acts">${buttons}</div></div>`;
const empty = (icon, text) => `<div class="empty"><span>${icon}</span><p>${text}</p></div>`;

/** Stat card: big number, label, coloured icon bubble. */
const stat = (icon, value, text, href, tone = "") =>
  `<${href ? `a href="${href}"` : "div"} class="card stat ${tone}"><span class="ico">${icon}</span>
    <div><b>${esc(value)}</b><span>${esc(text)}</span></div></${href ? "a" : "div"}>`;

/** Picture, or coloured initials when there is no picture. */
function avatar(name, src, cls = "") {
  if (src) return `<img class="av ${cls}" src="${esc(src)}" alt="">`;
  const initials = String(name || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let hue = 0;
  for (const ch of String(name)) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="av ${cls}" style="background:hsl(${hue} 45% 40%)">${esc(initials)}</span>`;
}

/** Search box that hides rows ([data-r]) not containing the typed words. */
const searchBox = (placeholder = "Search…") =>
  `<input class="q" type="search" placeholder="🔍 ${esc(placeholder)}" aria-label="${esc(placeholder)}"><p class="mut nomatch" hidden>Nothing matches your search.</p>`;

/** Table that turns into cards on phones (td[data-l] holds the column name). Cells are already-escaped HTML.
 *  search = placeholder text: always show a search box; without it, a box is shown only for long lists. */
function table(headers, rows, emptyText = "No records yet.", search) {
  if (!rows.length) return `<div class="card">${empty("🗂️", esc(emptyText))}</div>`;
  search = search || rows.length > 5 ? searchBox(search) : "";
  const body = rows.map((cells) => `<tr data-r>${cells.map((c, i) => `<td data-l="${esc(headers[i])}">${c ?? ""}</td>`).join("")}</tr>`).join("");
  return `${search}<div class="tw"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function toast(message, bad = false) {
  const t = $("t");
  t.textContent = (bad ? "⚠️ " : "✓ ") + message;
  t.className = "on" + (bad ? " bad" : "");
  clearTimeout(t.timer);
  t.timer = setTimeout(() => (t.className = ""), bad ? 4500 : 2500);
}

// ---------- New passwords: the same rules as the server (src/controllers/auth.js checkNewPassword) ----------
// [checklist text, test, error message]
const PW_RULES = [
  ["8–72 characters", (p) => p.length >= 8 && p.length <= 72, "The password needs 8 to 72 characters."],
  ["A letter", (p) => /[A-Za-z]/.test(p), "The password needs at least one letter."],
  ["A number", (p) => /\d/.test(p), "The password needs at least one number."],
  ["Not the username", (p, name) => !(name.length >= 3 && p.toLowerCase().includes(name)), "The password must not contain the username."],
];
/** The username a new-password box belongs to: the Register form's, or the signed-in person's. */
const pwUsername = (input) => String(input.dataset.user || input.form?.username?.value || session.user?.username || "").trim().toLowerCase();

/** Throws the first broken rule (so the form shows it before anything is sent). */
function checkPassword(p, username = "") {
  const name = String(username).trim().toLowerCase();
  const broken = PW_RULES.find(([, ok]) => !ok(String(p), name));
  if (broken) throw new Error(broken[2]);
}

/** Live checklist under a new-password box (input[data-pw]); also shows whether the confirm box matches. */
function updatePwChecklist(input) {
  // Full width under the password row (on Register the box shares a two-column row with the username)
  const anchor = input.closest(".two") || input.closest("label");
  let list = anchor.nextElementSibling;
  if (!list?.classList.contains("pwcheck")) {
    list = document.createElement("ul");
    list.className = "pwcheck";
    list.setAttribute("aria-label", "Password rules");
    anchor.after(list);
  }
  const p = input.value;
  const name = pwUsername(input);
  const confirmBox = input.form?.confirm;
  const rules = PW_RULES.map(([text, ok]) => [text, ok(p, name)]);
  if (confirmBox) rules.push(["Passwords match", p !== "" && p === confirmBox.value]);
  list.innerHTML = rules.map(([text, ok]) => `<li class="${ok ? "ok" : ""}"><i aria-hidden="true">${ok ? "✓" : ""}</i>${esc(text)}</li>`).join("");
}
document.addEventListener("input", (e) => {
  const box = e.target.matches?.("[data-pw]") ? e.target : e.target.form?.querySelector("[data-pw]");
  if (box && (e.target === box || ["confirm", "username"].includes(e.target.name))) updatePwChecklist(box);
});
document.addEventListener("focusin", (e) => e.target.matches?.("[data-pw]") && updatePwChecklist(e.target));

// ---------- Pictures: crop + shrink in the browser before saving ----------
// Only PNG and JPEG. The file's first bytes decide, not its name or the type Windows reports
// (Windows sometimes calls a .jpg "image/pjpeg").
const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const MAX_PICTURE_MB = 15;

/** Check the file and open it as an <img>. Read as a data: URL, which the Content-Security-Policy allows (blob: URLs are not). */
async function loadPicture(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isPng(head) && !isJpeg(head)) throw new Error("Please choose a PNG or JPEG picture (.png, .jpg or .jpeg).");
  if (file.size > MAX_PICTURE_MB * 1024 * 1024) throw new Error(`That picture is over ${MAX_PICTURE_MB} MB. Please choose a smaller one.`);
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That picture could not be opened. It may be damaged."));
    img.src = url;
  });
}

/** The cropped area as a JPEG data URL of w x h, shrunk until it fits maxLength characters. */
function exportCrop(img, crop, w, h, maxLength) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";   // a PNG's see-through parts become white
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
  for (let q = 0.85; q > 0.3; q -= 0.1) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= maxLength) return url;
  }
  throw new Error("That picture is too large.");
}

/**
 * Crop window: the picture behind a frame of the final shape (circle for the profile picture, 3:1 for the cover).
 * Drag to move; slider, mouse wheel, pinch or +/- to zoom; arrow keys move. Resolves the JPEG data URL, or null on Cancel.
 */
function cropPicture(img, w, h, maxLength, round) {
  return new Promise((resolve) => {
    let dlg = $("cropDlg");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "cropDlg"; document.body.append(dlg); }
    dlg.innerHTML = `<div class="crop"><div class="dlg-head"><h3>${round ? "Crop profile picture" : "Crop cover photo"}</h3>
        <button type="button" class="icon-btn" data-crop="cancel" title="Cancel">✕</button></div>
      <p class="mut small">Drag the picture to move it. Zoom with the slider, the mouse wheel or two fingers.</p>
      <div class="crop-view ${round ? "round" : ""}" tabindex="0" aria-label="Picture to crop. Arrow keys move it, plus and minus zoom."><img alt=""></div>
      <label class="crop-zoom"><span>－</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span>＋</span></label>
      <p class="err" hidden></p>
      <div class="dlg-actions"><button type="button" class="ghost" data-crop="cancel">Cancel</button><button type="button" data-crop="ok">Use picture</button></div></div>`;
    const view = dlg.querySelector(".crop-view"), pic = view.querySelector("img"), slider = dlg.querySelector("input"), err = dlg.querySelector(".err");
    pic.src = img.src;
    dlg.showModal();

    // Frame size on screen; the picture is placed with a translate + scale (origin top-left)
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const vw = view.clientWidth, vh = Math.round(vw * h / w);
    view.style.height = vh + "px";
    pic.style.width = iw + "px";
    const fit = Math.max(vw / iw, vh / ih);   // smallest scale that still fills the frame
    let zoom = 1, s = fit, x = (vw - iw * s) / 2, y = (vh - ih * s) / 2;
    const draw = () => {
      x = Math.min(0, Math.max(vw - iw * s, x));   // the picture always covers the whole frame
      y = Math.min(0, Math.max(vh - ih * s, y));
      pic.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      slider.value = zoom;
    };
    const setZoom = (z, cx = vw / 2, cy = vh / 2) => {   // zoom around a point, keeping it under the finger / cursor
      zoom = Math.min(4, Math.max(1, z));
      const px = (cx - x) / s, py = (cy - y) / s;
      s = fit * zoom;
      x = cx - px * s; y = cy - py * s;
      draw();
    };
    draw();

    // Drag with mouse or one finger, pinch with two
    const pointers = new Map();
    let pinch = null;
    view.onpointerdown = (e) => { view.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); view.classList.add("dragging"); };
    view.onpointermove = (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const now = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, now);
      if (pointers.size === 1) { x += now.x - last.x; y += now.y - last.y; draw(); return; }
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), rect = view.getBoundingClientRect();
      if (pinch) setZoom(zoom * dist / pinch, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      pinch = dist;
    };
    view.onpointerup = view.onpointercancel = (e) => {
      pointers.delete(e.pointerId);
      pinch = null;
      if (!pointers.size) view.classList.remove("dragging");
    };
    view.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = view.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    slider.oninput = () => setZoom(Number(slider.value));
    view.onkeydown = (e) => {
      const step = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }[e.key];
      if (step) { e.preventDefault(); x += step[0]; y += step[1]; draw(); }
      else if (e.key === "+" || e.key === "=") setZoom(zoom * 1.1);
      else if (e.key === "-") setZoom(zoom / 1.1);
    };

    const finish = (result) => { dlg.onclose = null; dlg.close(); resolve(result); };
    dlg.onclose = () => resolve(null);   // Esc key
    dlg.onclick = (e) => {
      const act = e.target.closest("[data-crop]")?.dataset.crop;
      if (act === "cancel") return finish(null);
      if (act !== "ok") return;
      try {   // the frame, mapped back onto the original picture
        finish(exportCrop(img, { sx: -x / s, sy: -y / s, sw: vw / s, sh: vh / s }, w, h, maxLength));
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    };
  });
}

// ---------- Form dialog ----------
// field = { name, label, type?: text|number|date|month|email|password|textarea|select|image, options?: [[value, label]],
//           required? (default true), hint?, step?, min?, max?, list?, minlength?, wide?, w/h/max/round (image) }
function fieldHtml(f, values) {
  const val = values[f.name] ?? f.value ?? "";
  const req = f.required === false ? "" : "required";
  if (f.type === "image") {
    return `<div class="lbl wide">${esc(f.label)}<div class="imgpick ${f.round ? "round" : ""}">
      <img ${val ? `src="${esc(val)}"` : "hidden"} alt=""><input type="hidden" name="${f.name}" value="${esc(val)}">
      <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" data-w="${f.w}" data-h="${f.h}" data-max="${f.max}">
      <button type="button" class="sm alt" data-recrop hidden>✂ Crop again</button>
      <button type="button" class="sm ghost" data-clear>Remove</button></div><small>PNG or JPEG only. You can crop it after choosing.</small></div>`;
  }
  let control;
  if (f.type === "select") {
    control = `<select name="${f.name}" ${req}>${f.options.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    control = `<textarea name="${f.name}" rows="4" maxlength="${f.max || 1000}" ${req}>${esc(val)}</textarea>`;
  } else {
    const extra = ["step", "min", "max", "list", "minlength"].filter((k) => f[k] != null).map((k) => `${k}="${esc(f[k])}"`).join(" ");
    control = `<input name="${f.name}" type="${f.type || "text"}" value="${esc(val)}" ${extra} ${req} ${f.newPassword ? `data-pw maxlength="72" data-user="${esc(f.pwUser || "")}"` : ""}
      autocomplete="${f.type === "password" ? (f.newPassword ? "new-password" : "current-password") : "off"}">`;
  }
  return `<label class="${f.wide ? "wide" : ""}">${esc(f.label)}${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`;
}

/** Open a form in a dialog. onSubmit(data) saves it; on success the dialog closes and the page reloads its data. */
function openForm({ title, fields, values = {}, submit = "Save", done = "Saved", onSubmit, onInput, extra = "" }) {
  const dlg = $("dlg");
  dlg.innerHTML = `<form class="dlg-form"><div class="dlg-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close title="Close">✕</button></div>
    <div class="fields">${fields.map((f) => fieldHtml(f, values)).join("")}</div>
    ${extra}<p class="err" hidden></p>
    <div class="dlg-actions"><button type="button" class="ghost" data-close>Cancel</button><button>${esc(submit)}</button></div></form>`;
  const form = dlg.querySelector("form");
  const err = form.querySelector(".err");
  form.oninput = (e) => onInput && onInput(form, e);
  // Picture fields: check the file, let the person crop it, then show and keep the cropped JPEG
  const cropInto = async (box, img) => {
    const input = box.querySelector("input[type=file]");
    const url = await cropPicture(img, +input.dataset.w, +input.dataset.h, +input.dataset.max, box.classList.contains("round"));
    if (!url) return false;   // Cancel: the old picture stays
    box.querySelector("input[type=hidden]").value = url;
    Object.assign(box.querySelector("img"), { src: url, hidden: false });
    box.picture = img;   // kept for "Crop again"
    box.querySelector("[data-recrop]").hidden = false;
    return true;
  };
  form.onchange = async (e) => {
    const file = e.target.type === "file" && e.target.files[0];
    if (!file) return;
    const box = e.target.closest(".imgpick");
    try {
      err.hidden = true;
      if (!(await cropInto(box, await loadPicture(file)))) e.target.value = "";
    } catch (ex) { err.textContent = ex.message; err.hidden = false; e.target.value = ""; }   // drop the refused file
  };
  form.onclick = (e) => {
    if (e.target.closest("[data-close]")) dlg.close();
    const recrop = e.target.closest("[data-recrop]");
    if (recrop) {
      const box = recrop.closest(".imgpick");
      if (box.picture) cropInto(box, box.picture);
    }
    const clear = e.target.closest("[data-clear]");
    if (clear) {
      const box = clear.closest(".imgpick");
      box.picture = null;
      box.querySelector("[data-recrop]").hidden = true;
      box.querySelector("input[type=hidden]").value = "";
      box.querySelector("input[type=file]").value = "";
      box.querySelector("img").hidden = true;
      box.querySelector("img").removeAttribute("src");
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries([...new FormData(form)].filter(([, v]) => typeof v === "string"));
    const button = form.querySelector(".dlg-actions button:not([type])");
    button.disabled = true;
    err.hidden = true;
    try {
      const message = await onSubmit(data);   // onSubmit may return its own success message
      dlg.close();
      toast(typeof message === "string" ? message : done);
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { button.disabled = false; }
  };
  dlg.showModal();
}

// ---------- Dashboard pieces ----------
/** Stalls as coloured tiles: green = occupied, amber = vacant, red = maintenance. */
const stallMap = (stalls) => `<div class="card"><div class="card-head"><h3>Stall map</h3><a href="#stalls" class="link">Stalls</a></div>
  ${stalls.length ? `<div class="tiles">${stalls.map((s) => `<a href="#stalls" class="tile s-${s.status}" title="${esc(s.stall_number)} · ${esc(nice(s.status))}${s.business_name ? " · " + esc(s.business_name) : ""}">
    <b>${esc(s.stall_number)}</b><small>${esc(s.business_name || nice(s.status))}</small></a>`).join("")}</div>
    <div class="legend"><i class="s-occupied"></i>Occupied <i class="s-vacant"></i>Vacant <i class="s-maintenance"></i>Maintenance</div>` : empty("🏪", "No stalls yet.")}</div>`;

const requestList = (requests) => {
  const open = requests.filter((r) => r.status !== "resolved").slice(0, 5);
  return `<div class="card"><div class="card-head"><h3>Open maintenance</h3><a href="#maintenance" class="link">See all</a></div>
    ${open.length ? `<ul class="list">${open.map((r) => `<li><span class="dot ${r.status}"></span><div><b>${esc(r.issue)}</b>
      <small class="mut">Stall ${esc(r.stall_number)} · ${esc(r.business_name)} · ${day(r.request_date)}</small></div>${badge(r.status)}</li>`).join("")}</ul>`
      : empty("🎉", "No open requests. Everything is working.")}</div>`;
};

const collection = (payments) => {
  if (!payments.length) return `<div class="card"><h3>Rent collection</h3>${empty("🧾", "No bills yet. Create this month's bills on the Payments page.")}</div>`;
  const latest = payments.map((p) => String(p.billing_month).slice(0, 7)).sort().pop();
  const bills = payments.filter((p) => String(p.billing_month).startsWith(latest));
  const due = bills.reduce((t, p) => t + Number(p.amount_due), 0);
  const paid = bills.reduce((t, p) => t + Number(p.amount_paid), 0);
  const pct = due ? Math.round((paid / due) * 100) : 0;
  return `<div class="card"><div class="card-head"><h3>Rent collection · ${month(bills[0].billing_month)}</h3><a href="#payments" class="link">Payments</a></div>
    <div class="ring" style="--p:${pct}"><b>${pct}%</b><small>collected</small></div>
    <div class="split"><div><small class="mut">Collected</small><b class="ok">${peso(paid)}</b></div>
      <div><small class="mut">Still unpaid</small><b class="bad">${peso(due - paid)}</b></div></div></div>`;
};

const pendingList = (users) => {
  const pending = users.filter((u) => u.status === "pending");
  if (!pending.length) return "";
  return `<div class="card attention"><div class="card-head"><h3>🆕 New registrations (${pending.length})</h3><a href="#users" class="link">Accounts</a></div>
    <ul class="list">${pending.map((u) => `<li>${avatar(u.business_name || `${u.first_name} ${u.last_name}`, null, "")}<div>
      <b>${esc(u.business_name || `${u.first_name} ${u.last_name}`)} <span class="chip">${u.role === "staff" ? "📋 Inspector" : "🧑‍🌾 Vendor"}</span></b>
      <small class="mut">${esc(u.first_name)} ${esc(u.last_name)} · ${esc(u.email)}${u.contact_number ? " · " + esc(u.contact_number) : ""}</small></div>
      <span class="acts">${btn("approve", u.user_id, "✓ Approve", "sm")} ${btn("decline", u.user_id, "Decline", "sm danger")}</span></li>`).join("")}</ul></div>`;
};

/** Admin: supplier suggestions from vendors that wait for a decision. */
const suggestionList = (ideas) => {
  const pending = ideas.filter((g) => g.status === "pending");
  if (!pending.length) return "";
  return `<div class="card attention"><div class="card-head"><h3>💡 Supplier suggestions (${pending.length})</h3><a href="#products" class="link">Products</a></div>
    <ul class="list">${pending.map((g) => `<li><span class="ico-sm">🚚</span><div>
      <b>${esc(g.supplier_name)}</b>${g.supplies ? ` <small class="mut">· ${esc(g.supplies)}</small>` : ""}
      <small class="mut">Suggested by ${esc(g.business_name)} · ${day(g.created_at)}${g.contact_number ? " · 📞 " + esc(g.contact_number) : ""}${g.address ? " · 📍 " + esc(g.address) : ""}</small>
      ${g.reason ? `<small>“${esc(g.reason)}”</small>` : ""}</div>
      <span class="acts">${btn("approveSuggestion", g.suggestion_id, "✓ Add supplier", "sm")} ${btn("declineSuggestion", g.suggestion_id, "Decline", "sm danger")}</span></li>`).join("")}</ul></div>`;
};

// Activity log (admin): who changed what, newest first. Rows come from the database audit trigger.
const LOG_TABLES = {
  users: "Account", vendors: "Vendor", stalls: "Stall", stall_assignments: "Stall assignment", rental_payments: "Bill",
  vendor_products: "Vendor product", inspections: "Inspection", maintenance_requests: "Maintenance request",
  supplier_suggestions: "Supplier suggestion", logins: "Sign-in",
};
const LOG_ACTIONS = {
  INSERT: ["Added", ""], UPDATE: ["Changed", "w"], DELETE: ["Removed", "x"],
  LOGIN: ["Signed in", ""], LOGIN_FAIL: ["Wrong password", "w"], LOCKED: ["Account locked", "x"], LOGOUT_ALL: ["Logged out everywhere", "w"],
  CODE_FAIL: ["Wrong sign-in code", "w"], "2STEP_ON": ["Two-step on", ""], "2STEP_OFF": ["Two-step off", "w"],
};
const when = (d) => new Date(d).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const activityLog = (log) => {
  const rows = log.map((l) => {
    const [verb, tone] = LOG_ACTIONS[l.action] || [nice(l.action), ""];
    const label = l.table_name === "rental_payments" && l.label ? month(l.label) : l.label;
    return [`<small>${when(l.logged_at)}</small>`,
      l.username ? `<b>${esc(l.actor)}</b><small class="mut"> @${esc(l.username)}</small>` : `<span class="mut">System / online payment</span>`,
      `<span class="b ${tone}">${verb}</span>`,
      `${esc(LOG_TABLES[l.table_name] || nice(l.table_name))} #${l.record_id ?? "—"}${label ? ` · ${esc(String(label).slice(0, 60))}` : ""}`,
      l.changed?.length ? `<small class="mut">${l.changed.map((c) => esc(nice(c))).join(", ")}</small>` : ""];
  });
  return head("Activity log", "", "Last 200 changes in the system · only admins can see this") +
    table(["When", "Who", "Action", "What", "Changed fields"], rows, "No activity yet.", "Search person, action, stall, vendor…");
};

// ---------- Screens ----------
const views = {
  // ===== Admin / staff dashboard =====
  async dashboard() {
    const isAdmin = role() === "admin";
    const [s, stalls, requests, payments, users, ideas] = await Promise.all([get("/dashboard"), get("/stalls"), get("/maintenance"),
      isAdmin ? get("/payments") : [], isAdmin ? get("/users") : [], isAdmin ? get("/suggestions") : []]);
    cache.suggestions = ideas;
    const open = requests.filter((r) => r.status !== "resolved").length;
    return `<section class="hero" style="--img:url('img/market.jpg')"><div>
        <h2>${greeting()}, ${esc(session.user.first_name)}!</h2>
        <p>${stalls.length} stalls · ${s.occupied_stalls} occupied · ${open} open maintenance request(s)</p></div>
        <div class="acts">${isAdmin
          ? `<button data-act="generate">🧾 Create monthly bills</button><button class="glass" data-act="addVendor">＋ Register vendor</button><button class="glass" data-act="addInspector">＋ Register inspector</button>`
          : `<button data-act="addInspection">📋 Record inspection</button>`}</div></section>
      ${isAdmin ? pendingList(users) + suggestionList(ideas) : ""}
      <div class="grid">
        ${isAdmin ? stat("🧑‍🌾", s.vendors, "Registered vendors", "#vendors", "t-blue") : ""}
        ${stat("🏪", s.occupied_stalls, "Occupied stalls", "#stalls", "t-green")}
        ${stat("🔑", s.vacant_stalls, "Vacant stalls", "#stalls", "t-amber")}
        ${stat("🛠️", stalls.filter((x) => x.status === "maintenance").length, "Under maintenance", "#stalls", "t-red")}
        ${isAdmin ? stat("💰", pesoShort(s.unpaid_rent), "Unpaid rent", "#payments", "t-red") : ""}
        ${stat("✅", s.inspections_passed_pct == null ? "—" : s.inspections_passed_pct + "%", "Inspections passed", "#inspections", "t-green")}
      </div>
      <div class="cols">${stallMap(stalls)}${isAdmin ? collection(payments) : ""}${requestList(requests)}</div>`;
  },

  // ===== Vendor home =====
  async home() {
    const [me, stalls, pays, products, requests] = await Promise.all(
      ["/my/profile", "/my/stalls", "/my/payments", "/my/products", "/my/requests"].map(get));
    cache.payments = pays;
    const unpaid = pays.filter((p) => p.status !== "paid");
    const due = unpaid.reduce((t, p) => t + Number(p.balance), 0);
    return `<section class="hero vendor" style="--img:url('${me.cover ? esc(me.cover) : "img/market.jpg"}')">
        <div class="hero-me">${avatar(me.business_name, me.avatar, "lg ring-white")}<div>
          <h2>${greeting()}, ${esc(session.user.first_name)}!</h2><p>${esc(me.business_name)}${stalls.length ? " · Stall " + esc(stalls.map((s) => s.stall_number).join(", ")) : ""}</p></div></div>
        <div class="acts"><a class="btn glass" href="#profile">👤 View my profile</a></div></section>
      ${me.status === "suspended" ? `<div class="card warnbox">⚠️ Your vendor account is suspended. Please visit the market office.</div>` : ""}
      <div class="grid">
        ${stat("💳", pesoShort(due), "Unpaid balance", "#payments", due ? "t-red" : "t-green")}
        ${stat("🏪", stalls.length, "My stalls", "#stalls", "t-blue")}
        ${stat("🧺", products.length, "Products listed", "#products", "t-green")}
        ${stat("🔧", requests.filter((r) => r.status !== "resolved").length, "Open requests", "#maintenance", "t-amber")}
      </div>
      <div class="cols">
        <div class="card"><div class="card-head"><h3>Bills to pay</h3><a href="#payments" class="link">All payments</a></div>
          ${unpaid.length ? `<ul class="list">${unpaid.map((p) => `<li><span class="ico-sm">🧾</span><div><b>${month(p.billing_month)} · Stall ${esc(p.stall_number)}</b>
            <small class="mut">Balance ${peso(p.balance)}</small></div>${btn("pay", p.payment_id, "💳 Pay now", "sm")}</li>`).join("")}</ul>`
            : empty("🎉", "You are all paid up. Salamat!")}</div>
        <div class="card"><div class="card-head"><h3>Quick actions</h3></div><div class="quick">
          <a href="#products" class="qbtn"><span>🧺</span>Add or update products</a>
          <a href="#maintenance" class="qbtn"><span>🔧</span>Report a problem</a>
          <a href="#directory" class="qbtn"><span>🏬</span>Browse other vendors</a>
          <a href="#account" class="qbtn"><span>🔒</span>Change password</a></div></div>
      </div>`;
  },

  // ===== Vendors (admin) =====
  async vendors() {
    const list = (cache.vendors = await get("/vendors"));
    const rows = list.map((v) => [`<span class="who-cell">${avatar(v.business_name, null, "sm2")}<a href="#profile/${v.vendor_id}">${esc(v.business_name)}</a></span>`,
      esc(`${v.first_name} ${v.last_name}`), esc(v.username), esc(v.contact_number),
      v.account_status === "active" ? badge(v.status) : badge(v.account_status), btn("editVendor", v.vendor_id, "Edit")]);
    return head("Vendors", `<button data-act="addVendor">＋ Register vendor</button>`, `${list.length} vendor(s)`) +
      table(["Business", "Owner", "Username", "Contact", "Status", ""], rows, undefined, "Search vendors, owners, contact…");
  },

  // ===== Stalls (admin + staff: every stall; vendor: own stalls) =====
  async stalls() {
    if (role() === "vendor") {
      const [list, pays] = await Promise.all([get("/my/stalls"), get("/my/payments")]);
      cache.myStalls = list;
      const owed = (no) => pays.filter((p) => p.stall_number === no && p.status !== "paid").reduce((t, p) => t + Number(p.balance), 0);
      const rows = list.map((s) => [`<b>${esc(s.stall_number)}</b>`, esc(s.section), peso(s.monthly_rent), badge(s.status), day(s.start_date),
        owed(s.stall_number) ? `<a href="#payments" class="bad">${peso(owed(s.stall_number))}</a>` : `<span class="ok">Paid up</span>`,
        btn("addRequest", s.stall_id, "🔧 Report a problem")]);
      return head("My stalls", "", list.length ? `You rent ${list.length} stall(s)` : "") +
        table(["Stall", "Section", "Monthly rent", "Status", "Renting since", "Unpaid", ""], rows,
          "You have no stall yet. Please visit the market office to rent one.", "Search stall, section, status…");
    }
    const isAdmin = role() === "admin";
    const [list, vendors] = await Promise.all([get("/stalls"), isAdmin ? get("/vendors") : []]);
    cache.stalls = list;
    cache.vendors = vendors;
    const rows = list.map((s) => [`<b>${esc(s.stall_number)}</b>`, esc(s.section), peso(s.monthly_rent), badge(s.status),
      s.vendor_id ? `<a href="#profile/${s.vendor_id}">${esc(s.business_name)}</a>` : `<span class="mut">—</span>`,
      btn("editStall", s.stall_id, "Edit") + (isAdmin ? " " + btn("stallVendor", s.stall_id, "Change vendor") : "")]);
    return head("Stalls", isAdmin ? `<button data-act="addStall">＋ Add stall</button>` : "", `${list.length} stall(s)`) +
      table(["Stall", "Section", "Monthly rent", "Status", "Vendor", ""], rows, undefined, "Search stall, section, status, vendor…");
  },

  // ===== Payments =====
  async payments() {
    if (role() === "vendor") {
      const list = (cache.payments = await get("/my/payments"));
      const due = list.filter((p) => p.status !== "paid").reduce((t, p) => t + Number(p.balance), 0);
      const rows = list.map((p) => [`<b>${month(p.billing_month)}</b>`, esc(p.stall_number), peso(p.amount_due), peso(p.amount_paid), peso(p.balance), badge(p.status),
        p.status !== "paid" ? btn("pay", p.payment_id, `💳 Pay ${peso(p.balance)}`, "sm") : `<small class="mut">Paid ${day(p.payment_date)}${p.payment_method ? " · " + esc(nice(p.payment_method)) : ""}</small>`]);
      return `<div class="card paybox"><div><span class="mut">Total unpaid balance</span><b>${peso(due)}</b></div>
          <div class="paylogos"><span>GCash</span><span>Card</span><small class="mut">Secure online payment by PayMongo, or pay cash at the market office.</small></div></div>
        ${head("My bills")}${table(["Month", "Stall", "Amount due", "Paid", "Balance", "Status", ""], rows, "No bills yet.")}`;
    }
    const list = (cache.payments = await get("/payments"));
    const rows = list.map((p) => [`#${p.payment_id}`, esc(p.business_name), esc(p.stall_number), month(p.billing_month), peso(p.amount_due),
      peso(p.amount_paid), p.payment_method ? esc(nice(p.payment_method)) : "—", badge(p.status),
      btn("editBill", p.payment_id, "Edit") + (p.status !== "paid" ? " " + btn("cash", p.payment_id, "Record cash") : "")]);
    return head("Rental payments", `<button data-act="generate">🧾 Create monthly bills</button>`, `${list.filter((p) => p.status !== "paid").length} unpaid bill(s)`) +
      table(["#", "Vendor", "Stall", "Month", "Due", "Paid", "Method", "Status", ""], rows, "No bills yet. Use “Create monthly bills”.");
  },

  // ===== Products =====
  async products() {
    if (role() === "vendor") {
      const [mine, catalog] = await Promise.all([get("/my/products"), get("/my/catalog")]);
      cache.myProducts = mine;
      cache.catalog = catalog;
      const rows = mine.map((p) => [`<b>${esc(p.product_name)}</b>`, esc(p.category), `${peso(p.selling_price)} / ${esc(p.unit)}`, p.stock_quantity,
        badge(p.status), esc(p.supplier_name || "—"),
        btn("editMyProduct", p.vendor_product_id, "Edit") + " " + btn("removeMyProduct", p.vendor_product_id, "Remove", "sm danger")]);
      const ideas = await get("/my/suggestions");
      return head("My products", `<button data-act="addMyProduct">＋ Add product</button>`, "Other vendors see these on your profile") +
        table(["Product", "Category", "Price", "Stock", "Status", "Supplier", ""], rows, "You have not listed any products yet.") +
        head("My supplier suggestions", `<button class="alt" data-act="suggestSupplier">💡 Suggest a supplier</button>`,
          "Know a good supplier that is not in the list? Suggest it and the market office will review it.") +
        table(["Supplier", "What they supply", "Sent", "Status", "Reply from the office", ""], ideas.map((g) => [`<b>${esc(g.supplier_name)}</b>`,
          esc(g.supplies || "—"), day(g.created_at), badge(g.status),
          g.admin_note ? esc(g.admin_note) : g.status === "approved" ? `<small class="ok">Added. You can now pick it for your products.</small>` : `<span class="mut">—</span>`,
          g.status === "pending" ? btn("withdrawSuggestion", g.suggestion_id, "Withdraw", "sm ghost") : ""]),
          "You have not suggested any suppliers yet.");
    }
    const [catalog, listings, suppliers, ideas] = await Promise.all([get("/products"), get("/vendor-products"), get("/suppliers"), get("/suggestions")]);
    cache.catalog = catalog;
    cache.suppliers = suppliers;
    cache.suggestions = ideas;
    return suggestionList(ideas) + head("Product catalog", `<button data-act="addProduct">＋ Add product</button>`) +
      table(["Product", "Category", "Unit", "Sold by", ""], catalog.map((p) => [`<b>${esc(p.product_name)}</b>`, esc(p.category), esc(p.unit),
        `${p.vendors} vendor(s)`, btn("editProduct", p.product_id, "Edit")])) +
      head("What vendors sell") +
      table(["Vendor", "Product", "Category", "Price", "Stock", "Status", "Supplier"], listings.map((p) => [
        `<a href="#profile/${p.vendor_id}">${esc(p.business_name)}</a>`, esc(p.product_name), esc(p.category), peso(p.selling_price),
        p.stock_quantity, badge(p.status), esc(p.supplier_name || "—")])) +
      head("Suppliers", `<button data-act="addSupplier">＋ Add supplier</button>`) +
      table(["Supplier", "Contact", "Address", "Products", "Status", ""], suppliers.map((s) => [`<b>${esc(s.supplier_name)}</b>`,
        esc(s.contact_number), esc(s.address), s.products, badge(s.status), btn("editSupplier", s.supplier_id, "Edit")])) +
      head("Supplier suggestions from vendors", "", "Reviewed suggestions") +
      table(["Supplier", "Suggested by", "Sent", "Status", "Note"], ideas.filter((g) => g.status !== "pending").map((g) => [`<b>${esc(g.supplier_name)}</b>`,
        `<a href="#profile/${g.vendor_id}">${esc(g.business_name)}</a>`, day(g.created_at), badge(g.status), esc(g.admin_note || "—")]),
        "No reviewed suggestions yet.");
  },

  // ===== Inspections (admin + staff) =====
  async inspections() {
    const [list, stalls] = await Promise.all([get("/inspections"), get("/stalls")]);
    cache.inspections = list;
    cache.stalls = stalls;
    const rows = list.map((i) => [`<b>${esc(i.stall_number)}</b>`, day(i.inspection_date), esc(i.inspection_type), badge(i.result),
      esc(i.inspector || "—"), esc(i.remarks || "—"), btn("editInspection", i.inspection_id, "Edit")]);
    return head("Inspections", `<button data-act="addInspection">＋ Record inspection</button>`, `${list.length} record(s)`) +
      table(["Stall", "Date", "Type", "Result", "Inspector", "Remarks", ""], rows, undefined, "Search stall, type, result, inspector…");
  },

  // ===== Maintenance =====
  async maintenance() {
    if (role() === "vendor") {
      const [list, stalls] = await Promise.all([get("/my/requests"), get("/my/stalls")]);
      cache.requests = list;
      cache.myStalls = stalls;
      const rows = list.map((r) => [`#${r.request_id}`, esc(r.stall_number), esc(r.issue), day(r.request_date), badge(r.status),
        r.status === "open" ? btn("editRequest", r.request_id, "Edit") : ""]);
      return head("Maintenance requests", stalls.length ? `<button data-act="addRequest">＋ Report a problem</button>` : "",
        stalls.length ? "The market office is notified right away" : "You need an assigned stall to report a problem") +
        table(["#", "Stall", "Issue", "Date", "Status", ""], rows, "No requests yet.", "Search stall, issue, status…");
    }
    const list = await get("/maintenance");
    const rows = list.map((r) => [`#${r.request_id}`, esc(r.stall_number), `<a href="#profile/${r.vendor_id}">${esc(r.business_name)}</a>`,
      esc(r.issue), day(r.request_date),
      `<select class="inline" data-change="requestStatus" data-id="${r.request_id}">${["open", "in_progress", "resolved"].map((s) =>
        `<option value="${s}" ${s === r.status ? "selected" : ""}>${nice(s)}</option>`).join("")}</select>`]);
    return head("Maintenance requests", "", `${list.filter((r) => r.status !== "resolved").length} open`) +
      table(["#", "Stall", "Vendor", "Issue", "Date", "Status"], rows, undefined, "Search stall, vendor, issue, status…");
  },

  // ===== Vendor directory (everyone) =====
  async directory() {
    const list = await get("/directory");
    const cards = list.map((v) => `<a class="card vcard" data-r href="#profile/${v.vendor_id}">
        ${avatar(v.business_name, v.avatar, "lg")}
        <div><b>${esc(v.business_name)}</b><small class="mut">${esc(v.owner_name)}${v.stalls ? " · Stall " + esc(v.stalls) : ""}</small>
        <span class="chip">🧺 ${v.products} product(s)</span>${v.bio ? `<p>${esc(v.bio.slice(0, 110))}${v.bio.length > 110 ? "…" : ""}</p>` : ""}</div></a>`);
    return head("Market directory", "", "Every active vendor in the market") +
      (list.length ? searchBox("Search vendors, owners or stalls…") : "") +
      (cards.length ? `<div class="vgrid">${cards.join("")}</div>` : `<div class="card">${empty("🏬", "No vendors yet.")}</div>`);
  },

  // ===== Vendor profile (everyone can view; the owner can edit) =====
  async profile(arg) {
    const id = arg ? Number(arg) : session.user.vendor_id;
    if (!id) return `<div class="card">${empty("👤", `Only vendors have a profile. Open one from the <a href="#directory">Directory</a>.`)}</div>`;
    const p = await get("/directory/" + id);
    const own = id === session.user.vendor_id;
    const stalls = p.stall_list.map((s) => `<li>🏪 <b>${esc(s.stall_number)}</b> · ${esc(s.section)}${s.stall_type ? ` · ${esc(s.stall_type)}` : ""}</li>`).join("");
    const products = p.product_list.map((x) => `<div class="ptile"><b>${esc(x.product_name)}</b><small class="mut">${esc(x.category)}</small>
        <span class="price">${peso(x.selling_price)} <small>/ ${esc(x.unit)}</small></span>
        ${x.status === "available" ? `<small class="ok">● ${x.stock_quantity} in stock</small>` : badge(x.status)}</div>`).join("");
    return `<section class="card pf">
        <div class="cover">${p.cover ? `<img src="${esc(p.cover)}" alt="">` : ""}</div>
        <div class="pf-head">${avatar(p.business_name, p.avatar, "xl")}
          <div class="pf-name"><h1>${esc(p.business_name)}</h1>
            <span class="mut">${esc(p.owner_name)} · ${p.stalls ? "Stall " + esc(p.stalls) : "No stall yet"} · ${p.products} product(s)</span></div>
          <div class="acts">${own ? `<button data-act="editProfile">✏️ Edit profile</button>`
            : `<a class="btn alt" href="tel:${esc(p.contact_number)}">📞 Call</a>`}</div>
        </div></section>
      <div class="pf-body">
        <aside>
          <div class="card"><h3>About</h3>
            ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : own ? `<p class="mut">Tell other vendors and customers about your business. Tap “Edit profile”.</p>` : ""}
            <ul class="facts"><li>📞 ${esc(p.contact_number)}</li><li>📍 ${esc(p.address)}</li><li>🗓️ Vendor since ${day(p.registration_date)}</li></ul></div>
          <div class="card"><h3>Stalls</h3>${stalls ? `<ul class="facts">${stalls}</ul>` : `<p class="mut">No stall assigned.</p>`}</div>
        </aside>
        <section class="card"><div class="card-head"><h3>Products</h3>${own ? `<button class="sm" data-act="addMyProduct">＋ Add product</button>` : ""}</div>
          ${products ? `<div class="pgrid">${products}</div>` : empty("🧺", `No products listed yet.${own ? ` <a href="#products">Add one</a>.` : ""}`)}</section>
      </div>`;
  },

  // ===== User accounts (admin) =====
  async users() {
    const list = (cache.users = await get("/users"));
    const rows = list.filter((u) => u.status !== "pending").map((u) => [
      `<span class="who-cell">${avatar(`${u.first_name} ${u.last_name}`, null, "sm2")}<span><b>${esc(u.first_name)} ${esc(u.last_name)}</b><small class="mut">@${esc(u.username)}</small></span></span>`,
      esc(u.email), esc(ROLE_NAMES[u.role]), badge(u.status), u.two_factor ? `<span class="b">🔐 On</span>` : `<span class="mut">Off</span>`, btn("editUser", u.user_id, "Edit")]);
    return pendingList(list) + head("User accounts", `<button data-act="addUser">＋ Add admin / inspector</button>`, "Vendors register themselves or on the Vendors page") +
      table(["Name", "Email", "Role", "Status", "Two-step", ""], rows, undefined, "Search name, username, email, role…");
  },

  // ===== My account (everyone) =====
  async account() {
    const [me, log] = await Promise.all([get("/me"), role() === "admin" ? get("/audit") : null]);
    session.user = me;
    return `<div class="card acct">${avatar(`${me.first_name} ${me.last_name}`, session.avatar, "xl")}
        <div><h2>${esc(me.first_name)} ${esc(me.last_name)}</h2><span class="mut">@${esc(me.username)} · ${esc(ROLE_NAMES[me.role])}</span>
        <span class="mut">✉️ ${esc(me.email)}</span>
        <div class="acts"><button data-act="changePassword">🔒 Change password</button>
        ${me.vendor_id ? `<a class="btn alt" href="#profile">👤 Edit my public profile</a>` : ""}
        <button class="ghost" data-act="logout">Log out</button></div></div></div>
      <div class="card"><h3>🛡️ Security</h3>
        <div class="sec-row"><div><b>Two-step sign-in ${me.two_factor ? `<span class="b">On</span>` : `<span class="b w">Off</span>`}</b>
          <small class="mut">${me.two_factor
            ? `After your password, we email a 6-digit code to ${esc(me.email)}. A stolen password alone cannot open your account.`
            : `Recommended. After your password, we also email you a 6-digit code, so a stolen password alone cannot open your account.`}</small></div>
          ${me.two_factor ? `<button class="ghost" data-act="twoStepOff">Turn off</button>` : `<button data-act="twoStepOn">🔐 Turn on</button>`}</div>
        <div class="sec-row"><div><b>Signed in somewhere else?</b>
          <small class="mut">Think someone knows your password, or lost a phone? Change your password, or sign out on every device.
            After 10 wrong passwords in a row, an account is locked for 15 minutes.</small></div>
          <button class="danger" data-act="logoutEverywhere">Log out of all devices</button></div></div>
      <p class="mut small">Forgot your password some day? Use “Forgot password?” on the sign-in page. A verification code is sent to ${esc(me.email)}.</p>
      ${log ? activityLog(log) : ""}`;
  },
};

// ---------- Buttons ----------
const find = (list, key, id) => (cache[list] || []).find((x) => x[key] === id);
const vendorOptions = () => (cache.vendors || []).filter((v) => v.status === "active" && v.account_status === "active").map((v) => [v.vendor_id, v.business_name]);
const INSPECTION_TYPES = ["Sanitation", "Compliance", "Safety", "Fire safety", "Structural"];
const withCurrent = (list, value) => (value && !list.includes(value) ? [...list, value] : list);

const vendorFields = [
  { name: "business_name", label: "Business name" }, { name: "first_name", label: "Owner first name" },
  { name: "last_name", label: "Owner last name" }, { name: "email", label: "Email", type: "email" },
  { name: "contact_number", label: "Contact number" }, { name: "address", label: "Address" },
];
const stallFields = (isAdmin) => [
  ...(isAdmin ? [{ name: "stall_number", label: "Stall number" }] : []),
  { name: "section", label: "Section" },
  ...(isAdmin ? [{ name: "monthly_rent", label: "Monthly rent (₱)", type: "number", step: "0.01", min: 0 }] : []),
  { name: "status", label: "Condition", type: "select", options: [["in_use", "In use (occupied / vacant is automatic)"], ["maintenance", "Under maintenance"]] },
];
const supplierFields = [
  { name: "supplier_name", label: "Supplier name" }, { name: "contact_number", label: "Contact number" }, { name: "address", label: "Address" },
];
/** New admin / inspector account. fixedRole = "staff" for the dashboard's "Register inspector" (no role choice). */
const accountForm = (fixedRole) => openForm({
  title: fixedRole ? "Register inspector" : "Add admin / inspector account",
  submit: fixedRole ? "Register" : "Create",
  done: fixedRole ? "Inspector registered. They can sign in now." : "Account created",
  fields: [{ name: "first_name", label: "First name" }, { name: "last_name", label: "Last name" },
    { name: "email", label: "Email", type: "email", wide: true, hint: "Used for “Forgot password” and two-step sign-in codes" },
    { name: "username", label: "Username" }, { name: "password", label: "Password", type: "password", minlength: 8, newPassword: true },
    ...(fixedRole ? [] : [{ name: "role", label: "Role", type: "select", options: [["staff", ROLE_NAMES.staff], ["admin", ROLE_NAMES.admin]] }])],
  onSubmit: (d) => { checkPassword(d.password, d.username); return api("POST", "/users", fixedRole ? { ...d, role: fixedRole } : d); },
});
const setStatus = async (id, status, message) => {
  try { await api("PATCH", `/users/${id}/status`, { status }); toast(message); render(); } catch (ex) { toast(ex.message, true); }
};

const actions = {
  logout: () => logout(),

  // Registrations
  approve: (id) => setStatus(id, "active", "Approved. They can now sign in."),
  decline: (id) => confirm("Decline this registration? The account will be disabled.") && setStatus(id, "inactive", "Registration declined"),

  // Vendors
  addVendor: () => openForm({
    title: "Register vendor", submit: "Register", done: "Vendor registered",
    fields: [{ name: "username", label: "Username" }, { name: "password", label: "Password", type: "password", minlength: 8, newPassword: true },
      ...vendorFields],
    onSubmit: (d) => { checkPassword(d.password, d.username); return api("POST", "/vendors", d); },
  }),
  editVendor: (id) => openForm({
    title: "Edit vendor", values: find("vendors", "vendor_id", id),
    fields: [...vendorFields, { name: "status", label: "Status", type: "select", options: opts(["active", "suspended"]) }],
    onSubmit: (d) => api("PATCH", `/vendors/${id}`, d),
  }),

  // Stalls
  addStall: () => openForm({
    title: "Add stall", submit: "Add", done: "Stall added", fields: stallFields(true).slice(0, 3),
    onSubmit: (d) => api("POST", "/stalls", d),
  }),
  editStall: (id) => {
    const s = find("stalls", "stall_id", id);
    openForm({
      title: `Edit stall ${s.stall_number}`, values: { ...s, status: s.status === "maintenance" ? "maintenance" : "in_use" },
      fields: stallFields(role() === "admin"), onSubmit: (d) => api("PATCH", `/stalls/${id}`, d),
    });
  },
  stallVendor: (id) => {
    const s = find("stalls", "stall_id", id);
    openForm({
      title: `Who rents stall ${s.stall_number}?`, values: { vendor_id: s.vendor_id ?? "", start_date: today() },
      fields: [{ name: "vendor_id", label: "Vendor", type: "select", required: false, options: [["", "— Nobody (vacant) —"], ...vendorOptions()] },
        { name: "start_date", label: "Start date", type: "date", hint: "The current vendor's assignment ends today." }],
      onSubmit: (d) => api("PUT", `/stalls/${id}/vendor`, d),
    });
  },

  // Payments
  generate: () => openForm({
    title: "Create monthly bills", submit: "Create bills",
    values: { month: today().slice(0, 7) },
    fields: [{ name: "month", label: "Billing month", type: "month", hint: "One bill per rented stall. Running it twice is safe." }],
    onSubmit: async (d) => {
      const r = await api("POST", "/payments/generate", { month: d.month + "-01" });
      return `${r.created} new bill(s) created`;
    },
  }),
  editBill: (id) => {
    const p = find("payments", "payment_id", id);
    openForm({
      title: `Edit bill · ${p.business_name} · ${month(p.billing_month)}`, done: "Bill updated",
      values: { amount_due: Number(p.amount_due).toFixed(2), amount_paid: Number(p.amount_paid).toFixed(2) },
      fields: [{ name: "amount_due", label: "Amount due (₱)", type: "number", step: "0.01", min: 0, hint: "Any amount, e.g. a discount or an extra charge" },
        { name: "amount_paid", label: "Amount paid so far (₱)", type: "number", step: "0.01", min: 0, hint: "The status (unpaid / partial / paid) updates by itself" }],
      onSubmit: (d) => api("PATCH", `/payments/${id}`, d),
    });
  },
  cash: (id) => {
    const p = find("payments", "payment_id", id);
    const balance = (Number(p.amount_due) - Number(p.amount_paid)).toFixed(2);
    openForm({
      title: `Cash payment · ${p.business_name} · ${month(p.billing_month)}`, submit: "Record payment", done: "Payment recorded",
      values: { amount: balance },
      fields: [{ name: "amount", label: `Amount received (₱) · balance ${peso(balance)}`, type: "number", step: "0.01", min: "0.01",
        hint: "Type any amount. Less than the balance = partial payment." }],
      onSubmit: (d) => api("POST", `/payments/${id}/cash`, d),
    });
  },
  pay: async (id, el) => {
    el.disabled = true;
    el.textContent = "Opening PayMongo…";
    try {
      const { checkoutUrl } = await api("POST", `/my/payments/${id}/checkout`);
      rememberPayment(id);   // checked when the vendor comes back, however they come back
      location.href = checkoutUrl;
    } catch (ex) {
      toast(ex.message, true);
      render();
    }
  },

  // Products (admin)
  addProduct: () => openForm({
    title: "Add product to catalog", submit: "Add", done: "Product added",
    fields: [{ name: "product_name", label: "Product name" }, { name: "category", label: "Category" }, { name: "unit", label: "Unit (kg, bundle, pc…)" }],
    onSubmit: (d) => api("POST", "/products", d),
  }),
  editProduct: (id) => openForm({
    title: "Edit product", values: find("catalog", "product_id", id),
    fields: [{ name: "product_name", label: "Product name" }, { name: "category", label: "Category" }, { name: "unit", label: "Unit" }],
    onSubmit: (d) => api("PATCH", `/products/${id}`, d),
  }),
  addSupplier: () => openForm({
    title: "Add supplier", submit: "Add", done: "Supplier added", fields: supplierFields,
    onSubmit: (d) => api("POST", "/suppliers", d),
  }),
  editSupplier: (id) => openForm({
    title: "Edit supplier", values: find("suppliers", "supplier_id", id),
    fields: [...supplierFields, { name: "status", label: "Status", type: "select", options: opts(["active", "inactive"]) }],
    onSubmit: (d) => api("PATCH", `/suppliers/${id}`, d),
  }),

  // Supplier suggestions (vendor suggests, admin decides)
  suggestSupplier: () => openForm({
    title: "Suggest a supplier", submit: "Send suggestion", done: "Suggestion sent to the market office",
    fields: [
      { name: "supplier_name", label: "Supplier name", wide: true },
      { name: "contact_number", label: "Contact number", required: false, hint: "If you know it" },
      { name: "address", label: "Address", required: false, hint: "If you know it" },
      { name: "supplies", label: "What do they supply?", required: false, wide: true, hint: "e.g. fresh fish, rice, vegetables from Benguet" },
      { name: "reason", label: "Why do you suggest them?", type: "textarea", required: false, wide: true, max: 500 },
    ],
    onSubmit: (d) => api("POST", "/my/suggestions", d),
  }),
  withdrawSuggestion: async (id) => {
    if (!confirm("Withdraw this supplier suggestion?")) return;
    try { await api("DELETE", `/my/suggestions/${id}`); toast("Suggestion withdrawn"); render(); } catch (ex) { toast(ex.message, true); }
  },
  approveSuggestion: (id) => {
    const g = find("suggestions", "suggestion_id", id);
    openForm({
      title: "Add suggested supplier", submit: "Add supplier", done: `${g.supplier_name} added to the suppliers`,
      values: g,
      fields: [...supplierFields, { name: "admin_note", label: "Note to the vendor", required: false, wide: true, hint: "Optional" }],
      extra: `<p class="mut small">Suggested by ${esc(g.business_name)}${g.supplies ? ` · supplies ${esc(g.supplies)}` : ""}. Check or fill in the contact number and address.</p>`,
      onSubmit: (d) => api("PATCH", `/suggestions/${id}`, { ...d, status: "approved" }),
    });
  },
  declineSuggestion: (id) => {
    const g = find("suggestions", "suggestion_id", id);
    openForm({
      title: `Decline “${g.supplier_name}”?`, submit: "Decline", done: "Suggestion declined",
      fields: [{ name: "admin_note", label: "Reason (the vendor sees this)", type: "textarea", required: false, wide: true, max: 500 }],
      onSubmit: (d) => api("PATCH", `/suggestions/${id}`, { ...d, status: "declined" }),
    });
  },

  // Products (vendor)
  addMyProduct: async () => {   // from the Products page or the vendor's own profile
    if (!cache.catalog?.products) cache.catalog = await get("/my/catalog");
    const { products, suppliers } = cache.catalog;
    openForm({
      title: "Add product", submit: "Add", done: "Product added",
      extra: `<datalist id="catalogList">${products.map((p) => `<option value="${esc(p.product_name)}">`).join("")}</datalist>`,
      fields: [
        { name: "product_name", label: "Product", list: "catalogList", hint: "Pick from the list or type a new product" },
        { name: "category", label: "Category", required: false }, { name: "unit", label: "Unit (kg, bundle, pc…)", required: false },
        { name: "selling_price", label: "Price (₱)", type: "number", step: "0.01", min: 0 },
        { name: "stock_quantity", label: "Stock", type: "number", step: 1, min: 0 },
        { name: "supplier_id", label: "Supplier", type: "select", required: false, options: [["", "— None —"], ...suppliers.map((s) => [s.supplier_id, s.supplier_name])],
          hint: "Not in the list? Use “Suggest a supplier” on the Products page." },
      ],
      onInput: (form, e) => {   // known product -> fill in its category and unit
        if (e.target.name !== "product_name") return;
        const match = products.find((p) => p.product_name.toLowerCase() === e.target.value.trim().toLowerCase());
        if (match) { form.category.value = match.category; form.unit.value = match.unit; }
      },
      onSubmit: (d) => api("POST", "/my/products", d),
    });
  },
  editMyProduct: (id) => {
    const p = find("myProducts", "vendor_product_id", id);
    openForm({
      title: `Edit ${p.product_name}`, values: { ...p, supplier_id: p.supplier_id ?? "" },
      fields: [
        { name: "selling_price", label: `Price (₱ per ${p.unit})`, type: "number", step: "0.01", min: 0 },
        { name: "stock_quantity", label: "Stock", type: "number", step: 1, min: 0 },
        { name: "supplier_id", label: "Supplier", type: "select", required: false,
          options: [["", "— None —"], ...cache.catalog.suppliers.map((s) => [s.supplier_id, s.supplier_name])] },
      ],
      onSubmit: (d) => api("PATCH", `/my/products/${id}`, d),
    });
  },
  removeMyProduct: async (id) => {
    const p = find("myProducts", "vendor_product_id", id);
    if (!confirm(`Remove ${p.product_name} from your products?`)) return;
    try { await api("DELETE", `/my/products/${id}`); toast("Product removed"); render(); } catch (ex) { toast(ex.message, true); }
  },

  // Inspections
  addInspection: async () => {
    if (!cache.stalls) cache.stalls = await get("/stalls");
    openForm({
      title: "Record inspection", submit: "Save", done: "Inspection recorded",
      fields: [
        { name: "stall_id", label: "Stall", type: "select", options: cache.stalls.map((s) => [s.stall_id, s.stall_number]) },
        { name: "inspection_type", label: "Type", type: "select", options: INSPECTION_TYPES.map((t) => [t, t]) },
        { name: "result", label: "Result", type: "select", options: opts(["passed", "failed"]) },
        { name: "remarks", label: "Remarks", type: "textarea", required: false, wide: true },
      ],
      onSubmit: (d) => api("POST", "/inspections", d),
    });
  },
  editInspection: (id) => {
    const i = find("inspections", "inspection_id", id);
    openForm({
      title: `Edit inspection · stall ${i.stall_number}`, values: i,
      fields: [
        { name: "inspection_type", label: "Type", type: "select", options: withCurrent(INSPECTION_TYPES, i.inspection_type).map((t) => [t, t]) },
        { name: "result", label: "Result", type: "select", options: opts(["passed", "failed"]) },
        { name: "remarks", label: "Remarks", type: "textarea", required: false, wide: true },
      ],
      onSubmit: (d) => api("PATCH", `/inspections/${id}`, d),
    });
  },

  // Maintenance (vendor)
  addRequest: (id) => openForm({   // id = stall picked on the My stalls page (none from the Maintenance page)
    title: "Report a problem", submit: "Send", done: "Request sent", values: id ? { stall_id: id } : {},
    fields: [{ name: "stall_id", label: "Stall", type: "select", options: cache.myStalls.map((s) => [s.stall_id, s.stall_number]) },
      { name: "issue", label: "What is the problem?", type: "textarea", wide: true }],
    onSubmit: (d) => api("POST", "/my/requests", d),
  }),
  editRequest: (id) => openForm({
    title: `Edit request #${id}`, values: find("requests", "request_id", id),
    fields: [{ name: "issue", label: "What is the problem?", type: "textarea", wide: true }],
    onSubmit: (d) => api("PATCH", `/my/requests/${id}`, d),
  }),

  // Profile (vendor)
  editProfile: async () => {
    const me = await get("/my/profile");
    openForm({
      title: "Edit profile", values: me,
      fields: [
        { name: "avatar", label: "Profile picture", type: "image", required: false, round: true, w: 320, h: 320, max: 190000 },
        { name: "cover", label: "Cover photo", type: "image", required: false, w: 1200, h: 400, max: 380000 },
        { name: "business_name", label: "Business name" }, { name: "contact_number", label: "Contact number" },
        { name: "address", label: "Address", wide: true },
        { name: "bio", label: "About your business", type: "textarea", required: false, wide: true, max: 1000 },
      ],
      onSubmit: async (d) => { await api("PUT", "/my/profile", d); session.avatar = d.avatar; showWho(); },
    });
  },

  // Accounts (admin)
  addUser: () => accountForm(),
  addInspector: () => accountForm("staff"),   // dashboard shortcut: no need to wait for a self-registration
  editUser: (id) => {
    const u = find("users", "user_id", id);
    openForm({
      title: `Edit account @${u.username}`, values: u,
      fields: [{ name: "first_name", label: "First name" }, { name: "last_name", label: "Last name" }, { name: "email", label: "Email", type: "email" },
        { name: "status", label: "Status", type: "select", options: opts(["active", "inactive", "pending"]), hint: "Only active accounts can sign in." },
        { name: "password", label: "New password", type: "password", minlength: 8, required: false, newPassword: true, pwUser: u.username, hint: "Leave empty to keep it. A new password signs them out everywhere." },
        // Shown only when they use two-step sign-in: the way back in for someone who lost access to their email
        ...(u.two_factor ? [{ name: "two_factor", label: "Two-step sign-in", type: "select", options: [["keep", "On (keep it)"], ["off", "Turn off: they lost access to their email"]] }] : [])],
      onSubmit: (d) => {
        if (d.password) checkPassword(d.password, u.username);
        return api("PATCH", `/users/${id}`, d);
      },
    });
  },

  // My account
  changePassword: () => openForm({
    title: "Change password", submit: "Change password", done: "Password changed",
    fields: [{ name: "current_password", label: "Current password", type: "password" },
      { name: "new_password", label: "New password", type: "password", minlength: 8, newPassword: true },
      { name: "confirm", label: "Type the new password again", type: "password" }],
    onSubmit: async (d) => {
      if (d.new_password !== d.confirm) throw new Error("The new passwords do not match.");
      checkPassword(d.new_password, session.user.username);
      await api("PATCH", "/me/password", d);   // other devices are signed out; the server gives this one a new cookie
      return "Password changed. Your other devices were signed out.";
    },
  }),
  // Two-step sign-in: turning it on needs a code from the email, so nobody locks themselves out with a wrong address.
  twoStepOn: async (id, el) => {
    el.disabled = true;
    try {
      const { challenge, email } = await api("POST", "/me/two-step/start");
      openForm({
        title: "Turn on two-step sign-in", submit: "Turn on", done: "Two-step sign-in is on. Next time, you also need the emailed code.",
        extra: `<p class="mut small">We sent a 6-digit code to ${esc(email)}. Not there? Check spam. If the email is wrong, ask the market office to fix it first.</p>`,
        fields: [{ name: "code", label: "Code from the email", wide: true, hint: "6 numbers, works for 10 minutes" }],
        onSubmit: (d) => api("POST", "/me/two-step/enable", { challenge, code: d.code }),
      });
    } catch (ex) { toast(ex.message, true); } finally { el.disabled = false; }
  },
  twoStepOff: () => openForm({
    title: "Turn off two-step sign-in", submit: "Turn off", done: "Two-step sign-in is off",
    extra: `<p class="mut small">Your account will be protected by your password only.</p>`,
    fields: [{ name: "password", label: "Your password", type: "password", wide: true }],
    onSubmit: (d) => api("POST", "/me/two-step/disable", d),
  }),
  logoutEverywhere: async () => {
    if (!confirm("Sign out on every phone and computer, including this one?")) return;
    try { await api("POST", "/me/logout-everywhere"); logout("You were signed out on all devices."); } catch (ex) { toast(ex.message, true); }
  },
};

// Inline status dropdowns
const changes = {
  requestStatus: async (id, el) => {
    try { await api("PATCH", `/maintenance/${id}/status`, { status: el.value }); toast("Status updated"); } catch (ex) { toast(ex.message, true); render(); }
  },
};

// ---------- Rendering ----------
let renderCount = 0;
let shownRoute = "";
async function render() {
  const [hashPage, arg] = location.hash.slice(1).split("/");
  const page = canOpen(hashPage) ? hashPage : homePage();
  const menuPage = page === "profile" && arg && Number(arg) !== session.user.vendor_id ? "directory" : page;
  $("nav").innerHTML = Object.keys(PAGES).filter((p) => PAGES[p].roles.includes(role())).map((p) =>
    `<a href="#${p}" class="${p === menuPage ? "on" : ""}"><span>${PAGES[p].icon}</span>${PAGES[p].label}</a>`).join("");
  $("pageTitle").textContent = page === "profile" && arg ? "Vendor profile" : PAGES[page].label;
  document.title = `${$("pageTitle").textContent} · PalengkeLink`;
  const main = $("main");
  const mine = ++renderCount;
  let term = "";   // a refresh of the same page (e.g. after saving a form) keeps what was typed in the search box
  if (shownRoute !== page + arg) {   // a new page: show a skeleton; a refresh of the same page keeps it on screen
    main.innerHTML = `<div class="skeleton"><i></i><i></i><i></i></div>`;
    shownRoute = page + arg;
    scrollTo(0, 0);
  } else term = main.querySelector(".q")?.value || "";
  try {
    const html = await views[page](arg);
    if (mine !== renderCount) return;
    main.innerHTML = `<div class="page">${html}</div>`;
    const q = main.querySelector(".q");
    if (q && term) { q.value = term; applySearch(q); }
  } catch (ex) {
    if (mine === renderCount && session.user) main.innerHTML = `<div class="card err">⚠️ ${esc(ex.message)}</div>`;
  }
}

function showWho() {
  const u = session.user;
  const name = `${u.first_name} ${u.last_name}`;
  $("whoAv").innerHTML = avatar(name, session.avatar, "sm");
  $("topAv").innerHTML = avatar(name, session.avatar, "sm");
  $("whoName").textContent = name;
  $("whoRole").textContent = ROLE_NAMES[u.role];
  $("today").textContent = new Date().toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function start() {
  $("auth").hidden = true;
  $("app").hidden = false;
  showWho();
  if (role() === "vendor") get("/my/profile").then((p) => { session.avatar = p.avatar; showWho(); }).catch(() => {});
  // Back from PayMongo through its own success / cancel link (?paid=1&pid=… or ?paid=0)
  const params = new URLSearchParams(location.search);
  const paid = params.get("paid");
  if (paid !== null) {
    history.replaceState(null, "", location.pathname + location.hash);
    if (paid !== "1") { store.set(PENDING_PAY, null); toast("Payment cancelled.", true); return render(); }
    const pid = Number(params.get("pid"));
    if (pid) rememberPayment(pid);
  }
  render();
  checkPendingPayment();   // also covers Back button, closed tab, paying in the GCash app
}

// ---------- Coming back from another site (PayMongo) or another tab / app ----------
// "Pay" remembers which bill went to PayMongo. Whenever the person comes back by ANY road (PayMongo's link, the
// Back button, switching tabs or apps), the bill is checked with PayMongo, a few times if PayMongo is still busy,
// and the page reloads its data.
const PENDING_PAY = "pl_pending_payment";   // "<bill id>:<time Pay was clicked>"
const PAY_WINDOW = 30 * 60 * 1000;            // a PayMongo checkout page lasts about this long
let checkingPayment = false, payCheckedOnce = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rememberPayment = (id) => { store.set(PENDING_PAY, `${id}:${Date.now()}`); payCheckedOnce = false; };

/** The bill waiting for PayMongo, or 0 (forgotten after PAY_WINDOW, so a cancelled payment stops being checked). */
function pendingPayment() {
  const [id, at] = String(store.get(PENDING_PAY) || "").split(":").map(Number);
  if (id && Date.now() - at < PAY_WINDOW) return id;
  store.set(PENDING_PAY, null);
  return 0;
}

async function checkPendingPayment() {
  const pid = pendingPayment();
  if (!pid || role() !== "vendor" || checkingPayment) return;
  checkingPayment = true;
  // First return: try for about 15 seconds while PayMongo finishes. Later returns: one quiet check.
  const tries = payCheckedOnce ? 1 : 6;
  if (!payCheckedOnce) toast("Checking your payment with PayMongo…");
  try {
    for (let attempt = 1; attempt <= tries; attempt++) {
      const r = await api("POST", `/my/payments/${pid}/confirm`).catch((ex) => ({ error: ex.message }));
      if (r.paid) { store.set(PENDING_PAY, null); toast("Payment received. Salamat!"); return; }
      if (r.error) { store.set(PENDING_PAY, null); if (!payCheckedOnce) toast(r.error, true); return; }   // e.g. no online payment was started
      if (attempt < tries) await wait(3000);
    }
    // Not paid (yet): maybe PayMongo is slow, or the vendor closed it without paying. The next return checks again.
    if (!payCheckedOnce) toast("No payment received yet. If you paid, it will show here in a minute.", true);
  } finally {
    payCheckedOnce = true;
    checkingPayment = false;
    render();
  }
}

/** Returning to the page: re-check a payment in progress, else reload the shown data (if away 5+ seconds). */
let hiddenAt = 0;
function onReturn(force) {
  if (!session.user || $("dlg").open) return;   // never wipe a form someone is typing in
  if (role() === "vendor" && pendingPayment()) return checkPendingPayment();
  if (force || Date.now() - hiddenAt >= 5000) render();
}
// Back button from PayMongo: the browser may show a saved copy of the page (bfcache), so refresh it
window.addEventListener("pageshow", (e) => e.persisted && onReturn(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hiddenAt = Date.now();
  else onReturn(false);
});

function logout(message) {
  if (session.user) api("POST", "/auth/logout").catch(() => {});   // the server removes the login cookie
  store.set(PENDING_PAY, null);   // the next person on this browser must not inherit a payment check
  session.user = session.avatar = null;
  $("app").hidden = true;
  $("main").innerHTML = "";
  shownRoute = "";
  if ($("dlg").open) $("dlg").close();
  showAuth("login", message);
}

// ---------- Sign in / Register / Forgot / Reset ----------
let resetToken = null;
function showAuth(panel, message) {
  $("auth").hidden = false;
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== panel; });
  document.querySelectorAll("#authTabs button").forEach((b) => b.classList.toggle("on", b.dataset.auth === panel));
  $("authTabs").hidden = !["login", "register"].includes(panel);
  const err = document.querySelector(`[data-panel="${panel}"] .err`);
  if (err) { err.textContent = message || ""; err.hidden = !message; }
  document.querySelector(`[data-panel="${panel}"] input`)?.focus();
}
function showDone(title, text) {
  $("doneTitle").textContent = title;
  $("doneText").textContent = text;
  showAuth("done");
}

/** Wire an auth form: send() does the work; errors show inside the form. */
function authForm(id, send) {
  const form = $(id);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector(".err");
    const button = form.querySelector("button.big");
    const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    err.hidden = true;
    try {
      await send(data, form);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { button.disabled = false; }
  };
}

let loginChallenge = null;   // two-step sign-in: id of the code that was emailed
authForm("loginForm", async (d, form) => {
  const r = await api("POST", "/auth/login", { username: d.username.trim(), password: d.password });
  form.reset();
  if (r.twoStep) {   // password was right; now the code from the email
    loginChallenge = r.challenge;
    $("loginCodeText").textContent = `We sent a 6-digit code to ${r.email}. It works for 10 minutes.`;
    return showAuth("loginCode");
  }
  session.user = r.user;
  start();
});
authForm("loginCodeForm", async (d, form) => {
  const { user } = await api("POST", "/auth/login/code", { challenge: loginChallenge, code: d.code.trim() });
  form.reset();
  loginChallenge = null;
  session.user = user;
  start();
});
// Register as vendor or inspector: inspectors have no business, so those fields are hidden and disabled (not required, not sent).
function syncRegisterRole() {
  const isVendor = $("registerForm").role.value !== "staff";
  $("vendorOnly").disabled = !isVendor;
  $("vendorOnly").hidden = !isVendor;
}
$("registerForm").addEventListener("change", (e) => e.target.name === "role" && syncRegisterRole());
authForm("registerForm", async (d, form) => {
  checkPassword(d.password, d.username);
  if (d.password !== d.confirm) throw new Error("The passwords do not match.");
  await api("POST", "/auth/register", d);
  form.reset();
  syncRegisterRole();
  showDone("Registration sent!", "Salamat! The market office will review your registration. You can sign in as soon as it is approved.");
});
let resetEmail = null;   // the email the verification code was sent to
authForm("forgotForm", async (d, form) => {
  resetEmail = d.email.trim();
  await api("POST", "/auth/forgot", { email: resetEmail });
  form.reset();
  $("codeText").textContent = `We sent a 6-digit code (and a reset link) to ${resetEmail}. It works for 30 minutes.`;
  showAuth("code");
});
authForm("codeForm", async (d, form) => {
  checkPassword(d.new_password);
  if (d.new_password !== d.confirm) throw new Error("The passwords do not match.");
  await api("POST", "/auth/reset", { email: resetEmail, code: d.code.trim(), new_password: d.new_password });
  form.reset();
  resetEmail = null;
  showDone("Password changed", "You can now sign in with your new password.");
});
authForm("resetForm", async (d, form) => {
  checkPassword(d.new_password);
  if (d.new_password !== d.confirm) throw new Error("The passwords do not match.");
  await api("POST", "/auth/reset", { token: resetToken, new_password: d.new_password });
  form.reset();
  resetToken = null;
  history.replaceState(null, "", location.pathname);
  showDone("Password changed", "You can now sign in with your new password.");
});

// ---------- Events ----------
document.body.addEventListener("click", (e) => {
  const auth = e.target.closest("[data-auth]");
  if (auth) { e.preventDefault(); return showAuth(auth.dataset.auth); }
  const eye = e.target.closest("[data-eye]");
  if (eye) {
    const input = eye.previousElementSibling;
    input.type = input.type === "password" ? "text" : "password";
    return;
  }
  const el = e.target.closest("[data-act]");
  if (el && actions[el.dataset.act]) actions[el.dataset.act](Number(el.dataset.id), el);
});
$("main").addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (el) changes[el.dataset.change](Number(el.dataset.id), el);
});
/** A row's searchable text. A dropdown counts only with its chosen option, not every option in it. */
function rowText(row) {
  let text = row.textContent;
  row.querySelectorAll("select").forEach((s) => { text = text.replace(s.textContent, " " + (s.selectedOptions[0]?.text || "") + " "); });
  return text.toLowerCase();
}
/** Show only the rows that contain every typed word (in any order). */
function applySearch(input) {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  $("main").querySelectorAll("[data-r]").forEach((row) => {
    const text = rowText(row);
    row.hidden = !words.every((w) => text.includes(w));
    if (!row.hidden) shown++;
  });
  $("main").querySelectorAll(".nomatch").forEach((p) => { p.hidden = shown > 0; });
}
$("main").addEventListener("input", (e) => e.target.classList.contains("q") && applySearch(e.target));
window.addEventListener("hashchange", () => session.user && render());

// ---------- Start ----------
(async () => {
  if (location.hash.startsWith("#reset/")) {   // link from the "forgot password" email
    resetToken = location.hash.slice("#reset/".length);
    return showAuth("reset");
  }
  try {   // still signed in? (the cookie is sent by itself; without one, /me answers 401)
    session.user = await get("/me");
    start();
  } catch { showAuth("login"); }
})();

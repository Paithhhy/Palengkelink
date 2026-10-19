/* PalengkeLink – UI logic. Reads sample data from data.js (replace with API calls later). */

// ---------- Config ----------
const ME = 1; // vendor id used when the "Vendor" role is selected
const NAV = {
  admin:  ["dashboard", "vendors", "stalls", "payments", "products", "inspections", "maintenance"],
  staff:  ["dashboard", "stalls", "inspections", "maintenance"],
  vendor: ["dashboard", "payments", "products", "maintenance"],
};
const ICONS = { dashboard: "📊", vendors: "🧑‍🌾", stalls: "🏪", payments: "💳", products: "🧺", inspections: "📋", maintenance: "🔧" };
const BAD_STATUS  = ["Unpaid", "Failed", "Suspended", "Inactive"];
const WARN_STATUS = ["Open", "In Progress", "Vacant", "Maintenance"];
const state = { role: "admin", view: "dashboard" };

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const peso = (n) => "₱" + Number(n).toLocaleString();
const nextId = (list) => list.length + 1;
const vendorName = (id) => (DB.vendors.find((v) => v.id == id) || {}).business || "—";
const supplierName = (id) => (DB.suppliers.find((s) => s.id == id) || {}).name || "—";
const supplierIdByName = (name) => (DB.suppliers.find((s) => s.name === name) || {}).id;
const sum = (rows, key) => rows.reduce((total, r) => total + r[key], 0);

function badge(text) {
  const cls = BAD_STATUS.includes(text) ? "x" : WARN_STATUS.includes(text) ? "w" : "";
  return `<span class="b ${cls}">${esc(text)}</span>`;
}

function stat(value, label) {
  return `<div class="card stat"><b>${value}</b><span>${label}</span></div>`;
}

/** Table that turns into cards on phones (td[data-l] holds the column name). */
function table(headers, rows) {
  const search = rows.length > 4 ? `<input class="q" type="search" placeholder="🔍 Search records…">` : "";
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows.length
    ? rows.map((cells) => `<tr data-r>${cells.map((c, i) => `<td data-l="${headers[i]}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td>No records yet.</td></tr>`;
  return `${search}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Collapsible form. field = { name, label, type?, options? } (options => dropdown). */
function formCard(action, title, fields) {
  const inputs = fields.map((f) => {
    const control = f.options
      ? `<select name="${f.name}">${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
      : `<input name="${f.name}" type="${f.type || "text"}" required>`;
    return `<label>${f.label}${control}</label>`;
  }).join("");
  return `<details class="card fm"><summary>＋ ${title}</summary>
    <form data-action="${action}" data-msg="${title}">${inputs}<button>${title}</button></form></details>`;
}

// ---------- Pages ----------
const views = {
  dashboard() {
    if (state.role === "vendor") {
      const myStalls = DB.stalls.filter((s) => s.vendor === ME);
      const due = sum(DB.payments.filter((p) => p.vendor === ME && p.status === "Unpaid"), "amount");
      return `<h2>Welcome, ${esc(vendorName(ME))}</h2>
        <div class="grid">
          ${stat(myStalls.map((s) => s.no).join(", "), "My assigned stalls")}
          ${stat(peso(due), "Unpaid balance")}
          ${stat(DB.products.filter((p) => p.vendor === ME).length, "Products listed")}
          ${stat(DB.maintenance.filter((m) => m.vendor === ME && m.status !== "Resolved").length, "Open maintenance requests")}
        </div>
        <div class="qa"><button data-view="payments">💳 My payments</button><button data-view="maintenance">🔧 Report a problem</button></div>`;
    }
    const isAdmin = state.role === "admin";
    const occupied = DB.stalls.filter((s) => s.status === "Occupied").length;
    const vacant = DB.stalls.filter((s) => s.status === "Vacant").length;
    const passed = DB.inspections.filter((i) => i.result === "Passed").length;
    const unpaid = sum(DB.payments.filter((p) => p.status === "Unpaid"), "amount");
    return `<h2>Dashboard</h2>
      <div class="grid">
        ${isAdmin ? stat(DB.vendors.length, "Registered vendors") : ""}
        ${stat(occupied, "Occupied stalls")}
        ${stat(vacant, "Vacant stalls")}
        ${isAdmin ? stat(peso(unpaid), "Unpaid rent") : ""}
        ${stat(Math.round((passed / DB.inspections.length) * 100) + "%", "Inspections passed")}
      </div>
      <div class="card"><b>Stall occupancy</b>
        <div class="bar"><i style="width:${(occupied / DB.stalls.length) * 100}%"></i></div>
        <small style="color:var(--mut)">${occupied} of ${DB.stalls.length} stalls occupied</small></div>`;
  },

  vendors() {
    const rows = DB.vendors.map((v) => [v.id, esc(v.business), esc(v.owner), esc(v.contact), badge(v.status)]);
    return `<h2>Vendor Management</h2>
      ${formCard("addVendor", "Register vendor", [
        { name: "business", label: "Business name" }, { name: "owner", label: "Owner" }, { name: "contact", label: "Contact" }])}
      ${table(["ID", "Business", "Owner", "Contact", "Status"], rows)}`;
  },

  stalls() {
    const vacant = DB.stalls.filter((s) => s.status === "Vacant").map((s) => s.no);
    const rows = DB.stalls.map((s) => [s.no, s.type, peso(s.rent), badge(s.status), s.vendor ? esc(vendorName(s.vendor)) : "—"]);
    const assignForm = state.role === "admin" && vacant.length
      ? formCard("assignStall", "Assign stall", [
          { name: "stall", label: "Vacant stall", options: vacant },
          { name: "vendor", label: "Vendor", options: DB.vendors.map((v) => v.business) }])
      : "";
    return `<h2>Stall Management</h2>${assignForm}${table(["Stall", "Type", "Monthly rent", "Status", "Vendor"], rows)}`;
  },

  payments() {
    const isVendor = state.role === "vendor";
    const list = DB.payments.filter((p) => !isVendor || p.vendor === ME);
    const unpaid = DB.payments.filter((p) => p.status === "Unpaid");
    const payForm = state.role === "admin" && unpaid.length
      ? formCard("recordPayment", "Record payment", [
          { name: "payment", label: "Unpaid record", options: unpaid.map((p) => `${p.id} · ${p.stall} · ${p.month}`) },
          { name: "method", label: "Method", options: ["Cash", "GCash", "Bank"] }])
      : "";
    const rows = list.map((p) => [p.id, esc(vendorName(p.vendor)), p.stall, p.month, peso(p.amount), badge(p.status)]);
    return `<h2>${isVendor ? "My Payment History" : "Rental Payments"}</h2>${payForm}
      ${table(["#", "Vendor", "Stall", "Month", "Amount", "Status"], rows)}`;
  },

  /** Products + Suppliers: each product row (VENDOR_PRODUCTS) shows who supplies it. */
  products() {
    const isVendor = state.role === "vendor";
    const isAdmin = state.role === "admin";
    const supplierNames = DB.suppliers.filter((s) => s.status === "Active").map((s) => s.name);

    const productForm = isVendor
      ? formCard("addProduct", "Add product", [
          { name: "name", label: "Product" }, { name: "category", label: "Category" },
          { name: "price", label: "Price (₱)", type: "number" }, { name: "stock", label: "Stock", type: "number" },
          { name: "supplier", label: "Supplier", options: supplierNames }])
      : "";
    const productRows = DB.products
      .filter((p) => !isVendor || p.vendor === ME)
      .map((p) => [esc(vendorName(p.vendor)), esc(p.name), esc(p.category), peso(p.price), p.stock, esc(supplierName(p.supplier))]);

    let html = `<h2>${isVendor ? "My Products" : "Products &amp; Supply"}</h2>${productForm}
      ${table(["Vendor", "Product", "Category", "Price", "Stock", "Supplier"], productRows)}`;

    if (isAdmin) {
      const supplierRows = DB.suppliers.map((s) => [
        s.id, esc(s.name), esc(s.contact), esc(s.address),
        DB.products.filter((p) => p.supplier === s.id).length, badge(s.status)]);
      html += `<h2 style="margin-top:26px">Suppliers</h2>
        ${formCard("addSupplier", "Add supplier", [
          { name: "name", label: "Supplier name" }, { name: "contact", label: "Contact" }, { name: "address", label: "Address" }])}
        ${table(["ID", "Supplier", "Contact", "Address", "Products", "Status"], supplierRows)}`;
    }
    return html;
  },

  inspections() {
    const rows = DB.inspections.map((i) => [i.id, i.stall, i.date, i.type, badge(i.result), esc(i.inspector)]);
    return `<h2>Inspection Records</h2>
      ${formCard("addInspection", "Record inspection", [
        { name: "stall", label: "Stall", options: DB.stalls.map((s) => s.no) },
        { name: "type", label: "Type", options: ["Sanitation", "Compliance", "Safety"] },
        { name: "result", label: "Result", options: ["Passed", "Failed"] }])}
      ${table(["#", "Stall", "Date", "Type", "Result", "Inspector"], rows)}`;
  },

  maintenance() {
    const isVendor = state.role === "vendor";
    const myStalls = DB.stalls.filter((s) => s.vendor === ME).map((s) => s.no);
    const rows = DB.maintenance
      .filter((m) => !isVendor || m.vendor === ME)
      .map((m) => [m.id, m.stall, esc(vendorName(m.vendor)), esc(m.issue), badge(m.status)]);
    const requestForm = isVendor
      ? formCard("addRequest", "Submit request", [{ name: "stall", label: "Stall", options: myStalls }, { name: "issue", label: "Issue" }])
      : "";
    return `<h2>Maintenance Requests</h2>${requestForm}${table(["#", "Stall", "Vendor", "Issue", "Status"], rows)}`;
  },
};

// ---------- Form actions (each becomes an API call + stored procedure later) ----------
const actions = {
  addVendor:  (d) => DB.vendors.push({ id: nextId(DB.vendors), business: d.business, owner: d.owner, contact: d.contact, status: "Active" }),
  assignStall: (d) => {
    const stall = DB.stalls.find((s) => s.no === d.stall);
    stall.status = "Occupied";
    stall.vendor = DB.vendors.find((v) => v.business === d.vendor).id;
  },
  recordPayment: (d) => { DB.payments.find((p) => p.id === parseInt(d.payment)).status = "Paid"; },
  addProduct: (d) => DB.products.push({ vendor: ME, name: d.name, category: d.category, price: +d.price, stock: +d.stock, supplier: supplierIdByName(d.supplier) }),
  addSupplier: (d) => DB.suppliers.push({ id: nextId(DB.suppliers), name: d.name, contact: d.contact, address: d.address, status: "Active" }),
  addInspection: (d) => DB.inspections.push({ id: nextId(DB.inspections), stall: d.stall, date: new Date().toISOString().slice(0, 10), type: d.type, result: d.result, inspector: "Insp. Ramos" }),
  addRequest: (d) => DB.maintenance.push({ id: nextId(DB.maintenance), stall: d.stall, vendor: ME, issue: d.issue, status: "Open" }),
};

// ---------- Rendering & events ----------
function showToast(message) {
  const toast = $("t");
  toast.textContent = "✓ " + message;
  toast.classList.add("on");
  setTimeout(() => toast.classList.remove("on"), 2200);
}

function render() {
  if (!NAV[state.role].includes(state.view)) state.view = "dashboard";
  $("nav").innerHTML = NAV[state.role].map((v) =>
    `<button class="${v === state.view ? "on" : ""}" data-view="${v}"><span>${ICONS[v]}</span>${v[0].toUpperCase() + v.slice(1)}</button>`).join("");
  $("main").innerHTML = views[state.view]();
  scrollTo(0, 0);
}

$("role").onchange = (e) => { state.role = e.target.value; render(); };
document.body.onclick = (e) => {
  const target = e.target.closest("[data-view]");
  if (target) { state.view = target.dataset.view; render(); }
};
$("main").oninput = (e) => {
  if (!e.target.classList.contains("q")) return;
  const term = e.target.value.toLowerCase();
  document.querySelectorAll("tr[data-r]").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
  });
};
$("main").onsubmit = (e) => {
  e.preventDefault();
  const form = e.target;
  actions[form.dataset.action](Object.fromEntries(new FormData(form)));
  render();
  showToast(form.dataset.msg + " saved");
};

render();

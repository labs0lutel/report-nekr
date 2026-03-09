/* eslint-disable no-alert */
const STORAGE_KEY = "reports.v1";
const API_BASE = (() => {
  const raw = typeof window !== "undefined" && window.REPORTS_API_URL ? String(window.REPORTS_API_URL).trim() : "";
  if (!raw) return "";
  const url = raw.replace(/\/$/, "");
  return /^https?:\/\//i.test(url) ? url : "http://" + url;
})();

const ADMIN_FIXED = 3500;
const PROFIT_RATE = 0.55; // прибыль = 55% от выручки (вычли 45%)
const MASTER_PAYOUT_RATE = 0.45; // мастеру = 45% (вычли 55%)
const DEFAULT_MASTER_MIN = 4000;

function $(id) {
  return document.getElementById(id);
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function safeParseJSON(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function loadReports() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const data = safeParseJSON(raw, []);
  return Array.isArray(data) ? data : [];
}

function saveReports(reports) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

async function loadReportsFromServer() {
  if (!API_BASE) return loadReports();
  try {
    const res = await fetch(API_BASE + "/api/reports", { method: "GET" });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("API load failed:", e);
    return loadReports();
  }
}

async function saveReportToServer(rep) {
  if (!API_BASE) return null;
  try {
    const url = API_BASE + "/api/reports" + (rep.id ? "/" + encodeURIComponent(rep.id) : "");
    const method = rep.id ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rep),
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.warn("API save failed:", e);
    return null;
  }
}

function normalizeNumberInput(raw) {
  if (raw == null) return 0;
  const s = String(raw)
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
    Math.round(v),
  );
}

function fmtRub(n) {
  return `${money(n)} ₽`;
}

function moneyDot(n) {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(v));
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function toDMY(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function sumByPay(items, pay) {
  return items
    .filter((x) => x.enabled !== false)
    .filter((x) => x.pay === pay)
    .reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
}

function sumAll(items) {
  return items
    .filter((x) => x.enabled !== false)
    .reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
}

function computeAdminPay(revenue) {
  const r = Number.isFinite(revenue) ? revenue : 0;
  if (r > 100000) return 4000;
  if (r >= 60000) return 3800;
  return 3500;
}

function computeMaster(earned, minPayout) {
  const e = Number.isFinite(earned) ? earned : 0;
  const payout = e * MASTER_PAYOUT_RATE;
  const min = Number.isFinite(minPayout) ? minPayout : DEFAULT_MASTER_MIN;
  const dop = Math.max(0, min - payout);
  return {
    payout,
    dop,
    payoutWithDop: payout + dop,
    min,
  };
}

function computeAll(state) {
  const revenue = normalizeNumberInput(state.revenue);
  const adminPay = computeAdminPay(revenue);
  const cashless = normalizeNumberInput(state.cashless);
  const cashCalcMode = state.cashCalcMode || "cashflow";

  const sales = state.sales ?? [];
  const expenses = state.expenses ?? [];

  const salesTotal = sumAll(sales);
  const salesCashless = sumByPay(sales, "cashless");
  const salesCash = sumByPay(sales, "cash");

  const expensesTotal = sumAll(expenses);
  const expensesCashless = sumByPay(expenses, "cashless");
  const expensesCash = sumByPay(expenses, "cash");

  const profit = revenue * PROFIT_RATE;

  // Быстрый подсчет "нал сегодня"
  // правило: если продажи за безнал — вычитаем их из безнала перед расчетом
  const cashlessAdjustedForCashCalc = cashless - salesCashless;
  const cashTodayGross = revenue - cashlessAdjustedForCashCalc;
  // Списываем ЗП админа из сегодняшнего нала (зависит от выручки)
  const cashTodayNet = cashTodayGross - adminPay;

  const masters = (state.masters ?? []).map((m) => {
    const enabled = m.enabled !== false;
    const earned = enabled ? normalizeNumberInput(m.earned) : 0;
    // Индивидуальные минималки: Абдулло 4500, Иса всегда 4000
    let minPayoutRaw = normalizeNumberInput(m.minPayout);
    if (m.name === "Абдулло") {
      minPayoutRaw = 4500;
    } else if (m.name === "Иса") {
      minPayoutRaw = DEFAULT_MASTER_MIN;
    }
    const c = computeMaster(earned, minPayoutRaw);
    return {
      ...m,
      enabled,
      earned,
      payout: c.payout,
      dop: c.dop,
      payoutWithDop: c.payoutWithDop,
      minPayout: c.min,
    };
  });
  const mastersPayoutTotal = masters
    .filter((m) => m.enabled)
    .reduce((acc, m) => acc + m.payoutWithDop, 0);
  const mastersDopTotal = masters
    .filter((m) => m.enabled)
    .reduce((acc, m) => acc + m.dop, 0);

  const monthSalesPrev = normalizeNumberInput(state.monthSalesPrev);
  const monthExpensesPrev = normalizeNumberInput(state.monthExpensesPrev);
  const monthSalesNew = monthSalesPrev + salesTotal;
  const monthExpensesNew = monthExpensesPrev + expensesTotal;

  const cashlessPrev = normalizeNumberInput(state.cashlessPrev);
  const cashPrev = normalizeNumberInput(state.cashPrev);
  // Безнал: вчерашний безнал + безнал сегодня − траты по безналу
  const cashlessNew = cashlessPrev + cashless - expensesCashless;

  // Нал (новое): два режима, потому что в примерах встречается отличающаяся логика
  // cashflow: касса = вчера + нал сегодня − траты_нал
  // rule11: если есть траты сегодня — вычесть их из вчерашнего нала, иначе прибавить нал сегодня
  const cashNew =
    cashCalcMode === "rule11"
      ? expensesCash > 0
        ? cashPrev - expensesCash - adminPay
        : cashPrev + cashTodayGross - adminPay
      : cashPrev + cashTodayNet - expensesCash;
  const totalNew = cashlessNew + cashNew;

  const notes = [];
  if (cashlessAdjustedForCashCalc < 0) {
    notes.push(
      "Продажи за безнал больше, чем указанный безнал: проверь 'Безнал сегодня' и продажи.",
    );
  }
  if (cashTodayGross < 0) {
    notes.push(
      "Нал сегодня получился отрицательный: проверь 'Выручка' и 'Безнал сегодня'.",
    );
  }
  if (cashTodayNet < 0) {
    notes.push("Нал сегодня после вычета админа получился отрицательный: проверь значения.");
  }

  return {
    revenue,
    adminPay,
    cashless,
    profit,
    salesTotal,
    salesCashless,
    salesCash,
    expensesTotal,
    expensesCashless,
    expensesCash,
    cashlessAdjustedForCashCalc,
    cashTodayGross,
    cashTodayNet,
    masters,
    mastersPayoutTotal,
    mastersDopTotal,
    monthSalesNew,
    monthExpensesNew,
    cashlessNew,
    cashNew,
    totalNew,
    cashCalcMode,
    notes,
  };
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("toast--show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => el.classList.remove("toast--show"), 2200);
}

const els = {
  date: $("date"),
  adminName: $("adminName"),
  revenue: $("revenue"),
  cashless: $("cashless"),
  adminFixed: $("adminFixed"),

  monthSalesPrev: $("monthSalesPrev"),
  monthExpensesPrev: $("monthExpensesPrev"),
  cashlessPrev: $("cashlessPrev"),
  cashPrev: $("cashPrev"),
  cashCalcMode: $("cashCalcMode"),

  masters: $("masters"),
  salesList: $("salesList"),
  expensesList: $("expensesList"),
  history: $("history"),

  profitValue: $("profitValue"),
  cashTodayValue: $("cashTodayValue"),
  cashTodayHint: $("cashTodayHint"),
  mastersPayoutTotal: $("mastersPayoutTotal"),
  mastersPayoutHint: $("mastersPayoutHint"),
  salesTodayTotal: $("salesTodayTotal"),
  expensesTodayTotal: $("expensesTodayTotal"),
  monthSalesNew: $("monthSalesNew"),
  monthExpensesNew: $("monthExpensesNew"),
  cashlessNew: $("cashlessNew"),
  cashNew: $("cashNew"),
  totalNew: $("totalNew"),

  calcStatus: $("calcStatus"),
  lastSavedHint: $("lastSavedHint"),

  btnAddSale: $("btnAddSale"),
  btnAddExpense: $("btnAddExpense"),
  btnSave: $("btnSave"),
  btnClearForm: $("btnClearForm"),
  btnNew: $("btnNew"),
  btnExport: $("btnExport"),
  btnClearAll: $("btnClearAll"),
  btnUseLast: $("btnUseLast"),
  btnResetMasters: $("btnResetMasters"),
};

const tpl = {
  master: $("tplMaster"),
  item: $("tplItem"),
  historyItem: $("tplHistoryItem"),
};

let reports = loadReports();
let currentId = null;
let lastSavedAt = null;

const state = {
  date: "",
  adminName: "",
  revenue: "",
  cashless: "",
  masters: [
    { id: uid(), name: "Абдулло", earned: "", enabled: true, minPayout: 4500 },
    { id: uid(), name: "Иса", earned: "", enabled: true, minPayout: DEFAULT_MASTER_MIN },
    { id: uid(), name: "Марат", earned: "", enabled: true, minPayout: DEFAULT_MASTER_MIN },
  ],
  sales: [],
  expenses: [],
  monthSalesPrev: "0",
  monthExpensesPrev: "0",
  cashlessPrev: "0",
  cashPrev: "0",
  cashCalcMode: "cashflow",
};

function bindInput(el, key) {
  el.addEventListener("input", () => {
    state[key] = el.value;
    recalc();
  });
}

function renderMasters() {
  els.masters.innerHTML = "";
  for (const m of state.masters) {
    const node = tpl.master.content.firstElementChild.cloneNode(true);
    const nameEl = node.querySelector('[data-role="name"]');
    const earnedEl = node.querySelector('[data-role="earned"]');
    const calcEl = node.querySelector('[data-role="calc"]');
    const toggleBtn = node.querySelector('[data-role="toggle"]');
    const toggleText = node.querySelector('[data-role="toggleText"]');

    nameEl.value = m.name ?? "";
    earnedEl.value = m.earned ?? "";

    const applyEnabledUI = () => {
      const enabled = m.enabled !== false;
      toggleText.textContent = enabled ? "Работал" : "Не работал";
      earnedEl.disabled = !enabled;
      node.style.opacity = enabled ? "1" : "0.55";
    };

    nameEl.addEventListener("input", () => {
      m.name = nameEl.value;
      recalc();
    });
    earnedEl.addEventListener("input", () => {
      m.earned = earnedEl.value;
      recalc();
    });
    toggleBtn.addEventListener("click", () => {
      m.enabled = !(m.enabled !== false);
      applyEnabledUI();
      recalc();
    });

    // будет заполнено в recalc
    calcEl.textContent = "—";
    applyEnabledUI();
    els.masters.appendChild(node);
  }
}

function renderItems(container, items, onChange) {
  container.innerHTML = "";
  for (const it of items) {
    const node = tpl.item.content.firstElementChild.cloneNode(true);
    const titleEl = node.querySelector('[data-role="title"]');
    const amountEl = node.querySelector('[data-role="amount"]');
    const payEl = node.querySelector('[data-role="pay"]');
    const metaEl = node.querySelector('[data-role="meta"]');
    const rmEl = node.querySelector('[data-role="remove"]');

    titleEl.value = it.title ?? "";
    amountEl.value = it.amount ?? "";
    payEl.value = it.pay ?? "cashless";

    const refreshMeta = () => {
      const pay = payEl.value === "cash" ? "нал" : "безнал";
      metaEl.textContent = `${pay}`;
    };
    refreshMeta();

    titleEl.addEventListener("input", () => {
      it.title = titleEl.value;
      onChange();
    });
    amountEl.addEventListener("input", () => {
      it.amount = amountEl.value;
      onChange();
    });
    payEl.addEventListener("change", () => {
      it.pay = payEl.value;
      refreshMeta();
      onChange();
    });
    rmEl.addEventListener("click", () => {
      const idx = items.findIndex((x) => x.id === it.id);
      if (idx >= 0) items.splice(idx, 1);
      onChange();
      renderAllLists();
    });

    container.appendChild(node);
  }
}

function renderAllLists() {
  renderItems(els.salesList, state.sales, recalc);
  renderItems(els.expensesList, state.expenses, recalc);
}

function renderHistory() {
  els.history.innerHTML = "";
  const sorted = [...reports].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  for (const rep of sorted.slice().reverse()) {
    const node = tpl.historyItem.content.firstElementChild.cloneNode(true);
    const openBtn = node.querySelector('[data-role="open"]');
    const dlBtn = node.querySelector('[data-role="download"]');
    node.querySelector('[data-role="date"]').textContent = toDMY(rep.date);
    node.querySelector('[data-role="admin"]').textContent =
      rep.adminName ? `Админ: ${rep.adminName}` : "—";
    node.querySelector('[data-role="revenue"]').textContent = fmtRub(rep.revenue ?? 0);
    node.querySelector('[data-role="total"]').textContent = fmtRub(rep.totalNew ?? 0);

    openBtn?.addEventListener("click", () => {
      loadIntoForm(rep.id);
    });
    dlBtn?.addEventListener("click", () => {
      exportSingleReportTXT(rep);
    });
    els.history.appendChild(node);
  }
  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Пока нет сохраненных отчетов.";
    els.history.appendChild(empty);
  }
}

function updateSaveButtonState() {
  if (currentId) {
    els.btnSave.textContent = "Обновить отчет";
    els.btnSave.classList.add("btn--highlight");
  } else {
    els.btnSave.textContent = "Сохранить отчет";
    els.btnSave.classList.remove("btn--highlight");
  }
}

function setSavedHint() {
  if (!lastSavedAt) {
    els.lastSavedHint.textContent = "Не сохранено";
    return;
  }
  const d = new Date(lastSavedAt);
  const t = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  els.lastSavedHint.textContent = `Сохранено в ${t}`;
}

function recalc() {
  const calc = computeAll(state);

  els.adminFixed.value = String(calc.adminPay);
  els.profitValue.textContent = fmtRub(calc.profit);
  els.cashTodayValue.textContent = fmtRub(calc.cashTodayNet);

  const cashHintParts = [];
  cashHintParts.push(
    `нал (грязн.) = выручка − (безнал − продажи_безнал) = ${money(calc.revenue)} − (${money(
      calc.cashless,
    )} − ${money(calc.salesCashless)}) = ${money(calc.cashTodayGross)}`,
  );
  cashHintParts.push(`минус админ ${money(calc.adminPay)} = ${money(calc.cashTodayNet)}`);
  if (calc.salesCash > 0) cashHintParts.push(`продажи_нал: ${fmtRub(calc.salesCash)}`);
  els.cashTodayHint.textContent = cashHintParts.join(" · ");

  els.mastersPayoutTotal.textContent = fmtRub(calc.mastersPayoutTotal);
  els.mastersPayoutHint.textContent =
    calc.mastersDopTotal > 0
      ? `включая доплаты до минимума: ${fmtRub(calc.mastersDopTotal)}`
      : "доплат нет";

  els.salesTodayTotal.textContent = fmtRub(calc.salesTotal);
  els.expensesTodayTotal.textContent = fmtRub(calc.expensesTotal);
  els.monthSalesNew.textContent = fmtRub(calc.monthSalesNew);
  els.monthExpensesNew.textContent = fmtRub(calc.monthExpensesNew);
  els.cashlessNew.textContent = fmtRub(calc.cashlessNew);
  els.cashNew.textContent = fmtRub(calc.cashNew);
  els.totalNew.textContent = fmtRub(calc.totalNew);

  els.calcStatus.textContent = calc.notes.length ? "Проверь значения" : "Готово";
  els.calcStatus.style.borderColor = calc.notes.length
    ? "rgba(239,68,68,.30)"
    : "rgba(34,197,94,.28)";
  els.calcStatus.style.background = calc.notes.length
    ? "rgba(239,68,68,.10)"
    : "rgba(34,197,94,.10)";

  // обновим подсказки у мастеров
  const masterRows = [...els.masters.querySelectorAll(".rowCard")];
  masterRows.forEach((row, idx) => {
    const m = calc.masters[idx];
    const calcEl = row.querySelector('[data-role="calc"]');
    if (!m || !calcEl) return;
    if (!m.enabled) {
      calcEl.textContent = "Не участвует";
      return;
    }
    const base = `${money(m.earned)} → ${money(m.payout)} (45%)`;
    calcEl.textContent =
      m.dop > 0
        ? `${base} · доплата до ${money(m.minPayout)}: ${money(m.dop)} = ${money(m.payoutWithDop)}`
        : base;
  });
}

function takeFormIntoState() {
  state.date = els.date.value;
  state.adminName = els.adminName.value;
  state.revenue = els.revenue.value;
  state.cashless = els.cashless.value;
  state.monthSalesPrev = els.monthSalesPrev.value;
  state.monthExpensesPrev = els.monthExpensesPrev.value;
  state.cashlessPrev = els.cashlessPrev.value;
  state.cashPrev = els.cashPrev.value;
  state.cashCalcMode = els.cashCalcMode.value;
}

function pushStateToForm() {
  els.date.value = state.date || "";
  els.adminName.value = state.adminName || "";
  els.revenue.value = state.revenue ?? "";
  els.cashless.value = state.cashless ?? "";
  els.adminFixed.value = String(ADMIN_FIXED);
  els.monthSalesPrev.value = state.monthSalesPrev ?? "0";
  els.monthExpensesPrev.value = state.monthExpensesPrev ?? "0";
  els.cashlessPrev.value = state.cashlessPrev ?? "0";
  els.cashPrev.value = state.cashPrev ?? "0";
  els.cashCalcMode.value = state.cashCalcMode || "cashflow";
}

function snapshotReport() {
  takeFormIntoState();
  const calc = computeAll(state);
  return {
    id: currentId ?? uid(),
    date: state.date,
    adminName: state.adminName,
    revenue: calc.revenue,
    profit: calc.profit,
    cashless: calc.cashless,
    adminFixed: calc.adminPay,
    masters: calc.masters.map((m) => ({
      id: m.id,
      name: m.name,
      enabled: m.enabled,
      earned: m.earned,
      payout: m.payout,
      dop: m.dop,
      payoutWithDop: m.payoutWithDop,
      minPayout: m.minPayout,
    })),
    mastersPayoutTotal: calc.mastersPayoutTotal,
    sales: (state.sales ?? []).map((x) => ({
      id: x.id,
      title: x.title ?? "",
      amount: normalizeNumberInput(x.amount),
      pay: x.pay ?? "cashless",
    })),
    expenses: (state.expenses ?? []).map((x) => ({
      id: x.id,
      title: x.title ?? "",
      amount: normalizeNumberInput(x.amount),
      pay: x.pay ?? "cashless",
    })),
    salesTodayTotal: calc.salesTotal,
    expensesTodayTotal: calc.expensesTotal,
    monthSalesPrev: normalizeNumberInput(state.monthSalesPrev),
    monthExpensesPrev: normalizeNumberInput(state.monthExpensesPrev),
    monthSalesNew: calc.monthSalesNew,
    monthExpensesNew: calc.monthExpensesNew,
    cashlessPrev: normalizeNumberInput(state.cashlessPrev),
    cashPrev: normalizeNumberInput(state.cashPrev),
    cashCalcMode: state.cashCalcMode || "cashflow",
    cashTodayGross: calc.cashTodayGross,
    cashTodayNet: calc.cashTodayNet,
    cashlessNew: calc.cashlessNew,
    cashNew: calc.cashNew,
    totalNew: calc.totalNew,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function loadIntoForm(id) {
  const rep = reports.find((r) => r.id === id);
  if (!rep) return;
  currentId = rep.id;

  state.date = rep.date || "";
  state.adminName = rep.adminName || "";
  state.revenue = String(rep.revenue ?? "");
  state.cashless = String(rep.cashless ?? "");
  updateSaveButtonState();

  state.masters =
    rep.masters?.map((m) => ({
      id: m.id ?? uid(),
      name: m.name ?? "",
      earned: String(m.earned ?? ""),
      enabled: m.enabled !== false,
      minPayout:
        Number.isFinite(m.minPayout) ? m.minPayout : m.name === "Абдулло" ? 4500 : DEFAULT_MASTER_MIN,
    })) ?? state.masters;

  state.sales =
    rep.sales?.map((x) => ({
      id: x.id ?? uid(),
      title: x.title ?? "",
      amount: String(x.amount ?? ""),
      pay: x.pay ?? "cashless",
    })) ?? [];
  state.expenses =
    rep.expenses?.map((x) => ({
      id: x.id ?? uid(),
      title: x.title ?? "",
      amount: String(x.amount ?? ""),
      pay: x.pay ?? "cashless",
    })) ?? [];

  state.monthSalesPrev = String(rep.monthSalesPrev ?? "0");
  state.monthExpensesPrev = String(rep.monthExpensesPrev ?? "0");
  state.cashlessPrev = String(rep.cashlessPrev ?? "0");
  state.cashPrev = String(rep.cashPrev ?? "0");
  state.cashCalcMode = String(rep.cashCalcMode ?? "cashflow");

  pushStateToForm();
  renderMasters();
  renderAllLists();
  recalc();
  toast("Открыл отчет");
}

function useLastAsPrev() {
  if (reports.length === 0) {
    toast("Нет прошлого отчета");
    return;
  }
  const last = [...reports].sort((a, b) => (a.date || "").localeCompare(b.date || "")).pop();
  if (!last) return;
  state.monthSalesPrev = String(last.monthSalesNew ?? last.monthSalesPrev ?? 0);
  state.monthExpensesPrev = String(last.monthExpensesNew ?? last.monthExpensesPrev ?? 0);
  state.cashlessPrev = String(last.cashlessNew ?? last.cashlessPrev ?? 0);
  state.cashPrev = String(last.cashNew ?? last.cashPrev ?? 0);
  pushStateToForm();
  recalc();
  toast("Подставил переходящие суммы");
}

function newReport() {
  currentId = null;
  lastSavedAt = null;
  setSavedHint();

  state.date = todayISO();
  state.adminName = "";
  state.revenue = "";
  state.cashless = "";
  state.sales = [];
  state.expenses = [];
  state.masters = [
    { id: uid(), name: "Абдулло", earned: "", enabled: true, minPayout: 4500 },
    { id: uid(), name: "Иса", earned: "", enabled: true, minPayout: DEFAULT_MASTER_MIN },
    { id: uid(), name: "Марат", earned: "", enabled: true, minPayout: DEFAULT_MASTER_MIN },
  ];
  state.cashCalcMode = state.cashCalcMode || "cashflow";

  // не трогаем переходящие поля — чтобы удобно было делать следующий отчет подряд
  pushStateToForm();
  renderMasters();
  renderAllLists();
  updateSaveButtonState();
  recalc();
  toast("Новый отчет");
}

function clearForm() {
  currentId = null;
  lastSavedAt = null;
  setSavedHint();

  state.date = "";
  state.adminName = "";
  state.revenue = "";
  state.cashless = "";
  state.sales = [];
  state.expenses = [];
  state.masters = [
    { id: uid(), name: "Абдулло", earned: "", enabled: true, minPayout: 4500 },
    { id: uid(), name: "Иса", earned: "", enabled: true, minPayout: DEFAULT_MASTER_MIN },
    { id: uid(), name: "Марат", earned: "", enabled: true, minPayout: DEFAULT_MASTER_MIN },
  ];
  state.monthSalesPrev = "0";
  state.monthExpensesPrev = "0";
  state.cashlessPrev = "0";
  state.cashPrev = "0";
  state.cashCalcMode = "cashflow";

  pushStateToForm();
  renderMasters();
  renderAllLists();
  updateSaveButtonState();
  recalc();
  toast("Ввод очищен");
}

async function saveCurrent() {
  const rep = snapshotReport();

  if (!rep.date) {
    alert("Укажи дату.");
    return;
  }
  if (!rep.adminName) {
    alert("Укажи имя админа.");
    return;
  }
  if (!Number.isFinite(rep.revenue) || rep.revenue <= 0) {
    alert("Укажи выручку (числом).");
    return;
  }

  if (API_BASE) {
    const existing = reports.find((r) => r.id === rep.id);
    if (existing) rep.createdAt = existing.createdAt ?? rep.createdAt;
    const saved = await saveReportToServer(rep);
    if (saved) {
      reports = await loadReportsFromServer();
      currentId = rep.id;
      lastSavedAt = Date.now();
      setSavedHint();
      renderHistory();
      updateSaveButtonState();
      toast("Сохранено на сервере");
    } else {
      toast("Ошибка сохранения. Проверь сеть и API.");
    }
    return;
  }

  const idx = reports.findIndex((r) => r.id === rep.id);
  if (idx >= 0) {
    rep.createdAt = reports[idx].createdAt ?? rep.createdAt;
    reports[idx] = rep;
  } else {
    reports.push(rep);
  }

  saveReports(reports);
  currentId = rep.id;
  lastSavedAt = Date.now();
  setSavedHint();
  renderHistory();
  toast("Сохранено");
}

function formatItemLine(item) {
  const amount = moneyDot(normalizeNumberInput(item.amount));
  const title = String(item.title || "").trim() || "без названия";
  const pay = item.pay === "cash" ? "нал" : "безнал";
  return `${amount} - ${title} (${pay})`;
}

function formatMasterLine(m) {
  const earned = moneyDot(normalizeNumberInput(m.earned));
  const payout = moneyDot(normalizeNumberInput(m.payout));
  const dop = normalizeNumberInput(m.dop);
  const base = `${m.name}: ${earned}/${payout}`;
  return dop > 0 ? `${base} (доплата ${moneyDot(dop)})` : base;
}

function formatReportAsText(rep) {
  const date = toDMY(rep.date || "");
  const adminName = String(rep.adminName || "").trim() || "—";
  const masters = (rep.masters || []).filter((m) => m.enabled !== false);
  const sales = (rep.sales || []).filter((x) => x.enabled !== false);
  const expenses = (rep.expenses || []).filter((x) => x.enabled !== false);

  const lines = [
    date,
    `Админ ${adminName}`,
    `Выручка сегодня: ${moneyDot(rep.revenue)}`,
    `Прибыль: ${moneyDot(rep.profit)}`,
    `Безнал: ${moneyDot(rep.cashless)}`,
    "",
    `Админ: ${moneyDot(rep.adminFixed)}`,
    "",
    "Зп мастерам:",
    ...(masters.length ? masters.map(formatMasterLine) : ["—"]),
    "",
    `К выплате мастерам: ${moneyDot(rep.mastersPayoutTotal)}`,
    "",
    "Продажи(сегодня):",
    ...(sales.length ? sales.map(formatItemLine) : ["—"]),
    "",
    "Траты:",
    ...(expenses.length ? expenses.map(formatItemLine) : ["—"]),
    "",
    `Продажи за месяц: ${moneyDot(rep.monthSalesNew)}`,
    `Траты за месяц: ${moneyDot(rep.monthExpensesNew)}`,
    "",
    "Эрик: 0",
    "Давид: 0",
    "",
    `Остаток безнал: ${moneyDot(rep.cashlessNew)}`,
    `Нал: ${moneyDot(rep.cashNew)}`,
    `Общий остаток: ${moneyDot(rep.totalNew)}`,
  ];

  return lines.join("\n");
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportSingleReportTXT(rep) {
  const date = (rep?.date || "report").replace(/[^\d-]/g, "") || "report";
  const admin = String(rep?.adminName || "admin")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-zа-яё0-9-_]/gi, "");
  const filename = `report-${date}-${admin || "admin"}.txt`;
  downloadTextFile(formatReportAsText(rep), filename);
}

function exportTXT() {
  const sorted = [...reports].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const payload = sorted.length
    ? sorted.map(formatReportAsText).join("\n\n------------------------------\n\n")
    : "Нет сохраненных отчетов.";

  downloadTextFile(payload, "reports-export.txt");
}

async function clearAll() {
  if (API_BASE) {
    reports = await loadReportsFromServer();
    renderHistory();
    toast("Список обновлён с сервера");
    return;
  }
  const ok = confirm("Удалить ВСЕ сохраненные отчеты на этом устройстве?");
  if (!ok) return;
  reports = [];
  saveReports(reports);
  renderHistory();
  toast("Очищено");
}

function seedFromProvidedExamplesIfEmpty() {
  if (reports.length > 0) return;

  const rep1 = {
    id: uid(),
    date: "2026-03-04",
    adminName: "Вика",
    revenue: 29100,
    cashless: 25300,
    monthSalesPrev: 0,
    monthExpensesPrev: 0,
    cashlessPrev: 0,
    cashPrev: 0,
    masters: [
      { id: uid(), name: "Абдулло", enabled: true, earned: 4700, minPayout: 4500 },
      { id: uid(), name: "Иса", enabled: true, earned: 8900, minPayout: DEFAULT_MASTER_MIN },
      { id: uid(), name: "Марат", enabled: true, earned: 14500, minPayout: DEFAULT_MASTER_MIN },
    ],
    sales: [],
    expenses: [
      { id: uid(), title: "Промоутер", amount: 1000, pay: "cash" },
      { id: uid(), title: "Зп мастеров", amount: 100687, pay: "cash" },
      { id: uid(), title: "Аренда", amount: 125000, pay: "cashless" },
      { id: uid(), title: "Зп Влады", amount: 20000, pay: "cashless" },
    ],
  };
  const rep2 = {
    id: uid(),
    date: "2026-03-05",
    adminName: "Игорь",
    revenue: 32900,
    cashless: 26700,
    monthSalesPrev: 1800,
    monthExpensesPrev: 247587,
    cashlessPrev: 28155,
    cashPrev: 11359,
    masters: [
      { id: uid(), name: "Абдулло", enabled: true, earned: 11800, minPayout: 4500 },
      { id: uid(), name: "Иса", enabled: true, earned: 8800, minPayout: DEFAULT_MASTER_MIN },
      { id: uid(), name: "Марат", enabled: true, earned: 12300, minPayout: DEFAULT_MASTER_MIN },
    ],
    sales: [
      { id: uid(), title: "Паста 100мл", amount: 700, pay: "cashless" },
      { id: uid(), title: "Морская соль", amount: 600, pay: "cashless" },
    ],
    expenses: [{ id: uid(), title: "Мастер по стиральной машине", amount: 8900, pay: "cash" }],
  };

  // досчитаем поля так же, как обычно
  const inflate = (raw) => {
    const st = {
      date: raw.date,
      adminName: raw.adminName,
      revenue: String(raw.revenue),
      cashless: String(raw.cashless),
      masters: raw.masters.map((m) => ({
        id: m.id,
        name: m.name,
        enabled: m.enabled,
        earned: String(m.earned),
        minPayout: m.minPayout,
      })),
      sales: raw.sales.map((x) => ({
        id: x.id,
        title: x.title,
        amount: String(x.amount),
        pay: x.pay,
      })),
      expenses: raw.expenses.map((x) => ({
        id: x.id,
        title: x.title,
        amount: String(x.amount),
        pay: x.pay,
      })),
      monthSalesPrev: String(raw.monthSalesPrev),
      monthExpensesPrev: String(raw.monthExpensesPrev),
      cashlessPrev: String(raw.cashlessPrev),
      cashPrev: String(raw.cashPrev),
      cashCalcMode: "cashflow",
    };
    const calc = computeAll(st);
    return {
      id: raw.id,
      date: raw.date,
      adminName: raw.adminName,
      revenue: raw.revenue,
      profit: calc.profit,
      cashless: raw.cashless,
      adminFixed: calc.adminPay,
      masters: calc.masters.map((m) => ({
        id: m.id,
        name: m.name,
        enabled: m.enabled,
        earned: m.earned,
        payout: m.payout,
        dop: m.dop,
        payoutWithDop: m.payoutWithDop,
      })),
      mastersPayoutTotal: calc.mastersPayoutTotal,
      sales: raw.sales,
      expenses: raw.expenses,
      salesTodayTotal: calc.salesTotal,
      expensesTodayTotal: calc.expensesTotal,
      monthSalesPrev: raw.monthSalesPrev,
      monthExpensesPrev: raw.monthExpensesPrev,
      monthSalesNew: calc.monthSalesNew,
      monthExpensesNew: calc.monthExpensesNew,
      cashlessPrev: raw.cashlessPrev,
      cashPrev: raw.cashPrev,
      cashTodayGross: calc.cashTodayGross,
      cashTodayNet: calc.cashTodayNet,
      cashlessNew: calc.cashlessNew,
      cashNew: calc.cashNew,
      totalNew: calc.totalNew,
      cashCalcMode: "cashflow",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  };

  reports = [inflate(rep1), inflate(rep2)];
  saveReports(reports);
}

async function init() {
  els.adminFixed.value = String(ADMIN_FIXED);

  bindInput(els.date, "date");
  bindInput(els.adminName, "adminName");
  bindInput(els.revenue, "revenue");
  bindInput(els.cashless, "cashless");
  bindInput(els.monthSalesPrev, "monthSalesPrev");
  bindInput(els.monthExpensesPrev, "monthExpensesPrev");
  bindInput(els.cashlessPrev, "cashlessPrev");
  bindInput(els.cashPrev, "cashPrev");
  els.cashCalcMode.addEventListener("change", () => {
    state.cashCalcMode = els.cashCalcMode.value;
    recalc();
  });

  els.btnAddSale.addEventListener("click", () => {
    state.sales.push({ id: uid(), title: "", amount: "", pay: "cashless" });
    renderAllLists();
    recalc();
  });
  els.btnAddExpense.addEventListener("click", () => {
    state.expenses.push({ id: uid(), title: "", amount: "", pay: "cashless" });
    renderAllLists();
    recalc();
  });
  els.btnSave.addEventListener("click", () => saveCurrent());
  els.btnClearForm.addEventListener("click", clearForm);
  els.btnNew.addEventListener("click", newReport);
  els.btnExport.addEventListener("click", exportTXT);
  els.btnClearAll.addEventListener("click", () => clearAll());
  els.btnUseLast.addEventListener("click", useLastAsPrev);
  els.btnResetMasters.addEventListener("click", () => {
    state.masters.forEach((m) => {
      m.earned = "";
      m.enabled = true;
    });
    renderMasters();
    recalc();
    toast("Мастера сброшены");
  });

  if (API_BASE) {
    reports = await loadReportsFromServer();
  } else {
    seedFromProvidedExamplesIfEmpty();
    reports = loadReports();
  }
  renderHistory();

  state.date = todayISO();
  pushStateToForm();
  renderMasters();
  renderAllLists();
  useLastAsPrev(); // если есть история — подтянем переходящие суммы
  recalc();
  updateSaveButtonState();
  setSavedHint();
}

init();

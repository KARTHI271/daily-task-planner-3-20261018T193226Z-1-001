const PRIORITIES = ["High", "Medium", "Low"];
const CATEGORIES = ["SRE", "AWS", "GCP", "Linux", "DevOps", "AI", "Documentation", "Personal", "Other"];
const STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];
const PRIORITY_COLOR = { High: "#F2994A", Medium: "#F2C94C", Low: "#6FCF97" };
const API = "/api";
const APK_DOWNLOAD_URL = "https://github.com/KARTHI271/daily-task-planner-3-20261018T193226Z-1-001/releases/download/android-latest/DailyTaskPlanner.apk";

const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

let state = {
  view: "day",
  selectedDate: new Date(),
  monthCursor: new Date(),
  dayTasks: [],
  overdueTasks: [],
  showForm: false,
  editing: null,
  error: null,

  // Search / Filter / Sort
  searchQuery: "",
  filterCategory: "All",
  filterPriority: "All",
  filterStatus: "All",
  sortBy: "priority",
  sortOrder: "asc",

  // Expansion & Snooze UI
  expandedTasks: new Set(),
  activeSnoozeTaskId: null,
};
let currentUser = null;
let authMode = "login";
let authMessage = "";

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok && res.status !== 204) {
    if (res.status === 401 && !path.startsWith("/auth/")) currentUser = null;
    let msg = "Request failed";
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadDay(preserveSearchFocus = false) {
  // Remember search input position before rendering
  let searchValue = state.searchQuery;
  let selectionStart = null;
  let selectionEnd = null;

  if (preserveSearchFocus) {
    const activeElement = document.activeElement;

    if (activeElement && activeElement.classList.contains("search-input")) {
      selectionStart = activeElement.selectionStart;
      selectionEnd = activeElement.selectionEnd;
    }
  }

  try {
    const params = new URLSearchParams();

    params.set("date", toKey(state.selectedDate));

    if (state.searchQuery) {
      params.set("search", state.searchQuery);
    }

    if (state.filterCategory !== "All") {
      params.set("category", state.filterCategory);
    }

    if (state.filterPriority !== "All") {
      params.set("priority", state.filterPriority);
    }

    if (state.filterStatus !== "All") {
      params.set("status", state.filterStatus);
    }

    if (state.sortBy) {
      params.set("sortBy", state.sortBy);
      params.set("sortOrder", state.sortOrder);
    }

    state.dayTasks = await api(`/tasks?${params.toString()}`);
    state.overdueTasks = await api("/tasks?overdue=true");

  } catch (e) {
    state.error = e.message;
  }

  // Render the page
  await render();

  // Restore search input focus and cursor position
  if (preserveSearchFocus) {
    const newSearchInput = document.querySelector(".search-input");

    if (newSearchInput) {
      newSearchInput.focus();

      if (
        selectionStart !== null &&
        selectionEnd !== null
      ) {
        newSearchInput.setSelectionRange(
          selectionStart,
          selectionEnd
        );
      } else {
        // Put cursor at the end when typing
        newSearchInput.setSelectionRange(
          searchValue.length,
          searchValue.length
        );
      }
    }
  }
}

async function toggleStatus(t) {
  const next = STATUSES[(STATUSES.indexOf(t.status) + 1) % STATUSES.length];
  await api(`/tasks/${t.id}`, { method: "PUT", body: JSON.stringify({ status: next }) });
  loadDay();
}

async function removeTask(id) {
  await api(`/tasks/${id}`, { method: "DELETE" });
  loadDay();
}

async function rescheduleTask(id, targetDate = toKey(new Date())) {
  await api(`/tasks/${id}/reschedule`, {
    method: "POST",
    body: JSON.stringify({ date: targetDate })
  });
  loadDay();
}

async function snoozeTask(id, minutes = 15) {
  await api(`/tasks/${id}/snooze`, {
    method: "POST",
    body: JSON.stringify({ minutes })
  });
  state.activeSnoozeTaskId = null;
  loadDay();
}

async function toggleSubtask(task, subtaskId) {
  const subs = parseSubtasks(task.subtasks);
  const updated = subs.map(s => s.id === subtaskId ? { ...s, completed: !s.completed } : s);
  await api(`/tasks/${task.id}`, {
    method: "PUT",
    body: JSON.stringify({ subtasks: updated })
  });
  loadDay();
}

async function saveTask(payload, isRecurring) {
  if (isRecurring) {
    const body = { ...payload, startDate: toKey(state.selectedDate) };
    if (state.editing) await api(`/recurring/${state.editing.id}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/recurring", { method: "POST", body: JSON.stringify(body) });
  } else if (state.editing) {
    await api(`/tasks/${state.editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await api("/tasks", { method: "POST", body: JSON.stringify({ ...payload, date: toKey(state.selectedDate) }) });
  }
  state.showForm = false;
  state.editing = null;
  loadDay();
}

function shiftDay(n) {
  const d = new Date(state.selectedDate);
  d.setDate(d.getDate() + n);
  state.selectedDate = d;
  loadDay();
}

function parseSubtasks(subtasks) {
  if (!subtasks) return [];
  if (Array.isArray(subtasks)) return subtasks;
  try { return JSON.parse(subtasks); } catch { return []; }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "selected" || k === "checked" || k === "disabled") {
      if (v) node[k] = true;
    }
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

// --- SVG Icons ---
const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_PATHS = {
  plus: ["M12 5v14", "M5 12h14"],
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  trash: ["M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M10 11v6", "M14 11v6"],
  repeat: ["M17 1l4 4-4 4", "M3 11V9a4 4 0 0 1 4-4h14", "M7 23l-4-4 4-4", "M21 13v2a4 4 0 0 1-4 4H3"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  chevronRight: ["M9 18l6-6-6-6"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronUp: ["M18 15l-6-6-6 6"],
  clock: ["M12 6v6l4 2"],
  calendar: ["rect:3,4,18,18,2", "M16 2v4", "M8 2v4", "M3 10h18"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  barChart: ["M12 20V10", "M18 20V4", "M6 20v-4"],
  search: ["circle:11,11,8", "M21 21l-4.35-4.35"],
  filter: ["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"],
  bell: ["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  alertTriangle: ["path:M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  cornerDownRight: ["polyline:15,10,20,15,15,20", "path:M4 4v7a4 4 0 0 0 4 4h12"],
};

function icon(name, size = 20, extra = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", extra.strokeWidth || 2);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("icon");
  if (extra.style) svg.setAttribute("style", extra.style);

  (ICON_PATHS[name] || []).forEach((spec) => {
    if (spec.startsWith("circle:")) {
      const [cx, cy, r] = spec.slice(7).split(",");
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
      svg.appendChild(c);
    } else if (spec.startsWith("rect:")) {
      const [x, y, w, h, rx] = spec.slice(5).split(",");
      const r = document.createElementNS(SVG_NS, "rect");
      r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", w); r.setAttribute("height", h);
      if (rx) r.setAttribute("rx", rx);
      svg.appendChild(r);
    } else {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", spec);
      svg.appendChild(p);
    }
  });
  return svg;
}

function renderSidebar() {
  const completed = state.dayTasks.filter((t) => t.status === "Completed").length;
  const pct = state.dayTasks.length ? Math.round((completed / state.dayTasks.length) * 100) : 0;

  const navItems = [
    ["day", "Today", "list"],
    ["calendar", "Calendar", "calendar"],
    ["stats", "Stats", "barChart"],
  ];
  const nav = el("div", { class: "nav" }, navItems.map(([k, label, iconName]) => el("button", {
    class: state.view === k ? "active" : "",
    onclick: () => { state.view = k; render(); },
  }, [icon(iconName, 20), el("span", {}, label)])));

  return el("aside", { class: "sidebar" }, [
    el("div", {}, [
      el("div", { class: "logo" }, [el("span", {}, "$"), " planner"]),
      el("div", { class: "account-panel" }, [
        el("div", { class: "account-email" }, currentUser.email),
        el("button", { class: "account-action", onclick: async () => {
          await api("/auth/logout", { method: "POST" });
          currentUser = null;
          state.dayTasks = [];
          state.overdueTasks = [];
          render();
        } }, "Sign out"),
      ]),
      el("a", { class: "download-app-btn", href: APK_DOWNLOAD_URL }, "Download Android app"),
      nav,
    ]),
    el("div", { class: "sidebar-stats" }, [
      el("div", { class: "mono", style: "font-size:13px;color:#6B7280" }, toKey(state.selectedDate)),
      el("div", { style: "display:flex;align-items:baseline;gap:6px;margin-top:6px" }, [
        el("span", { class: "mono", style: "font-size:34px;font-weight:600" }, String(pct)),
        el("span", { class: "mono", style: "font-size:15px;color:#6B7280" }, "% done"),
      ]),
      el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `width:${pct}%` })),
      el("div", { class: "mono", style: "font-size:13px;color:#6B7280;margin-top:8px" }, `${completed}/${state.dayTasks.length} tasks`),
    ]),
  ]);
}

function renderAuth() {
  let submit;
  const email = el("input", { class: "field-input", type: "email", name: "email", autocomplete: "email", required: "required", maxlength: "254", placeholder: "you@example.com" });
  const password = el("input", {
    class: "field-input", type: "password", name: "password", required: "required",
    minlength: authMode === "register" ? "12" : undefined, maxlength: "128",
    autocomplete: authMode === "register" ? "new-password" : "current-password",
    placeholder: authMode === "register" ? "At least 12 characters" : "Your password"
  });
  const form = el("form", { class: "auth-card", onsubmit: async (event) => {
    event.preventDefault();
    authMessage = "";
    submit.disabled = true;
    try {
      const result = await api(`/auth/${authMode === "register" ? "register" : "login"}`, {
        method: "POST", body: JSON.stringify({ email: email.value, password: password.value })
      });
      currentUser = result.user;
      password.value = "";
      await loadDay();
    } catch (error) {
      authMessage = error.message;
      render();
    } finally {
      submit.disabled = false;
    }
  } }, [
    el("div", { class: "auth-brand" }, [el("span", {}, "$"), " planner"]),
    el("h1", { class: "auth-title" }, authMode === "register" ? "Create your account" : "Welcome back"),
    el("p", { class: "auth-copy" }, "Your tasks are private to your account and sync with this server."),
    authMessage ? el("div", { class: "error-banner" }, authMessage) : null,
    el("label", { class: "field-label" }, "Email"), email,
    el("label", { class: "field-label" }, "Password"), password,
    authMode === "register" ? el("p", { class: "auth-hint" }, "Use at least 12 characters. Passwords are stored as salted Argon2id hashes, never as readable text.") : null,
    submit = el("button", { class: "primary-btn auth-submit", type: "submit" }, authMode === "register" ? "Create account" : "Sign in"),
    el("button", { class: "auth-switch", type: "button", onclick: () => {
      authMode = authMode === "register" ? "login" : "register";
      authMessage = "";
      render();
    } }, authMode === "register" ? "Already have an account? Sign in" : "New here? Create an account"),
    el("a", { class: "download-app-btn auth-download", href: APK_DOWNLOAD_URL }, "Download Android app"),
  ]);
  return el("div", { class: "auth-page" }, form);
}

function taskRow(t, isOverdue = false) {
  const done = t.status === "Completed";
  const cancelled = t.status === "Cancelled";
  const sublist = parseSubtasks(t.subtasks);
  const subsDone = sublist.filter(s => s.completed).length;
  const isExpanded = state.expandedTasks.has(t.id);
  const isSnoozeOpen = state.activeSnoozeTaskId === t.id;

  const box = done
    ? el("div", { class: "checkbox", style: "background:#6FCF97;border-color:#6FCF97" }, icon("check", 14, { strokeWidth: 3, style: "color:#14171C" }))
    : t.status === "In Progress"
    ? el("div", { class: "checkbox", style: "border-color:#F2C94C" }, el("span", { class: "in-progress-dot" }))
    : el("div", { class: "checkbox" });

  const snoozePopover = isSnoozeOpen ? el("div", { class: "snooze-popover" }, [
    el("button", { onclick: () => snoozeTask(t.id, 15) }, "+15 Minutes"),
    el("button", { onclick: () => snoozeTask(t.id, 60) }, "+1 Hour"),
    el("button", { onclick: () => rescheduleTask(t.id, toKey(new Date(Date.now() + 86400000))) }, "Tomorrow"),
  ]) : null;

  const rowHeader = el("div", { class: "task-row-main" }, [
    el("button", { onclick: () => toggleStatus(t) }, box),
    el("div", { class: "task-body", onclick: () => openForm(t) }, [
      el("div", { class: "task-title", style: `${done ? "text-decoration:line-through;color:#6B7280" : ""}` }, [
        t.title,
        t.recurringId ? icon("repeat", 15, { style: "color:#6B7280;margin-left:6px;vertical-align:-2px" }) : null,
      ]),
      el("div", { class: "task-meta" }, [
        t.startTime ? el("span", { class: "mono", style: "display:inline-flex;align-items:center;gap:4px" }, [icon("clock", 13), t.startTime]) : null,
        el("span", { class: "mono" }, t.category),
        sublist.length ? el("span", { class: "mono subtask-badge" }, `${subsDone}/${sublist.length} subtasks`) : null,
        isOverdue ? el("span", { class: "mono overdue-badge" }, `Due: ${t.date}`) : null,
      ]),
    ]),
    el("div", { class: "task-actions" }, [
      isOverdue ? el("button", {
        class: "icon-btn reschedule-btn",
        title: "Reschedule to today",
        onclick: () => rescheduleTask(t.id, toKey(new Date()))
      }, [icon("cornerDownRight", 16), " Today"]) : null,
      el("div", { style: "position:relative" }, [
        el("button", {
          class: "icon-btn",
          title: "Snooze reminder",
          onclick: (e) => {
            e.stopPropagation();
            state.activeSnoozeTaskId = state.activeSnoozeTaskId === t.id ? null : t.id;
            render();
          }
        }, icon("bell", 16)),
        snoozePopover
      ]),
      (t.description || t.notes || sublist.length) ? el("button", {
        class: "icon-btn",
        title: "Expand details",
        onclick: () => {
          if (isExpanded) state.expandedTasks.delete(t.id);
          else state.expandedTasks.add(t.id);
          render();
        }
      }, icon(isExpanded ? "chevronUp" : "chevronDown", 16)) : null,
      el("button", { class: "delete-btn", onclick: () => removeTask(t.id) }, icon("trash", 18)),
    ]),
  ]);

  const expandedDetails = isExpanded ? el("div", { class: "task-details" }, [
    t.description ? el("div", { class: "detail-block" }, [
      el("div", { class: "detail-label mono" }, "DESCRIPTION"),
      el("div", { class: "detail-text" }, t.description),
    ]) : null,
    t.notes ? el("div", { class: "detail-block" }, [
      el("div", { class: "detail-label mono" }, "NOTES"),
      el("div", { class: "detail-text" }, t.notes),
    ]) : null,
    sublist.length ? el("div", { class: "detail-block" }, [
      el("div", { class: "detail-label mono" }, "SUBTASKS"),
      el("div", { class: "subtask-list" }, sublist.map((s) => el("label", { class: "subtask-item" }, [
        el("input", {
          type: "checkbox",
          checked: s.completed ? "checked" : undefined,
          onchange: () => toggleSubtask(t, s.id)
        }),
        el("span", { style: s.completed ? "text-decoration:line-through;color:#6B7280" : "" }, s.title)
      ])))
    ]) : null
  ]) : null;

  return el("div", { class: `task-row ${isOverdue ? "task-overdue-row" : ""}`, style: cancelled ? "opacity:.45" : "" }, [
    rowHeader,
    expandedDetails
  ]);
}

let searchDebounceTimer = null;

function renderFilterSortBar() {
  const searchInput = el("input", {
  class: "search-input",
  placeholder: "Search tasks...",
  value: state.searchQuery,

  oninput: (e) => {
    state.searchQuery = e.target.value;

    clearTimeout(searchDebounceTimer);

    searchDebounceTimer = setTimeout(() => {
      loadDay(true);
    }, 250);
  },

  onkeydown: (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchDebounceTimer);
      loadDay(true);
    }
  }
});

  const categorySelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.filterCategory = e.target.value; loadDay(); }
  }, ["All", ...CATEGORIES].map((c) => el("option", { value: c, selected: state.filterCategory === c }, `Cat: ${c}`)));

  const prioritySelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.filterPriority = e.target.value; loadDay(); }
  }, ["All", ...PRIORITIES].map((p) => el("option", { value: p, selected: state.filterPriority === p }, `Priority: ${p}`)));

  const statusSelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.filterStatus = e.target.value; loadDay(); }
  }, ["All", ...STATUSES].map((s) => el("option", { value: s, selected: state.filterStatus === s }, `Status: ${s}`)));

  const sortSelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.sortBy = e.target.value; loadDay(); }
  }, [
    ["priority", "Sort: Priority"],
    ["startTime", "Sort: Time"],
    ["title", "Sort: Title"],
    ["date", "Sort: Date"],
  ].map(([val, label]) => el("option", { value: val, selected: state.sortBy === val }, label)));

  const sortOrderBtn = el("button", {
    class: "icon-btn sort-order-btn",
    title: `Order: ${state.sortOrder.toUpperCase()}`,
    onclick: () => {
      state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
      loadDay();
    }
  }, state.sortOrder === "asc" ? "↑ ASC" : "↓ DESC");

  return el("div", { class: "filter-bar" }, [
    el("div", { class: "search-wrapper" }, [icon("search", 16), searchInput]),
    el("div", { class: "filter-controls" }, [categorySelect, prioritySelect, statusSelect, sortSelect, sortOrderBtn])
  ]);
}

function renderOverdueBanner() {
  if (!state.overdueTasks || state.overdueTasks.length === 0) return null;

  return el("div", { class: "overdue-banner" }, [
    el("div", { class: "overdue-header" }, [
      icon("alertTriangle", 20, { style: "color:#F2994A" }),
      el("span", { class: "overdue-title" }, `Overdue Tasks (${state.overdueTasks.length})`),
    ]),
    el("div", { class: "overdue-list" }, state.overdueTasks.map((t) => taskRow(t, true)))
  ]);
}

function renderDayView() {
  const header = el("div", { class: "day-header" }, [
    el("button", { class: "icon-btn", onclick: () => shiftDay(-1) }, icon("chevronLeft", 20)),
    el("h1", { class: "day-title" }, dayLabel(state.selectedDate)),
    el("button", { class: "icon-btn", onclick: () => shiftDay(1) }, icon("chevronRight", 20)),
    el("div", { style: "flex:1" }),
    el("button", { class: "primary-btn", onclick: () => openForm(null) }, [icon("plus", 18), "Add task"]),
  ]);

  const body = [];
  const overdueBanner = renderOverdueBanner();
  if (overdueBanner) body.push(overdueBanner);

  body.push(renderFilterSortBar());

  if (state.dayTasks.length === 0) body.push(el("div", { class: "empty" }, "No tasks match your criteria."));

  if (state.sortBy === "priority") {
    const grouped = { High: [], Medium: [], Low: [] };
    state.dayTasks.forEach((t) => (grouped[t.priority] ||= []).push(t));

    PRIORITIES.forEach((p) => {
      if (!grouped[p] || !grouped[p].length) return;
      body.push(el("div", { style: "margin-bottom:24px" }, [
        el("div", { class: "priority-label" }, [
          el("span", { class: "dot", style: `background:${PRIORITY_COLOR[p]}` }),
          p,
        ]),
        el("div", {}, grouped[p].map((t) => taskRow(t, false))),
      ]));
    });
  } else {
    const sortLabels = {
      startTime: "START TIME",
      title: "TITLE",
      date: "DATE"
    };
    const labelText = `SORTED BY ${sortLabels[state.sortBy] || state.sortBy.toUpperCase()} (${state.sortOrder.toUpperCase()})`;

    body.push(el("div", { style: "margin-bottom:24px" }, [
      el("div", { class: "priority-label" }, labelText),
      el("div", {}, state.dayTasks.map((t) => taskRow(t, false))),
    ]));
  }

  return el("div", {}, [header, ...body]);
}

async function renderCalendarView() {
  const year = state.monthCursor.getFullYear();
  const month = state.monthCursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() + 6) % 7;

  const rangeTasks = await api(`/tasks?from=${toKey(first)}&to=${toKey(last)}`);
  const counts = {};
  rangeTasks.forEach((t) => {
    counts[t.date] = counts[t.date] || { total: 0, done: 0 };
    counts[t.date].total++;
    if (t.status === "Completed") counts[t.date].done++;
  });

  const header = el("div", { class: "day-header" }, [
    el("button", { class: "icon-btn", onclick: () => { state.monthCursor = new Date(year, month - 1, 1); render(); } }, icon("chevronLeft", 20)),
    el("h1", { class: "day-title" }, first.toLocaleDateString(undefined, { month: "long", year: "numeric" })),
    el("button", { class: "icon-btn", onclick: () => { state.monthCursor = new Date(year, month + 1, 1); render(); } }, icon("chevronRight", 20)),
  ]);

  const cells = ["Mo","Tu","We","Th","Fr","Sa","Su"].map((d) => el("div", { class: "cal-dow mono" }, d));
  for (let i = 0; i < startOffset; i++) cells.push(el("div", {}));
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    const key = toKey(date);
    const info = counts[key];
    const classes = ["cal-cell"];
    if (toKey(state.selectedDate) === key) classes.push("selected");
    if (toKey(new Date()) === key) classes.push("today");
    cells.push(el("button", {
      class: classes.join(" "),
      onclick: () => { state.selectedDate = date; state.view = "day"; loadDay(); },
    }, [
      el("span", { class: "mono", style: "font-size:15px" }, String(d)),
      info ? el("span", { class: "mono", style: `font-size:11px;color:${info.done === info.total ? "#6FCF97" : "#8B93A1"}` }, `${info.done}/${info.total}`) : null,
    ]));
  }

  return el("div", {}, [header, el("div", { class: "cal-grid" }, cells)]);
}

async function renderStatsView() {
  const stats = await api("/stats");
  const grid = el("div", { class: "stat-grid" }, [
    statCard("This week", `${stats.week?.pct || 0}%`, `${stats.week?.done || 0}/${stats.week?.total || 0} tasks`),
    statCard("This month", `${stats.month?.pct || 0}%`, `${stats.month?.done || 0}/${stats.month?.total || 0} tasks`),
    statCard("All time", `${stats.allTime?.pct || 0}%`, `${stats.allTime?.done || 0}/${stats.allTime?.total || 0} tasks`),
    statCard("Overdue", `${stats.overdueCount || 0}`, "needs attention"),
    statCard("Streak", `${stats.streak || 0} days`, "completed days"),
    statCard("Subtasks", `${stats.subtaskStats?.pct || 0}%`, `${stats.subtaskStats?.done || 0}/${stats.subtaskStats?.total || 0} done`),
  ]);

  const catRows = (stats.byCategory || []).map((c) => el("div", { class: "cat-row" }, [
    el("div", { class: "cat-name" }, c.category),
    el("div", { class: "cat-track" }, el("div", { class: "cat-fill", style: `width:${c.total ? Math.round((c.done / c.total) * 100) : 0}%` })),
    el("div", { class: "cat-count mono" }, `${c.done}/${c.total}`),
  ]));

  const priorityRows = (stats.byPriority || []).map((p) => el("div", { class: "cat-row" }, [
    el("div", { class: "cat-name" }, p.priority),
    el("div", { class: "cat-track" }, el("div", { class: "cat-fill", style: `width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%;background:${PRIORITY_COLOR[p.priority] || "#F2C94C"}` })),
    el("div", { class: "cat-count mono" }, `${p.done}/${p.total}`),
  ]));

  return el("div", {}, [
    el("h1", { class: "day-title", style: "margin-bottom:20px" }, "Progress Statistics"),
    grid,
    el("div", { class: "mono", style: "font-size:11px;color:#6B7280;margin-bottom:10px;margin-top:20px" }, "BY CATEGORY"),
    el("div", {}, catRows.length ? catRows : [el("div", { style: "color:#6B7280;font-size:13px" }, "No tasks yet.")]),
    el("div", { class: "mono", style: "font-size:11px;color:#6B7280;margin-bottom:10px;margin-top:24px" }, "BY PRIORITY"),
    el("div", {}, priorityRows.length ? priorityRows : [el("div", { style: "color:#6B7280;font-size:13px" }, "No tasks yet.")]),
  ]);
}

function statCard(label, value, sub) {
  return el("div", { class: "stat-card" }, [
    el("div", { class: "stat-label mono" }, label.toUpperCase()),
    el("div", { class: "stat-value mono" }, value),
    el("div", { class: "stat-sub" }, sub),
  ]);
}

function openForm(task) {
  state.editing = task;
  state.showForm = true;
  render();
}

function closeForm() {
  state.showForm = false;
  state.editing = null;
  render();
}

function renderForm() {
  const t = state.editing || {};
  const isRecurringInitial = !!t.frequency;
  let subtasksList = parseSubtasks(t.subtasks);

  const title = el("input", { class: "field-input", value: t.title || "", placeholder: "Study GCP Monitoring" });
  const description = el("textarea", { class: "field-input", rows: 2, placeholder: "Task description..." }, t.description || "");
  const startTime = el("input", { class: "field-input", type: "time", value: t.startTime || t.start_time || "" });
  const reminderTime = el("input", { class: "field-input", type: "time", value: t.reminderTime || t.reminder_time || "" });
  const priority = el("select", { class: "field-input" }, PRIORITIES.map((p) => el("option", { value: p, selected: (t.priority || "Medium") === p }, p)));
  const category = el("select", { class: "field-input" }, CATEGORIES.map((c) => el("option", { value: c, selected: (t.category || "Other") === c }, c)));
  const notes = el("textarea", { class: "field-input", rows: 2, placeholder: "Additional notes or links..." }, t.notes || "");

  const subtaskContainer = el("div", { class: "subtasks-edit-list" });
  function renderSubtaskInputs() {
    subtaskContainer.innerHTML = "";
    subtasksList.forEach((s, idx) => {
      const item = el("div", { class: "subtask-edit-item" }, [
        el("input", {
          type: "checkbox",
          checked: s.completed ? "checked" : undefined,
          onchange: (e) => { subtasksList[idx].completed = e.target.checked; }
        }),
        el("input", {
          class: "field-input",
          value: s.title,
          oninput: (e) => { subtasksList[idx].title = e.target.value; }
        }),
        el("button", {
          type: "button",
          class: "icon-btn",
          onclick: () => { subtasksList.splice(idx, 1); renderSubtaskInputs(); }
        }, icon("x", 16))
      ]);
      subtaskContainer.appendChild(item);
    });
  }
  renderSubtaskInputs();

  const newSubtaskInput = el("input", { class: "field-input", placeholder: "Add a subtask..." });
  const addSubtaskBtn = el("button", {
    type: "button",
    class: "secondary-btn",
    style: "padding:6px 12px;font-size:13px",
    onclick: () => {
      if (!newSubtaskInput.value.trim()) return;
      subtasksList.push({
        id: Math.random().toString(36).slice(2, 9),
        title: newSubtaskInput.value.trim(),
        completed: false
      });
      newSubtaskInput.value = "";
      renderSubtaskInputs();
    }
  }, "+ Add Subtask");

  const recurCheck = el("input", { type: "checkbox", checked: isRecurringInitial ? "checked" : undefined });
  const frequency = el("select", { class: "field-input" }, [
    el("option", { value: "daily" }, "Every day"),
    el("option", { value: "weekly" }, "Every week (this weekday)"),
    el("option", { value: "monthly" }, "Every month (this date)"),
  ]);
  frequency.style.display = isRecurringInitial ? "block" : "none";
  frequency.value = t.frequency || "daily";
  recurCheck.addEventListener("change", () => { frequency.style.display = recurCheck.checked ? "block" : "none"; });

  const form = el("form", { class: "form-card", onsubmit: (e) => {
    e.preventDefault();
    if (!title.value.trim()) return;
    saveTask({
      title: title.value.trim(),
      description: description.value,
      startTime: startTime.value,
      reminderTime: reminderTime.value,
      priority: priority.value,
      category: category.value,
      notes: notes.value,
      subtasks: subtasksList,
      frequency: frequency.value,
    }, recurCheck.checked);
  }}, [
    el("div", { class: "form-header" }, [
      el("span", {}, state.editing ? "Edit task" : "New task"),
      el("button", { type: "button", class: "icon-btn", onclick: closeForm }, icon("x", 18)),
    ]),
    el("label", { class: "field-label" }, "Title"), title,
    el("label", { class: "field-label" }, "Description"), description,
    el("div", { style: "display:flex;gap:10px" }, [
      el("div", { style: "flex:1" }, [el("label", { class: "field-label" }, "Start time"), startTime]),
      el("div", { style: "flex:1" }, [el("label", { class: "field-label" }, "Reminder time"), reminderTime]),
    ]),
    el("div", { style: "display:flex;gap:10px" }, [
      el("div", { style: "flex:1" }, [el("label", { class: "field-label" }, "Priority"), priority]),
      el("div", { style: "flex:1" }, [el("label", { class: "field-label" }, "Category"), category]),
    ]),
    el("label", { class: "field-label" }, "Notes"), notes,
    el("label", { class: "field-label" }, "Subtasks"),
    subtaskContainer,
    el("div", { style: "display:flex;gap:8px;margin-top:6px" }, [newSubtaskInput, addSubtaskBtn]),
    el("label", { class: "field-label", style: "display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:16px" }, [recurCheck, "Repeat this task"]),
    frequency,
    el("div", { class: "form-actions" }, [
      el("button", { type: "button", class: "secondary-btn", onclick: closeForm }, "Cancel"),
      el("button", { type: "submit", class: "primary-btn" }, "Save task"),
    ]),
  ]);

  return el("div", { class: "overlay", onclick: (e) => { if (e.target === e.currentTarget) closeForm(); } }, form);
}

async function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  if (!currentUser) {
    app.appendChild(renderAuth());
    return;
  }

  const main = el("main", { class: "main" });
  if (state.error) {
    main.appendChild(el("div", { class: "error-banner" }, [
      state.error,
      el("button", { onclick: () => { state.error = null; render(); } }, icon("x", 15)),
    ]));
  }

  if (state.view === "day") main.appendChild(renderDayView());
  else if (state.view === "calendar") main.appendChild(await renderCalendarView());
  else if (state.view === "stats") main.appendChild(await renderStatsView());

  app.appendChild(renderSidebar());
  app.appendChild(main);
  if (state.showForm) app.appendChild(renderForm());
}

async function initialize() {
  try {
    const result = await api("/auth/me");
    currentUser = result.user;
    await loadDay();
  } catch {
    currentUser = null;
    render();
  }
}

initialize();

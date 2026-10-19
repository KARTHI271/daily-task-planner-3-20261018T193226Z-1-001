// Daily Task Planner - Core Application
const PRIORITIES = ["High", "Medium", "Low"];
const CATEGORIES = ["SRE", "AWS", "GCP", "Linux", "DevOps", "AI", "Documentation", "Personal", "Other"];
const STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];

const PRIORITY_COLOR = {
  High: "#EF4444",
  Medium: "#F59E0B",
  Low: "#10B981"
};

const CATEGORY_COLORS = {
  SRE: "#0284C7",
  AWS: "#F97316",
  GCP: "#3B82F6",
  Linux: "#10B981",
  DevOps: "#14B8A6",
  AI: "#8B5CF6",
  Documentation: "#EC4899",
  Personal: "#6366F1",
  Other: "#64748B"
};

const API = "/api";
const APK_DOWNLOAD_URL = "https://github.com/KARTHI271/daily-task-planner-3-20261018T193226Z-1-001/releases/download/android-public-latest/DailyTaskPlanner.apk";

const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
const shortDayLabel = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

let state = {
  view: "day", // "day" | "calendar" | "stats"
  selectedDate: new Date(),
  monthCursor: new Date(),
  dayTasks: [],
  overdueTasks: [],
  showForm: false,
  editing: null,
  error: null,
  isLoading: false,

  // Search / Filter / Sort
  searchQuery: "",
  filterCategory: "All",
  filterPriority: "All",
  filterStatus: "All",
  sortBy: "priority",
  sortOrder: "asc",

  // Expansion, Snooze & UI
  expandedTasks: new Set(),
  activeSnoozeTaskId: null,
  showAccountMenu: false,
  taskToDelete: null,
};

let currentUser = null;
let authMode = "login";
let authMessage = "";
let authMessageIsError = false;
let passwordResetToken = "";

// Toast notification helper
function showToast(message, type = "info") {
  const existing = document.querySelector(".toast-notification");
  if (existing) existing.remove();

  const toast = el("div", { class: `toast-notification toast-${type}` }, [
    icon(type === "success" ? "check" : type === "error" ? "alertTriangle" : "info", 18),
    el("span", {}, message)
  ]);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

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
  let selectionStart = null;
  let selectionEnd = null;

  if (preserveSearchFocus) {
    const active = document.activeElement;
    if (active && active.classList.contains("search-input")) {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    }
  }

  try {
    const params = new URLSearchParams();
    params.set("date", toKey(state.selectedDate));

    if (state.searchQuery) params.set("search", state.searchQuery);
    if (state.filterCategory !== "All") params.set("category", state.filterCategory);
    if (state.filterPriority !== "All") params.set("priority", state.filterPriority);
    if (state.filterStatus !== "All") params.set("status", state.filterStatus);
    if (state.sortBy) {
      params.set("sortBy", state.sortBy);
      params.set("sortOrder", state.sortOrder);
    }

    state.dayTasks = await api(`/tasks?${params.toString()}`);
    state.overdueTasks = await api("/tasks?overdue=true");
  } catch (e) {
    state.error = e.message;
  }

  await render();

  if (preserveSearchFocus) {
    const input = document.querySelector(".search-input");
    if (input) {
      input.focus();
      if (selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(selectionStart, selectionEnd);
      } else {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }
}

async function toggleStatus(t) {
  const next = STATUSES[(STATUSES.indexOf(t.status) + 1) % STATUSES.length];
  try {
    await api(`/tasks/${t.id}`, { method: "PUT", body: JSON.stringify({ status: next }) });
    if (next === "Completed") showToast("Task completed! 🎉", "success");
    loadDay();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function promptDeleteTask(task) {
  state.taskToDelete = task;
  render();
}

async function confirmDeleteTask() {
  if (!state.taskToDelete) return;
  const id = state.taskToDelete.id;
  state.taskToDelete = null;
  try {
    await api(`/tasks/${id}`, { method: "DELETE" });
    showToast("Task deleted", "info");
    loadDay();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function cancelDeleteTask() {
  state.taskToDelete = null;
  render();
}

async function rescheduleTask(id, targetDate = toKey(new Date())) {
  try {
    await api(`/tasks/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ date: targetDate })
    });
    showToast("Task rescheduled to today", "success");
    loadDay();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function snoozeTask(id, minutes = 15) {
  try {
    await api(`/tasks/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ minutes })
    });
    state.activeSnoozeTaskId = null;
    showToast(`Reminder snoozed for ${minutes}m`, "info");
    loadDay();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function toggleSubtask(task, subtaskId) {
  const subs = parseSubtasks(task.subtasks);
  const updated = subs.map(s => s.id === subtaskId ? { ...s, completed: !s.completed } : s);
  try {
    await api(`/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ subtasks: updated })
    });
    loadDay();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function saveTask(payload, isRecurring) {
  // Sanitize subtasks
  if (Array.isArray(payload.subtasks)) {
    payload.subtasks = payload.subtasks
      .filter(s => s && s.title && s.title.trim())
      .map(s => ({ ...s, title: s.title.trim() }));
  }

  try {
    if (isRecurring) {
      const body = { ...payload, startDate: toKey(state.selectedDate) };
      const recurringId = state.editing?.recurring_id || (state.editing?.frequency ? state.editing.id : null);
      if (recurringId) {
        await api(`/recurring/${recurringId}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/recurring", { method: "POST", body: JSON.stringify(body) });
      }
    } else if (state.editing) {
      await api(`/tasks/${state.editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/tasks", { method: "POST", body: JSON.stringify({ ...payload, date: toKey(state.selectedDate) }) });
    }
    showToast(state.editing ? "Task updated" : "Task created", "success");
    state.showForm = false;
    state.editing = null;
    loadDay();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function shiftDay(n) {
  const d = new Date(state.selectedDate);
  d.setDate(d.getDate() + n);
  state.selectedDate = d;
  loadDay();
}

function goToToday() {
  state.selectedDate = new Date();
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
  clock: ["M12 6v6l4 2", "circle:12,12,10"],
  calendar: ["rect:3,4,18,18,2", "M16 2v4", "M8 2v4", "M3 10h18"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  barChart: ["M12 20V10", "M18 20V4", "M6 20v-4"],
  search: ["circle:11,11,8", "M21 21l-4.35-4.35"],
  filter: ["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"],
  bell: ["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  alertTriangle: ["path:M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  cornerDownRight: ["polyline:15,10,20,15,15,20", "path:M4 4v7a4 4 0 0 0 4 4h12"],
  flame: ["path:M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"],
  info: ["circle:12,12,10", "M12 16v-4", "M12 8h.01"],
  download: ["path:M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "polyline:7,10,12,15,17,10", "M12 15V3"],
  slash: ["circle:12,12,10", "M4.93 4.93l14.14 14.14"],
  target: ["circle:12,12,10", "circle:12,12,6", "circle:12,12,2"],
  sparkles: ["path:M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"]
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
    } else if (spec.startsWith("path:")) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", spec.slice(5));
      svg.appendChild(p);
    } else if (spec.startsWith("polyline:")) {
      const pts = spec.slice(9).split(",").map(Number);
      const points = [];
      for (let i = 0; i < pts.length; i += 2) points.push(`${pts[i]},${pts[i+1]}`);
      const pl = document.createElementNS(SVG_NS, "polyline");
      pl.setAttribute("points", points.join(" "));
      svg.appendChild(pl);
    } else {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", spec);
      svg.appendChild(p);
    }
  });
  return svg;
}

// --- New App Brand Logo SVG Component ---
function renderAppLogo(size = 34) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("fill", "none");
  svg.classList.add("brand-logo-svg");

  const defs = document.createElementNS(SVG_NS, "defs");
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  const gradId = `logo-g-${Math.random().toString(36).slice(2, 7)}`;
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "2"); grad.setAttribute("y1", "2");
  grad.setAttribute("x2", "34"); grad.setAttribute("y2", "34");
  grad.setAttribute("gradientUnits", "userSpaceOnUse");

  const stop1 = document.createElementNS(SVG_NS, "stop");
  stop1.setAttribute("offset", "0%"); stop1.setAttribute("stop-color", "#6366F1");
  const stop2 = document.createElementNS(SVG_NS, "stop");
  stop2.setAttribute("offset", "50%"); stop2.setAttribute("stop-color", "#8B5CF6");
  const stop3 = document.createElementNS(SVG_NS, "stop");
  stop3.setAttribute("offset", "100%"); stop3.setAttribute("stop-color", "#EC4899");

  grad.appendChild(stop1);
  grad.appendChild(stop2);
  grad.appendChild(stop3);
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Squircle base
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "2"); rect.setAttribute("y", "2");
  rect.setAttribute("width", "32"); rect.setAttribute("height", "32");
  rect.setAttribute("rx", "10");
  rect.setAttribute("fill", `url(#${gradId})`);
  svg.appendChild(rect);

  // Subtle inner highlight
  const rectBorder = document.createElementNS(SVG_NS, "rect");
  rectBorder.setAttribute("x", "2.5"); rectBorder.setAttribute("y", "2.5");
  rectBorder.setAttribute("width", "31"); rectBorder.setAttribute("height", "31");
  rectBorder.setAttribute("rx", "9.5");
  rectBorder.setAttribute("stroke", "rgba(255,255,255,0.25)");
  rectBorder.setAttribute("stroke-width", "1");
  svg.appendChild(rectBorder);

  // Dynamic Checkmark
  const check = document.createElementNS(SVG_NS, "path");
  check.setAttribute("d", "M10 18.5L15 23.5L26 12.5");
  check.setAttribute("stroke", "#FFFFFF");
  check.setAttribute("stroke-width", "3.2");
  check.setAttribute("stroke-linecap", "round");
  check.setAttribute("stroke-linejoin", "round");
  svg.appendChild(check);

  // Sparkle / energy dot
  const star = document.createElementNS(SVG_NS, "circle");
  star.setAttribute("cx", "25.5"); star.setAttribute("cy", "11.5");
  star.setAttribute("r", "1.75");
  star.setAttribute("fill", "#FDE047");
  svg.appendChild(star);

  return svg;
}

// Global click listener to close popovers on click outside
document.addEventListener("click", (e) => {
  if (state.activeSnoozeTaskId && !e.target.closest(".snooze-container")) {
    state.activeSnoozeTaskId = null;
    render();
  }
  if (state.showAccountMenu && !e.target.closest(".account-menu")) {
    state.showAccountMenu = false;
    render();
  }
});

function renderAccountMenu(isMobile = false) {
  const signOut = el("button", { class: "account-action", onclick: async () => {
    await api("/auth/logout", { method: "POST" });
    currentUser = null;
    state.dayTasks = [];
    state.overdueTasks = [];
    state.showAccountMenu = false;
    render();
  } }, "Sign out");

  const reminderSetting = el("label", { class: "email-reminder-setting" }, [
    el("input", {
      type: "checkbox",
      checked: currentUser.emailRemindersEnabled,
      disabled: !currentUser.emailVerified,
      onchange: async (event) => {
        try {
          const result = await api("/auth/preferences", {
            method: "PUT",
            body: JSON.stringify({
              emailRemindersEnabled: event.target.checked,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            }),
          });
          currentUser.emailRemindersEnabled = result.emailRemindersEnabled;
          currentUser.timezone = result.timezone;
          showToast("Reminder preferences updated", "success");
        } catch (error) {
          state.error = error.message;
          render();
        }
      },
    }),
    el("span", {}, currentUser.emailVerified ? "Email task reminders" : "Verify email for reminders"),
  ]);

  const profileInitial = (currentUser.email || "U").trim().charAt(0).toUpperCase();
  const trigger = isMobile
    ? el("button", {
        class: "profile-trigger mobile-avatar-btn",
        type: "button",
        "aria-label": "Account settings",
        "aria-expanded": String(state.showAccountMenu),
        onclick: (e) => { e.stopPropagation(); state.showAccountMenu = !state.showAccountMenu; render(); },
      }, profileInitial)
    : el("button", {
        class: "profile-trigger",
        type: "button",
        "aria-label": "Account settings",
        "aria-expanded": String(state.showAccountMenu),
        onclick: (e) => { e.stopPropagation(); state.showAccountMenu = !state.showAccountMenu; render(); },
      }, [
        el("span", { class: "profile-avatar" }, profileInitial),
        el("span", { class: "profile-email-label" }, currentUser.email.split("@")[0]),
        icon("chevronDown", 14)
      ]);

  return el("div", { class: `account-menu ${state.showAccountMenu ? "open" : ""}` }, [
    trigger,
    el("div", { class: "account-details", onclick: (e) => e.stopPropagation() }, [
      el("div", { class: "account-user-card" }, [
        el("div", { class: "avatar-lg" }, profileInitial),
        el("div", {}, [
          el("div", { class: "account-email-full" }, currentUser.email),
          el("span", { class: `status-chip ${currentUser.emailVerified ? "chip-verified" : "chip-unverified"}` },
            currentUser.emailVerified ? "Verified Account" : "Unverified"
          )
        ])
      ]),
      reminderSetting,
      el("a", { class: "download-app-btn", href: APK_DOWNLOAD_URL, target: "_blank", rel: "noopener" }, [
        icon("download", 16),
        "Download Android APK"
      ]),
      signOut,
    ]),
  ]);
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
    "aria-label": label,
    class: state.view === k ? "active" : "",
    onclick: () => { state.view = k; render(); },
  }, [
    icon(iconName, 20),
    el("span", { class: "nav-label" }, label)
  ])));

  const accountMenu = renderAccountMenu(false);

  return el("aside", { class: "sidebar" }, [
    el("div", { class: "sidebar-top" }, [
      el("div", { class: "logo" }, [
        renderAppLogo(34),
        el("div", { class: "logo-text-group" }, [
          el("span", { class: "logo-title" }, "Planix"),
          el("span", { class: "logo-sub" }, "Daily Task Planner")
        ])
      ]),
      accountMenu,
    ]),
    nav,
    el("div", { class: "sidebar-stats" }, [
      el("div", { class: "sidebar-stat-header" }, [
        el("span", { class: "stat-header-label" }, "TODAY'S MOMENTUM"),
        el("span", { class: "stat-header-date mono" }, toKey(state.selectedDate)),
      ]),
      el("div", { class: "progress-card" }, [
        el("div", { class: "progress-data-row" }, [
          el("span", { class: "progress-number" }, `${pct}%`),
          el("span", { class: "progress-count mono" }, `${completed}/${state.dayTasks.length} done`)
        ]),
        el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `width:${pct}%` })),
      ]),
    ]),
  ]);
}

function renderAuth() {
  let submit;
  const needsEmail = authMode !== "reset";
  const needsPassword = ["login", "register", "reset"].includes(authMode);
  const email = el("input", {
    class: "field-input", type: "email", name: "email", autocomplete: "email",
    required: "required", maxlength: "254", placeholder: "name@company.com"
  });
  const password = needsPassword ? el("input", {
    class: "field-input", type: "password", name: "password", required: "required",
    minlength: authMode === "register" || authMode === "reset" ? "12" : undefined, maxlength: "128",
    autocomplete: authMode === "register" || authMode === "reset" ? "new-password" : "current-password",
    placeholder: authMode === "register" || authMode === "reset" ? "At least 12 characters" : "••••••••••••"
  }) : null;

  const titles = {
    login: "Welcome back",
    register: "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };
  const action = authMode === "register" ? "register"
    : authMode === "login" ? "login"
      : authMode === "forgot" ? "forgot-password" : "reset-password";

  const form = el("form", { class: "auth-card", onsubmit: async (event) => {
    event.preventDefault();
    authMessage = "";
    authMessageIsError = false;
    submit.disabled = true;
    try {
      const body = {};
      if (needsEmail) body.email = email.value;
      if (needsPassword) body.password = password.value;
      if (authMode === "register") body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      if (authMode === "reset") body.token = passwordResetToken;
      const result = await api(`/auth/${action}`, {
        method: "POST", body: JSON.stringify(body)
      });
      if (authMode === "login") {
        currentUser = result.user;
        password.value = "";
        await loadDay();
      } else if (authMode === "register") {
        authMode = "login";
        authMessage = result.message;
        render();
      } else if (authMode === "forgot") {
        authMessage = result.message;
        render();
      } else {
        passwordResetToken = "";
        authMode = "login";
        authMessage = result.message;
        render();
      }
    } catch (error) {
      authMessage = error.message;
      authMessageIsError = true;
      render();
    } finally {
      submit.disabled = false;
    }
  } }, [
    el("div", { class: "auth-brand-center" }, [
      renderAppLogo(46),
      el("h1", { class: "auth-app-title" }, "Planix Planner"),
      el("p", { class: "auth-app-subtitle" }, "Master your day with clarity & flow")
    ]),
    el("div", { class: "auth-inner-header" }, [
      el("h2", { class: "auth-title" }, titles[authMode]),
      el("p", { class: "auth-copy" }, "Your daily tasks are securely synced to your account."),
    ]),
    authMessage ? el("div", { class: authMessageIsError ? "error-banner" : "auth-hint success-banner" }, authMessage) : null,
    needsEmail ? el("label", { class: "field-label" }, "Email address") : null,
    needsEmail ? email : null,
    needsPassword ? el("label", { class: "field-label" }, "Password") : null,
    needsPassword ? password : null,
    authMode === "register" ? el("p", { class: "auth-hint" }, "Use at least 12 characters. Verification email will be sent.") : null,
    submit = el("button", { class: "primary-btn auth-submit", type: "submit" }, ({ login: "Sign in to Planner", register: "Create Free Account", forgot: "Send Reset Link", reset: "Save New Password" })[authMode]),
    authMode === "login" ? el("button", { class: "auth-switch", type: "button", onclick: () => {
      authMode = "forgot"; authMessage = ""; authMessageIsError = false; render();
    } }, "Forgot your password?") : null,
    el("button", { class: "auth-switch switch-main", type: "button", onclick: () => {
      authMode = authMode === "register" ? "login" : authMode === "login" ? "register" : "login";
      authMessage = "";
      authMessageIsError = false;
      render();
    } }, authMode === "register" ? "Already have an account? Sign in" : authMode === "login" ? "Don't have an account? Sign up" : "Back to Sign in"),
    el("div", { class: "auth-divider" }, el("span", {}, "OR GET THE APP")),
    el("a", { class: "download-app-btn auth-download", href: APK_DOWNLOAD_URL, target: "_blank", rel: "noopener" }, [
      icon("download", 16),
      "Download Android App (APK)"
    ]),
  ]);

  return el("div", { class: "auth-page" }, form);
}

function taskRow(t, isOverdue = false) {
  const done = t.status === "Completed";
  const inProgress = t.status === "In Progress";
  const cancelled = t.status === "Cancelled";
  const sublist = parseSubtasks(t.subtasks);
  const subsDone = sublist.filter(s => s.completed).length;
  const isExpanded = state.expandedTasks.has(t.id);
  const isSnoozeOpen = state.activeSnoozeTaskId === t.id;

  const checkboxClass = `checkbox ${done ? "checkbox-done" : inProgress ? "checkbox-inprogress" : cancelled ? "checkbox-cancelled" : "checkbox-pending"}`;

  const box = done
    ? el("div", { class: checkboxClass }, icon("check", 13, { strokeWidth: 3 }))
    : inProgress
    ? el("div", { class: checkboxClass }, el("span", { class: "in-progress-dot" }))
    : cancelled
    ? el("div", { class: checkboxClass }, icon("slash", 13, { strokeWidth: 2.5 }))
    : el("div", { class: checkboxClass });

  const snoozePopover = isSnoozeOpen ? el("div", { class: "snooze-popover", onclick: (e) => e.stopPropagation() }, [
    el("div", { class: "snooze-popover-title" }, "Snooze reminder:"),
    el("button", { class: "snooze-opt", onclick: () => snoozeTask(t.id, 15) }, "+15 Minutes"),
    el("button", { class: "snooze-opt", onclick: () => snoozeTask(t.id, 60) }, "+1 Hour"),
    el("button", { class: "snooze-opt", onclick: () => rescheduleTask(t.id, toKey(new Date(Date.now() + 86400000))) }, "Tomorrow"),
  ]) : null;

  const categoryColor = CATEGORY_COLORS[t.category] || "#64748B";

  const rowHeader = el("div", { class: "task-row-main" }, [
    el("button", { class: "checkbox-hit-area", "aria-label": `Status: ${t.status}`, onclick: () => toggleStatus(t) }, box),
    el("div", { class: "task-body", onclick: () => openForm(t) }, [
      el("div", { class: "task-top-line" }, [
        el("div", { class: `task-title ${done ? "task-title-done" : cancelled ? "task-title-cancelled" : ""}` }, [
          t.title,
          t.recurringId || t.recurring_id ? icon("repeat", 14, { style: "color:#8B5CF6;margin-left:6px;vertical-align:-2px;" }) : null,
        ]),
        el("span", {
          class: "category-chip",
          style: `--cat-color:${categoryColor}`
        }, [
          el("span", { class: "cat-dot", style: `background:${categoryColor}` }),
          t.category
        ])
      ]),
      el("div", { class: "task-meta" }, [
        t.startTime || t.start_time ? el("span", { class: "mono meta-pill" }, [
          icon("clock", 12),
          t.startTime || t.start_time
        ]) : null,
        sublist.length ? el("span", { class: `mono meta-pill subtask-pill ${subsDone === sublist.length ? "subtasks-all-done" : ""}` }, [
          icon("list", 12),
          `${subsDone}/${sublist.length} subtasks`
        ]) : null,
        isOverdue ? el("span", { class: "mono meta-pill overdue-badge" }, [
          icon("alertTriangle", 12),
          `Due: ${t.date}`
        ]) : null,
      ]),
    ]),
    el("div", { class: "task-actions" }, [
      isOverdue ? el("button", {
        class: "icon-btn reschedule-btn",
        title: "Reschedule to today",
        onclick: () => rescheduleTask(t.id, toKey(new Date()))
      }, [icon("cornerDownRight", 14), el("span", { class: "btn-text-sm" }, "Today")]) : null,
      el("div", { class: "snooze-container", style: "position:relative" }, [
        el("button", {
          class: `icon-btn ${isSnoozeOpen ? "active" : ""}`,
          title: "Snooze reminder",
          onclick: (e) => {
            e.stopPropagation();
            state.activeSnoozeTaskId = state.activeSnoozeTaskId === t.id ? null : t.id;
            render();
          }
        }, icon("bell", 15)),
        snoozePopover
      ]),
      (t.description || t.notes || sublist.length) ? el("button", {
        class: `icon-btn expand-btn ${isExpanded ? "active" : ""}`,
        title: isExpanded ? "Collapse" : "Expand details",
        onclick: () => {
          if (isExpanded) state.expandedTasks.delete(t.id);
          else state.expandedTasks.add(t.id);
          render();
        }
      }, icon(isExpanded ? "chevronUp" : "chevronDown", 15)) : null,
      el("button", {
        class: "icon-btn delete-btn",
        title: "Delete task",
        onclick: (e) => { e.stopPropagation(); promptDeleteTask(t); }
      }, icon("trash", 15)),
    ]),
  ]);

  const expandedDetails = isExpanded ? el("div", { class: "task-details" }, [
    t.description ? el("div", { class: "detail-block" }, [
      el("div", { class: "detail-label" }, "DESCRIPTION"),
      el("div", { class: "detail-text" }, t.description),
    ]) : null,
    t.notes ? el("div", { class: "detail-block" }, [
      el("div", { class: "detail-label" }, "NOTES"),
      el("div", { class: "detail-text" }, t.notes),
    ]) : null,
    sublist.length ? el("div", { class: "detail-block" }, [
      el("div", { class: "detail-label-subtasks" }, [
        el("span", { class: "detail-label" }, "SUBTASKS"),
        el("span", { class: "mono subtask-percent" }, `${Math.round((subsDone / sublist.length) * 100)}% complete`)
      ]),
      el("div", { class: "subtask-track" }, el("div", { class: "subtask-fill", style: `width:${Math.round((subsDone / sublist.length) * 100)}%` })),
      el("div", { class: "subtask-list" }, sublist.map((s) => el("label", { class: "subtask-item" }, [
        el("input", {
          type: "checkbox",
          checked: s.completed ? "checked" : undefined,
          onchange: () => toggleSubtask(t, s.id)
        }),
        el("span", { class: `subtask-item-title ${s.completed ? "subtask-done" : ""}` }, s.title)
      ])))
    ]) : null
  ]) : null;

  return el("div", {
    class: `task-row ${done ? "task-completed-row" : ""} ${isOverdue ? "task-overdue-row" : ""}`,
    style: cancelled ? "opacity:.45" : ""
  }, [
    rowHeader,
    expandedDetails
  ]);
}

let searchDebounceTimer = null;

function renderFilterSortBar() {
  const isFiltered = state.searchQuery || state.filterCategory !== "All" || state.filterPriority !== "All" || state.filterStatus !== "All";

  const searchInput = el("input", {
    class: "search-input",
    placeholder: "Search tasks by title, note, or tag…",
    value: state.searchQuery,
    oninput: (e) => {
      state.searchQuery = e.target.value;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        loadDay(true);
      }, 200);
    },
    onkeydown: (e) => {
      if (e.key === "Enter") {
        clearTimeout(searchDebounceTimer);
        loadDay(true);
      }
    }
  });

  const clearSearchBtn = state.searchQuery ? el("button", {
    class: "clear-search-btn",
    title: "Clear search",
    onclick: () => {
      state.searchQuery = "";
      loadDay(true);
    }
  }, icon("x", 14)) : null;

  const categorySelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.filterCategory = e.target.value; loadDay(); }
  }, ["All", ...CATEGORIES].map((c) => el("option", { value: c, selected: state.filterCategory === c }, c === "All" ? "All Categories" : c)));

  const prioritySelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.filterPriority = e.target.value; loadDay(); }
  }, ["All", ...PRIORITIES].map((p) => el("option", { value: p, selected: state.filterPriority === p }, p === "All" ? "All Priorities" : `${p} Priority`)));

  const statusSelect = el("select", {
    class: "filter-select",
    onchange: (e) => { state.filterStatus = e.target.value; loadDay(); }
  }, ["All", ...STATUSES].map((s) => el("option", { value: s, selected: state.filterStatus === s }, s === "All" ? "All Statuses" : s)));

  const sortSelect = el("select", {
    class: "filter-select sort-select",
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
  }, [
    el("span", { class: "mono" }, state.sortOrder === "asc" ? "↑ ASC" : "↓ DESC")
  ]);

  const resetFiltersBtn = isFiltered ? el("button", {
    class: "reset-filters-btn",
    onclick: () => {
      state.searchQuery = "";
      state.filterCategory = "All";
      state.filterPriority = "All";
      state.filterStatus = "All";
      loadDay();
    }
  }, [icon("x", 13), "Reset filters"]) : null;

  return el("div", { class: "filter-bar" }, [
    el("div", { class: "search-wrapper" }, [
      icon("search", 16),
      searchInput,
      clearSearchBtn
    ]),
    el("div", { class: "filter-controls-scroll" }, [
      categorySelect,
      prioritySelect,
      statusSelect,
      sortSelect,
      sortOrderBtn,
      resetFiltersBtn
    ])
  ]);
}

function renderOverdueBanner() {
  if (!state.overdueTasks || state.overdueTasks.length === 0) return null;

  return el("div", { class: "overdue-banner" }, [
    el("div", { class: "overdue-header" }, [
      el("div", { class: "overdue-icon-wrap" }, icon("alertTriangle", 18)),
      el("span", { class: "overdue-title" }, `Overdue Tasks (${state.overdueTasks.length})`),
      el("span", { class: "overdue-sub" }, "Reschedule to today to keep your streak going"),
    ]),
    el("div", { class: "overdue-list" }, state.overdueTasks.map((t) => taskRow(t, true)))
  ]);
}

function renderDeleteModal() {
  if (!state.taskToDelete) return null;
  return el("div", { class: "overlay", onclick: (e) => { if (e.target === e.currentTarget) cancelDeleteTask(); } }, [
    el("div", { class: "confirm-dialog" }, [
      el("div", { class: "confirm-icon-wrap" }, icon("trash", 24)),
      el("h3", { class: "confirm-title" }, "Delete this task?"),
      el("p", { class: "confirm-text" }, `Are you sure you want to delete "${state.taskToDelete.title}"? This action cannot be undone.`),
      el("div", { class: "confirm-actions" }, [
        el("button", { class: "secondary-btn", onclick: cancelDeleteTask }, "Cancel"),
        el("button", { class: "danger-btn", onclick: confirmDeleteTask }, "Delete Task")
      ])
    ])
  ]);
}

function renderDayView() {
  const isCurrentDayToday = toKey(state.selectedDate) === toKey(new Date());

  const header = el("div", { class: "day-header" }, [
    el("div", { class: "day-nav-group" }, [
      el("button", { class: "icon-btn nav-arrow", "aria-label": "Previous day", onclick: () => shiftDay(-1) }, icon("chevronLeft", 18)),
      el("button", {
        class: `day-title-btn ${isCurrentDayToday ? "is-today" : ""}`,
        onclick: goToToday,
        title: "Click to jump to Today"
      }, [
        el("span", { class: "day-title" }, dayLabel(state.selectedDate)),
        !isCurrentDayToday ? el("span", { class: "jump-today-chip" }, "Go to Today") : null
      ]),
      el("button", { class: "icon-btn nav-arrow", "aria-label": "Next day", onclick: () => shiftDay(1) }, icon("chevronRight", 18)),
    ]),
    el("div", { class: "header-action-group" }, [
      el("button", { class: "primary-btn add-task-btn", onclick: () => openForm(null) }, [
        icon("plus", 18, { strokeWidth: 2.5 }),
        el("span", {}, "Add Task")
      ]),
    ])
  ]);

  const body = [];
  const overdueBanner = renderOverdueBanner();
  if (overdueBanner) body.push(overdueBanner);

  const completedCount = state.dayTasks.filter((task) => task.status === "Completed").length;
  const completionPct = state.dayTasks.length ? Math.round((completedCount / state.dayTasks.length) * 100) : 0;

  // Mobile & Compact Daily Focus Banner
  body.push(el("section", { class: "daily-focus-card" }, [
    el("div", { class: "focus-info" }, [
      el("span", { class: "focus-kicker" }, "DAILY PROGRESS"),
      el("div", { class: "focus-metric" }, [
        el("span", { class: "focus-percent" }, `${completionPct}%`),
        el("span", { class: "focus-detail mono" }, `${completedCount} of ${state.dayTasks.length} tasks completed`)
      ])
    ]),
    el("div", { class: "focus-track" }, el("div", { class: "focus-fill", style: `width:${completionPct}%` })),
  ]));

  body.push(renderFilterSortBar());

  if (state.dayTasks.length === 0) {
    body.push(el("div", { class: "empty-state-card" }, [
      el("div", { class: "empty-icon-circle" }, icon("sparkles", 32)),
      el("h3", { class: "empty-title" }, "No tasks found"),
      el("p", { class: "empty-desc" }, state.searchQuery || state.filterCategory !== "All" || state.filterStatus !== "All"
        ? "No tasks match your selected search or filter criteria."
        : "Your schedule is clear for this day. Ready to plan something great?"),
      el("button", { class: "primary-btn empty-action-btn", onclick: () => openForm(null) }, [
        icon("plus", 18),
        "Create First Task"
      ])
    ]));
  } else if (state.sortBy === "priority") {
    const grouped = { High: [], Medium: [], Low: [] };
    state.dayTasks.forEach((t) => (grouped[t.priority] ||= []).push(t));

    PRIORITIES.forEach((p) => {
      if (!grouped[p] || !grouped[p].length) return;
      body.push(el("div", { class: "priority-group" }, [
        el("div", { class: "priority-group-header" }, [
          el("span", { class: "priority-indicator-dot", style: `background:${PRIORITY_COLOR[p]}` }),
          el("span", { class: "priority-group-title" }, `${p} Priority`),
          el("span", { class: "mono priority-count-badge" }, String(grouped[p].length)),
        ]),
        el("div", { class: "task-list-container" }, grouped[p].map((t) => taskRow(t, false))),
      ]));
    });
  } else {
    const sortLabels = {
      startTime: "START TIME",
      title: "TITLE",
      date: "DATE"
    };
    const labelText = `SORTED BY ${sortLabels[state.sortBy] || state.sortBy.toUpperCase()} (${state.sortOrder.toUpperCase()})`;

    body.push(el("div", { class: "priority-group" }, [
      el("div", { class: "priority-group-header" }, [
        el("span", { class: "priority-group-title mono" }, labelText),
        el("span", { class: "mono priority-count-badge" }, String(state.dayTasks.length)),
      ]),
      el("div", { class: "task-list-container" }, state.dayTasks.map((t) => taskRow(t, false))),
    ]));
  }

  return el("div", { class: "day-view-container" }, [header, ...body]);
}

async function renderCalendarView() {
  const year = state.monthCursor.getFullYear();
  const month = state.monthCursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() + 6) % 7; // Monday start

  let rangeTasks = [];
  try {
    rangeTasks = await api(`/tasks?from=${toKey(first)}&to=${toKey(last)}`);
  } catch (err) {
    showToast("Error loading calendar events", "error");
  }

  const counts = {};
  rangeTasks.forEach((t) => {
    counts[t.date] = counts[t.date] || { total: 0, done: 0 };
    counts[t.date].total++;
    if (t.status === "Completed") counts[t.date].done++;
  });

  const header = el("div", { class: "calendar-header" }, [
    el("div", { class: "cal-nav-group" }, [
      el("button", { class: "icon-btn", "aria-label": "Previous month", onclick: () => { state.monthCursor = new Date(year, month - 1, 1); render(); } }, icon("chevronLeft", 18)),
      el("h2", { class: "calendar-month-title" }, first.toLocaleDateString(undefined, { month: "long", year: "numeric" })),
      el("button", { class: "icon-btn", "aria-label": "Next month", onclick: () => { state.monthCursor = new Date(year, month + 1, 1); render(); } }, icon("chevronRight", 18)),
    ]),
    el("button", {
      class: "secondary-btn cal-today-btn",
      onclick: () => {
        state.monthCursor = new Date();
        state.selectedDate = new Date();
        render();
      }
    }, "This Month")
  ]);

  const cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => el("div", { class: "cal-dow mono" }, d));
  for (let i = 0; i < startOffset; i++) cells.push(el("div", { class: "cal-empty-cell" }));

  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    const key = toKey(date);
    const info = counts[key];
    const isSelected = toKey(state.selectedDate) === key;
    const isToday = toKey(new Date()) === key;

    const classes = ["cal-cell"];
    if (isSelected) classes.push("selected");
    if (isToday) classes.push("today");

    let progressChip = null;
    if (info) {
      const allDone = info.done === info.total && info.total > 0;
      progressChip = el("span", {
        class: `cal-badge mono ${allDone ? "cal-badge-done" : "cal-badge-pending"}`
      }, `${info.done}/${info.total}`);
    }

    cells.push(el("button", {
      class: classes.join(" "),
      onclick: () => { state.selectedDate = date; state.view = "day"; loadDay(); },
    }, [
      el("span", { class: "cal-day-num mono" }, String(d)),
      progressChip
    ]));
  }

  return el("div", { class: "calendar-view-container" }, [
    header,
    el("div", { class: "cal-grid" }, cells)
  ]);
}

async function renderStatsView() {
  let stats = {};
  try {
    stats = await api("/stats");
  } catch (err) {
    showToast("Error loading stats", "error");
  }

  const grid = el("div", { class: "stat-grid" }, [
    statCard("This Week", `${stats.week?.pct || 0}%`, `${stats.week?.done || 0}/${stats.week?.total || 0} completed`, "target"),
    statCard("This Month", `${stats.month?.pct || 0}%`, `${stats.month?.done || 0}/${stats.month?.total || 0} completed`, "calendar"),
    statCard("All-Time Rate", `${stats.allTime?.pct || 0}%`, `${stats.allTime?.done || 0}/${stats.allTime?.total || 0} tasks`, "barChart"),
    statCard("Active Streak", `${stats.streak || 0} Days`, stats.streak > 0 ? "Keep momentum going! 🔥" : "Complete tasks to build", "flame"),
    statCard("Overdue", `${stats.overdueCount || 0}`, stats.overdueCount > 0 ? "Needs attention" : "All up to date! ✨", "alertTriangle"),
    statCard("Subtasks Mastered", `${stats.subtaskStats?.pct || 0}%`, `${stats.subtaskStats?.done || 0}/${stats.subtaskStats?.total || 0} done`, "list"),
  ]);

  const catRows = (stats.byCategory || []).map((c) => {
    const color = CATEGORY_COLORS[c.category] || "#64748B";
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    return el("div", { class: "cat-row" }, [
      el("div", { class: "cat-name-group" }, [
        el("span", { class: "cat-dot", style: `background:${color}` }),
        el("span", { class: "cat-name" }, c.category),
      ]),
      el("div", { class: "cat-track" }, el("div", { class: "cat-fill", style: `width:${pct}%;background:${color}` })),
      el("div", { class: "cat-count mono" }, `${c.done}/${c.total} (${pct}%)`),
    ]);
  });

  const priorityRows = (stats.byPriority || []).map((p) => {
    const color = PRIORITY_COLOR[p.priority] || "#F59E0B";
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return el("div", { class: "cat-row" }, [
      el("div", { class: "cat-name-group" }, [
        el("span", { class: "cat-dot", style: `background:${color}` }),
        el("span", { class: "cat-name" }, `${p.priority} Priority`),
      ]),
      el("div", { class: "cat-track" }, el("div", { class: "cat-fill", style: `width:${pct}%;background:${color}` })),
      el("div", { class: "cat-count mono" }, `${p.done}/${p.total} (${pct}%)`),
    ]);
  });

  return el("div", { class: "stats-view-container" }, [
    el("div", { class: "stats-header" }, [
      el("h2", { class: "stats-title" }, "Performance Analytics"),
      el("p", { class: "stats-subtitle" }, "Review your task completion, habits, and productivity patterns.")
    ]),
    grid,
    el("div", { class: "analytics-section" }, [
      el("h3", { class: "analytics-heading mono" }, "COMPLETION BY CATEGORY"),
      el("div", { class: "analytics-card" }, catRows.length ? catRows : [el("div", { class: "empty-subtext" }, "No category data yet.")]),
    ]),
    el("div", { class: "analytics-section" }, [
      el("h3", { class: "analytics-heading mono" }, "COMPLETION BY PRIORITY"),
      el("div", { class: "analytics-card" }, priorityRows.length ? priorityRows : [el("div", { class: "empty-subtext" }, "No priority data yet.")]),
    ])
  ]);
}

function statCard(label, value, sub, iconName) {
  return el("div", { class: "stat-card" }, [
    el("div", { class: "stat-top-row" }, [
      el("span", { class: "stat-label mono" }, label.toUpperCase()),
      icon(iconName, 18, { style: "color:#8B5CF6;opacity:0.85;" })
    ]),
    el("div", { class: "stat-value" }, value),
    el("div", { class: "stat-sub mono" }, sub),
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
  const isRecurringInitial = !!(t.frequency || t.recurring_id || t.recurringId);
  let subtasksList = parseSubtasks(t.subtasks).map(s => ({ ...s }));

  const title = el("input", {
    class: "field-input",
    value: t.title || "",
    placeholder: "e.g., Audit Terraform configs or Write API spec",
    required: "required",
    autofocus: "autofocus"
  });

  const description = el("textarea", {
    class: "field-input",
    rows: 2,
    placeholder: "What needs to be done? Add context or objectives..."
  }, t.description || "");

  const startTime = el("input", {
    class: "field-input",
    type: "time",
    value: t.startTime || t.start_time || ""
  });

  const reminderTime = el("input", {
    class: "field-input",
    type: "time",
    value: t.reminderTime || t.reminder_time || ""
  });

  const priority = el("select", { class: "field-input" }, PRIORITIES.map((p) =>
    el("option", { value: p, selected: (t.priority || "Medium") === p }, `${p} Priority`)
  ));

  const category = el("select", { class: "field-input" }, CATEGORIES.map((c) =>
    el("option", { value: c, selected: (t.category || "Other") === c }, c)
  ));

  const notes = el("textarea", {
    class: "field-input",
    rows: 2,
    placeholder: "Links, markdown snippets, or documentation URLs..."
  }, t.notes || "");

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
          class: "field-input subtask-title-input",
          value: s.title,
          placeholder: "Subtask title...",
          oninput: (e) => { subtasksList[idx].title = e.target.value; }
        }),
        el("button", {
          type: "button",
          class: "icon-btn subtask-remove-btn",
          title: "Remove subtask",
          onclick: () => { subtasksList.splice(idx, 1); renderSubtaskInputs(); }
        }, icon("x", 14))
      ]);
      subtaskContainer.appendChild(item);
    });
  }
  renderSubtaskInputs();

  const newSubtaskInput = el("input", {
    class: "field-input new-subtask-input",
    placeholder: "Add a checklist item (press Enter)...",
    onkeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addSubtask();
      }
    }
  });

  function addSubtask() {
    const val = newSubtaskInput.value.trim();
    if (!val) return;
    subtasksList.push({
      id: Math.random().toString(36).slice(2, 9),
      title: val,
      completed: false
    });
    newSubtaskInput.value = "";
    renderSubtaskInputs();
  }

  const addSubtaskBtn = el("button", {
    type: "button",
    class: "secondary-btn add-subtask-btn",
    onclick: addSubtask
  }, [icon("plus", 14), "Add Item"]);

  const recurCheck = el("input", {
    type: "checkbox",
    id: "recur-check",
    checked: isRecurringInitial ? "checked" : undefined
  });

  const frequency = el("select", { class: "field-input frequency-select" }, [
    el("option", { value: "daily" }, "Repeats: Every Day"),
    el("option", { value: "weekly" }, "Repeats: Every Week (on this day)"),
    el("option", { value: "monthly" }, "Repeats: Every Month (on this date)"),
  ]);
  frequency.style.display = isRecurringInitial ? "block" : "none";
  frequency.value = t.frequency || "daily";

  recurCheck.addEventListener("change", () => {
    frequency.style.display = recurCheck.checked ? "block" : "none";
  });

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
    el("div", { class: "sheet-handle" }),
    el("div", { class: "form-header" }, [
      el("div", { class: "form-title-wrap" }, [
        icon(state.editing ? "calendar" : "plus", 20, { style: "color:#8B5CF6" }),
        el("h3", { class: "form-title" }, state.editing ? "Edit Task Details" : "Create New Task"),
      ]),
      el("button", { type: "button", class: "icon-btn close-form-btn", onclick: closeForm }, icon("x", 18)),
    ]),

    el("div", { class: "form-body-scroll" }, [
      el("label", { class: "field-label" }, "Task Title *"),
      title,

      el("label", { class: "field-label" }, "Description"),
      description,

      el("div", { class: "form-row-2" }, [
        el("div", { class: "form-col" }, [el("label", { class: "field-label" }, "Scheduled Time"), startTime]),
        el("div", { class: "form-col" }, [el("label", { class: "field-label" }, "Reminder Alert"), reminderTime]),
      ]),

      el("div", { class: "form-row-2" }, [
        el("div", { class: "form-col" }, [el("label", { class: "field-label" }, "Priority"), priority]),
        el("div", { class: "form-col" }, [el("label", { class: "field-label" }, "Category Tag"), category]),
      ]),

      el("label", { class: "field-label" }, "Subtasks / Checklist"),
      subtaskContainer,
      el("div", { class: "new-subtask-row" }, [newSubtaskInput, addSubtaskBtn]),

      el("label", { class: "field-label" }, "Notes & Links"),
      notes,

      el("div", { class: "recurrence-section" }, [
        el("label", { class: "recurrence-toggle-label", for: "recur-check" }, [
          recurCheck,
          el("span", {}, "Repeat this task automatically")
        ]),
        frequency,
      ]),
    ]),

    el("div", { class: "form-actions" }, [
      el("button", { type: "button", class: "secondary-btn", onclick: closeForm }, "Cancel"),
      el("button", { type: "submit", class: "primary-btn form-submit-btn" }, [
        icon("check", 16, { strokeWidth: 2.5 }),
        state.editing ? "Save Changes" : "Create Task"
      ]),
    ]),
  ]);

  return el("div", { class: "overlay", onclick: (e) => { if (e.target === e.currentTarget) closeForm(); } }, form);
}

// Render Top Mobile Bar for Mobile View
function renderMobileTopBar() {
  return el("header", { class: "mobile-header" }, [
    el("div", { class: "mobile-brand" }, [
      renderAppLogo(28),
      el("span", { class: "mobile-brand-title" }, "Planix")
    ]),
    el("div", { class: "mobile-header-right" }, [
      renderAccountMenu(true)
    ])
  ]);
}

// Mobile Bottom Navigation Bar
function renderMobileBottomNav() {
  const navItems = [
    ["day", "Today", "list"],
    ["calendar", "Calendar", "calendar"],
    ["stats", "Stats", "barChart"],
  ];

  return el("nav", { class: "mobile-bottom-nav" }, [
    ...navItems.map(([k, label, iconName]) => el("button", {
      class: `mobile-nav-btn ${state.view === k ? "active" : ""}`,
      onclick: () => { state.view = k; render(); }
    }, [
      icon(iconName, 22),
      el("span", { class: "mobile-nav-text" }, label)
    ])),
    el("button", {
      class: "mobile-fab-btn",
      title: "Add Task",
      onclick: () => openForm(null)
    }, icon("plus", 24, { strokeWidth: 2.5 }))
  ]);
}

async function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  if (!currentUser) {
    app.appendChild(renderAuth());
    return;
  }

  // Top Mobile Bar
  app.appendChild(renderMobileTopBar());

  // Main Desktop Sidebar
  app.appendChild(renderSidebar());

  const main = el("main", { class: "main" });
  if (state.error) {
    main.appendChild(el("div", { class: "error-banner" }, [
      el("div", { class: "error-text-wrap" }, [icon("alertTriangle", 18), state.error]),
      el("button", { class: "icon-btn error-close", onclick: () => { state.error = null; render(); } }, icon("x", 14)),
    ]));
  }

  if (state.view === "day") main.appendChild(renderDayView());
  else if (state.view === "calendar") main.appendChild(await renderCalendarView());
  else if (state.view === "stats") main.appendChild(await renderStatsView());

  app.appendChild(main);

  // Bottom Mobile Nav
  app.appendChild(renderMobileBottomNav());

  // Form Modal / Bottom Sheet
  if (state.showForm) app.appendChild(renderForm());

  // Delete Confirm Modal
  if (state.taskToDelete) app.appendChild(renderDeleteModal());
}

async function initialize() {
  const hash = window.location.hash;
  const verifyMatch = hash.match(/^#verify=([^&]+)/);
  const resetMatch = hash.match(/^#reset=([^&]+)/);

  if (verifyMatch) {
    try {
      const result = await api("/auth/verify-email", {
        method: "POST", body: JSON.stringify({ token: decodeURIComponent(verifyMatch[1]) }),
      });
      authMessage = result.message;
      authMessageIsError = false;
    } catch (error) {
      authMessage = error.message;
      authMessageIsError = true;
    }
    history.replaceState(null, "", window.location.pathname + window.location.search);
    render();
    return;
  }

  if (resetMatch) {
    passwordResetToken = decodeURIComponent(resetMatch[1]);
    authMode = "reset";
    history.replaceState(null, "", window.location.pathname + window.location.search);
    render();
    return;
  }

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

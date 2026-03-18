const STORAGE_KEY = "hs-ledger-v1";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC6Cpg83N8fBuvY7YOSwTWsfM9DUsaVc3E",
  authDomain: "pariksha-sathi.firebaseapp.com",
  projectId: "pariksha-sathi",
  storageBucket: "pariksha-sathi.firebasestorage.app",
  messagingSenderId: "921721697043",
  appId: "1:921721697043:web:dada90a420c40e11ae60e6",
  measurementId: "G-NC7955J7KV"
};

const state = loadState();
let currentFilter = "all";
let authRef = null;
let cloudApi = null;
let syncTimer = null;
let deferredPrompt = null;

function defaultState() {
  return {
    entries: [],
    settings: {
      theme: "dark",
      reminderEnabled: false,
      reminderName: "",
      lastReminderAt: 0
    }
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed ? { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } } : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value || 0);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  state.settings.theme = theme;
  saveState();
}

function entryLabel(type) {
  return {
    expense: "Expense",
    income: "Income",
    "loan-given": "Loan Given",
    "loan-returned": "Loan Returned"
  }[type] || type;
}

function amountClass(type) {
  if (type === "expense" || type === "loan-given") return "expense";
  return "income";
}

function normalizePerson(value) {
  return (value || "").trim();
}

function getSummary() {
  const summary = {
    todayExpense: 0,
    totalEarned: 0,
    totalSpent: 0,
    outstandingLoan: 0,
    totalLoanGiven: 0,
    totalLoanReturned: 0,
    netCashFlow: 0
  };

  const today = todayString();
  for (const entry of state.entries) {
    const amount = Number(entry.amount || 0);
    if (entry.type === "expense") {
      summary.totalSpent += amount;
      summary.netCashFlow -= amount;
      if (entry.date === today) summary.todayExpense += amount;
    }
    if (entry.type === "income") {
      summary.totalEarned += amount;
      summary.netCashFlow += amount;
    }
    if (entry.type === "loan-given") {
      summary.totalLoanGiven += amount;
      summary.outstandingLoan += amount;
      summary.netCashFlow -= amount;
    }
    if (entry.type === "loan-returned") {
      summary.totalLoanReturned += amount;
      summary.outstandingLoan -= amount;
      summary.netCashFlow += amount;
    }
  }
  return summary;
}

function getLoanPeople() {
  const people = new Map();
  for (const entry of state.entries) {
    if (!entry.type.startsWith("loan")) continue;
    const person = normalizePerson(entry.person) || "Unknown";
    if (!people.has(person)) people.set(person, { person, given: 0, returned: 0 });
    const bucket = people.get(person);
    if (entry.type === "loan-given") bucket.given += Number(entry.amount || 0);
    if (entry.type === "loan-returned") bucket.returned += Number(entry.amount || 0);
  }
  return [...people.values()]
    .map((item) => ({ ...item, due: item.given - item.returned }))
    .sort((a, b) => b.due - a.due);
}

function getFilteredEntries() {
  const entries = [...state.entries].sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  const today = todayString();
  if (currentFilter === "today") return entries.filter((entry) => entry.date === today);
  if (currentFilter === "expense") return entries.filter((entry) => entry.type === "expense");
  if (currentFilter === "income") return entries.filter((entry) => entry.type === "income");
  if (currentFilter === "loan") return entries.filter((entry) => entry.type === "loan-given" || entry.type === "loan-returned");
  return entries;
}

function renderSummary() {
  const summary = getSummary();
  const grid = document.getElementById("summaryGrid");
  grid.innerHTML = `
    <article class="stat-card negative">
      <p class="section-kicker">Today Spent</p>
      <strong>${formatCurrency(summary.todayExpense)}</strong>
      <p class="helper-text">How much left your pocket today.</p>
    </article>
    <article class="stat-card positive">
      <p class="section-kicker">Total Earned</p>
      <strong>${formatCurrency(summary.totalEarned)}</strong>
      <p class="helper-text">Only direct income and earnings.</p>
    </article>
    <article class="stat-card negative">
      <p class="section-kicker">Total Spent</p>
      <strong>${formatCurrency(summary.totalSpent)}</strong>
      <p class="helper-text">All expenses across your ledger.</p>
    </article>
    <article class="stat-card warning">
      <p class="section-kicker">Udhar Outstanding</p>
      <strong>${formatCurrency(summary.outstandingLoan)}</strong>
      <p class="helper-text">Still expected back from others.</p>
    </article>
  `;
}

function renderToday() {
  const container = document.getElementById("todayList");
  const today = todayString();
  const items = state.entries.filter((entry) => entry.date === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">No records yet for today.</div>`;
    return;
  }
  container.innerHTML = items.slice(0, 5).map((entry) => `
    <article class="today-card">
      <div class="today-meta">
        <div>
          <strong>${entryLabel(entry.type)}</strong>
          <p class="helper-text">${entry.category || entry.note || "No extra detail"}</p>
        </div>
        <strong class="entry-amount ${amountClass(entry.type)}">${formatCurrency(entry.amount)}</strong>
      </div>
    </article>
  `).join("");
}

function renderLoans() {
  const container = document.getElementById("loanBoard");
  const people = getLoanPeople();
  if (!people.length) {
    container.innerHTML = `<div class="empty-state">No udhar records yet.</div>`;
    return;
  }
  container.innerHTML = people.map((person) => `
    <article class="loan-card">
      <div class="loan-meta">
        <div>
          <strong>${person.person}</strong>
          <p class="helper-text">Given ${formatCurrency(person.given)} | Returned ${formatCurrency(person.returned)}</p>
        </div>
        <strong class="entry-amount ${person.due > 0 ? "expense" : "income"}">${formatCurrency(person.due)}</strong>
      </div>
    </article>
  `).join("");
}

function renderLedger() {
  const container = document.getElementById("ledgerList");
  const entries = getFilteredEntries();
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">No records match this filter.</div>`;
    return;
  }

  container.innerHTML = entries.map((entry) => `
    <article class="ledger-item">
      <div class="ledger-topline">
        <div>
          <span class="entry-type-badge entry-type-${entry.type}">${entryLabel(entry.type)}</span>
          <h3>${entry.category || (entry.type.startsWith("loan") ? normalizePerson(entry.person) || "Loan record" : "General entry")}</h3>
        </div>
        <strong class="entry-amount ${amountClass(entry.type)}">${formatCurrency(entry.amount)}</strong>
      </div>
      <div class="ledger-meta">
        <div>
          <p class="helper-text">${entry.date}${entry.person ? ` | ${entry.person}` : ""}</p>
          <p class="helper-text">${entry.note || "No note added"}</p>
        </div>
        <button class="secondary-button" type="button" data-delete="${entry.id}">Delete</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("Delete this record?")) return;
      state.entries = state.entries.filter((entry) => entry.id !== button.dataset.delete);
      persistAndRender();
    });
  });
}

function renderAll() {
  renderSummary();
  renderToday();
  renderLoans();
  renderLedger();
}

function persistAndRender(syncCloud = true) {
  saveState();
  renderAll();
  if (syncCloud) queueCloudSave();
}

function updateTypeVisibility() {
  const type = document.querySelector('input[name="entryType"]:checked')?.value || "expense";
  document.getElementById("personField").classList.toggle("hidden", !(type === "loan-given" || type === "loan-returned"));
}

function setDefaultFormValues() {
  document.getElementById("dateInput").value = todayString();
  updateTypeVisibility();
  document.getElementById("notifToggle").checked = state.settings.reminderEnabled;
  document.getElementById("notifName").value = state.settings.reminderName;
  applyTheme(state.settings.theme || "dark");
}

function buildBackupPayload() {
  return {
    app: "Hisaab Sathi",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: state.entries,
    settings: {
      theme: state.settings.theme,
      reminderEnabled: state.settings.reminderEnabled,
      reminderName: state.settings.reminderName
    }
  };
}

function backupCodeFromPayload(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function restoreFromPayload(payload) {
  if (!payload || !Array.isArray(payload.entries)) throw new Error("Invalid backup format");
  state.entries = payload.entries;
  state.settings = { ...state.settings, ...payload.settings };
  persistAndRender(false);
  setDefaultFormValues();
}

function downloadBackupFile() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `hisaab-sathi-backup-${todayString()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  document.getElementById("backupStatus").textContent = "JSON backup downloaded.";
}

async function backupToGmail() {
  const payload = buildBackupPayload();
  const code = backupCodeFromPayload(payload);
  const file = new File([JSON.stringify(payload, null, 2)], `hisaab-sathi-backup-${todayString()}.json`, { type: "application/json" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      title: "Hisaab Sathi backup",
      text: "Share this backup to your Gmail so you can restore later.",
      files: [file]
    });
    document.getElementById("backupStatus").textContent = "Backup shared. Choose Gmail in the share sheet.";
    return;
  }

  const body = `Hisaab Sathi backup code\n\nKeep this code safe.\n\n${code}`;
  if (body.length < 6000) {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent("Hisaab Sathi Backup")}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, "_blank", "noopener");
    document.getElementById("backupStatus").textContent = "Gmail compose opened with your backup code.";
  } else {
    downloadBackupFile();
    document.getElementById("backupStatus").textContent = "Backup file downloaded. Attach it manually in Gmail.";
  }
}

async function copyBackupCode() {
  const code = backupCodeFromPayload(buildBackupPayload());
  await navigator.clipboard.writeText(code);
  document.getElementById("backupStatus").textContent = "Backup code copied.";
}

function parseBackupInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Backup data is empty");
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return JSON.parse(decodeURIComponent(escape(atob(trimmed))));
}

async function initFirebase() {
  const firebaseApp = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js");
  const firebaseAuth = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js");
  const firebaseDb = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js");

  firebaseApp.initializeApp(FIREBASE_CONFIG);
  authRef = firebaseAuth.getAuth();
  cloudApi = { firebaseAuth, firebaseDb };
  const provider = new firebaseAuth.GoogleAuthProvider();

  firebaseAuth.onAuthStateChanged(authRef, async (user) => {
    const authState = document.getElementById("authState");
    const authButton = document.getElementById("authButton");
    const cloudStatus = document.getElementById("cloudStatus");

    if (user) {
      authState.textContent = `${user.displayName || user.email} is signed in`;
      authButton.textContent = "Logout";
      authButton.onclick = async () => firebaseAuth.signOut(authRef);
      document.getElementById("notifName").value = state.settings.reminderName || user.displayName || "";
      try {
        await loadFromCloud(user.uid);
        cloudStatus.textContent = "Cloud data checked. Gmail backup still recommended as a fallback.";
      } catch {
        cloudStatus.textContent = "Logged in, but cloud data could not be loaded right now.";
      }
    } else {
      authState.textContent = "No active family login";
      authButton.textContent = "Login with Google";
      authButton.onclick = async () => firebaseAuth.signInWithPopup(authRef, provider);
      cloudStatus.textContent = "Same Google login works across the whole Sathi family.";
    }
  });
}

async function loadFromCloud(uid) {
  const { firebaseDb } = cloudApi;
  const ref = firebaseDb.doc(firebaseDb.getFirestore(), "users", uid, "finance", "hisaab-sathi");
  const snap = await firebaseDb.getDoc(ref);
  if (!snap.exists()) return;
  const payload = snap.data();
  if (Array.isArray(payload.entries)) {
    state.entries = payload.entries;
    persistAndRender(false);
  }
}

async function saveToCloud() {
  if (!authRef?.currentUser || !cloudApi) return;
  const { firebaseDb } = cloudApi;
  const ref = firebaseDb.doc(firebaseDb.getFirestore(), "users", authRef.currentUser.uid, "finance", "hisaab-sathi");
  await firebaseDb.setDoc(ref, {
    entries: state.entries,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

function queueCloudSave() {
  if (!authRef?.currentUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await saveToCloud();
      document.getElementById("cloudStatus").textContent = "Cloud synced.";
    } catch {
      document.getElementById("cloudStatus").textContent = "Cloud sync failed. Gmail backup is still available.";
    }
  }, 900);
}

function maybeShowReminder() {
  if (!state.settings.reminderEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - Number(state.settings.lastReminderAt || 0) < 24 * 60 * 60 * 1000) return;
  const name = state.settings.reminderName || "Friend";
  new Notification("Hisaab Sathi reminder", {
    body: `${name}, today's expenses and udhar ko log karna mat bhoolna.`,
    icon: "logo.svg",
    tag: "hs-daily-reminder"
  });
  state.settings.lastReminderAt = now;
  saveState();
}

function initPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.getElementById("installButton").classList.remove("hidden");
  });

  document.getElementById("installButton").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById("installButton").classList.add("hidden");
  });
}

function initEvents() {
  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });

  document.querySelectorAll('input[name="entryType"]').forEach((input) => {
    input.addEventListener("change", updateTypeVisibility);
  });

  document.getElementById("entryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const type = document.querySelector('input[name="entryType"]:checked').value;
    const amount = Number(document.getElementById("amountInput").value);
    const date = document.getElementById("dateInput").value;
    const category = document.getElementById("categoryInput").value.trim();
    const person = normalizePerson(document.getElementById("personInput").value);
    const note = document.getElementById("noteInput").value.trim();

    if (!amount || amount <= 0) return;
    if ((type === "loan-given" || type === "loan-returned") && !person) {
      alert("Please add the person's name for loan records.");
      return;
    }

    state.entries.push({
      id: crypto.randomUUID(),
      type,
      amount,
      date,
      category,
      person,
      note,
      createdAt: new Date().toISOString()
    });
    event.target.reset();
    document.getElementById("dateInput").value = todayString();
    document.querySelector('input[name="entryType"][value="expense"]').checked = true;
    updateTypeVisibility();
    persistAndRender();
  });

  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
      renderLedger();
    });
  });

  document.getElementById("notifSave").addEventListener("click", async () => {
    state.settings.reminderEnabled = document.getElementById("notifToggle").checked;
    state.settings.reminderName = document.getElementById("notifName").value.trim();
    saveState();
    if (state.settings.reminderEnabled && "Notification" in window) {
      const permission = await Notification.requestPermission();
      document.getElementById("notifStatus").textContent = permission === "granted"
        ? "Reminder saved. HS will remind you once every 24 hours on supported browsers."
        : "Notification permission denied. You can still use backup and cloud sync.";
    } else {
      document.getElementById("notifStatus").textContent = "Reminder preference saved locally.";
    }
  });

  document.getElementById("cloudSyncButton").addEventListener("click", async () => {
    if (!authRef?.currentUser) {
      document.getElementById("cloudStatus").textContent = "Login first to use cloud sync.";
      return;
    }
    try {
      await saveToCloud();
      document.getElementById("cloudStatus").textContent = "Cloud sync completed.";
    } catch {
      document.getElementById("cloudStatus").textContent = "Cloud sync failed. Use Gmail backup as a fallback.";
    }
  });

  document.getElementById("downloadBackup").addEventListener("click", downloadBackupFile);
  document.getElementById("gmailBackup").addEventListener("click", async () => {
    try {
      await backupToGmail();
    } catch {
      document.getElementById("backupStatus").textContent = "Backup to Gmail could not start. Try JSON download instead.";
    }
  });
  document.getElementById("copyBackupCode").addEventListener("click", async () => {
    try {
      await copyBackupCode();
    } catch {
      document.getElementById("backupStatus").textContent = "Clipboard access failed. Use JSON download instead.";
    }
  });

  document.getElementById("restoreFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!confirm("Restore this backup and replace current local data?")) return;
      restoreFromPayload(payload);
      document.getElementById("restoreStatus").textContent = "Backup restored from file.";
    } catch {
      document.getElementById("restoreStatus").textContent = "This file could not be restored.";
    }
  });

  document.getElementById("restoreBackupCode").addEventListener("click", () => {
    try {
      const payload = parseBackupInput(document.getElementById("backupCodeInput").value);
      if (!confirm("Restore this backup and replace current local data?")) return;
      restoreFromPayload(payload);
      document.getElementById("restoreStatus").textContent = "Backup restored from pasted data.";
    } catch {
      document.getElementById("restoreStatus").textContent = "Backup code or JSON is invalid.";
    }
  });

  const feedbackModal = document.getElementById("feedbackModal");
  document.getElementById("feedbackFab").addEventListener("click", () => feedbackModal.classList.add("open"));
  document.getElementById("feedbackClose").addEventListener("click", () => feedbackModal.classList.remove("open"));
  feedbackModal.addEventListener("click", (event) => {
    if (event.target === feedbackModal) feedbackModal.classList.remove("open");
  });
  document.getElementById("feedbackSend").addEventListener("click", () => {
    const category = document.getElementById("feedbackCategory").value;
    const message = document.getElementById("feedbackMessage").value.trim();
    if (!message) return;
    const subject = encodeURIComponent(`[Hisaab Sathi Feedback] ${category}`);
    const body = encodeURIComponent(message);
    window.open(`mailto:sangamkrishna.dev@gmail.com?subject=${subject}&body=${body}`, "_blank");
    feedbackModal.classList.remove("open");
    document.getElementById("feedbackMessage").value = "";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setDefaultFormValues();
  renderAll();
  initEvents();
  initPwa();
  maybeShowReminder();
  await initFirebase();
});

const STORAGE_KEY = "hs-ledger-v3";
const FAMILY_THEME_KEY = "sathi-family-theme";
const FAMILY_THEME_MODE_KEY = "sathi-family-theme-mode";
const APP_INSTALL_MARKER = "sathi-installed-hisaab-sathi";
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
let quotes = [];
let quoteIndex = 0;
let dashboardReady = false;
let appInstalled = window.matchMedia("(display-mode: standalone)").matches;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function defaultState() {
  return {
    entries: [],
    settings: {
      theme: "dark",
      reminderEnabled: false,
      reminderTime: "20:30",
      reminderAsked: false,
      lastReminderAt: 0,
      passcodeHash: "",
      passcodeHint: "",
      securityPromptSeen: false
    }
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed
      ? { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } }
      : defaultState();
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

function monthKey(date) {
  return String(date).slice(0, 7);
}

function currentMonthKey() {
  return todayString().slice(0, 7);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function prettyDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function titleCase(input) {
  return input
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizePerson(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  return {
    key: clean.toLowerCase(),
    label: titleCase(clean)
  };
}

function entryLabel(type) {
  return {
    expense: "Kharch",
    income: "Kamai",
    "loan-given": "Udhar Diya",
    "loan-returned": "Udhar Wapas"
  }[type] || type;
}

function amountTone(type) {
  if (type === "expense") return "amount-expense";
  if (type === "income") return "amount-income";
  if (type === "loan-given") return "amount-due";
  return "amount-income";
}

function openModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

function setDashboardReady(ready) {
  dashboardReady = ready;
  document.getElementById("summaryShell").classList.toggle("hidden-shell", !ready);
  document.getElementById("dashboardShell").classList.toggle("hidden-shell", !ready);
}

function getThemePreference() {
  return localStorage.getItem(FAMILY_THEME_MODE_KEY) || localStorage.getItem(FAMILY_THEME_KEY) || state.settings.theme || "system";
}

function resolveTheme(themePreference) {
  if (themePreference === "system") return systemThemeQuery.matches ? "dark" : "light";
  return themePreference === "light" ? "light" : "dark";
}

function applyTheme(themePreference, persist = true) {
  const resolvedTheme = resolveTheme(themePreference);
  document.body.dataset.theme = resolvedTheme;
  document.documentElement.dataset.theme = resolvedTheme;
  state.settings.theme = resolvedTheme;
  if (persist) {
    localStorage.setItem(FAMILY_THEME_MODE_KEY, themePreference);
    localStorage.setItem(FAMILY_THEME_KEY, resolvedTheme);
    saveState();
  }
}

function initThemeSync() {
  applyTheme(getThemePreference(), false);

  const handleSystemThemeChange = () => {
    if ((localStorage.getItem(FAMILY_THEME_MODE_KEY) || "system") === "system") {
      applyTheme("system", false);
    }
  };

  if (typeof systemThemeQuery.addEventListener === "function") {
    systemThemeQuery.addEventListener("change", handleSystemThemeChange);
  } else if (typeof systemThemeQuery.addListener === "function") {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === FAMILY_THEME_KEY || event.key === FAMILY_THEME_MODE_KEY) {
      applyTheme(getThemePreference(), false);
    }
  });
}

function setPrivacyLocked(locked) {
  document.querySelector(".app-shell")?.classList.toggle("privacy-locked", locked);
}

function generateQuotes() {
  const englishStarts = [
    "Money grows when",
    "A strong month begins when",
    "Your future thanks you when",
    "Wealth stays longer when",
    "Peace with money starts when",
    "A healthy budget appears when",
    "Savings become real when",
    "Debt becomes smaller when",
    "Financial clarity comes when",
    "A stable life gets built when",
    "Discipline wins when",
    "Cash flow improves when",
    "Small salaries still shine when",
    "Good habits compound when",
    "A smart spender knows when",
    "The best ledger works when",
    "Income feels bigger when",
    "Monthly progress shows when",
    "Simple finance becomes powerful when",
    "A calm pocket stays calm when",
    "Smart money moves happen when",
    "A careful earner grows when",
    "Planning pays when",
    "A clear record helps when",
    "Consistency changes money when"
  ];
  const englishEnds = [
    "every rupee gets a job.",
    "today's spending gets written today.",
    "wants wait and needs go first.",
    "you remember where cash actually went.",
    "small leaks are noticed early.",
    "borrowing and returning are tracked honestly.",
    "income is respected before it is spent.",
    "monthly totals are reviewed without excuses.",
    "simplicity beats complicated budgeting.",
    "discipline becomes daily, not dramatic."
  ];
  const hindiStarts = [
    "Paisa tab tikta hai jab",
    "Mahine ka control tab aata hai jab",
    "Sahi hisaab tab banta hai jab",
    "Bachat tab badhti hai jab",
    "Udhar tab sambhalta hai jab",
    "Kamai ka asar tab dikhta hai jab",
    "Kharch tab samajh aata hai jab",
    "Aarthik sukoon tab milta hai jab",
    "Budget tab strong banta hai jab",
    "Roz ka record tab kaam aata hai jab",
    "Pocket tab secure lagti hai jab",
    "Future tab strong hota hai jab",
    "Paise ki izzat tab hoti hai jab",
    "Ghar ka hisaab tab sudharta hai jab",
    "Financial discipline tab aati hai jab",
    "Smart spending tab hoti hai jab",
    "Aamdani tab bachi rehti hai jab",
    "Thoda paisa bhi tab kaafi lagta hai jab",
    "Mahine ka total tab useful hota hai jab",
    "Paisa tab dosti nibhata hai jab",
    "Stress tab kam hota hai jab",
    "Sahi planning tab dikhti hai jab",
    "Saving ka maza tab aata hai jab",
    "Loan tab problem nahi banta jab",
    "Hisaab tab sach bolta hai jab"
  ];
  const hindiEnds = [
    "har rupaye ka record likha jaata hai.",
    "kharch aur kamai dono time par note hote hain.",
    "zarurat pehle aur shauk baad me aata hai.",
    "udhar diya aur wapas mila dono clearly dikhte hain.",
    "chhote kharch ko bhi ignore nahi kiya jaata.",
    "mahine ke end ka wait nahi kiya jaata.",
    "aaj ka hisaab aaj hi band hota hai.",
    "discipline aadat ban jaati hai.",
    "cash ka flow samajh me aata rehta hai.",
    "paise ko yaadash pe nahi, record pe chhoda jaata hai."
  ];

  const built = [];
  for (const start of englishStarts) for (const end of englishEnds) built.push(`${start} ${end}`);
  for (const start of hindiStarts) for (const end of hindiEnds) built.push(`${start} ${end}`);
  return built.slice(0, 500);
}

function showQuote(index) {
  const node = document.getElementById("quoteText");
  if (!node || !quotes.length) return;
  node.textContent = quotes[index % quotes.length];
}

function initQuotes() {
  quotes = generateQuotes();
  quoteIndex = Math.floor(Math.random() * quotes.length);
  showQuote(quoteIndex);
  setInterval(() => {
    quoteIndex = (quoteIndex + 1) % quotes.length;
    showQuote(quoteIndex);
  }, 9000);
}

function getSummary() {
  const summary = {
    todaySpent: 0,
    monthSpent: 0,
    totalEarned: 0,
    outstandingLoan: 0
  };

  const today = todayString();
  const currentMonth = currentMonthKey();
  for (const entry of state.entries) {
    const amount = Number(entry.amount || 0);
    if (entry.type === "expense") {
      if (entry.date === today) summary.todaySpent += amount;
      if (monthKey(entry.date) === currentMonth) summary.monthSpent += amount;
    }
    if (entry.type === "income") summary.totalEarned += amount;
    if (entry.type === "loan-given") summary.outstandingLoan += amount;
    if (entry.type === "loan-returned") summary.outstandingLoan -= amount;
  }
  return summary;
}

function getLoanPeople() {
  const people = new Map();
  for (const entry of state.entries) {
    if (!(entry.type === "loan-given" || entry.type === "loan-returned")) continue;
    const person = normalizePerson(entry.person);
    if (!person.key) continue;
    if (!people.has(person.key)) people.set(person.key, { person: person.label, given: 0, returned: 0 });
    const bucket = people.get(person.key);
    bucket.person = person.label;
    if (entry.type === "loan-given") bucket.given += Number(entry.amount || 0);
    if (entry.type === "loan-returned") bucket.returned += Number(entry.amount || 0);
  }
  return [...people.values()]
    .map((item) => ({ ...item, due: item.given - item.returned }))
    .filter((item) => Math.abs(item.due) > 0.009 || item.given || item.returned)
    .sort((a, b) => Math.abs(b.due) - Math.abs(a.due));
}

function getFilteredEntries() {
  const entries = [...state.entries].sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  const today = todayString();
  if (currentFilter === "today") return entries.filter((entry) => entry.date === today);
  if (currentFilter === "expense") return entries.filter((entry) => entry.type === "expense");
  if (currentFilter === "income") return entries.filter((entry) => entry.type === "income");
  if (currentFilter === "loan") return entries.filter((entry) => entry.type.startsWith("loan"));
  return entries;
}

function renderSummary() {
  const summary = getSummary();
  document.getElementById("summaryGrid").innerHTML = `
    <article>
      <p class="section-kicker">Aaj Ka Kharch</p>
      <strong class="summary-rose">${formatCurrency(summary.todaySpent)}</strong>
      <p class="helper-text">Aaj total kitna kharch hua.</p>
    </article>
    <article>
      <p class="section-kicker">Is Mahine Ka Kharch</p>
      <strong class="summary-gold">${formatCurrency(summary.monthSpent)}</strong>
      <p class="helper-text">Current month ka automatic total.</p>
    </article>
    <article>
      <p class="section-kicker">Total Kamai</p>
      <strong class="summary-lime">${formatCurrency(summary.totalEarned)}</strong>
      <p class="helper-text">Ab tak total income entries.</p>
    </article>
    <article>
      <p class="section-kicker">Udhar Outstanding</p>
      <strong class="summary-money">${formatCurrency(summary.outstandingLoan)}</strong>
      <p class="helper-text">Abhi kitna paisa wapas aana baaki hai.</p>
    </article>
  `;
  document.getElementById("monthLabel").textContent = new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function renderLoans() {
  const container = document.getElementById("loanBoard");
  const people = getLoanPeople();
  if (!people.length) {
    container.innerHTML = `<div class="empty-state">Abhi koi active udhar balance nahi hai.</div>`;
    return;
  }
  container.innerHTML = people.map((person) => `
    <article class="loan-card">
      <div class="loan-meta">
        <div>
          <strong>${person.person}</strong>
          <p class="helper-text">Diya ${formatCurrency(person.given)} | Wapas ${formatCurrency(person.returned)}</p>
        </div>
        <strong class="entry-amount ${person.due >= 0 ? "amount-due" : "amount-income"}">${formatCurrency(person.due)}</strong>
      </div>
      <p class="helper-text">${person.due >= 0 ? "Itna abhi lena baaki hai." : "Itna extra receive ho chuka hai."}</p>
    </article>
  `).join("");
}

function renderLedger() {
  const container = document.getElementById("ledgerList");
  const entries = getFilteredEntries();
  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">Is filter me koi record nahi mila.</div>`;
    return;
  }

  const grouped = entries.reduce((acc, entry) => {
    if (!acc[entry.date]) acc[entry.date] = [];
    acc[entry.date].push(entry);
    return acc;
  }, {});

  container.innerHTML = Object.entries(grouped).map(([date, group]) => {
    const spent = group.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const earned = group.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const due = group.filter((entry) => entry.type === "loan-given").reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      - group.filter((entry) => entry.type === "loan-returned").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

    return `
      <section class="ledger-date-group">
        <div class="ledger-group-head">
          <div>
            <div class="ledger-date-label">${prettyDate(date)}</div>
            <p class="helper-text">${group.length} record${group.length > 1 ? "s" : ""}</p>
          </div>
          <div class="ledger-summary">
            <span class="mini-stat">Kharch ${formatCurrency(spent)}</span>
            <span class="mini-stat">Kamai ${formatCurrency(earned)}</span>
            <span class="mini-stat">Net udhar ${formatCurrency(due)}</span>
          </div>
        </div>
        <div class="ledger-items">
          ${group.map((entry) => `
            <article class="ledger-item">
              <div class="ledger-item-head">
                <div>
                  <span class="entry-type-badge entry-type-${entry.type}">${entryLabel(entry.type)}</span>
                  <h3>${entry.category || (entry.person ? normalizePerson(entry.person).label : "General entry")}</h3>
                </div>
                <strong class="entry-amount ${amountTone(entry.type)}">${formatCurrency(entry.amount)}</strong>
              </div>
              <div class="ledger-meta-line">
                <span>${entry.person ? normalizePerson(entry.person).label : "No person tag"}</span>
                <span>${entry.date}</span>
              </div>
              <p class="entry-note">${entry.note || "No note added"}</p>
              <div class="ledger-actions">
                <button class="chip-btn" type="button" data-delete="${entry.id}">Delete</button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");

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
  document.getElementById("notifToggle").checked = state.settings.reminderEnabled;
  document.getElementById("notifTime").value = state.settings.reminderTime;
  applyTheme(getThemePreference(), false);
  updateTypeVisibility();
}

function buildBackupPayload() {
  return {
    app: "Hisaab Sathi",
    version: 3,
    exportedAt: new Date().toISOString(),
    entries: state.entries,
    settings: {
      theme: state.settings.theme,
      reminderEnabled: state.settings.reminderEnabled,
      reminderTime: state.settings.reminderTime,
      passcodeHash: state.settings.passcodeHash,
      passcodeHint: state.settings.passcodeHint
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
      text: "Share this backup to Gmail and keep it safe.",
      files: [file]
    });
    document.getElementById("backupStatus").textContent = "Backup shared. Share sheet me Gmail choose karo.";
    return;
  }

  const body = `Hisaab Sathi backup code\n\nKeep this code safe.\n\n${code}`;
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent("Hisaab Sathi Backup")}&body=${encodeURIComponent(body)}`;
  window.open(gmailUrl, "_blank", "noopener");
  document.getElementById("backupStatus").textContent = "Gmail compose opened with your backup code.";
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
    if (!authState || !authButton) return;

    if (user) {
      authState.textContent = `${user.displayName || user.email} is signed in`;
      authButton.textContent = "Logout";
      authButton.onclick = async () => firebaseAuth.signOut(authRef);
      try {
        await loadFromCloud(user.uid);
        cloudStatus.textContent = "Cloud data checked. Gmail backup still best fallback hai.";
      } catch {
        cloudStatus.textContent = "Cloud load nahi hua. Local data safe hai.";
      }
    } else {
      authState.textContent = "No active family login";
      authButton.textContent = "Login with Google";
      authButton.onclick = async () => firebaseAuth.signInWithPopup(authRef, provider);
      cloudStatus.textContent = "Same login works across the whole Sathi family.";
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
      document.getElementById("cloudStatus").textContent = "Cloud sync failed. Gmail backup still available.";
    }
  }, 900);
}

function shouldFireReminderNow() {
  if (!state.settings.reminderEnabled) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  const [hour, minute] = (state.settings.reminderTime || "20:30").split(":").map(Number);
  const now = new Date();
  const windowStart = new Date();
  windowStart.setHours(hour, minute, 0, 0);
  const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);
  const last = Number(state.settings.lastReminderAt || 0);

  return now >= windowStart && now <= windowEnd && Date.now() - last >= 24 * 60 * 60 * 1000;
}

function maybeShowReminder() {
  if (!shouldFireReminderNow()) return;
  new Notification("Hisaab Sathi reminder", {
    body: "Aaj ka kharch add kar do. 2 minute ka kaam hai.",
    icon: "logo.svg",
    tag: "hs-daily-reminder"
  });
  state.settings.lastReminderAt = Date.now();
  saveState();
}

function initPwa() {
  if (appInstalled) localStorage.setItem(APP_INSTALL_MARKER, "true");
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.getElementById("installButton").classList.remove("hidden");
    if (!appInstalled || new URLSearchParams(window.location.search).get("family-install") === "1") openModal("installModal");
  });

  window.addEventListener("appinstalled", () => {
    appInstalled = true;
    localStorage.setItem(APP_INSTALL_MARKER, "true");
    closeModal("installModal");
    document.getElementById("installButton").classList.add("hidden");
    if (!state.settings.reminderAsked) openModal("reminderModal");
  });
}

async function triggerInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
}

async function hashString(value) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function savePasscode() {
  const passcode = document.getElementById("passcodeInput").value.trim();
  const confirmPasscode = document.getElementById("passcodeConfirmInput").value.trim();
  const hint = document.getElementById("passcodeHintInput").value.trim();
  const status = document.getElementById("passcodeSetupStatus");

  if (!/^\d{4}$/.test(passcode)) {
    status.textContent = "Passcode exactly 4 digits ka hona chahiye.";
    return;
  }
  if (passcode !== confirmPasscode) {
    status.textContent = "Dono passcode same nahi hain.";
    return;
  }

  state.settings.passcodeHash = await hashString(passcode);
  state.settings.passcodeHint = hint;
  state.settings.securityPromptSeen = true;
  saveState();
  status.textContent = "Passcode saved.";
  document.getElementById("passcodeStatus").textContent = "Passcode active hai. App khulte hi unlock pucha jayega.";
  document.getElementById("passcodeInput").value = "";
  document.getElementById("passcodeConfirmInput").value = "";
  document.getElementById("passcodeHintInput").value = "";
  closeModal("passcodeSetupModal");
  if (!dashboardReady) openModal("entryPromptModal");
}

function removePasscode() {
  if (!state.settings.passcodeHash) {
    document.getElementById("passcodeStatus").textContent = "Abhi koi passcode set nahi hai.";
    return;
  }
  if (!confirm("Passcode remove karna hai?")) return;
  state.settings.passcodeHash = "";
  state.settings.passcodeHint = "";
  saveState();
  setPrivacyLocked(false);
  document.getElementById("unlockOverlay").classList.add("hidden");
  document.getElementById("passcodeStatus").textContent = "Passcode remove ho gaya.";
}

async function unlockApp() {
  const input = document.getElementById("unlockPasscodeInput");
  const status = document.getElementById("unlockStatus");
  const attempted = input.value.trim();
  if (!/^\d{4}$/.test(attempted)) {
    status.textContent = "4-digit passcode enter karo.";
    return;
  }
  const hashed = await hashString(attempted);
  if (hashed !== state.settings.passcodeHash) {
    status.textContent = "Passcode galat hai.";
    input.value = "";
    return;
  }
  document.getElementById("unlockOverlay").classList.add("hidden");
  setPrivacyLocked(false);
  input.value = "";
  status.textContent = "";
  queuePostUnlockPrompts();
}

function lockNow() {
  if (!state.settings.passcodeHash) {
    document.getElementById("passcodeStatus").textContent = "Pehle passcode set karo, phir lock use hoga.";
    return;
  }
  document.getElementById("unlockHint").textContent = state.settings.passcodeHint ? `Hint: ${state.settings.passcodeHint}` : "";
  document.getElementById("unlockOverlay").classList.remove("hidden");
  setPrivacyLocked(true);
  closeMenu();
}

function openMenu() {
  document.getElementById("menuDrawer").classList.add("open");
}

function closeMenu() {
  document.getElementById("menuDrawer").classList.remove("open");
}

function promptPasscodeIfNeeded() {
  if (!state.settings.passcodeHash && !state.settings.securityPromptSeen) {
    openModal("passcodePromptModal");
    return true;
  }
  return false;
}

function queuePostUnlockPrompts() {
  const passcodePromptOpened = promptPasscodeIfNeeded();
  if (!passcodePromptOpened && !dashboardReady) openModal("entryPromptModal");
  if (!passcodePromptOpened && appInstalled && !state.settings.reminderAsked) openModal("reminderModal");
}

async function saveReminderPreference(time) {
  state.settings.reminderEnabled = true;
  state.settings.reminderTime = time;
  state.settings.reminderAsked = true;
  saveState();
  document.getElementById("notifToggle").checked = true;
  document.getElementById("notifTime").value = time;

  if ("Notification" in window) {
    const permission = await Notification.requestPermission();
    document.getElementById("notifStatus").textContent = permission === "granted"
      ? `Reminder save ho gaya. ${time} ke around yaad dilayega.`
      : "Notification permission off hai. Browser settings se enable kar sakte ho.";
  }
  closeModal("reminderModal");
}

function initEvents() {
  document.getElementById("menuOpen").addEventListener("click", openMenu);
  document.getElementById("menuClose").addEventListener("click", closeMenu);
  document.getElementById("menuDrawer").addEventListener("click", (event) => {
    if (event.target.id === "menuDrawer") closeMenu();
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });

  document.getElementById("installButton").addEventListener("click", triggerInstall);
  document.getElementById("installNowButton").addEventListener("click", triggerInstall);
  document.getElementById("installLaterButton").addEventListener("click", () => closeModal("installModal"));

  document.getElementById("entryPromptAdd").addEventListener("click", () => {
    closeModal("entryPromptModal");
    setDashboardReady(true);
    document.getElementById("amountInput").focus();
    document.getElementById("entryForm").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("entryPromptSkip").addEventListener("click", () => {
    closeModal("entryPromptModal");
    setDashboardReady(true);
  });

  document.getElementById("passcodePromptYes").addEventListener("click", () => {
    closeModal("passcodePromptModal");
    openModal("passcodeSetupModal");
  });
  document.getElementById("passcodePromptLater").addEventListener("click", () => {
    state.settings.securityPromptSeen = true;
    saveState();
    closeModal("passcodePromptModal");
    if (!dashboardReady) openModal("entryPromptModal");
  });
  document.getElementById("openPasscodeSetup").addEventListener("click", () => openModal("passcodeSetupModal"));
  document.getElementById("passcodeSaveButton").addEventListener("click", savePasscode);
  document.getElementById("passcodeCancelButton").addEventListener("click", () => closeModal("passcodeSetupModal"));
  document.getElementById("removePasscode").addEventListener("click", removePasscode);
  document.getElementById("lockNowButton").addEventListener("click", lockNow);
  document.getElementById("unlockButton").addEventListener("click", unlockApp);
  document.getElementById("unlockPasscodeInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlockApp();
  });

  document.querySelectorAll(".time-choice").forEach((button) => {
    button.addEventListener("click", () => saveReminderPreference(button.dataset.timeChoice));
  });
  document.getElementById("reminderSkip").addEventListener("click", () => {
    state.settings.reminderAsked = true;
    saveState();
    closeModal("reminderModal");
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
    const personRaw = document.getElementById("personInput").value;
    const person = normalizePerson(personRaw).label;
    const note = document.getElementById("noteInput").value.trim();

    if (!amount || amount <= 0) return;
    if ((type === "loan-given" || type === "loan-returned") && !normalizePerson(personRaw).key) {
      alert("Loan entry ke liye person name zaroor dalo.");
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
    setDashboardReady(true);
    closeModal("entryPromptModal");
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
    state.settings.reminderTime = document.getElementById("notifTime").value;
    state.settings.reminderAsked = true;
    saveState();
    if (state.settings.reminderEnabled && "Notification" in window) {
      const permission = await Notification.requestPermission();
      document.getElementById("notifStatus").textContent = permission === "granted"
        ? `Reminder save ho gaya. ${state.settings.reminderTime} ke around yaad dilayega.`
        : "Notification permission off hai.";
    } else {
      document.getElementById("notifStatus").textContent = "Reminder preference locally save ho gayi.";
    }
  });

  document.getElementById("cloudSyncButton").addEventListener("click", async () => {
    if (!authRef?.currentUser) {
      document.getElementById("cloudStatus").textContent = "Cloud sync ke liye login karo.";
      return;
    }
    try {
      await saveToCloud();
      document.getElementById("cloudStatus").textContent = "Cloud sync completed.";
    } catch {
      document.getElementById("cloudStatus").textContent = "Cloud sync fail hua. Gmail backup use karo.";
    }
  });

  document.getElementById("downloadBackup").addEventListener("click", downloadBackupFile);
  document.getElementById("gmailBackup").addEventListener("click", async () => {
    try {
      await backupToGmail();
    } catch {
      document.getElementById("backupStatus").textContent = "Gmail backup start nahi ho paaya.";
    }
  });
  document.getElementById("copyBackupCode").addEventListener("click", async () => {
    try {
      await copyBackupCode();
    } catch {
      document.getElementById("backupStatus").textContent = "Clipboard access fail hua.";
    }
  });

  document.getElementById("restoreFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!confirm("Restore karke current local data replace karna hai?")) return;
      restoreFromPayload(payload);
      document.getElementById("restoreStatus").textContent = "Backup file restore ho gayi.";
    } catch {
      document.getElementById("restoreStatus").textContent = "Yeh file restore nahi ho paayi.";
    }
  });

  document.getElementById("restoreBackupCode").addEventListener("click", () => {
    try {
      const payload = parseBackupInput(document.getElementById("backupCodeInput").value);
      if (!confirm("Restore karke current local data replace karna hai?")) return;
      restoreFromPayload(payload);
      document.getElementById("restoreStatus").textContent = "Pasted backup restore ho gaya.";
    } catch {
      document.getElementById("restoreStatus").textContent = "Backup code parse nahi hua.";
    }
  });

  document.getElementById("feedbackSend").addEventListener("click", () => {
    const category = document.getElementById("feedbackCategory").value;
    const message = document.getElementById("feedbackMessage").value.trim();
    if (!message) return;
    const mailto = `mailto:sangamkrishna.dev@gmail.com?subject=${encodeURIComponent(`[Hisaab Sathi] ${category}`)}&body=${encodeURIComponent(message)}`;
    window.open(mailto, "_blank");
    document.getElementById("feedbackMessage").value = "";
  });
}

function initSecurityLayer() {
  if (state.settings.passcodeHash) {
    document.getElementById("unlockHint").textContent = state.settings.passcodeHint ? `Hint: ${state.settings.passcodeHint}` : "";
    document.getElementById("unlockOverlay").classList.remove("hidden");
    setPrivacyLocked(true);
    setDashboardReady(false);
    return;
  }
  setPrivacyLocked(false);
  queuePostUnlockPrompts();
}

document.addEventListener("DOMContentLoaded", async () => {
  setDefaultFormValues();
  initThemeSync();
  initQuotes();
  initPwa();
  initEvents();
  renderAll();
  setDashboardReady(false);
  maybeShowReminder();
  try {
    await initFirebase();
  } catch {
    document.getElementById("cloudStatus").textContent = "Cloud features abhi load nahi huin. Local app normal chalega.";
  }
  initSecurityLayer();
});

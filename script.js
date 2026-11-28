/* ============================================================
   Dream Japan — JFT Mock Test (3-file SPA)
   v4.5.0 — latest results, average leaderboard, and admin question reports
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs, addDoc, serverTimestamp, getDocFromServer, orderBy, limit, startAfter, runTransaction, deleteDoc, writeBatch, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";



/* ============ CONFIG ============ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD_JxMqTdYiW2DF8lgAlojh1quO32M0CuI",
  authDomain: "dream-japan-9cad8.firebaseapp.com",
  projectId: "dream-japan-9cad8",
  storageBucket: "dream-japan-9cad8.firebasestorage.app",
  messagingSenderId: "587561440248",
  appId: "1:587561440248:web:5a97ae4d2366e3b5583c0d",
  measurementId: "G-V3M5626QM5"
};
const ADMIN_EMAIL = "deepakrajpant978@gmail.com";
const REPO_BASE = "https://deepakrajpant.github.io/Info/";
const QUESTIONS_DOC = "jftoctnovset/QORwII8D7qLZ7wuCDW36";
const CACHE_KEY = "dj_q_cache_v5";               // v5: localStorage + 60min

const PLANS_CACHE_KEY = "dj_plans_v1";
const PLANS_TTL = 10 * 60 * 1000;
const PROFILE_CACHE_KEY = "dj_profile_v1";
const PROFILE_TTL = 24 * 60 * 60 * 1000;
const RESULTS_CACHE_KEY = "dj_results_v1";
const RESULTS_TTL = 60 * 60 * 1000;
const LAST_LOGIN_KEY = "dj_last_login_update";
const MAX_PLAYS = 2;
const EXAM_STATE_KEY = "dj_exam_state";
const RESULT_KEY = "dj_result";
const REDIRECT_AFTER_KEY = "dj_redirect_after";

const SECTIONS = [
  { key:"sv", name:"Script & Vocabulary", short:"Script & Vocabulary", marks:3, icon:"" },
  { key:"ce", name:"Conversation & Expression", short:"Conversation & Expression", marks:4, icon:"" },
  { key:"lc", name:"Listening Comprehension", short:"Listening Comprehension", marks:6, icon:"" },
  { key:"rc", name:"Reading Comprehension", short:"Reading Comprehension", marks:7, icon:"" }
];
const SET_NAMES = [
  { name:"SHIMEMASU", kana:"1" },{ name:"HARE", kana:"2" },
  { name:"GAKUSEI", kana:"3" },{ name:"ORIMASU", kana:"4" },
  { name:"KONPYUTA", kana:"5" },{ name:"MAGARIMASU", kana:"6" }
];

const GROUPS = {
  jftoctnovset: {label:"October – November", first:1, names:SET_NAMES.map(set => set.name), leaderboard:"leaderboard"},
  jftdecjanset: {label:"December – January", first:7, names:["SIFU","OKIMAS","KUTCHUSITA","KUROI","KHUDAMONO","JITENSYA"], leaderboard:"leaderboardDecJan"}
};
const GROUP_IDS = Object.keys(GROUPS);
const [OCT, DEC] = GROUP_IDS;
const ALL_SET_IDS = Array.from({length:12}, (_, i) => i + 1);
const defaultSets = Object.fromEntries(GROUP_IDS.flatMap(group =>
  GROUPS[group].names.map((name, i) => {
    const idx = GROUPS[group].first + i;
    return [idx, {idx, group, number:i+1, name, kana:String(i+1), duration:60, totalMarks:250,
      passMarks:200, order:i+1, access:"premium", isPublished:group === OCT, version:0, questionCount:null}];
  })
));
const setKey = idx => `set_${idx}`;
const setNumber = idx => defaultSets[idx]?.number || idx;
const groupFor = idx => defaultSets[idx]?.group || OCT;
const studentGroup = () => GROUPS[state.params.group] ? state.params.group : OCT;
const groupSetIds = group => ALL_SET_IDS.filter(idx => groupFor(idx) === group);
const catalogRef = () => doc(db, "appConfig", "mockTests");
const bankRef = idx => doc(db, groupFor(idx), setKey(idx));
let catalog = {legacySplit:false, sets:{}};
const setMeta = idx => ({...defaultSets[idx], ...catalog.sets?.[setKey(idx)]});
const groupSets = group => groupSetIds(group).map(setMeta).sort((a, b) => a.order - b.order || a.number - b.number);
const groupOptions = selected => GROUP_IDS.map(group =>
  `<option value="${group}" ${group === selected ? "selected" : ""}>${GROUPS[group].label}</option>`).join("");
function seriesStatus(group) {
  const available = groupSets(group).filter(set => set.isPublished).length;
  return `<span class="home-status home-status-${available ? "live" : "soon"}">${available ? `${available} available` : "Coming Soon"}</span>`;
}
const questionCache = new Map();
const PUBLIC_CACHE_TTL = 5 * 60 * 1000;

function publicStore() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open("dj_public_metadata", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}

async function publicCache(key, value) {
  try {
    const store = await publicStore();
    if (!store) return null;
    return await new Promise(resolve => {
      const tx = store.transaction("settings", value === undefined ? "readonly" : "readwrite");
      const records = tx.objectStore("settings");
      const request = value === undefined ? records.get(key) : records.put({time:Date.now(), value}, key);
      tx.oncomplete = () => {
        store.close();
        const record = value === undefined ? request.result : null;
        resolve(record && Date.now() - record.time < PUBLIC_CACHE_TTL ? record.value : null);
      };
      tx.onerror = tx.onabort = () => {store.close(); resolve(null);};
    });
  } catch { return null; }
}

async function readCatalog(fresh = false) {
  const next = await memoRead(fresh ? "catalog-server" : "catalog", async () => {
    if (!fresh) {
      const cached = await publicCache("catalog");
      if (cached) return cached;
    }
    const snap = await getDocFromServer(catalogRef());
    const value = snap.data() || {legacySplit:false, sets:{}};
    if (fresh) clearFastReads("catalog");
    void publicCache("catalog", value);
    return value;
  }, fresh ? 0 : PUBLIC_CACHE_TTL);
  catalog = next;
  return next;
}

function visibleSet(idx) {
  const meta = setMeta(idx);
  return meta.isPublished === true;
}

function canUseSet(idx) {
  return !!state.user && (state.isAdmin || (state.profile?.status === "active" &&
    (setMeta(idx).access === "free" || hasPremium())));
}

function comingSoon() {
  modal("Coming Soon!", "<p>This mock test will be available soon. Please stay tuned.</p>");
}

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

/* ============ STATE ============ */
const state = {
  user: null, profile: null, isAdmin: false,
  screen: "loading", params: {},
  sets: [], plans: [], results: [],
  exam: null, practice: null,
  bookmarks: [], leaderboard: [],
  _tick: null, _audio: null,
  _perfStart: 0, _perfLeftAtStart: 0, _timeupShown: false, _lockTick: null,
  _allStudents: null, _allQs: null,
  _confirmedLeave: false,        // leave-exam flow
  totalQ: 0, fullMarks: 250, passMarks: 200
};
let _backHandling = false;
let _lastHandledHash = location.hash;

/* Fast response: short-lived reads, immediate busy feedback, compact exam saves. */
const fastReads=new Map(),fastJobs=new Map(),warmMedia=new Map();
const EXAM_SNAPSHOT_KEY=EXAM_STATE_KEY+"_questions";
let savedSnapshotFor="";
function readScope(key){return `${state.user?.uid||"guest"}:${state.isAdmin?"admin":"student"}:${key}`;}
function memoRead(key,loader,ttl=15000){
 const scoped=readScope(key),entry=fastReads.get(scoped),now=Date.now();
 if(entry && (entry.pending || now-entry.time<ttl))return entry.promise;
 const next={pending:true,time:now,promise:null};
 next.promise=Promise.resolve().then(loader).then(value=>{next.pending=false;next.time=Date.now();return value;},error=>{if(fastReads.get(scoped)===next)fastReads.delete(scoped);throw error;});
 fastReads.set(scoped,next);
 if(fastReads.size>128){for(const [oldKey,oldEntry] of fastReads){if(!oldEntry.pending){fastReads.delete(oldKey);break;}}}
 return next.promise;
}
function clearFastReads(...keys){
 if(!keys.length){fastReads.clear();return;}
 for(const key of keys)fastReads.delete(readScope(key));
}
function onceJob(key,work){
 const scoped=readScope(key);if(fastJobs.has(scoped))return fastJobs.get(scoped);
 const job=Promise.resolve().then(work).finally(()=>{if(fastJobs.get(scoped)===job)fastJobs.delete(scoped);});
 fastJobs.set(scoped,job);return job;
}
function debounce(fn,delay=100){let timer;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);};}
function bindFastButtons(root=document){
 root.querySelectorAll("button").forEach(button=>{
  const handler=button.onclick;
  if(!handler || handler._djFast || ["playBtn","prevBtn","nextBtn"].includes(button.id))return;
  const wrapped=function(event){
   if(button._djPending)return;
   const original=button.innerHTML,disabled=button.disabled;
   let result;
   try{result=handler.call(this,event);}catch(error){console.error(error);toast(error.message||"Unable to complete action","err");return;}
   if(!result || typeof result.then!=="function")return result;
   button._djPending=true;button.disabled=true;button.setAttribute("aria-busy","true");
   if(button.isConnected)button.textContent=button.dataset.busyLabel||"Please wait…";
   const restore=()=>{button._djPending=false;button.removeAttribute("aria-busy");if(button.isConnected){button.innerHTML=original;button.disabled=disabled;}};
   return Promise.resolve(result).then(value=>{restore();return value;},error=>{restore();console.error(error);toast(error.message||"Request failed. Please retry.","err");});
  };
  wrapped._djFast=true;button.onclick=wrapped;
 });
}

/* ============ UTILS ============ */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const pad = n => String(n).padStart(2, "0");

let _toastTimer;
function toast(msg, type="") {
  const t = $("toast"); t.textContent = msg; t.className = "toast show" + (type ? " " + type : "");
  clearTimeout(_toastTimer); _toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}
function modal(title, bodyHTML, buttons) {
  const m = $("modal");
  m.setAttribute("role","dialog");m.setAttribute("aria-modal","true");
  const btns = buttons || [{ label: "OK", cls: "btn-primary" }];
  const btnHtml = btns.map((b, i) => `<button class="btn ${b.cls || "btn-primary"}" data-idx="${i}">${b.label}</button>`).join("");
  m.innerHTML = `<div class="modal-card"><h3>${esc(title)}</h3><div>${bodyHTML}</div><div class="modal-actions">${btnHtml}</div></div>`;
  m.classList.add("show");
  m.querySelectorAll(".modal-actions button").forEach(btn => {
    btn.onclick = () => {
      m.classList.remove("show");
      const b = btns[+btn.dataset.idx];
      if (b && b.keepOpen) m.classList.add("show");
      if (b && b.onClick) return b.onClick();
    };
  });
  bindFastButtons(m);
}
function closeModal() { $("modal").classList.remove("show"); }

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : (ts.seconds||ts._seconds) ? new Date((ts.seconds||ts._seconds)*1000) : new Date(ts);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}
function daysLeft(ts) {
  if (!ts) return 0;
  const d = ts.toDate ? ts.toDate() : (ts.seconds||ts._seconds) ? new Date((ts.seconds||ts._seconds)*1000) : new Date(ts);
  return Math.max(0, Math.ceil((d - Date.now()) / 86400000));
}
function resolveUrl(url) {
  if (!url) return "";
  url = String(url).trim();
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("scene:") || url.startsWith("tts:")) return url;
  const gh = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  if (url.startsWith("//")) return "https:" + url;
  if (/^https?:\/\//.test(url)) return url;
  return REPO_BASE + url.replace(/^\/+/, "");
}
function sceneData(kind) {
  const sky = { rain:"#7f94a8", sun:"#6ec1f2", snow:"#c8d6e5", cloud:"#9fb3c4" }[kind] || "#6ec1f2";
  let x = kind === "sun" ? `<circle cx="300" cy="55" r="30" fill="#ffd23f"/>`
    : `<ellipse cx="110" cy="52" rx="55" ry="22" fill="#fff" opacity=".88"/><ellipse cx="255" cy="44" rx="60" ry="24" fill="#fff" opacity=".88"/>`;
  if (kind === "rain") for (let i = 0; i < 24; i++) x += `<line x1="${20+i*15}" y1="${90+(i*37)%60}" x2="${14+i*15}" y2="${110+(i*37)%60}" stroke="#d8ecff" stroke-width="2"/>`;
  if (kind === "snow") for (let i = 0; i < 22; i++) x += `<circle cx="${15+i*16}" cy="${95+(i*53)%90}" r="3" fill="#fff"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200"><rect width="360" height="200" fill="${sky}"/>${x}<rect y="165" width="360" height="35" fill="#5d8a4e"/><polygon points="170,165 215,95 260,165" fill="#c94536"/></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
const LOGO_SVG = `<svg viewBox="0 0 24 24"><path d="M12 4L20 19H4L12 4Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

/* ============ LOCALSTORAGE CACHES (new) ============ */
function saveProfileCache(uid, profile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ uid, profile, ts: Date.now() })); } catch {}
}
function loadProfileCache(uid) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || c.uid !== uid) return null;
    if (Date.now() - c.ts > PROFILE_TTL) return null;
    return c.profile;
  } catch { return null; }
}
function clearProfileCache() { try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {} }

function savePlansCache(plans) {
  try { localStorage.setItem(PLANS_CACHE_KEY, JSON.stringify({ ts: Date.now(), plans })); } catch {}
}
function loadPlansCache() {
  try {
    const raw = localStorage.getItem(PLANS_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || Date.now() - c.ts > PLANS_TTL) return null;
    return c.plans;
  } catch { return null; }
}

function readLocalAttempts(uid){try{return JSON.parse(localStorage.getItem("dj_attempt_history_"+uid)||"[]");}catch{return [];}}

function resultTime(result) {
  return membershipUntil(result.submittedAt) || 0;
}

function latestBySet(rows) {
  const sets = new Map();
  const seen = new Set();
  for (const row of [...rows].sort((a, b) => resultTime(b) - resultTime(a))) {
    const setIdx = Number(row.setIdx);
    if (!Number.isInteger(setIdx) || setIdx < 1 || setIdx > ALL_SET_IDS.length) continue;
    const id = row.attemptId || row.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const group = sets.get(setIdx);
    if (!group) sets.set(setIdx, { latest: row, legacy: row.attemptCount ? 0 : 1, count: row.attemptCount || 0 });
    else if (row.attemptCount) group.count = Math.max(group.count, row.attemptCount);
    else group.legacy++;
  }
  return [...sets.values()].map(({ latest, legacy, count }) => ({
    ...latest, attemptCount: Math.max(legacy, count)
  }));
}
function saveLocalAttempts(){if(!state.user)return;try{localStorage.setItem("dj_attempt_history_"+state.user.uid,JSON.stringify(state.results.map(resultWithoutQuestions)));}catch{toast("Browser storage is full; keep this result open until cloud saving completes.","warn");}}
function saveResultsCache(uid, results) {
  try { localStorage.setItem(`${RESULTS_CACHE_KEY}_${uid}`, JSON.stringify({ ts: Date.now(), results })); } catch {}
}
function loadResultsCache(uid) {
  try {
    const raw = localStorage.getItem(`${RESULTS_CACHE_KEY}_${uid}`);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || Date.now() - c.ts > RESULTS_TTL) return null;
    return c.results;
  } catch { return null; }
}
function invalidateResultsCache(uid) {
  try { localStorage.removeItem(`${RESULTS_CACHE_KEY}_${uid}`); } catch {}
}

/* ============ EXAM LOCK ============ */
function examLockKey(setIdx) { return `dj_exam_lock_${setIdx}`; }
function readExamLock(setIdx) {
  try { const raw = localStorage.getItem(examLockKey(setIdx)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function isExamLockedByOther(setIdx) {
  const lock = readExamLock(setIdx);
  if (!lock) return false;
  return lock.tab !== TAB_ID && (Date.now() - lock.ts) < 90000;
}
function acquireExamLock(setIdx) {
  try { localStorage.setItem(examLockKey(setIdx), JSON.stringify({ ts: Date.now(), tab: TAB_ID })); } catch {}
}
function refreshExamLock(setIdx) {
  try { localStorage.setItem(examLockKey(setIdx), JSON.stringify({ ts: Date.now(), tab: TAB_ID })); } catch {}
}
function releaseExamLock(setIdx) {
  try { const lock = readExamLock(setIdx); if (lock && lock.tab === TAB_ID) localStorage.removeItem(examLockKey(setIdx)); } catch {}
}

/* ============ HISTORY / ROUTER ============ */
/**
 * App-like history:
 *   - Home is at position 0 (seeded once)
 *   - Non-home screens at position 1 (push on leave-home, replace between non-home)
 *   - Back from any non-home → home (popstate)
 *   - Back from home → exits browser (native)
 *   - Exam back → intercepted → leave-modal → back again → home
 */
function initHistory() {
  const { screen, params } = parseHash();
  if (!screen || screen === "home" || screen === "login" || screen === "signup") {
    history.replaceState({ screen: "home", params: {} }, "", location.hash || "#/home");
  } else {
    history.replaceState({ screen: "home", params: {} }, "", "#/home");
    const search = new URLSearchParams(params).toString();
    const hash = "#/" + screen + (search ? "?" + search : "");
    history.pushState({ screen, params }, "", hash);
  }
  _lastHandledHash = location.hash;
}

function parseHash() {
  const raw = location.hash || "#/home";
  const [screen, qs] = raw.slice(2).split("?");
  const params = {};
  if (qs) new URLSearchParams(qs).forEach((v, k) => params[k] = v);
  return { screen: screen || "home", params };
}

function navigate(screen, params = {}) {
  const search = new URLSearchParams(params).toString();
  const hash = "#/" + screen + (search ? "?" + search : "");

  // Both home → no-op
  if (screen === "home" && state.screen === "home") {
    if (location.hash !== "#/home") history.replaceState({ screen: "home", params: {} }, "", "#/home");
    return;
  }

  // Non-home → home: use history.back() for clean exit-from-home next press
  if (screen === "home" && state.screen !== "home") {
    if (location.hash === hash) {
      // Already at #/home — just render
      state.screen = "home"; state.params = {};
      stopAudio(); render(); window.scrollTo(0, 0);
      return;
    }
    history.back();
    return;
  }

  // Home → non-home: push. Non-home → non-home: replace.
  if (state.screen === "home" || !state.screen) {
    history.pushState({ screen, params }, "", hash);
  } else {
    history.replaceState({ screen, params }, "", hash);
  }
  state.screen = screen;
  state.params = params;
  stopAudio();
  render();
  window.scrollTo(0, 0);
}

// Replace without affecting stack depth (used when clearing exam to leave)
function replaceNavigate(screen, params = {}) {
  const search = new URLSearchParams(params).toString();
  const hash = "#/" + screen + (search ? "?" + search : "");
  history.replaceState({ screen, params }, "", hash);
  state.screen = screen;
  state.params = params;
  stopAudio();
  render();
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", (e) => {
  // Exam interceptor
  if (state.screen === "exam" && state.exam && !state._confirmedLeave) {
    if (_backHandling) return;
    _backHandling = true;
    const search = new URLSearchParams(state.params || {}).toString();
    const hash = "#/exam" + (search ? "?" + search : "");
    history.pushState({ screen: "exam", params: state.params }, "", hash);
    _lastHandledHash = hash;
    askLeaveExam();
    setTimeout(() => { _backHandling = false; }, 400);
    return;
  }

  // Confirmed leave flow
  if (state._confirmedLeave) {
    state._confirmedLeave = false;
    const savedSetIdx = state.exam?.setIdx;
    state.exam = null;
    clearExamState();
    if (state._tick) { clearInterval(state._tick); state._tick = null; }
    if (state._lockTick) { clearInterval(state._lockTick); state._lockTick = null; }
    if (savedSetIdx !== undefined) releaseExamLock(savedSetIdx);
  }

  const { screen, params } = parseHash();
  state.screen = screen || "home";
  state.params = params;
  _lastHandledHash = location.hash;
  stopAudio();
  render();
});

// Defensive: handle typed-in URLs / external hash links
window.addEventListener("hashchange", () => {
  if (location.hash === _lastHandledHash) return;
  _lastHandledHash = location.hash;
  if (state.screen === "exam" && state.exam) {
    // Don't allow URL typing to silently leave an active exam
    const search = new URLSearchParams(state.params || {}).toString();
    const hash = "#/exam" + (search ? "?" + search : "");
    history.replaceState({ screen: "exam", params: state.params }, "", hash);
    _lastHandledHash = hash;
    return;
  }
  const { screen, params } = parseHash();
  if (screen === state.screen && JSON.stringify(params) === JSON.stringify(state.params)) return;
  state.screen = screen;
  state.params = params;
  stopAudio();
  render();
});

/* ============ AUTH ============ */
async function signInGoogle() {
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (["auth/popup-blocked","auth/popup-closed-by-user","auth/cancelled-popup-request",
         "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      try {
        sessionStorage.setItem(REDIRECT_AFTER_KEY, location.hash || "#/home");
        await signInWithRedirect(auth, provider);
      } catch (re) { toast(re.message, "err"); }
    } else { toast("Login failed: " + (e.code || e.message), "err"); }
  }
}
async function signInEmail(email, pass) {
  try { await signInWithEmailAndPassword(auth, email, pass); return true; }
  catch (e) {
    const map = {
      "auth/user-not-found":"No account with this email",
      "auth/wrong-password":"Incorrect password",
      "auth/invalid-email":"Invalid email",
      "auth/invalid-credential":"Invalid email or password"
    };
    toast(map[e.code] || "Login failed", "err");
    return false;
  }
}
async function signUpEmail(email,pass,name) {
 try {
  state._signupName=name;
  const cred=await createUserWithEmailAndPassword(auth,email,pass);
  await sendEmailVerification(cred.user);
  toast("Account created. Check your email to verify.","ok");return true;
 }catch(e){toast(e.message||"Signup failed","err");return false;}
}
async function resetPassword(email) {
  try { await sendPasswordResetEmail(auth, email); toast("Reset link sent", "ok"); }
  catch (e) { toast("Failed: " + e.message, "err"); }
}
async function logout() {
  clearFastReads();warmMedia.clear();
  if (state._lockTick) { clearInterval(state._lockTick); state._lockTick = null; }
  if (state._tick) { clearInterval(state._tick); state._tick = null; }
  stopAudio();
  clearProfileCache();clearExamState();clearResult();clearQCache();state.practice=null;
  if (state.user) invalidateResultsCache(state.user.uid);
  try { localStorage.removeItem(LAST_LOGIN_KEY); } catch {}
  await signOut(auth);
}

// FIX: throttle lastLogin writes to once per hour
async function touchLastLogin(uid) {
  try {
    const last = +localStorage.getItem(`${LAST_LOGIN_KEY}:${uid}`) || 0;
    if (Date.now() - last < 60 * 60 * 1000) return;
    await updateDoc(doc(db, "users", uid), { lastLogin: serverTimestamp() });
    localStorage.setItem(`${LAST_LOGIN_KEY}:${uid}`, String(Date.now()));
  } catch {}
}

async function createNewProfile(user) {
  const isAdmin = user.email === ADMIN_EMAIL;
  const profile = {
    name: state._signupName || user.displayName || (user.email || "").split("@")[0],
    email: user.email || "", photoURL: user.photoURL || "",
    emailVerified: !!user.emailVerified,
    role: "student", status: "active",
    practiceAccess: false, premium: null, bookmarks: [],
    streak: { count: 0, last: null }, bestScore: 0,
    createdAt: serverTimestamp(), lastLogin: serverTimestamp(), directoryStudent:!isAdmin
  };
  profile.searchGrams = studentGrams(profile);
  try {
    await setDoc(doc(db, "users", user.uid), profile);
    localStorage.setItem(`${LAST_LOGIN_KEY}:${user.uid}`, String(Date.now()));
  } catch (e) { throw e; }
  return { uid: user.uid, ...profile };
}

// NO cache → getDoc; has cache → return cache (background refresh handled elsewhere)
async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDocFromServer(ref);
    if (auth.currentUser?.uid !== user.uid) throw new Error("Please sign in again");
    if (snap.exists()) {
      const profile = { uid: user.uid, ...snap.data() };
      saveProfileCache(user.uid, profile);
      void touchLastLogin(user.uid); // background, throttled
      if (!("directoryStudent" in profile)) void updateDoc(ref,{directoryStudent:user.email!==ADMIN_EMAIL,searchGrams:studentGrams(profile)}).catch(console.warn);
      return profile;
    }
    const fresh = await createNewProfile(user);
    saveProfileCache(user.uid, fresh);
    return fresh;
  } catch (e) {
    // Offline or network error — fall back to cache if present
    const cached = loadProfileCache(user.uid);
    if (cached) return cached;
    throw e;
  }
}

/* ============ DATA ============ */
function normalizeRow(r) {
  if (!r) return null;
  if (Array.isArray(r)) r = {set:r[0],section:r[1],question:r[2],passage:r[3],image:r[4],audio:r[5],answer:r[6],A:r[7],B:r[8],C:r[9],D:r[10],marks:r[11]??null,explanation:r[12]??""};
  const clean = v => /^(NA|null|undefined)$/i.test(String(v).trim()) ? "" : String(v ?? "").trim();
  const row = {...r, id:clean(r.id),set:Number(r.set)||1,section:clean(r.section||"sv").toLowerCase()};
  for (const k of ["question","passage","image","audio","answer","A","B","C","D"]) row[k]=clean(r[k]);
  row.answer=(row.answer||"A").toUpperCase();
  if ("marks" in row) row.marks=clean(row.marks) || null;
  if ("explanation" in row) row.explanation=clean(row.explanation);
  if(row.image && !/^(https?:|data:|scene:|photos\/)/.test(row.image)) row.image="photos/"+row.image;
  if(row.audio && !/^(https?:|tts:|audio\/)/.test(row.audio)) row.audio="audio/"+row.audio;
  return row;
}

// NEW: localStorage instead of sessionStorage
function clearQCache() {
  questionCache.clear();
  clearFastReads("legacy-bank");
  try { localStorage.removeItem(CACHE_KEY); sessionStorage.removeItem("dj_q_cache_v4"); } catch {}
}

async function readLegacyBank() {
  return memoRead("legacy-bank", async () => {
    const snapshot = await getDocFromServer(doc(db, QUESTIONS_DOC));
    if (!snapshot.exists()) throw new Error("October–November question bank was not found");
    return rowList(snapshot.data());
  }, 0);
}

async function readSetRows(idx, {fresh = false, admin = false} = {}) {
  const uid = requireSession();
  const meta = setMeta(idx);
  if (!admin && (!visibleSet(idx) || !canUseSet(idx))) return [];
  if (meta.group === OCT && !catalog.legacySplit) {
    return (await readLegacyBank()).filter(row => row.set === idx);
  }
  if (!meta.version) return [];
  const key = `${uid}:${idx}:${meta.version}`;
  if (!fresh && questionCache.has(key)) return questionCache.get(key);
  return memoRead(`bank:${key}`, async () => {
    const snapshot = await getDocFromServer(bankRef(idx));
    const data = snapshot.data();
    if (!data || data.version !== meta.version) throw new Error("This set changed. Please try again.");
    if (state.user?.uid !== uid) throw new Error("Please sign in again");
    const rows = rowList(data);
    questionCache.set(key, rows);
    if (questionCache.size > 8) questionCache.delete(questionCache.keys().next().value);
    return rows;
  }, 0);
}

function examSet(idx, rows) {
  return buildSets(rows)[idx - 1];
}
function buildSets(rows) {
  const sets = ALL_SET_IDS.map(idx => ({
    ...setMeta(idx),
    sections: SECTIONS.map(s => ({
      key: s.key, name: s.name, short: s.short, marks: s.marks, count: 0, questions: [], icon: s.icon
    }))
  }));
  rows.forEach(r => {
    const row = normalizeRow(r);
    if (!row || row.set < 1 || row.set > 12) return;
    const set = sets[row.set - 1];
    const sec = set.sections.find(s => s.key === row.section);
    if (!sec) return;
    const ansIdx = Math.max(0, Math.min(3, row.answer.charCodeAt(0) - 65));
    sec.questions.push({
      id: row.id, set: row.set, section: row.section, q: row.question, p: row.passage || null,
      marks: Number(row.marks)>0&&Number(row.marks)<=250 ? Number(row.marks) : sec.marks,
      explanation: String(row.explanation || ""),
      img: row.image ? (row.image.startsWith("scene:") ? sceneData(row.image.slice(6)) : resolveUrl(row.image)) : null,
      au: row.audio || null,
      o: [row.A, row.B, row.C, row.D],
      a: ansIdx, sel: undefined, locked: false, played: 0
    });
  });
  sets.forEach(set => set.sections.forEach(section => {
    section.count = section.questions.length;
    section.questions.forEach((question,index) => {question.originalIndex=index;});
  }));
  return sets;
}

function resultRows(snapshot) {
  return snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }));
}

async function loadSetResult(uid,idx,knownMissing = false) {
  if (!defaultSets[idx]) return null;
  return memoRead(`latest:${idx}`, async () => {
    if (!knownMissing) {
      const direct = await getDoc(doc(db,"users",uid,"latestResults",setKey(idx)));
      if (direct.exists()) return {...direct.data(),id:direct.id};
    }
    if (groupFor(idx)!==OCT) return null;
    const oldResults = collection(db,"users",uid,"results");
    const selector = where("setIdx","==",idx);
    const latest = await getDocs(query(oldResults,selector,orderBy("submittedAt","desc"),limit(1)));
    if (latest.empty) return null;
    const count = await getCountFromServer(query(oldResults,selector));
    const row = latest.docs[0];
    return {...row.data(),id:row.id,attemptCount:count.data().count};
  },RESULTS_TTL);
}

async function loadResults(uid) {
  try {
    const cloud = resultRows(await getDocs(collection(db,"users",uid,"latestResults")));
    if (state.user?.uid !== uid) return [];
    const missing = groupSetIds(OCT).filter(idx => !cloud.some(row => row.setIdx===idx));
    if (missing.length) {
      const oldResults = collection(db,"users",uid,"results");
      const hasLegacy = await memoRead("has-legacy", () => getDocs(query(oldResults,limit(1))).then(snap => !snap.empty),RESULTS_TTL);
      if (hasLegacy) cloud.push(...(await Promise.all(missing.map(idx => loadSetResult(uid,idx,true)))).filter(Boolean));
    }
    const merged = latestBySet([...cloud,...readLocalAttempts(uid)]);
    saveResultsCache(uid,merged);
    return merged;
  } catch (error) {
    console.warn("Could not refresh result history",error);
    return latestBySet([...(loadResultsCache(uid)||[]),...readLocalAttempts(uid)]);
  }
}
async function loadPlans() {
  try {
    const snap = await getDocs(collection(db, "plans"));
    const plans = [];
    snap.forEach(d => plans.push({ id: d.id, ...d.data() }));
    plans.sort((a, b) => (a.price || 0) - (b.price || 0));
    savePlansCache(plans);
    return plans;
  } catch { return loadPlansCache() || []; }
}
async function loadPlansCached() {
  const cached = loadPlansCache();
  if (cached) return cached;
  return await loadPlans();
}
async function loadLeaderboard(group = OCT) {
 try {
  const snap = await memoRead(`leaderboard:${group}`, () => getDocs(query(
    collection(db, GROUPS[group].leaderboard), orderBy("averagePercentage", "desc"), limit(20)
  )), 30000);
  return snap.docs.map(d=>({uid:d.id,streak:0,...d.data()}));
 } catch(e) {toast("Leaderboard: "+e.message,"err"); return [];}
}
async function bumpStreak() {
  if (!state.user || !state.profile) return;
  const streak = state.profile.streak || { count: 0, last: null };
  const last = streak.last ? new Date(streak.last) : null;
  const now = new Date();
  let newCount = streak.count || 0;
  if (!last) newCount = 1;
  else {
    const diff = Math.floor((now - last) / 86400000);
    if (diff === 0) return;
    newCount = diff === 1 ? newCount + 1 : 1;
  }
  try {
    await updateDoc(doc(db, "users", state.user.uid), { streak: { count: newCount, last: now.toISOString() } });
    if (state.profile) state.profile.streak = { count: newCount, last: now.toISOString() };
    saveProfileCache(state.user.uid, state.profile);
  } catch {}
}
async function requestAccess() { navigate("premium"); }
async function requestPremium(planId) { return openPayment(planId); }
async function toggleBookmark(setIdx, secKey, qi) {
  if (!state.user) return;
  const p = state.profile || {};
  const bms = [...(p.bookmarks || [])];
  const activeExam = state.practice || state.exam;
  const qid = activeExam?.sections[activeExam.si]?.questions[activeExam.qi]?.id;
  const idx = bms.findIndex(b => qid&&b.id ? b.id===qid && b.set===setIdx : b.set === setIdx && b.section === secKey && b.qi === qi);
  if (idx >= 0) bms.splice(idx, 1);
  else bms.push({ id:qid||"", set: setIdx, section: secKey, qi, addedAt: Date.now() });
  try {
    await updateDoc(doc(db, "users", state.user.uid), { bookmarks: bms });
    state.profile.bookmarks = bms;
    saveProfileCache(state.user.uid, state.profile);
    loadedViews.delete(`${state.user.uid}:bookmarks`);
    toast(idx >= 0 ? "Bookmark removed" : "Bookmarked ", "ok");
  } catch (e) { toast("Failed: " + e.message, "err"); }
}

/* ============ EXAM STATE PERSIST ============ */
function saveExamState(ex) {
 if(!ex || !state.user)return;
 try{
  const owner=`${state.user.uid}:${ex.attemptId||ex.startedAt}`;
  if(savedSnapshotFor!==owner){
   sessionStorage.setItem(EXAM_SNAPSHOT_KEY,JSON.stringify({owner,set:ex.set}));savedSnapshotFor=owner;
  }
  sessionStorage.setItem(EXAM_STATE_KEY,JSON.stringify({uid:state.user.uid,attemptId:ex.attemptId,setIdx:ex.setIdx,startedAt:ex.startedAt,si:ex.si,qi:ex.qi,left:ex.left,maxReachable:ex.maxReachable,
   answers:ex.sections.map(s=>s.questions.map(q=>q.sel??null)),
   played:ex.sections.map(s=>s.questions.map(q=>q.played||0)),
   locked:ex.sections.map(s=>s.questions.map(q=>!!q.locked))}));
 }catch{}
}
function loadExamState(){
 try{
  const raw=sessionStorage.getItem(EXAM_STATE_KEY);if(!raw)return null;
  const saved=JSON.parse(raw);
  if(!saved.snapshot){const snapshot=JSON.parse(sessionStorage.getItem(EXAM_SNAPSHOT_KEY)||"null");if(snapshot?.owner===`${saved.uid}:${saved.attemptId||saved.startedAt}`)saved.snapshot=snapshot.set;}
  return saved;
 }catch{return null;}
}
function clearExamState() { savedSnapshotFor="";try {sessionStorage.removeItem(EXAM_STATE_KEY);sessionStorage.removeItem(EXAM_SNAPSHOT_KEY);}catch{} }
function saveResult(res) { try { sessionStorage.setItem(RESULT_KEY, JSON.stringify({...res,ownerUid:state.user?.uid})); } catch {} }
function loadResult() {
  try { const raw=sessionStorage.getItem(RESULT_KEY);
    const result=raw ? JSON.parse(raw) : null;
    return result?.ownerUid===state.user?.uid ? result : null; } catch { return null; }
}
function clearResult() { try { sessionStorage.removeItem(RESULT_KEY); } catch {} }

/* ============ RENDER ============ */
function render() {
  const root = $("app");
  const s = state.screen;
  let html = "";

  if (state.user && ["practice","past-sets"].includes(s) && !hasPremium()) {
    html=renderPremium();
  } else if (!state.user) {
    if (s === "signup") html = renderSignup();
    else html = renderLogin();
  } else if (s === "loading") html = renderLoading();
  else if (s === "login" || s === "signup" || s === "home") html = renderHomeScreen();
  else if (s === "sets") html = renderSets();
  else if (s === "past-sets") html = renderPastSets();
  else if (s === "start") html = renderStart();
  else if (s === "exam") html = renderExam();
  else if (s === "result") html = renderResult();
  else if (s === "review") html = renderReview();
  else if (s === "profile") html = renderProfile();
  else if (s === "premium") html = renderPremium();
  else if (s === "practice") html = renderPractice();
  else if (s === "bookmarks") html = renderBookmarks();
  else if (s === "leaderboard") html = renderLeaderboard();
  else if (s === "admin") html = state.isAdmin ? renderAdmin() : renderHomeScreen();
  else html = renderHomeScreen();

  root.innerHTML = html;
  postRender();bindMedia();updateInstallBanner();bindFastButtons(root);bindAddedFeatures();updateRenewalNotice();
  void loadRouteData();
}

function topbarHTML() {
  if (!state.user) return "";
  const p = state.profile || {};
  const initial = (p.name || state.user.email || "U")[0].toUpperCase();
  const avatar = p.photoURL
    ? `<img src="${esc(p.photoURL)}" class="avatar" alt="" loading="lazy">`
    : `<div class="avatar">${initial}</div>`;
  return `<div class="topbar"><div class="topbar-inner">
    <div class="logo" data-go="home">${LOGO_SVG}</div>
    <div class="brand" data-go="home"><h1>Dream Japan</h1><p>JFT MOCK TEST</p></div>
    <button class="user-btn" data-go="profile">${avatar}
      <span>${esc(p.name || state.user.email)}</span></button>${state.isAdmin?`<button class="btn btn-ghost btn-sm" id="pendingAdminButton">Requests <b id="pendingAdminCount">${state._pendingCount||0}</b></button>`:""}
  </div></div>`;
}
function bottomNavHTML(active) {
  if (!state.user) return "";
  const items = [
    { key:"home", icon:"", label:"Home" },
    { key:"sets", icon:"", label:"Tests" },
    { key:"premium", icon:"", label:"Premium" },
    { key:"profile", icon:"", label:"Profile" }
  ];
  return `<nav class="bottom-nav"><div class="bnav-inner">${items.map(it => `
    <button class="bnav-item ${active === it.key ? "on" : ""}" data-nav="${it.key}">
      <span class="ic">${navIcon(it.key)}</span><span>${it.label}</span>
    </button>`).join("")}</div></nav>`;
}

function renderLoading() {
  return `<div class="loading-screen"><div class="spinner"></div><p class="muted">Loading Dream Japan…</p></div>`;
}

function renderLogin() {
  return `<div class="login-wrap"><div class="login-card">
    <div class="login-logo">${LOGO_SVG}</div>
    <h2>Dream Japan</h2>
    <p class="sub">Sign in to access JFT-BASIC mock tests</p>
    <button class="gbtn" id="gLogin">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Continue with Google
    </button>
    <div class="divider">or</div>
    <div class="field"><label>Email</label><input type="email" id="loginEmail" class="input" placeholder="you@example.com"></div>
    <div class="field"><label>Password</label><input type="password" id="loginPass" class="input" placeholder="••••••••"></div>
    <button class="btn btn-primary btn-block mt-2" id="emailLogin">Sign In</button>
    <div class="login-link"><a id="forgotLink">Forgot password?</a> · <a id="signupLink">Create account</a></div>
  </div></div>`;
}

function renderSignup() {
  return `<div class="login-wrap"><div class="login-card">
    <div class="login-logo">${LOGO_SVG}</div>
    <h2>Create Account</h2>
    <p class="sub">Join Dream Japan and start practising</p>
    <div class="field"><label>Name</label><input type="text" id="signName" class="input" placeholder="Your name"></div>
    <div class="field"><label>Email</label><input type="email" id="signEmail" class="input" placeholder="you@example.com"></div>
    <div class="field"><label>Password</label><input type="password" id="signPass" class="input" placeholder="6+ characters"></div>
    <div class="field"><label>Confirm Password</label><input type="password" id="signPass2" class="input" placeholder="Re-enter"></div>
    <button class="btn btn-primary btn-block mt-2" id="emailSignup">Create Account</button>
    <div class="login-link">Already have an account? <a id="backLogin">Sign in</a></div>
  </div></div>`;
}

function homeIcon(key) {
  const paths = {
    arrow:'M5 12h14m-6-6 6 6-6 6',
    book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h4v15h-4a4 4 0 0 0-3 2',
    chart:'M4 19h16M7 15v-4m5 4V5m5 10V8',
    bookmark:'M6 3h12v18l-6-4-6 4V3Z',
    trophy:'M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v6m-4 2h8',
    crown:'m3 6 5 5 4-7 4 7 5-5-2 14H5L3 6Z',
    calendar:'M5 5h14v16H5V5Zm3-3v6m8-6v6M5 11h14m-10 4h2',
    layers:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
    sparkle:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z',
    check:'m5 12 4 4L19 6'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key]||paths.arrow}"/></svg>`;
}
function renderHomeScreen() {
  const p = state.profile || {};
  const results = latestBySet(state.results || []);
  const attempts = results.reduce((sum, row) => sum + (row.attemptCount || 1), 0);
  const best = results.length ? Math.max(...results.map(r => Number(r.percentage) || 0)) : null;
  const active = !!(p.premium && daysLeft(p.premium.expiry) > 0);
  const hasAccess = active || state.isAdmin;
  const streak = Number(p.streak?.count) || 0;
  return `<div class="home-shell">${topbarHTML()}<main class="home-main">
    <header class="home-intro"><div><p class="home-kicker">JFT-BASIC</p><h2>Let’s <span>practise.</span></h2></div><span class="home-member ${hasAccess ? "is-premium" : ""}">${homeIcon(hasAccess ? "crown" : "book")}${state.isAdmin ? "Admin access" : active ? "Premium member" : "Student account"}</span></header>
    <section class="home-quick-stats" aria-label="Your practice overview"><div><span class="home-stat-icon">${homeIcon("layers")}</span><p><strong>${results.length}<small> / ${ALL_SET_IDS.length}</small></strong><span>Sets completed</span></p></div><div><span class="home-stat-icon">${homeIcon("book")}</span><p><strong>${attempts}</strong><span>Total attempts</span></p></div><div><span class="home-stat-icon">${homeIcon("trophy")}</span><p><strong>${best === null ? "—" : best + "%"}</strong><span>Best score</span></p></div></section>
    <section class="home-tests" aria-labelledby="homeTestsTitle"><div class="home-section-title"><div><h3 id="homeTestsTitle">Mock tests</h3></div></div><div class="home-collections">
      <button type="button" class="home-series-button" id="upcomingMockButton"><span class="home-collection-icon">${homeIcon("calendar")}</span><span class="home-collection-copy"><strong>December – January Mock Test</strong></span><span class="home-collection-end">${seriesStatus(DEC)}<span class="home-collection-arrow">${homeIcon("arrow")}</span></span></button>
      <button type="button" class="home-series-button" data-go="sets"><span class="home-collection-icon">${homeIcon("book")}</span><span class="home-collection-copy"><strong>October – November Mock Test</strong></span><span class="home-collection-end">${seriesStatus(OCT)}<span class="home-collection-arrow">${homeIcon("arrow")}</span></span></button>
      <button type="button" class="home-series-button" data-go="past-sets"><span class="home-collection-icon">${homeIcon("layers")}</span><span class="home-collection-copy"><strong>Past Mock Tests</strong></span><span class="home-collection-end"><span class="home-status home-status-library">Explore sets</span><span class="home-collection-arrow">${homeIcon("arrow")}</span></span></button>
    </div></section>
    <section class="home-progress-cta" aria-labelledby="homeProgressTitle"><div class="home-progress-mark">${homeIcon("chart")}</div><div class="home-progress-copy"><h3 id="homeProgressTitle">Your progress</h3><p>Results, weak areas &amp; tips.</p></div><button type="button" class="home-progress-button" id="homeProgressButton">View progress${homeIcon("arrow")}</button></section>
    <section class="home-toolkit" aria-labelledby="homeToolkitTitle"><div class="home-section-title"><div><h3 id="homeToolkitTitle">Quick access</h3></div>${streak > 0 ? `<span class="home-streak">${streak}-day streak</span>` : ""}</div><div class="home-tools-grid">${[
      ["practice","book","Quick practice","Focus on one skill"],
      ["bookmarks","bookmark","Bookmarks",`${(p.bookmarks || []).length} saved questions`],
      ["leaderboard","trophy","Leaderboard","See how you compare"],
      ["premium","crown","Premium",active ? `${daysLeft(p.premium.expiry)} days remaining` : "Explore premium plans"]
    ].map(([go,icon,title,description])=>`<button type="button" class="home-tool" data-go="${go}"><span class="home-tool-icon">${homeIcon(icon)}</span><span class="home-tool-copy"><strong>${title}</strong><span>${description}</span></span><span class="home-tool-arrow">${homeIcon("arrow")}</span></button>`).join("")}</div></section>
    ${!hasAccess ? `<aside class="home-access"><span class="home-access-icon">${homeIcon("crown")}</span><div><h3>Unlock Premium</h3><p>All mock tests &amp; practice.</p></div><div class="home-access-actions"><button type="button" class="btn btn-prem btn-sm" data-go="premium">View plans${homeIcon("arrow")}</button><button type="button" class="home-text-button" id="reqAccessBtn">Request access</button></div></aside>` : ""}

  </main>${bottomNavHTML("home")}</div>`;
}


/* Previous Google Forms: separate from the premium Firestore question bank. */
const PAST_SETS = [
  [1,"KOUEN","https://forms.gle/84UAEy8fbNk2L4F38"],
  [2,"TOIRE","https://forms.gle/oGivZzEUkubeyX4TA"],
  [3,"CHICHI","https://forms.gle/GdpnBd9xjJmskvFa6"],
  [4,"BASU","https://forms.gle/fxeDNxuMP4Npuy7YA"],
  [5,"JITENSHA","https://forms.gle/T8B7xjDQLx78tdjV8"],
  [6,"TANA","https://forms.gle/j8wn5T7soFx6nhmt8"],
  [7,"KAGI","https://forms.gle/MCxEogDjeP35Wbqu9"],
  [10,"SARADA","https://forms.gle/6AXNWdoCakJ6dUiN8"],
  [11,"BASU","https://forms.gle/EtRoXF9wNcBYWTLG6"],
  [12,"CHICHI","https://forms.gle/QS72Eu13JQvZPhdm9"]
];
function renderPastSets() {
  if(!hasPremium()){setTimeout(()=>navigate("premium"),0);return renderPremium();}
  return `${topbarHTML()}<main class="wrap past-page">
    <button class="past-back" data-go="home" type="button">← &nbsp; Back to Home</button>
    <section class="past-hero"><div class="past-hero-glow"></div>
      <span class="past-eyebrow">DREAM JAPAN · JFT-BASIC</span>
      <h2>Past Mock<br>Test Sets<span class="past-dot">.</span></h2>
      <p>Practice previous JFT mock tests and build your confidence for exam day.</p>
      <div class="past-hero-footer"><span><b>${PAST_SETS.length}</b> Available Sets</span><span>Practice Collection ↗</span></div>
    </section>
    <section class="past-password" aria-label="Google Form password">
      <div class="past-password-heading"><span class="past-lock">⌑</span><div><strong>Google Form Password</strong><p>If a form asks for a password, use this one.</p></div></div>
      <div class="past-password-value"><code>myreservasi</code><button id="copyPastPassword" type="button">Copy Password</button></div>
    </section>
    <div class="past-section-heading"><div><span>YOUR PRACTICE LIBRARY</span><h3>Choose a Set</h3></div><span class="past-count">${PAST_SETS.length} Sets</span></div>
    <div class="past-grid">${PAST_SETS.map(([num,name,url],i)=>`<a class="past-set" href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="--past-i:${i%6}"><span class="past-set-top"><span class="past-set-number">SET ${String(num).padStart(2,'0')}</span><span class="past-external">↗</span></span><strong>${esc(name)}</strong><span class="past-set-foot">Start Practice <span>→</span></span></a>`).join("")}</div>
    <p class="past-note">Sets 8 and 9 are not available yet. Google Forms open in a new tab.</p>
  </main>${bottomNavHTML("home")}`;
}

function renderSets() {
  const group = studentGroup();
  return `${topbarHTML()}<div class="wrap" style="padding-top:16px;padding-bottom:80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
    <h2 class="mb-2">${GROUPS[group].label} Mock Tests</h2>
    <div class="field"><label for="mockGroup">Mock test group</label><select id="mockGroup" class="input">${groupOptions(group)}</select></div>
    ${groupSets(group).map(set => `
      <button type="button" class="set-card mock-set-card" data-set="${set.idx-1}">
        <span class="set-kana">${set.kana}</span>
        <span class="set-info">
          <small>SET ${set.number}</small><strong>${esc(set.name)}</strong>
          <em>${set.questionCount == null ? "" : `${set.questionCount} questions · `}${set.duration} min</em>
        </span>
        ${set.isPublished ? `<span class="badge ${set.access === "free" ? "badge-success" : "badge-prem"}">${set.access === "free" ? "Free" : "Premium"}</span>` : '<span class="badge badge-info">Coming Soon</span>'}
      </button>`).join("")}
  </div>${bottomNavHTML("sets")}`;
}
function passageHTML(value){
 const template=document.createElement("template");template.innerHTML=String(value||"");
 const tags=new Set("P BR DIV SPAN B STRONG I EM U S MARK SMALL SUB SUP RUBY RT RP UL OL LI BLOCKQUOTE TABLE THEAD TBODY TR TH TD H3 H4 FONT".split(" "));
 const properties=new Set(["color","background-color","font-weight","font-style","text-decoration","text-decoration-line","text-align","font-size"]);
 function clean(parent){for(const node of [...parent.childNodes]){
  if(node.nodeType===8){node.remove();continue;}if(node.nodeType!==1)continue;
  if(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","SVG","MATH","TEMPLATE"].includes(node.tagName)){node.remove();continue;}
  clean(node);
  if(!tags.has(node.tagName)){node.replaceWith(...node.childNodes);continue;}
  const styles=[];for(const property of properties){const v=node.style.getPropertyValue(property);if(v && !/url|expression|var\(/i.test(v) && (property!=="font-size" || /^(?:\d{1,2}(?:\.\d+)?(?:px|pt)|[12](?:\.\d+)?em|small|medium|large)$/.test(v)))styles.push([property,v]);}
  const color=node.tagName==="FONT"?node.getAttribute("color"):null;
  for(const a of [...node.attributes])node.removeAttribute(a.name);
  for(const [property,v] of styles)node.style.setProperty(property,v);
  if(color && CSS.supports("color",color))node.style.color=color;
 }}clean(template.content);return template.innerHTML;
}
function questionActions(){return `<div class="question-actions"><button type="button" class="question-tool" data-report>⚑ Report</button><button type="button" class="question-tool" data-bookmark="current">Bookmark</button></div>`;}
function showPreparing(title,detail){modal(title,`<div class="preparing-panel" role="status" aria-live="polite"><div class="prep-orbit"><span>DJ</span></div><p>${esc(detail)}</p><div class="prep-track"><i></i></div><small>Please wait a moment</small></div>`,[]);}
function sectionPercent(section){const items=section.items||[];return items.length?Math.round(items.filter(it=>it.yourAns!=null&&it.yourAns===it.correctAns).length/items.length*100):0;}

function attemptHistory(set) {
  const latest = state.results.find(row => Number(row.setIdx) === set.idx);
  if (!latest) return "";
  const count = latest.attemptCount || 1;
  return `<button type="button" class="latest-attempt" data-attempt="${esc(latest.attemptId || latest.id)}">
    <span class="latest-attempt-icon">${actionIcon("history")}</span>
    <span class="latest-attempt-copy"><strong>Latest attempt</strong>
      <small>${Math.round(latest.score)} / ${latest.maxScore || 250} · ${latest.percentage}% · ${fmtDate(latest.submittedAt)}</small></span>
    <span class="latest-attempt-count">${count} ${count === 1 ? "attempt" : "attempts"}</span>
    <span aria-hidden="true" class="action-chevron">›</span>
  </button>`;
}
function renderStart() {
const idx = Number(state.params.set || 0) + 1;
  if (!defaultSets[idx]) return renderSets();
  const set = setMeta(idx);
  if (!set.isPublished) return `${topbarHTML()}<main class="wrap page-space"><div class="card"><h2>Coming Soon!</h2><p>This mock test will be available soon. Please stay tuned.</p><button class="btn btn-ghost mt-2" id="backToGroup">Back to Sets</button></div></main>`;
  const hasAccess = canUseSet(idx);
  if (!hasAccess) {
    return `${topbarHTML()}<div class="wrap" style="padding-top:16px">
      <button class="btn btn-ghost btn-sm mb-2" id="backToGroup">← Back</button>
      <div class="card center">
        <div style="font-size:48px;margin-bottom:12px"></div>
        <h2>Access Required</h2>
        <p class="muted mt-1 mb-3">Premium is needed to start exams.</p>
        <button class="btn btn-primary btn-block mb-1" data-go="premium">View Plans</button>
        
      </div>
    </div>`;
  }

  return `${topbarHTML()}<div class="wrap" style="padding-top:16px;padding-bottom:40px">
    <button class="btn btn-ghost btn-sm mb-2" id="backToGroup">← Back</button>
    <div class="card card-lg exam-start-card">
      <div class="exam-set-symbol" style="width:70px;height:70px;border-radius:50%;background:var(--grad);color:#fff;
        display:grid;place-items:center;font-size:32px;font-weight:800;margin:0 auto 16px">${set.kana}</div>
      <h2 class="center">${esc(set.name)}</h2>
      <p class="center muted mt-1" style="font-size:11px;letter-spacing:1.2px;font-weight:800;color:var(--purple)">JFT-BASIC PRACTICE MOCK TEST</p>
      <div class="grid-2 mt-3 mb-3 exam-start-metrics">
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${set.questionCount ?? "—"}</div><div class="muted small">Questions</div></div>
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${set.totalMarks}</div><div class="muted small">Total Marks</div></div>
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${set.duration}</div><div class="muted small">Minutes</div></div>
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${set.passMarks}</div><div class="muted small">Pass Mark</div></div>
      </div>
      ${attemptHistory(set)}
      <details class="exam-rules"><summary>Exam rules</summary>
      <ol class="muted" style="padding-left:18px;font-size:12.5px;line-height:1.7">
        <li>Once you finish a section you cannot return to it</li>
        <li>Timer auto-submits the exam at 00:00</li>
        <li>Answer each question before moving forward</li>
        <li>Audio can be replayed ${MAX_PLAYS} times per question</li>
        <li>Pass mark: ${set.passMarks} / ${set.totalMarks}</li>
        <li>Your progress is saved if you refresh the page</li>
      </ol></details>
      <label class="flex" style="background:var(--bg);padding:12px;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="agree" style="width:18px;height:18px;accent-color:var(--purple)">
        <span style="font-size:12.5px;font-weight:600">I understand the rules and am ready</span>
      </label>
      <button class="btn btn-primary btn-block mt-2" id="startBtn" disabled>${state.results.some(r=>Number(r.setIdx)===set.idx)?"RETAKE EXAM":"START EXAM"}</button>
    </div>
  </div>`;
}

function renderExam() {
  if (!state.exam) {
    const saved = loadExamState();
    if (saved) {
      setTimeout(() => resumeExamFromSaved(saved), 0);
      return renderLoading();
    }
    setTimeout(() => replaceNavigate("sets"), 10);
    return renderLoading();
  }
  const ex = state.exam;
  const sec = ex.sections[ex.si];
  const q = sec.questions[ex.qi];
  const isLastQ = ex.qi === sec.questions.length - 1;
  const isLastSec = ex.si === ex.sections.length - 1;
  const nextLabel = isLastQ ? (isLastSec ? "Submit Exam " : "Finish Section →") : "Next →";

  const mediaHTML = mediaMarkup(q);

  const optsHTML = q.o.slice(0, q.o[3] ? 4 : 3).map((t, i) => `
    <button class="opt ${q.sel === i ? "sel" : ""}" data-opt="${i}" aria-pressed="${q.sel===i}">
      <div class="opt-ltr">${"ABCD"[i]}</div>
      <div class="opt-tx">${esc(t)}</div>
    </button>`).join("");

  return `<div class="exam-bar"><div class="exam-bar-inner">
    <button class="xback" id="leaveBtn" aria-label="Leave test"></button>
    <div class="exam-info">
      <b>Set ${ex.set.number} · ${esc(ex.set.name)}</b>
      <span>Section ${ex.si + 1} of ${ex.sections.length} — ${esc(sec.name)}</span>
    </div>
    <div class="timer ${ex.left <= 600 ? "low" : ""}" id="timerDisplay">
   <span>${pad(Math.floor(Math.ceil(ex.left) / 60))}:${pad(Math.ceil(ex.left) % 60)}</span></div>
  </div></div>
  <div class="wrap" style="padding-bottom:40px">
    <div class="steps">${ex.sections.map((s, i) =>
      `<div class="step ${i === ex.si ? "cur" : i < ex.si ? "done" : ""}">${s.short}</div>`).join("")}</div>
    <div class="progress-bar"><i id="progressFill" style="width:${(ex.answeredCount / sec.questions.length) * 100}%"></i></div>
    <div class="palette">${sec.questions.map((qq, i) => {
      const disabled = i > ex.maxReachable || qq.locked;
      return `<button class="pal-btn ${qq.sel !== undefined ? "ans" : ""} ${i === ex.qi ? "cur" : ""}"
        ${disabled ? "disabled" : ""} data-jump="${i}">${i + 1}</button>`;
    }).join("")}</div>
    <div class="q-card">
      <div class="q-meta">
        <span class="q-num">Q ${ex.qi + 1} of ${sec.questions.length}</span>
        <span class="q-tag">${esc(sec.short)}</span>
      </div>
      <div class="q-text">${esc(q.q)}</div>
      ${q.p ? `<div class="passage">${passageHTML(q.p)}</div>` : ""}
      ${mediaHTML}
      <div class="opts" id="opts">${optsHTML}</div>${questionActions()}
    </div>
    <div class="exam-nav">
      <button class="btn btn-ghost" id="prevBtn" ${ex.qi === 0 ? "disabled" : ""}>← Previous</button>
      <button class="btn btn-primary" id="nextBtn" ${q.sel === undefined ? "disabled" : ""}>${nextLabel}</button>
    </div>
  </div>`;
}

function renderResult() {
  const r = loadResult();
  if (!r) return renderHomeScreen();
  const target = r.passMarks ?? 200;
  const maximum = r.maxScore || 250;
  const pass = r.score >= target;
  const pct = r.percentage;
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 40px">
    <div class="result-card">
      ${r.cloudSaved===false?`<p class="muted small">Saved on this browser. Cloud saving is pending.</p><button id="retryCloud" class="btn btn-ghost btn-sm">Retry cloud save</button>`:""}
      <div class="result-badge ${pass ? "pass" : "fail"}">${pass ? "PASSED" : "NOT PASSED"}</div>
      <span class="muted" style="font-size:11px;letter-spacing:1.2px;font-weight:800">SET ${setNumber(r.setIdx)} · ${esc(r.setName)}</span>
      <div class="ring mt-2">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle class="bg" cx="80" cy="80" r="68"/>
          <circle class="fg" id="resultRing" cx="80" cy="80" r="68" stroke-dasharray="427.3" stroke-dashoffset="427.3"
            stroke="${pass ? "var(--green)" : "var(--red)"}"/>
        </svg>
        <div><b>${Math.round(r.score)}</b><span>/ ${r.maxScore}</span></div>
      </div>
      <div class="grade-text">${pass ? (pct >= 95 ? " Outstanding!" : " Passed — well done!") : ` Need ${Math.max(0,target - Math.round(r.score))} more marks to pass`}</div>
      <div class="result-stats">
        <div><h4>Correct</h4><p class="g">${r.correct}</p></div>
        <div><h4>Wrong</h4><p class="r">${r.wrong}</p></div>
        <div><h4>Skipped</h4><p>${r.unanswered}</p></div>
        <div><h4>Percent</h4><p>${pct}%</p></div>
        <div><h4>Time used</h4><p>${audioClock(r.timeUsed)}</p></div>
        <div><h4>Attempts</h4><p>${r.attemptCount || 1}</p></div>
      </div>
    </div>
    <section class="card jft-result mt-2">
      <div class="jft-heading"><div><small>総合得点 · Total Score</small><strong>${Math.round(r.score)} <small>/ ${maximum}</small></strong></div><div><small>判定結果 · Assessment</small><strong>${pass?"A2 practice target":"Below A2 practice target"}</strong></div></div>
      <p class="muted small">Dream Japan practice estimate · Target: ${target}/${maximum}</p>
      <div class="jft-score-track"><i style="left:${Math.min(100,Math.max(0,r.score/maximum*100))}%"><span>${Math.round(r.score)}</span></i><b class="jft-target" style="left:${target/maximum*100}%"></b></div><div class="flex-between small"><span>0</span><span>${target} target</span><span>${maximum}</span></div>
      <h3 class="mt-3">セクション毎の正答率</h3><p class="muted small">The percentage of correct answers for each section</p>
      ${r.sections.map(s=>`<div class="jft-section"><span>${esc(s.name)}</span><div class="section-track"><i style="left:${sectionPercent(s)}%"><b>${sectionPercent(s)}%</b></i></div></div>`).join("")}
      <p class="muted small mt-2">Practice results are calculated from this mock test. They are not an official JFT scaled score or certification.</p>
    </section>
    <div class="grid-2 mt-2">
      <button class="btn btn-ghost" data-review="all">All Answers</button>
      <button class="btn btn-ghost" data-review="wrong">Wrong Only</button>
    </div>
    <button class="btn btn-teal btn-block mt-1" id="shareBtn"> Share Result</button>
    <button class="btn btn-primary btn-block mt-1" id="retryBtn">Try Again</button>
    <button class="btn btn-ghost btn-block mt-1" data-go="sets">Back to Sets</button>
  </div>`;
}

async function openResultReview(filter) {
  const result = loadResult();
  if (!result) return;
  const uid = requireSession();
  try {
    if (!await ensureSetAccess(result.setIdx)) return;
    if (!result.sections?.some(section => section.items?.some(item => typeof item.q === "string")) && result.savedAt) {
      const snap = await memoRead(`review:${result.attemptId}`, () =>
        getDocFromServer(doc(db,"users",uid,"resultReviews",setKey(result.setIdx))), 30000);
      if (snap.data()?.attemptId === result.attemptId) result.sections = snap.data().sections;
    }
    if (state.user?.uid !== uid) return;
    if (!result.sections?.some(section => section.items?.some(item => typeof item.q === "string"))) {
      return toast("Detailed answers are unavailable for this attempt.", "warn");
    }
    saveResult(result);
    state.reviewAllowed = result.attemptId;
    navigate("review",{filter});
  } catch (error) {toast(error.message,"err");}
}

function renderReview() {
  const r = loadResult();
  const filter = state.params.filter || "all";
  if (!r) return renderHomeScreen();
  if (state.reviewAllowed !== r.attemptId) return renderResult();
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 40px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="result">← Back</button>
    <div class="flex-between mb-2">
      <h2>Answer Review</h2>
      <div class="flex" style="gap:6px">
        <button class="btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}" data-review="all">All</button>
        <button class="btn btn-sm ${filter === "correct" ? "btn-primary" : "btn-ghost"}" data-review="correct">Right</button>
        <button class="btn btn-sm ${filter === "wrong" ? "btn-primary" : "btn-ghost"}" data-review="wrong">Wrong</button>
      </div>
    </div>
    ${r.sections.map(s => {
      const items = (s.items || []).filter(it => filter === "all" || (filter === "correct" ? it.yourAns != null && it.yourAns === it.correctAns : it.yourAns !== it.correctAns));
      if (!items.length) return "";
      return `<h3 class="mt-2 mb-1" style="color:var(--purple);font-size:12px;letter-spacing:.8px;text-transform:uppercase">${esc(s.name)}</h3>
        ${items.map(it => `
          <div class="card q-card mb-1" style="border-left:4px solid ${it.yourAns === it.correctAns ? "var(--green)" : "var(--red)"}">
            <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:6px">Q${it.idx + 1}${it.yourAns == null ? " · not answered" : ""}</div>
            <div class="q-text">${esc(it.q)}</div>${it.p ? `<div class="passage">${passageHTML(it.p)}</div>` : ""}
            ${it.img ? `<img src="${esc(it.img)}" loading="lazy" style="width:100%;border-radius:10px;margin-bottom:8px" onerror="this.style.display='none'">` : ""}
            ${it.au && !it.au.startsWith("tts:") ? `<audio controls preload="none" src="${esc(resolveUrl(it.au))}"></audio>` : ""}
            
            ${(it.o || []).map((txt, i) => {
              if (i === 3 && !txt) return "";
              const isC = i === it.correctAns, isY = i === it.yourAns;
              const style = isC ? "background:#d1fae5;border-color:var(--green)" : (isY && !isC ? "background:#fee2e2;border-color:var(--red)" : "");
              return `<div style="padding:9px 11px;border:1px solid var(--border);border-radius:9px;margin-top:6px;font-size:12.5px;${style}">
                ${"ABCD"[i]}. ${esc(txt)} ${isC ? " Correct" : ""} ${isY && !isC ? " Your answer" : ""}</div>`;
            }).join("")}
            ${it.explanation ? `<p class="muted small mt-2">${esc(it.explanation)}</p>` : ""}
          </div>`).join("")}`;
    }).join("")}
  </div>`;
}


function actionIcon(name) {
  const paths = {
    admin: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    bookmarks: '<path d="M6 4h12v17l-6-4-6 4z"/>',
    leaderboard: '<path d="M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>',
    premium: '<path d="m3 7 5 5 4-7 4 7 5-5-2 12H5z"/>',
    logout: '<path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4"/>',
    history: '<path d="M3 12a9 9 0 1 1 2.6 6.4M3 5v7h7m2-5v5l3 2"/>',
    support: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 9.5c.5 2.5 2 4 4.5 4.5l1-1 2 1c-.3 1-1 1.5-2 1.5-3.5 0-6.5-3-6.5-6.5 0-1 .5-1.7 1.5-2l1 2-1 1Z"/>'
  };
  return `<svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function profileAction(name, label, detail = "") {
  const action = name === "logout" ? 'id="logoutBtn"' : name === "support" ? 'id="supportBtn"' : `data-go="${name}"`;
  return `<button type="button" class="profile-action profile-action-${name}" ${action}>
    <span class="profile-action-icon">${actionIcon(name)}</span>
    <strong>${label}</strong>${detail ? `<span class="profile-action-detail">${detail}</span>` : ""}
    <span aria-hidden="true" class="action-chevron">›</span>
  </button>`;
}

function renderProfile() {
  const p = state.profile || {};
  const premActive = p.premium && daysLeft(p.premium.expiry) > 0;
  const streak = (p.streak && p.streak.count) || 0;
  return `${topbarHTML()}<div class="wrap" style="padding-bottom:80px">
    <div class="profile-header">
      ${p.photoURL ? `<img src="${esc(p.photoURL)}" class="profile-avatar" loading="lazy">`
        : `<div class="profile-avatar">${(p.name || "U")[0].toUpperCase()}</div>`}
      <h2>${esc(p.name || "Student")}</h2><p>${esc(p.email || "")}</p>
      <div class="role-badge">${state.isAdmin ? " Administrator" : premActive ? " Premium" : "Student"}</div>
    </div>
    <div class="grid-3 mt-2">
      <div class="stat-card center"><div class="num">${state.results.reduce((sum, row) => sum + (row.attemptCount || 1), 0)}</div><div class="lbl">Attempts</div></div>
      <div class="stat-card center"><div class="num">${streak}</div><div class="lbl">Streak</div></div>
      <div class="stat-card center"><div class="num">${state.results.length ? leaderboardSummary(state.results).averagePercentage : 0}%</div><div class="lbl">Latest avg</div></div>
    </div>
    <div class="card mt-2">
      <h3 class="mb-2">Account Status</h3>
      <div class="flex-between" style="padding:8px 0"><span class="muted small">Account</span>
        <span class="badge ${p.status === "blocked" ? "badge-danger" : "badge-success"}">${p.status === "blocked" ? "Blocked" : "Active"}</span></div>
      <div class="flex-between" style="padding:8px 0;border-top:1px solid var(--border)">
        <span class="muted small">Practice Access</span>
        <span class="badge ${premActive||state.isAdmin ? "badge-success" : "badge-muted"}">${premActive||state.isAdmin ? "Premium access" : "Premium required"}</span></div>
      <div class="flex-between" style="padding:8px 0;border-top:1px solid var(--border)">
        <span class="muted small">Premium</span>
        <span class="badge ${premActive ? "badge-prem" : "badge-muted"}">${premActive ? `${esc(p.premium.plan)} · ${daysLeft(p.premium.expiry)}d` : "Inactive"}</span></div>
      <div class="flex-between" style="padding:8px 0;border-top:1px solid var(--border)">
        <span class="muted small">Member Since</span>
        <span style="font-size:12px;font-weight:700">${fmtDate(p.createdAt)}</span></div>
    </div>

    <div class="profile-actions" aria-label="Account shortcuts">
      ${state.isAdmin ? profileAction("admin", "Open Admin Dashboard") : ""}
      ${profileAction("bookmarks", "My Bookmarks", (p.bookmarks || []).length || "")}
      ${profileAction("leaderboard", "Leaderboard")}
      ${profileAction("premium", "View Premium Plans")}
      ${profileAction("support", "WhatsApp Support", "Chat with us")}
      ${profileAction("logout", "Logout")}
    </div>
  </div>${bottomNavHTML("profile")}`;
}

function renderPremium() {
 const p=state.profile||{}, active=p.premium && daysLeft(p.premium.expiry)>0;
 return `${topbarHTML()}<main class="wrap page-space"><div class="premium-status"><p>YOUR NEXT STEP</p><h2>Practice with confidence</h2><p>All sets, listening practice and progress in one place.</p></div>
 ${p.premium?`<div class="card mt-2"><h3>${active?"Active":"Expired"}: ${esc(p.premium.plan)}</h3><p>${fmtDate(p.premium.start)} to ${fmtDate(p.premium.expiry)} · ${daysLeft(p.premium.expiry)} days remaining</p><p class="muted">Access is tied to the browser used for payment.</p></div>`:""}
 ${renewalEligible()?`<div class="renewal-offer mt-2"><span class="badge badge-prem">LOYALTY REWARD · 40% OFF</span><h3>Premium लिइसक्नुभएको छ? सस्तोमा renew गर्नुहोस्।</h3><p>तलको plan छान्नुहोस् र WhatsApp बाट discounted renewal माग्नुहोस्। Admin verification required.</p></div>`:""}<h3 class="mt-3 mb-2">Available plans</h3>${state.plans.length?state.plans.filter(pl=>pl.active!==false).map(pl=>`<article class="plan-card"><div class="flex-between"><h3>${esc(pl.name)}</h3><div><b class="price">NPR ${Number(pl.price||0).toLocaleString()}</b><p>${Number(pl.days)} days</p></div></div><ul class="benefits">${(pl.benefits||[]).map(b=>`<li>${esc(b)}</li>`).join("")}</ul>${renewalEligible()?`<div class="renewal-plan-price"><span class="badge badge-success">40% OFF RENEWAL</span><strong>NPR ${renewalPrice(pl).toLocaleString()}</strong><small>Regular price: NPR ${Number(pl.price||0).toLocaleString()}</small></div><button class="btn btn-teal btn-block mt-2" data-renew-plan="${esc(pl.id)}">Renew on WhatsApp · Save 40%</button>`:""}<button class="btn ${renewalEligible()?"btn-ghost":"btn-primary"} btn-block mt-2" data-plan="${esc(pl.id)}">${renewalEligible()?"Standard-price eSewa payment":active?"Extend or choose plan":"Select plan"}</button></article>`).join(""):"<div class='card'>No plans available. Please contact the admin.</div>"}
 <div class="card"><p>Payment is verified manually. A request does not activate premium automatically.</p></div></main>${bottomNavHTML("premium")}`;
}

function renderPractice() {
  if(state.contentError)return `${topbarHTML()}<main class="wrap page-space"><div class="card"><h3>Practice unavailable</h3><p>${esc(state.contentError)}</p><button class="btn btn-primary mt-2" id="retryContent">Retry loading</button></div></main>`;
  const p = state.profile || {};
  const premActive = p.premium && daysLeft(p.premium.expiry) > 0;
  const hasAccess = premActive || state.isAdmin;
  if (!hasAccess) {
    return `${topbarHTML()}<div class="wrap" style="padding:16px 0 40px">
      <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
      <div class="card center">
        <div style="font-size:48px;margin-bottom:12px"></div>
        <h2>Premium Feature</h2>
        <p class="muted mt-1 mb-3">Practice Mode is available for premium members only.</p>
        <button class="btn btn-prem btn-block" data-go="premium">View Plans</button>
      </div>
    </div>`;
  }
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
    <h2 class="mb-1">Quick Practice</h2>
    <p class="muted mb-3">Choose a section — 10 questions, no timer</p>
    ${SECTIONS.map(s => `
      <div class="practice-card" data-practice="${s.key}">
        <div class="ic">${s.icon}</div>
        <div style="flex:1"><h4>${esc(s.name)}</h4><p>10 questions · ${s.marks} marks each</p></div>
        <div style="color:var(--purple);font-size:20px">→</div>
      </div>`).join("")}
  </div>`;
}

function renderBookmarks() {
  const p = state.profile || {};
  if(state.contentError)return `${topbarHTML()}<main class="wrap page-space"><div class="card">${esc(state.contentError)}<button class="btn btn-primary" id="retryContent">Retry loading</button></div></main>`;
  const bms = p.bookmarks || [];
  if (bms.length && !state.sets.length) return `${topbarHTML()}<main class="wrap page-space"><div class="card">${esc(state.bookmarkError || "Loading bookmarks…")}<button class="btn btn-ghost" id="retryContent">Retry</button></div></main>`;
  if (!bms.length) {
    return `${topbarHTML()}<div class="wrap" style="padding:16px 0 40px">
      <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
      <h2 class="mb-2">My Bookmarks</h2>
      <div class="empty"><div class="big"></div>No bookmarks yet.<br>Tap the bookmark icon on any question during practice.</div>
    </div>`;
  }
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
    <h2 class="mb-2">My Bookmarks (${bms.length})</h2>
    ${bms.map((bm, i) => {
      const set = state.sets[bm.set - 1]; if (!set) return "";
      const sec = set.sections.find(s => s.key === bm.section); if (!sec) return "";
      const q = bm.id ? sec.questions.find(q=>q.id===bm.id) : sec.questions[bm.qi];
      if (!q) return `<div class="card mb-1 flex-between"><span>Set ${set.number} · Question unavailable</span><button class="btn btn-sm btn-ghost" data-rm-bm="${i}">Remove</button></div>`;
      return `<div class="card q-card mb-1">
        <div class="flex-between mb-1">
          <span class="badge badge-info">Set ${set.number} · ${sec.short}</span>
          <button class="btn btn-sm btn-ghost" data-rm-bm="${i}">Remove</button>
        </div>
        <div style="font-size:13.5px;line-height:1.5;margin-bottom:8px">${esc(q.q)}</div>${previewMedia(q)}
        ${q.o.map((t, oi) => t ? `<div style="padding:7px 10px;font-size:12px;color:var(--muted);border-radius:6px;margin-top:4px;${oi === q.a ? "background:#d1fae5;color:#047857;font-weight:700" : ""}">
          ${"ABCD"[oi]}. ${esc(t)} ${oi === q.a ? "" : ""}</div>` : "").join("")}
      </div>`;
    }).join("")}
  </div>`;
}

function renderLeaderboard() {
  const lb = state.leaderboards?.[studentGroup()] || [];
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
    <h2 class="mb-1"> Leaderboard</h2>
    <div class="field"><label for="leaderboardGroup">Mock test group</label><select id="leaderboardGroup" class="input">${groupOptions(studentGroup())}</select></div>
    <p class="muted mb-3">Top 20 by the average of the latest score from each completed set. Each set counts once.</p>
    <div class="card">
      ${lb.length ? lb.map((u, i) => {
        const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        return `<div class="lb-row">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-info"><b>${esc(u.name)}</b><span>${u.setCount} / ${SET_NAMES.length} sets · ${u.streak}-day streak</span></div>
          <div class="lb-score">${u.averagePercentage}%</div>
        </div>`;
      }).join("") : `<div class="empty">No scores yet.</div>`}
    </div>
  </div>`;
}

/* ============ ADMIN ============ */
let adminTab = "overview";
function renderAdmin() {
  const tabs = [
    { id:"overview", label:"Overview" },{ id:"students", label:"Students" },
    { id:"requests", label:"Requests" },{ id:"questions", label:"Questions" },
    { id:"reports", label:"Reports" },{ id:"settings", label:"Settings" }
  ];
  const contentMap = {
    overview: adminOverviewHTML, students: adminStudentsHTML, requests: adminRequestsHTML,
    questions: adminQuestionsHTML, reports: adminReportsHTML, settings: adminSettingsHTML
  };
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="profile">← Back</button>
    <h2 class="mb-2"> Admin Dashboard</h2>
    <div class="admin-tabs">
      ${tabs.map(t => `<button class="admin-tab ${adminTab === t.id ? "on" : ""}" data-admin-tab="${t.id}">${t.label}</button>`).join("")}
    </div>
    <div id="adminContent">${contentMap[adminTab]()}</div>
  </div>`;
}
function adminOverviewHTML() {
  return `<div class="flex-between mb-2"><h3>Overview</h3><button class="btn btn-ghost btn-sm" id="refreshStats">Refresh stats</button></div>
  <div class="grid-2 admin-overview">
    <button class="stat-card" data-stat="statTotal" data-admin-tab="students"><div class="num" id="statTotal">…</div><div class="lbl">Total Students</div></button>
    <button class="stat-card" data-stat="statActive" data-admin-tab="students"><div class="num" id="statActive">…</div><div class="lbl">Active</div></button>
    <button class="stat-card" data-stat="statBlocked" data-admin-tab="students"><div class="num" id="statBlocked">…</div><div class="lbl">Blocked</div></button>
    <button class="stat-card" data-stat="statPremium" data-admin-tab="students"><div class="num" id="statPremium">…</div><div class="lbl">Premium</div></button>
    <button class="stat-card" data-stat="statPending" data-admin-tab="requests"><div class="num" id="statPending">…</div><div class="lbl">Pending Requests</div></button>
    <button class="stat-card" data-stat="statQuestions" data-admin-tab="questions"><div class="num" id="statQuestions">…</div><div class="lbl">Questions</div></button>
    <button class="stat-card" data-stat="statOnline" data-admin-tab="students"><div class="num" id="statOnline">…</div><div class="lbl">Online students</div><small>Seen in the last 7 min</small></button>
    <button class="stat-card" data-stat="statToday" data-admin-tab="students"><div class="num" id="statToday">…</div><div class="lbl">Premium started today</div><small>Nepal time</small></button>
    <button class="stat-card" data-stat="statExpired" data-admin-tab="students"><div class="num" id="statExpired">…</div><div class="lbl">Premium expired</div></button>
    <button class="stat-card" data-admin-tab="reports"><div class="num" id="statReports">…</div><div class="lbl">Open question reports</div></button>
  </div>
  <p class="muted small" id="statsLoadMessage" role="status" hidden></p>
  <div class="card mt-2"><h3 class="mb-1">Quick Actions</h3>
    <div class="grid-2">
      <button class="btn btn-primary btn-sm" data-admin-tab="students">Students</button>
      <button class="btn btn-teal btn-sm" data-admin-tab="questions">Questions</button>
      <button class="btn btn-ghost btn-sm" data-admin-tab="requests">Requests</button>
      <button class="btn btn-ghost btn-sm" id="refreshQBtn">↻ Refresh Q</button>
    </div>
  </div>`;
}
function adminStudentsHTML() {
  return `<div class="field"><input type="text" id="studentSearch" class="input" placeholder="Search by name or email…"></div>
    <select class="input mb-2" id="studentFilter"><option value="all">All students</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="premium">Premium</option><option value="expired">Expired premium</option><option value="online">Online recently</option><option value="today">Premium started today</option></select><div id="studentsList"><p class="muted center" style="padding:24px">Loading…</p></div><div id="studentPaging" class="mock-admin-actions"></div>`;
}
function adminRequestsHTML() {
  return `<div id="requestsList"><p class="muted center" style="padding:24px">Loading…</p></div>`;
}

function adminReportsHTML() {
  return `<div class="flex-between mb-2"><h3>Question reports</h3>
    <button class="btn btn-ghost btn-sm" id="refreshReports">Refresh</button></div>
    <select class="input mb-2" id="reportFilter" aria-label="Report status">
      <option value="open">Open reports</option><option value="resolved">Resolved reports</option>
    </select><div id="questionReportsList" aria-live="polite"></div>`;
}

async function loadQuestionReports(cursor) {
  const list = $("questionReportsList");
  const filter = $("reportFilter");
  if (!state.isAdmin || !list || !filter) return;
  const status = filter.value;
  if (!cursor) list.innerHTML = '<p class="muted center">Loading reports…</p>';
  try {
    const snapshot = await getDocs(query(collection(db,"questionReports"),where("status","==",status),orderBy("createdAt","desc"),...(cursor?[startAfter(cursor)]:[]),limit(20)));
    if (!list.isConnected || filter.value !== status) return;
    const reports = resultRows(snapshot).sort((a, b) => membershipUntil(b.createdAt) - membershipUntil(a.createdAt));
    const rows = reports.map(report => `<article class="admin-q-item question-report">
      <div class="flex-between"><h4>${GROUPS[groupFor(report.setIdx)].label} · Set ${setNumber(report.setIdx)} · ${esc(SECTIONS.find(section => section.key === report.section)?.short || report.section)} · Q${report.questionNumber}</h4>
        <span class="badge ${status === "open" ? "badge-warn" : "badge-success"}">${status}</span></div>
      <p class="muted small">${esc(report.email)} · ${fmtDate(report.createdAt)} · ID ${esc(report.questionId)}</p>
      <p class="question-report-text">${esc(report.question)}</p>
      <p class="question-report-reason">${esc(report.reason)}</p>
      ${status === "open" ? `<button class="btn btn-ghost btn-sm mt-1" data-resolve-report="${esc(report.id)}">Mark resolved</button>` : ""}
    </article>`).join("");
    $("moreReports")?.remove();
    if (cursor) list.insertAdjacentHTML("beforeend",rows); else list.innerHTML=rows || '<p class="empty">No reports in this view.</p>';
    if (snapshot.size===20) {
      list.insertAdjacentHTML("beforeend",'<button class="btn btn-ghost mt-2" id="moreReports">Load more reports</button>');
      $("moreReports").onclick=() => loadQuestionReports(snapshot.docs.at(-1));
    }
    list.querySelectorAll("[data-resolve-report]").forEach(button => {
      button.onclick = async () => {
        await updateDoc(doc(db, "questionReports", button.dataset.resolveReport), {
          status: "resolved", resolvedAt: serverTimestamp()
        });
        clearFastReads("adminOpenReports","stat:statReports");
        toast("Report resolved", "ok");
        await loadQuestionReports();
      };
    });
    bindFastButtons(list);
  } catch (error) {
    if (list.isConnected && filter.value === status) list.textContent = "Could not load reports. Click Refresh to try again.";
  }
}

function adminQuestionsHTML() {
  return `<div class="flex-between mb-2">
    <h3>Questions</h3>
    <div class="flex" style="gap:6px">
      <button class="btn btn-ghost btn-sm" id="refreshQ2">↻</button>
      <button class="btn btn-primary btn-sm" id="addQBtn">+ Add</button>
    </div>
  </div>
  <div class="card" style="background:var(--bg);padding:12px;margin-bottom:12px">
    <p class="muted small" style="line-height:1.6">
      <b> GitHub Media:</b> Put images in <code>photos/</code> and audio in <code>audio/</code> in your repo.<br>
      Base URL: <code>${REPO_BASE}</code>
    </p>
  </div>
  <div class="field"><input type="text" id="qSearch" class="input" placeholder="Search questions…"></div>
  ${adminSetPicker()}
  <p class="muted small" id="qCount" aria-live="polite"></p>
  <div class="toolbar"><select class="input" id="qSection"><option value="">All sections</option>${SECTIONS.map(x=>`<option value="${x.key}">${x.name}</option>`).join("")}</select></div><div class="toolbar mb-2"><button class="btn btn-ghost" id="setPreview">Preview filtered questions</button><button class="btn btn-danger" id="deleteSelected">Delete selected</button><label><input type="checkbox" id="selectAll"> Select all shown</label></div><div id="questionsList"><p class="muted center" style="padding:24px">Loading…</p></div>`;
}
let adminQuestionGroup = OCT;
let adminQuestionSet = 1;
let questionLoadId = 0;

function adminSetPicker() {
  return `<div class="toolbar">
    <label>Question group<select class="input" id="qGroup">${groupOptions(adminQuestionGroup)}</select></label>
    <label>Mock test set<select class="input" id="qSet">${groupSets(adminQuestionGroup).map(set =>
      `<option value="${set.idx}" ${set.idx===adminQuestionSet?"selected":""}>Set ${set.number} · ${esc(set.name)}</option>`).join("")}</select></label>
  </div>`;
}

function adminSettingsHTML() {
  return `<div class="card mb-2">
    <h3 class="mb-2">Mock Test Settings</h3><div id="mockSettingsRows"><p class="muted">Loading settings…</p></div>
  </div>
  <div class="card mb-2"><h3 class="mb-2">Data Setup</h3>
    <p id="legacySetupStatus" class="muted small"></p>
    <div class="mock-admin-actions"><button class="btn btn-ghost btn-sm" id="exportLegacy">Back up original October–November bank</button>
    <button class="btn btn-primary btn-sm" id="splitLegacy">Split October–November bank</button>
    <button class="btn btn-ghost btn-sm" id="indexStudents">Build student search index</button></div>
    <p id="studentIndexStatus" class="muted small" role="status"></p>
  </div>
  <div class="card mb-2"><h3 class="mb-2">Export / Import</h3>
    ${adminSetPicker()}
    <button class="btn btn-primary btn-sm mb-2" id="exportBtn">Download selected set</button>
    <label>Questions JSON<textarea id="importText" class="input" placeholder='{"questions": [...]}' rows="4"></textarea></label>
    <button class="btn btn-teal btn-sm mt-2" id="importBtn">Import questions</button>
  </div>` + enhancedSettings();
}

function renderMockSettings() {
  const target = $("mockSettingsRows");
  if (!target) return;
  target.innerHTML = GROUP_IDS.map(group => `<section class="mb-2"><h4>${GROUPS[group].label} Mock Tests</h4>
    ${groupSets(group).map(set => `<div class="plan-row mock-setting-row">
      <div><b>Set ${set.number} · ${esc(set.name)}</b><p class="muted small">${set.duration} min · ${set.passMarks}/${set.totalMarks} pass · ${set.access} · ${set.questionCount ?? "—"} questions</p></div>
      <span class="badge ${set.isPublished ? "badge-success" : "badge-muted"}">${set.isPublished ? "Published" : "Unpublished"}</span>
      <button class="btn btn-ghost btn-sm" data-edit-set="${set.idx}">Edit</button>
      <button class="btn btn-primary btn-sm" data-publish-set="${set.idx}" ${group===OCT&&!catalog.legacySplit?"disabled":""}>${set.isPublished?"Unpublish":"Publish"}</button>
    </div>`).join("")}</section>`).join("");
  target.querySelectorAll("[data-edit-set]").forEach(button => button.onclick = () => editSetSettings(+button.dataset.editSet));
  target.querySelectorAll("[data-publish-set]").forEach(button => button.onclick = async () => {
    try {
      await updateSetSettings(+button.dataset.publishSet, meta => ({isPublished:!meta.isPublished}));
      renderMockSettings();
      toast("Publication status updated","ok");
    } catch (error) {toast(error.message,"err");}
  });
  $("legacySetupStatus").textContent = catalog.legacySplit ? "October–November uses set-level question documents."
    : "Split the October–November bank before editing its questions or publication controls.";
  $("splitLegacy").disabled = catalog.legacySplit;
  bindFastButtons(target);
}

function editSetSettings(idx) {
  const set = setMeta(idx);
  modal("Edit mock test set", `<label>Name<input id="msName" class="input" maxlength="100" value="${esc(set.name)}"></label>
    <div class="grid-2"><label>Minutes<input id="msDuration" type="number" min="1" max="180" class="input" value="${set.duration}"></label>
    <label>Order<input id="msOrder" class="input" type="number" min="1" max="99" value="${set.order}"></label>
    <label>Total marks<input id="msTotal" class="input" type="number" min="1" max="1000" value="${set.totalMarks}"></label>
    <label>Pass marks<input id="msPass" class="input" type="number" min="0" class="input" value="${set.passMarks}"></label></div>
    <label>Access<select id="msAccess" class="input" ${set.group===OCT&&!catalog.legacySplit?"disabled":""}>
      <option value="premium">Premium</option><option value="free" ${set.access==="free"?"selected":""}>Free</option></select></label>`,
    [{label:"Cancel",cls:"btn-ghost"},{label:"Save",keepOpen:true,onClick:async () => {
      try {
        const changes = {name:$("msName").value.trim(),duration:+$("msDuration").value,order:+$("msOrder").value,
          totalMarks:+$("msTotal").value,passMarks:+$("msPass").value,access:$("msAccess").value};
        const inRange = (value,min,max) => Number.isInteger(value) && value>=min && value<=max;
        if (!changes.name || !inRange(changes.duration,1,180) || !inRange(changes.order,1,99) ||
            !inRange(changes.totalMarks,1,1000) || !inRange(changes.passMarks,0,changes.totalMarks)) {
          throw new Error("Check the set name, duration, marks and display order.");
        }
        await updateSetSettings(idx, () => changes);
        closeModal();renderMockSettings();toast("Set saved","ok");
      } catch (error) {toast(error.message,"err");}
    }}]);
}

function cachedCatalog(next) {
  catalog = next;
  clearFastReads("catalog","catalog-server","admin-catalog");
  loadedViews.delete(`${state.user?.uid}:catalog`);
  for (const key of fastReads.keys()) if (key.includes(":stat:statQuestions")) fastReads.delete(key);
  void publicCache("catalog", next);
  questionCache.clear();
}

function catalogEntry(data,idx) {
  const {name,duration,order,totalMarks,passMarks,access,isPublished,version,questionCount} =
    {...defaultSets[idx],...data.sets?.[setKey(idx)]};
  return {name,duration,order,totalMarks,passMarks,access,isPublished,version,questionCount};
}

async function updateSetSettings(idx, transform) {
  if (!state.isAdmin || !defaultSets[idx]) throw new Error("Admin access required.");
  const next = await runTransaction(db, async tx => {
    const snapshot = await tx.get(catalogRef());
    const data = snapshot.data() || {legacySplit:false,sets:{}};
    const prior = catalogEntry(data,idx);
    const updated = {...prior,...transform(prior)};
    if (groupFor(idx) === OCT && !data.legacySplit && (!updated.isPublished || updated.access === "free"))
      throw new Error("Split the legacy bank before changing its access.");
    if (updated.isPublished && !updated.questionCount && (groupFor(idx) === DEC || data.legacySplit))
      throw new Error("Upload questions before publishing this set.");
    data.sets = {...data.sets,[setKey(idx)]:updated};
    tx.set(catalogRef(),data);
    return data;
  });
  cachedCatalog(next);
}

function bindSetPicker(reload) {
  $("qGroup").onchange = () => {
    adminQuestionGroup = $("qGroup").value;
    adminQuestionSet = GROUPS[adminQuestionGroup].first;
    $("qSet").innerHTML = groupSets(adminQuestionGroup).map(set =>
      `<option value="${set.idx}" ${set.idx===adminQuestionSet?"selected":""}>Set ${set.number} · ${esc(set.name)}</option>`).join("");
    reload?.();
  };
  $("qSet").onchange = () => {adminQuestionSet = +$("qSet").value;reload?.();};
}
/* ============ POST-RENDER ============ */
function postRender() {
  document.querySelectorAll("[data-attempt]").forEach(button => {
    button.onclick = () => {
      const result = state.results.find(row => (row.attemptId || row.id) === button.dataset.attempt);
      if (!result) return;
      saveResult(result);
      navigate("result");
    };
  });
  if($("copyPastPassword")) $("copyPastPassword").onclick=async()=>{try{await navigator.clipboard.writeText("myreservasi");toast("Password copied","ok");}catch(e){const el=document.createElement("textarea");el.value="myreservasi";document.body.append(el);el.select();const ok=document.execCommand("copy");el.remove();toast(ok?"Password copied":"Please copy the password manually",ok?"ok":"err");}};
  if($("retryCloud"))$("retryCloud").onclick=async()=>{const r=loadResult();if(!r)return;try{await saveResultToDb(r);render();toast("Saved to cloud","ok");}catch(e){toast(e.message,"err");}};
  if($("pendingAdminButton"))$("pendingAdminButton").onclick=()=>{adminTab="requests";navigate("admin");};
  if($("retryContent"))$("retryContent").onclick=()=>loadDataInBackground();
  document.querySelectorAll("[data-go]").forEach(el => {
    el.onclick = () => navigate(el.dataset.go);
  });
  document.querySelectorAll("[data-nav]").forEach(el => {
    el.onclick = () => navigate(el.dataset.nav);
  });
  document.querySelectorAll("[data-admin-tab]").forEach(el => {
    el.onclick = () => { adminTab = el.dataset.adminTab; state._studentSearch="";state._studentPage=0;state._studentAll=false;state._studentFilter=({statActive:"active",statBlocked:"blocked",statPremium:"premium",statOnline:"online",statToday:"today",statExpired:"expired"})[el.dataset.stat]||"all"; render(); if($("studentFilter")) $("studentFilter").value=state._studentFilter; };
  });
  document.querySelectorAll("[data-review]").forEach(el => {
    el.onclick = () => openResultReview(el.dataset.review);
  });

  if (!state.user && state.screen !== "signup") {
    $("gLogin").onclick = signInGoogle;
    $("emailLogin").onclick = async () => {
      const e = $("loginEmail").value.trim(), p = $("loginPass").value;
      if (!e || !p) return toast("Email and password required", "err");
      const btn=$("emailLogin");btn.disabled=true;btn.textContent="Signing in…";try{await signInEmail(e,p);}finally{btn.disabled=false;btn.textContent="Sign In";}
    };
    $("signupLink").onclick = () => navigate("signup");
    $("forgotLink").onclick = () => {
      const email = $("loginEmail").value.trim();
      if (!email) return toast("Enter your email first", "err");
      resetPassword(email);
    };
  }
  if (state.screen === "signup" && !state.user) {
    $("backLogin").onclick = () => navigate("login");
    $("emailSignup").onclick = async () => {
      const name = $("signName").value.trim();
      const email = $("signEmail").value.trim();
      const p1 = $("signPass").value, p2 = $("signPass2").value;
      if (!email || !p1) return toast("All fields required", "err");
      if (p1 !== p2) return toast("Passwords don't match", "err");
      if (p1.length < 6) return toast("Password 6+ characters", "err");
      await signUpEmail(email, p1, name);
    };
  }

  const reqBtn = $("reqAccessBtn");
  if (reqBtn) reqBtn.onclick = requestAccess;

  document.querySelectorAll("[data-set]").forEach(el => {
el.onclick = async () => {
      const idx = Number(el.dataset.set) + 1;
      try {
        await readCatalog(true);
        if (!visibleSet(idx)) { comingSoon(); return; }
        if (!canUseSet(idx)) await freshProfile();
        navigate("start", {set:idx-1,group:groupFor(idx)});
      } catch (error) {toast(error.message,"err");}
    };
  });

if ($("mockGroup")) $("mockGroup").onchange = e => navigate("sets", {group:e.target.value});
  if ($("backToGroup")) $("backToGroup").onclick = () => navigate("sets", {group:groupFor(Number(state.params.set || 0)+1)});
  const agree = $("agree"), startBtn = $("startBtn");
  if (agree && startBtn) {
    agree.onchange = () => { startBtn.disabled = !agree.checked; };
    startBtn.onclick = () => {
      if (!agree.checked) return toast("Please agree to the rules", "err");
      return beginExam(Number(state.params.set) || 0);
    };
  }
  const reqAcc2 = $("reqAcc2");
  if (reqAcc2) reqAcc2.onclick = requestAccess;

  if (state.screen === "exam" && state.exam && $("nextBtn")) bindExamEvents();

  const shareBtn = $("shareBtn");
  if (shareBtn) shareBtn.onclick = shareResult;
  const retryBtn = $("retryBtn");
  if (retryBtn) retryBtn.onclick = () => {
    const r = loadResult();
    if (r) navigate("start", {set:r.setIdx-1,group:groupFor(r.setIdx)});
  };
  if (state.screen === "result") {
    setTimeout(() => {
      const r = loadResult();
      const ring = $("resultRing");
      if (ring && r) ring.style.strokeDashoffset = 427.3 * (1 - r.percentage / 100);
    }, 100);
  }

  const logoutBtn = $("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = logout;
  const supportBtn = $("supportBtn");
  if (supportBtn) supportBtn.onclick = () => {
    const number = String(appConfig.whatsappNumber || "").replace(/\D/g, "");
    if (!number) return toast("WhatsApp support number is not configured.", "err");
    const message = `नमस्ते Dream Japan Support, मलाई JFT Mock Test सम्बन्धमा सहयोग चाहिएको छ।\nनाम: ${state.profile?.name || ""}\nईमेल: ${state.profile?.email || state.user?.email || ""}`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  document.querySelectorAll("[data-plan]").forEach(el => {
    el.onclick = () => requestPremium(el.dataset.plan);
  });

  document.querySelectorAll("[data-practice]").forEach(el => {
    el.onclick = () => startPractice(el.dataset.practice);
  });

  document.querySelectorAll("[data-rm-bm]").forEach(el => {
    el.onclick = async () => {
      const bms = [...(state.profile.bookmarks || [])];
      bms.splice(+el.dataset.rmBm, 1);
      try {
        await updateDoc(doc(db, "users", state.user.uid), { bookmarks: bms });
        state.profile.bookmarks = bms;
        saveProfileCache(state.user.uid, state.profile);
        render();
        toast("Removed", "ok");
      } catch (e) { toast("Failed: " + e.message, "err"); }
    };
  });

  if ($("leaderboardGroup")) $("leaderboardGroup").onchange = e => navigate("leaderboard", {group:e.target.value});
  if (state.screen === "admin" && state.isAdmin) bindAdminTab();
}

/* ============ EXAM ENGINE ============ */
async function beginExam(setIdx, force = false) {
  return onceJob("beginExam", async () => {
    const idx = setIdx + 1;
    const uid = requireSession();
    if (!force && isExamLockedByOther(setIdx)) {
      modal("Another tab has this exam", "This exam is open in another tab.", [
        {label:"Cancel",cls:"btn-ghost"},
        {label:"Start Anyway",onClick:() => beginExam(setIdx, true)}
      ]);
      return;
    }
    showPreparing("Preparing your exam", "Getting your questions ready…");
    try {
      if (!await ensureSetAccess(idx)) return;
      const rows = await readSetRows(idx);
      if (state.user?.uid !== uid || state.screen !== "start") {closeModal(); return;}
      const set = examSet(idx, rows);
      set.sections = set.sections.filter(section => section.questions.length);
      if (!set.sections.length) throw new Error("This set has no questions.");
      void warmAsset(set.sections[0].questions[0].img,false,"high");
      const sections = structuredClone(set.sections);
      state.exam = {set,setIdx,sections,attemptId:uuid(),si:0,qi:0,left:set.duration*60,paused:false,
        answeredCount:0,maxReachable:0,startedAt:Date.now()};
      acquireExamLock(setIdx);
      saveExamState(state.exam);
      startTimer();
      void bumpStreak();
      closeModal();
      navigate("exam");
    } catch (error) {closeModal(); toast(error.message,"err");}
  });
}

async function resumeExamFromSaved(saved) {
  return onceJob("resumeExam", async () => {
    const idx = saved.setIdx + 1;
    const failure = () => {clearExamState(); replaceNavigate("sets", {group:groupFor(idx)});};
    try {
      if (saved.uid !== state.user?.uid) return failure();
      if (!await ensureSetAccess(idx)) return failure();
      const current = setMeta(idx);
      const set = saved.snapshot;
      if (!set || (set.version ?? 0) !== current.version || saved.uid !== state.user?.uid) return failure();
      Object.assign(set, {duration:set.duration ?? current.duration,totalMarks:set.totalMarks ?? current.totalMarks,
        passMarks:set.passMarks ?? current.passMarks,number:setNumber(idx)});
      const sections = set.sections.map((section, si) => ({
        ...section,
        questions: section.questions.map((q, qi) => ({
          ...q,sel:saved.answers?.[si]?.[qi] ?? undefined,
          locked:!!saved.locked?.[si]?.[qi],played:saved.played?.[si]?.[qi] || 0
        }))
      }));
      const si = saved.si || 0;
      state.exam = {set,setIdx:saved.setIdx,attemptId:saved.attemptId,sections,si,qi:saved.qi||0,
        left:Math.max(0,set.duration*60-(Date.now()-saved.startedAt)/1000),paused:false,
        answeredCount:sections[si].questions.filter(q => q.sel !== undefined).length,
        maxReachable:saved.maxReachable||0,startedAt:saved.startedAt};
      startTimer();
      render();
    } catch (error) {failure(); toast(error.message,"err");}
  });
}
function startTimer() {
  if (state._tick) clearInterval(state._tick);
  if (state._lockTick) clearInterval(state._lockTick);
  state._perfStart = performance.now();
  state._perfLeftAtStart = state.exam.left;
  state._timeupShown = false;
  state._tick = setInterval(tick, 500);
  state._lockTick = setInterval(() => {
    if (state.exam) refreshExamLock(state.exam.setIdx);
  }, 15000);
  refreshExamLock(state.exam.setIdx);
}

function tick() {
  if(state.exam && (!visibleSet(state.exam.set.idx) || !canUseSet(state.exam.set.idx))){clearInterval(state._tick);stopAudio();state.exam=null;clearExamState();navigate("premium");return;}
  const ex = state.exam;
  if (!ex) { clearInterval(state._tick); return; }
  if (ex.paused) {
    state._perfStart = performance.now();
    state._perfLeftAtStart = ex.left;
    return;
  }
  const elapsedSec = (Date.now()-ex.startedAt)/1000;
  ex.left = Math.max(0, ex.set.duration*60-elapsedSec);
  const el = $("timerDisplay");
  if (el) {
    const secs = Math.ceil(ex.left);
    const label=el.querySelector("span")||el,text=`${pad(Math.floor(secs/60))}:${pad(secs%60)}`;
    if(label.textContent!==text)label.textContent=text;
    el.classList.toggle("low", ex.left <= 600);
  }
  if (ex.left <= 0 && !state._timeupShown) {
    state._timeupShown = true;
    clearInterval(state._tick);
    if (state._lockTick) { clearInterval(state._lockTick); state._lockTick = null; }
    finishExam();
  }
}

function bindExamEvents() {
  const ex = state.exam;
  const sec = ex.sections[ex.si];
  const q = sec.questions[ex.qi];

  document.querySelectorAll("[data-opt]").forEach(el => {
    el.onclick = () => selectOpt(+el.dataset.opt);
  });
  document.querySelectorAll("[data-jump]").forEach(el => {
    el.onclick = () => { if (!el.disabled) jumpTo(+el.dataset.jump); };
  });
  $("prevBtn").onclick = prevQ;
  $("nextBtn").onclick = nextQ;
  $("leaveBtn").onclick = askLeaveExam;
  const pb = $("playBtn");
  if (pb) pb.onclick = () => playAudio(q);
  const rb = $("replayBtn");
  if (rb) rb.onclick = () => playAudio(q);
}

function selectOpt(i) {
  const ex = state.exam;
  if (!ex) return;
  const sec = ex.sections[ex.si];
  const q = sec.questions[ex.qi];
  if (q.locked) return;
  q.sel = i;
  ex.answeredCount = sec.questions.filter(x => x.sel !== undefined).length;
  document.querySelectorAll(".opt").forEach((el, idx) => {el.classList.toggle("sel", idx === i);el.setAttribute("aria-pressed",String(idx===i));});
  const nextBtn = $("nextBtn"); if (nextBtn) nextBtn.disabled = false;
  const palette = document.querySelectorAll(".pal-btn");
  if (palette[ex.qi]) palette[ex.qi].classList.add("ans");
  const pbar = $("progressFill");
  if (pbar) pbar.style.width = (ex.answeredCount / sec.questions.length * 100) + "%";
  saveExamState(ex);
}

function jumpTo(i) {
  const ex = state.exam;
  if (!ex) return;
  const sec = ex.sections[ex.si];
  if (!sec) return;
  if (i < 0 || i >= sec.questions.length) return;
  if (i > ex.maxReachable) return;
  if (sec.questions[i]?.locked) return;
  stopAudio();
  ex.qi = i;
  saveExamState(ex);
  render();
}
function prevQ() {
  const ex = state.exam;
  if (!ex) return;
  if (ex.qi > 0) { stopAudio(); ex.qi--; saveExamState(ex); render(); }
}
function nextQ() {
  const ex = state.exam;
  if (!ex) return;
  const sec = ex.sections[ex.si];
  const q = sec.questions[ex.qi];
  if (q.sel === undefined) return;
  if (ex.qi < sec.questions.length - 1) {
    stopAudio();
    ex.qi++;
    if (ex.qi > ex.maxReachable) ex.maxReachable = ex.qi;
    saveExamState(ex);
    render();
  } else {
    finishSection();
  }
}
function finishSection() {
  const ex = state.exam;
  const sec = ex.sections[ex.si];
  const unanswered = sec.questions.filter(x => x.sel === undefined).length;
  const isLast = ex.si === ex.sections.length - 1;
  modal(isLast ? "Submit your exam?" : "Complete this section?",
    (unanswered ? `${unanswered} unanswered. ` : "") +
    (isLast ? "You cannot change answers after submitting." : "You cannot return to this section."),
    [
      { label: "Cancel", cls: "btn-ghost" },
      { label: isLast ? "Submit" : "Continue", cls: "btn-primary", onClick: () => {
        sec.questions.forEach(q => q.locked = true);
        if (isLast) finishExam();
        else {
          ex.si++; ex.qi = 0; ex.maxReachable = 0; ex.answeredCount=0; stopAudio();
          saveExamState(ex);
          render();
        }
      }}
    ]);
}

function askLeaveExam() {
  if (!state.exam) return;
  state.exam.paused = true;
  stopAudio();
  modal("Leave the exam?", "Progress will be lost and timer stops.",
    [
      { label: "Stay", cls: "btn-ghost", onClick: () => { if (state.exam) state.exam.paused = false; } },
      { label: "Leave", cls: "btn-danger", onClick: () => {
        state._confirmedLeave = true;
        history.back();
      }}
    ]);
}

async function finishExam() {
  if (state._tick) clearInterval(state._tick);
  if (state._lockTick) { clearInterval(state._lockTick); state._lockTick = null; }
  stopAudio();
  const ex = state.exam;
  if (!ex || state._submitting) return;
  state._submitting=true;
  showPreparing("Preparing your result", "Calculating your score and section performance…");
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  const used = Math.min(ex.set.duration*60,Math.max(0,Math.round(ex.set.duration * 60 - ex.left)));

  let score = 0, correct = 0, unanswered = 0;
  const sections = ex.sections.map(s => {
    const items = s.questions.map((q, idx) => ({
      idx, q: q.q, p: q.p, img: q.img, au: q.au, o: q.o, explanation:q.explanation || "",
      correctAns: q.a, yourAns: q.sel
    }));
    let c = 0, u = 0;
    s.questions.forEach(q => {
      if (q.sel === undefined) u++;
      else if (q.sel === q.a) c++;
    });
    const max = s.questions.reduce((sum,q) => sum + (q.marks || s.marks), 0);
    const sc = s.questions.reduce((sum,q) => sum + (q.sel === q.a ? (q.marks || s.marks) : 0), 0);
    score += sc; correct += c; unanswered += u;
    return { name: s.name, short: s.short, marks: s.marks, score: sc, max, items };
  });

  const totalQ=ex.sections.reduce((n,s)=>n+s.questions.length,0);
  const originalFullMarks=sections.reduce((n,s)=>n+s.max,0);
  sections.forEach(s=>{s.score=+(s.score*ex.set.totalMarks/originalFullMarks).toFixed(2);s.max=+(s.max*ex.set.totalMarks/originalFullMarks).toFixed(2);});
  score=Math.round(score*ex.set.totalMarks/originalFullMarks);
  const wrong = totalQ - correct - unanswered;
  const percentage = Math.round(score / ex.set.totalMarks * 100);
  const attemptId = `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const previous = state.results.find(row => row.setIdx === ex.set.idx);
  const result = {
    attemptCount: (previous?.attemptCount || 0) + 1,
    cloudSaved: false, attemptId: ex.attemptId || attemptId,
    setIdx: ex.set.idx, setName: ex.set.name, passMarks:ex.set.passMarks,
    score, maxScore: ex.set.totalMarks, percentage,
    correct, wrong, unanswered, sections, timeUsed: used,
    startedAt: new Date(ex.startedAt).toISOString(),
    submittedAt: new Date().toISOString()
  };

  saveResult(result);
  state.results = latestBySet([result, ...state.results]);
  saveLocalAttempts();
  clearExamState();
  invalidateResultsCache(state.user.uid);   // force re-fetch next visit

  state._submitting=false;
  const setIdx = ex.setIdx;
  state.exam = null;
  releaseExamLock(setIdx);

  closeModal();
  replaceNavigate("result");
  saveResultToDb(result).then(()=>{if(state.screen==="result" && loadResult()?.setIdx===result.setIdx)render();}).catch(error=>{console.warn("Result kept on this browser",error);if(state.screen==="result")toast("Result saved on this browser. Cloud save is pending.");});
}


function resultWithoutQuestions(row) {
  const sections=(row.sections||[]).map(({items,...section}) => ({...section,items:items?.map(({yourAns,correctAns}) => ({yourAns,correctAns}))||[]}));
  return {...row,sections};
}

function cloudResult(row) {
  const {attemptId,setIdx,setName,score,maxScore,percentage,correct,wrong,unanswered,timeUsed,startedAt,attemptCount,passMarks} = row;
  const {sections} = resultWithoutQuestions(row);
  return JSON.parse(JSON.stringify({
    attemptId: attemptId || row.id, setIdx, setName, score, maxScore, percentage, passMarks,
    correct, wrong, unanswered, sections, timeUsed, startedAt, attemptCount,
    cloudSaved: true, scoreSource: "browser"
  }));
}

function leaderboardSummary(rows) {
  const percentageSum = rows.reduce((sum, row) => sum + row.percentage, 0);
  const totalTimeUsed = rows.reduce((sum, row) => sum + row.timeUsed, 0);
  return {
    averagePercentage: Math.round(percentageSum * 100 / rows.length) / 100,
    setCount: rows.length, completedSets: rows.map(row => row.setIdx), totalTimeUsed
  };
}

async function writeLatestResults(uid, incoming) {
  const group = incoming ? groupFor(incoming.setIdx) : OCT;
  const ids = groupSetIds(group);
  const refs = ids.map(idx => doc(db,"users",uid,"latestResults",setKey(idx)));
  const userRef = doc(db, "users", uid);
  return runTransaction(db, async tx => {
    const [user, ...snapshots] = await Promise.all([tx.get(userRef), ...refs.map(ref => tx.get(ref))]);
    if (!user.exists() || (!state.isAdmin && user.data().status !== "active")) {
      throw new Error("Active premium is required to save results");
    }
    const existing = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => snapshot.data());
    const rows = new Map(existing.map(row => [row.setIdx, row]));
    const changes = new Map();

    if (incoming) {
      const previous = changes.get(incoming.setIdx) || rows.get(incoming.setIdx);
      const sameAttempt = previous?.attemptId === incoming.attemptId;
      if (!sameAttempt && (!previous || resultTime(incoming) >= resultTime(previous))) {
        changes.set(incoming.setIdx, {
          ...incoming, attemptCount: Math.max((previous?.attemptCount || 0) + 1, incoming.attemptCount || 1)
        });
      }
    }
    for (const [setIdx, row] of changes) {
      const data = {
        ...cloudResult(row),
        submittedAt: row.submittedAt?.toMillis ? row.submittedAt : new Date(resultTime(row)),
        savedAt: serverTimestamp()
      };
      tx.set(refs[ids.indexOf(setIdx)], data);
      if (row.sections?.some(section => section.items?.some(item => typeof item.q === "string"))) {
        tx.set(doc(db,"users",uid,"resultReviews",setKey(setIdx)), {
          attemptId:data.attemptId, sections:JSON.parse(JSON.stringify(row.sections)), savedAt:serverTimestamp()
        });
      }
      rows.set(setIdx, { ...data, submittedAt: row.submittedAt, savedAt: Date.now() });
    }
    const latest = [...rows.values()];
    if (changes.size) {
      tx.set(doc(db, GROUPS[group].leaderboard, uid), {
        ...leaderboardSummary(latest),
        name: String(user.data().name || "Student").slice(0, 80),
        streak: Number(user.data().streak?.count) || 0,
        scoreSource: "browser", updatedAt: serverTimestamp()
      });
    }
    return latest;
  });
}

async function saveResultToDb(result) {
  return onceJob(`save-result:${result.attemptId}`, async () => {
    const uid = requireSession();
    const group = groupFor(result.setIdx);

    if (state.user?.uid !== uid) throw new Error("Please sign in again");
    const latest = await writeLatestResults(uid, result);
    if (state.user?.uid !== uid) return;
    const saved = latest.find(row => row.setIdx === result.setIdx);
    state.results = latestBySet([...latest, ...state.results.filter(row => row.attemptId !== result.attemptId)]);
    saveLocalAttempts();
    if (saved?.attemptId === result.attemptId && loadResult()?.attemptId === result.attemptId) saveResult({...result,...saved,sections:result.sections});
    saveResultsCache(uid, state.results);
    clearFastReads("progress-results",`latest:${result.setIdx}`,`leaderboard:${groupFor(result.setIdx)}`);
    loadedViews.delete(`${uid}:results`);
    loadedViews.delete(`${uid}:start-result:${result.setIdx}`);
    loadedViews.delete(`${uid}:leaderboard:${groupFor(result.setIdx)}`);
  });
}
function stopAudio() {
  if (state._audio) { try { state._audio.pause(); } catch {} state._audio = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
async function playAudio(q) {
 if(!q?.au) return;
 const unlimited=!!state.practice;
 if(state._audio && state._audio.src===resolveUrl(q.au) && !state._audio.ended){
  if(state._audio.paused) await state._audio.play().catch(()=>toast("Audio playback failed","err"));
  else state._audio.pause();
  return;
 }
 if(!unlimited && (q.played||0)>=MAX_PLAYS) return toast("Audio playback limit reached","warn");
 stopAudio();
 if(q.au.startsWith("tts:")) {
  if(!("speechSynthesis" in window)) return toast("Speech is not supported","err");
  const u=new SpeechSynthesisUtterance(q.au.slice(4));u.lang="ja-JP";u.rate=.85;
  u.onstart=()=>{q.played=(q.played||0)+1;if(state.exam)saveExamState(state.exam);};speechSynthesis.speak(u);return;
 }
 const a=state._audio=new Audio(resolveUrl(q.au));
 let counted=false;
 a.onplaying=()=>{if(!counted){q.played=(q.played||0)+1;counted=true;} if(state.exam) saveExamState(state.exam);};
 const update=()=>{
  if($("playBtn")) $("playBtn").textContent=a.paused?"Play":"Pause";
  if($("audioTime")) $("audioTime").textContent=`${audioClock(a.currentTime)} / ${audioClock(a.duration)}`;
  if($("audioProgress")) $("audioProgress").value=isFinite(a.duration)?a.currentTime/a.duration*100:0;
  if($("audioLeft")) $("audioLeft").textContent=unlimited?"Unlimited practice":`${Math.max(0,MAX_PLAYS-(q.played||0))} plays left`;
 };
 a.ontimeupdate=a.onloadedmetadata=a.onpause=a.onplay=a.onended=update;
 a.onerror=()=>{toast("Audio unavailable. Check the file path or connection.","err");update();};
 await a.play().catch(()=>toast("Unable to play audio. Please retry.","err"));update();
}

/* ============ PRACTICE ============ */
async function startPractice(sectionKey) {
  if (!SECTIONS.some(section => section.key === sectionKey)) return;
  const uid = state.user?.uid;
  const pool = [];
  try {
    await Promise.all([readCatalog(true),checkFreeAccess()]);
    const candidates = ALL_SET_IDS.filter(visibleSet).map(idx => ({idx, random:Math.random()}))
      .sort((a,b) => a.random-b.random);
    for (const {idx} of candidates) {
      const rows = await readSetRows(idx);
      const section = examSet(idx, rows).sections.find(s => s.key === sectionKey);
      pool.push(...section.questions);
      if (pool.length >= 10) break;
    }
  } catch (error) {toast(error.message,"err"); return;}
  if (state.user?.uid !== uid || state.screen !== "practice") return;
  if (pool.length < 1) return toast("Not enough questions in this section", "err");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Math.min(10, pool.length));
  void warmAsset(picked[0].img,false,"high");
  const meta = SECTIONS.find(s => s.key === sectionKey);
  state.practice = {
    sections: [{ key: meta.key, name: meta.name, short: meta.short, marks: meta.marks,
      questions: picked, count: picked.length, icon: meta.icon }],
    si: 0, qi: 0, answeredCount: 0, maxReachable: 0
  };
  renderPracticeScreen();
}
function renderPracticeScreen() {
  const root = $("app");
  const pr = state.practice;
  if (!pr) return renderPractice();
  const sec = pr.sections[0];
  const q = sec.questions[pr.qi];
  const mediaHTML = mediaMarkup(q);
  const optsHTML = q.o.slice(0, q.o[3] ? 4 : 3).map((t, i) => `
    <button class="opt ${q.sel === i ? "sel" : ""}" data-popt="${i}" aria-pressed="${q.sel===i}">
      <div class="opt-ltr">${"ABCD"[i]}</div>
      <div class="opt-tx">${esc(t)}</div>
    </button>`).join("");
  const isLast = pr.qi === sec.questions.length - 1;
  root.innerHTML = `
    <div class="exam-bar"><div class="exam-bar-inner">
      <button class="xback" id="leaveBtn" aria-label="Leave test"></button>
      <div class="exam-info">
        <b>Practice · ${esc(sec.name)}</b>
        <span>Q ${pr.qi + 1} of ${sec.questions.length}</span>
      </div>
    </div></div>
    <div class="wrap" style="padding-bottom:40px">
      <div class="progress-bar"><i id="progressFill" style="width:${(pr.answeredCount / sec.questions.length) * 100}%"></i></div>
      <div class="palette">${sec.questions.map((qq, i) =>
        `<button class="pal-btn ${qq.sel !== undefined ? "ans" : ""} ${i === pr.qi ? "cur" : ""}"
          ${i > pr.maxReachable ? "disabled" : ""} data-pjump="${i}">${i + 1}</button>`).join("")}</div>
      <div class="q-card">
        <div class="q-meta">
          <span class="q-num">Q ${pr.qi + 1} of ${sec.questions.length}</span>
          <span class="q-tag">${esc(sec.short)}</span>
        </div>
        <div class="q-text">${esc(q.q)}</div>
        ${q.p ? `<div class="passage">${passageHTML(q.p)}</div>` : ""}
        ${mediaHTML}
        <div class="opts">${optsHTML}</div>${questionActions()}
      </div>
      <div class="exam-nav">
        <button class="btn btn-ghost" id="prevBtn" ${pr.qi === 0 ? "disabled" : ""}>← Previous</button>
        <button class="btn btn-primary" id="nextBtn" ${q.sel === undefined ? "disabled" : ""}>${isLast ? "Finish " : "Next →"}</button>
      </div>
    </div>`;
  document.querySelectorAll("[data-popt]").forEach(el => el.onclick = () => practiceSelect(+el.dataset.popt));
  document.querySelectorAll("[data-pjump]").forEach(el => el.onclick = () => {
    if (!el.disabled) { stopAudio(); pr.qi = +el.dataset.pjump; renderPracticeScreen(); }
  });
  $("prevBtn").onclick = () => { if (pr.qi > 0) { stopAudio(); pr.qi--; renderPracticeScreen(); } };
  $("nextBtn").onclick = () => {
    if (q.sel === undefined) return;
    if (pr.qi < sec.questions.length - 1) {
      stopAudio(); pr.qi++;
      if (pr.qi > pr.maxReachable) pr.maxReachable = pr.qi;
      renderPracticeScreen();
    } else finishPractice();
  };
  $("leaveBtn").onclick = () => {
    modal("Leave practice?", "Your progress will not be saved.",
      [{ label:"Stay", cls:"btn-ghost" },
       { label:"Leave", cls:"btn-danger", onClick: () => { stopAudio(); state.practice = null; navigate("practice"); } }]);
  };
  if ($("playBtn")) $("playBtn").onclick = () => playAudio(q);
  bindMedia();
  bindFastButtons(root);
}
function practiceSelect(i) {
  const pr = state.practice;
  if (!pr) return;
  const sec = pr.sections[0];
  sec.questions[pr.qi].sel = i;
  pr.answeredCount = sec.questions.filter(x => x.sel !== undefined).length;
  document.querySelectorAll(".opt").forEach((el, idx) => {el.classList.toggle("sel", idx === i);el.setAttribute("aria-pressed",String(idx===i));});
  const nb = $("nextBtn"); if (nb) nb.disabled = false;
  const palette = document.querySelectorAll(".pal-btn");
  if (palette[pr.qi]) palette[pr.qi].classList.add("ans");
  const pb = $("progressFill");
  if (pb) pb.style.width = (pr.answeredCount / sec.questions.length * 100) + "%";
}
function finishPractice() {
  const sec = state.practice.sections[0];
  let correct = 0;
  sec.questions.forEach(q => { if (q.sel === q.a) correct++; });
  const total = sec.questions.length;
  modal("Practice Complete", `<div class="center">
    <div style="font-size:48px;margin-bottom:8px">${correct/total >= 0.7 ? "" : ""}</div>
    <h3 style="font-size:32px;color:var(--purple);margin-bottom:4px">${correct}/${total}</h3>
    <p class="muted">${Math.round(correct/total*100)}% correct</p>
  </div>`, [{ label: "Done", cls: "btn-primary", onClick: () => {
    state.practice = null;
    navigate("home");
  }}]);
}

/* ============ SHARE ============ */
async function shareResult() {
  const r = loadResult();
  if (!r) return;
  const pass = r.score >= state.passMarks;
  const text = ` I scored ${Math.round(r.score)}/${r.maxScore} (${r.percentage}%) on Dream Japan JFT Mock Test!\nSet ${r.setIdx} · ${r.setName}\n${pass ? " PASSED" : " Practicing hard"}\n#JFT #DreamJapan`;
  if (navigator.share) {
    try { await navigator.share({ title: "Dream Japan JFT Result", text }); return; } catch {}
  }
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard ", "ok"); }
  catch { modal("Share Result", `<p style="white-space:pre-line;font-size:13px">${esc(text)}</p>`); }
}

/* ============ ADMIN BINDINGS ============ */
function bindAdminTab() {
  if (adminTab === "overview") {
    loadStats();
    $("refreshStats").onclick = () => {
      clearStudentPages();clearFastReads("catalog-server");
      return loadStats();
    };
    const rb = $("refreshQBtn");
    if (rb) rb.onclick = refreshQuestions;
  }
  if (adminTab === "students") {
const search = $("studentSearch");
    search.value = state._studentSearch || "";
    $("studentFilter").value = state._studentFilter || "all";
    search.oninput = debounce(() => {if ($("studentSearch") === search) filterStudents();}, 400);
    $("studentFilter").onchange = filterStudents;
    void loadStudents();
  }
  if (adminTab === "requests") loadRequests();
  if (adminTab === "reports") {
    $("reportFilter").onchange = () => loadQuestionReports();
    $("refreshReports").onclick = () => loadQuestionReports();
    loadQuestionReports();
  }
  if (adminTab === "questions") {
    $("qSearch").oninput = debounce(filterQuestions);
    bindSetPicker(loadQs);
    $("qSection").onchange=filterQuestions;
    $("setPreview").onclick=()=>previewSet();
    $("deleteSelected").onclick=deleteSelected;
    $("selectAll").onchange=e=>document.querySelectorAll("[data-qcheck]").forEach(c=>c.checked=e.target.checked);
    $("addQBtn").onclick = () => openQEditor(null);
    $("refreshQ2").onclick = refreshQuestions;
    loadQs();
  }
  if (adminTab === "settings") {
    $("saveConfig").onclick=async()=>{try{appConfig={...appConfig,esewaNumber:$("cfgEsewa").value.trim(),whatsappNumber:$("cfgWhatsapp").value.trim(),qrPath:$("cfgQR").value.trim(),installPromptEnabled:$("cfgInstall").checked};await setDoc(doc(db,"appConfig","main"),appConfig,{merge:true});clearFastReads("config");void publicCache("main",appConfig);toast("Settings saved","ok");}catch(e){toast(e.message,"err");}};
    $("addPlan").onclick=()=>editPlan();
    document.querySelectorAll("[data-edit-plan]").forEach(b=>b.onclick=()=>editPlan(b.dataset.editPlan));
bindSetPicker();
    $("exportBtn").onclick = exportJSON;
    $("importBtn").onclick = importJSON;
    $("exportLegacy").onclick = exportLegacyBank;
    $("splitLegacy").onclick = splitLegacyBank;
    $("indexStudents").onclick = indexStudentDirectory;
    const settings = $("mockSettingsRows");
    void memoRead("admin-catalog", () => readCatalog(true), 30000).then(() => {
      if (settings.isConnected) renderMockSettings();
    }).catch(error => {if (settings.isConnected) settings.textContent=error.message;});
  }
}

const studentCountQueries = {
  statTotal:"all",statActive:"active",statBlocked:"blocked",statPremium:"premium",
  statOnline:"online",statToday:"today",statExpired:"expired"
};
let studentQueryEpoch = 0;
let studentLoadToken = 0;
let studentQueryClock = Date.now();

function studentSearchText(user) {
  return [user.name,user.email,user.note,user.premium?.note].join(" ").normalize("NFKC").toLowerCase();
}

function studentGrams(user) {
  const chars = Array.from(studentSearchText(user));
  const grams = new Set();
  for (let i=0; i<chars.length; i++) {
    for (let n=1; n<=3 && i+n<=chars.length; n++) grams.add(chars.slice(i,i+n).join(""));
  }
  return [...grams];
}

function studentConstraints(filter, now) {
  const constraints = [where("directoryStudent","==",true)];
  let sort = "createdAt";
  switch (filter) {
    case "active": case "blocked": constraints.push(where("status","==",filter)); break;
    case "premium": case "expired":
      sort = "premium.expiry";

      constraints.push(where(sort,filter === "premium" ? ">" : "<=",new Date(now)));
      if (filter === "expired") constraints.push(where(sort,">",new Date(0)));
      break;
    case "online":
      sort = "lastSeen";
      constraints.push(where("status","==","active"),where(sort,">",new Date(now-7*60000)));
      break;
    case "today": {
      sort = "premium.start";
      const nepalOffset = 345*60000;
      const midnight = Math.floor((now+nepalOffset)/86400000)*86400000-nepalOffset;
      constraints.push(where(sort,">=",new Date(midnight)),where(sort,"<",new Date(midnight+86400000)));
      break;
    }
  }
  return {constraints,sort};
}

async function loadStats() {
  const container = $("statsLoadMessage");
  if (!container) return;
  const now = Date.now();
  const counts = Object.entries(studentCountQueries).map(([id,filter]) => [
    id, () => getCountFromServer(query(collection(db,"users"),...studentConstraints(filter,now).constraints,...(filter==="premium"?[where("status","==","active")]:[]))).then(s => s.data().count)
  ]);
  counts.push(
    ["statPending",() => getCountFromServer(query(collection(db,"accessRequests"),where("status","==","pending"))).then(s => s.data().count)],
    ["statReports",() => getCountFromServer(query(collection(db,"questionReports"),where("status","==","open"))).then(s => s.data().count)],
    ["statQuestions",async () => {
      await readCatalog(true);
      const known = ALL_SET_IDS.reduce((total,idx) => total+(setMeta(idx).questionCount||0),0);
      return catalog.legacySplit ? known : `${known} + legacy`;
    }]
  );
  const status = await Promise.allSettled(counts.map(async ([id,load]) => {
    const value = await memoRead(`stat:${id}`,load,60000);
    if (container.isConnected && $(id)) $(id).textContent = String(value);
  }));
  if (status.some(result => result.status === "rejected") && container.isConnected) {
    container.textContent = "Some counts are unavailable. Check Firestore indexes and try Refresh stats.";
    container.hidden = false;
  }
}

function clearStudentPages() {
  studentQueryEpoch++;
  studentQueryClock = Date.now();
  for (const key of fastReads.keys()) if (key.includes(":students-page:") || key.includes(":stat:")) fastReads.delete(key);
}

async function loadStudents() {
  const list = $("studentsList"), paging = $("studentPaging");
  if (!list || !paging) return;
  const token = ++studentLoadToken;
  const filter = $("studentFilter").value;
  const term = $("studentSearch").value.trim().normalize("NFKC").toLowerCase();
  const expanded = state._studentAll || filter !== "all" || !!term;
  const page = expanded ? state._studentPage || 0 : 0;
  const perPage = expanded ? 20 : 5;
  const {constraints,sort} = studentConstraints(filter, studentQueryClock);
  if (term) constraints.push(where("searchGrams","array-contains",Array.from(term).slice(0,3).join("")));
  const epoch = studentQueryEpoch;
  const key = number => `students-page:${epoch}:${filter}:${perPage}:${term}:${number}`;
  const prior = page ? fastReads.get(readScope(key(page-1)))?.promise : null;
  try {
    if (page && !prior) {state._studentPage=0; return loadStudents();}
    const cursor = prior ? (await prior).docs.at(-1) : null;
    if (page && !cursor) {state._studentPage=page-1; return loadStudents();}
const latest = !page && state._studentAll && filter==="all" && !term ?
      fastReads.get(readScope(`students-page:${epoch}:all:5::0`))?.promise : null;
    const snap = await memoRead(key(page), async () => {
      const preview = latest ? (await latest).docs : [];
      if (latest && preview.length < 5) return {docs:preview,size:preview.length};
      const anchor = cursor || preview.at(-1);
      const result = await getDocs(query(collection(db,"users"),...constraints,
        orderBy(sort,"desc"),...(anchor ? [startAfter(anchor)] : []),limit(perPage-preview.length)));
      const docs = [...preview,...result.docs];
      return {docs,size:docs.length};
    },120000);
    if (token !== studentLoadToken || !list.isConnected) return;
    const students = snap.docs.map(entry => ({...entry.data(),uid:entry.id}));
    state._allStudents = students.filter(student => !term || studentSearchText(student).includes(term));
    renderStudentRows(state._allStudents);
    paging.innerHTML = expanded
      ? `<button class="btn btn-ghost btn-sm" id="studentPrev" ${page===0?"disabled":""}>Previous</button><span>Page ${page+1}</span><button class="btn btn-ghost btn-sm" id="studentNext" ${snap.size<perPage?"disabled":""}>Next</button>`
      : '<button class="btn btn-primary btn-sm" id="studentAll">See All Students</button>';
    if (!state._allStudents.length && term && snap.size === perPage) {
      list.innerHTML = '<p class="muted center">No exact matches on this page. Select Next to continue the global search.</p>';
    }
    if ($("studentAll")) $("studentAll").onclick = () => {state._studentAll=true;return loadStudents();};
    if ($("studentPrev")) $("studentPrev").onclick = () => {state._studentPage=page-1;return loadStudents();};
    if ($("studentNext")) $("studentNext").onclick = () => {state._studentPage=page+1;return loadStudents();};
    bindFastButtons(paging);
  } catch (error) {
    if (token === studentLoadToken && list.isConnected) list.innerHTML = `<p class="muted" role="alert">${esc(error.message)}</p>`;
  }
}
function renderStudentRows(users) {
  const list = $("studentsList");
  if (!list) return;
  if (!users.length) { list.innerHTML = `<p class="muted center" style="padding:24px">No students found.</p>`; return; }
  list.innerHTML = users.map(u => {
    const premActive = u.premium && daysLeft(u.premium.expiry) > 0;
    return `<div class="admin-q-item">
      <div class="flex-between mb-1">
        <div><h4>${esc(u.name || "Unnamed")}</h4><p class="muted small">${esc(u.email)}</p></div>
        <div class="badges">
          ${u.status === "blocked" ? '<span class="badge badge-danger">Blocked</span>' : '<span class="badge badge-success">Active</span>'}
          ${premActive ? '<span class="badge badge-prem">Premium</span>' : ""}
          ${u.practiceAccess ? '<span class="badge badge-info">Practice</span>' : ""}
        </div>
      </div>
      <p class="muted small">Joined ${fmtDate(u.createdAt)}</p><p class="muted small">Note: ${esc(u.note||u.premium?.note||"No note")}</p><p class="muted small">Premium expires: ${fmtDate(u.premium?.expiry)}</p><div class="actions">
        <button data-uact="grant-prem" data-uid="${u.uid}">Grant Premium</button>
        <button data-uact="revoke" data-uid="${u.uid}">Remove Premium</button><button data-uact="note" data-uid="${u.uid}">Edit Note</button><button data-uact="device" data-uid="${u.uid}">Reset Device</button>
        <button class="${u.status === "blocked" ? "preview" : "del"}" data-uact="toggle-block" data-uid="${u.uid}" data-status="${u.status}">${u.status === "blocked" ? "Unblock" : "Block"}</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-uact]").forEach(b => {
    b.onclick = () => {
      if (["revoke","device","note"].includes(b.dataset.uact)) return studentAction(b.dataset.uact,b.dataset.uid);
      if (b.dataset.uact === "grant-prem") return grantPremium(b.dataset.uid);
      else if (b.dataset.uact === "toggle-practice") return togglePractice(b.dataset.uid, b.dataset.val === "true");
      else if (b.dataset.uact === "toggle-block") return toggleBlock(b.dataset.uid, b.dataset.status);
    };
  });
  bindFastButtons(list);
}
function filterStudents() {
  state._studentSearch = $("studentSearch").value;
  state._studentFilter = $("studentFilter").value;
  state._studentPage = 0;
  if (Date.now()-studentQueryClock > 120000) clearStudentPages();
  return loadStudents();
}
async function loadRequests(cursor) {
  const list = $("requestsList");
  if (!list) return;
  try {
    const snap = await memoRead(cursor ? `requests-after:${cursor.id}` : "adminRequests",()=>getDocs(query(collection(db,"accessRequests"),orderBy("createdAt","desc"),...(cursor?[startAfter(cursor)]:[]),limit(20))));
    if (!list.isConnected) return;
    const reqs = [];
    snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
    if (!reqs.length && !cursor) { list.innerHTML = `<p class="muted center" style="padding:24px">No requests yet.</p>`; return; }
    const rows = reqs.map(r => `
      <div class="admin-q-item">
        <div class="flex-between mb-1">
          <div><h4>${esc(r.name || r.email || r.uid)}</h4>
            <p class="muted small">${esc(r.type)}${r.planName ? " · " + esc(r.planName) : ""} · ${fmtDate(r.createdAt)}</p></div>
          <span class="badge badge-${r.status === "pending" ? "warn" : r.status === "approved" ? "success" : "danger"}">${esc(r.status)}</span>
        </div>
        <p class="muted small">${esc(r.email||"")} · ${Number(r.days||0)} days · NPR ${Number(r.planPrice||0)}</p><p class="muted small">Transaction: ${esc(r.paymentRef||"Legacy request")}</p>${r.status === "pending" ? `<div class="actions">
          <button class="preview" data-ract="approve" data-rid="${r.id}" data-uid="${r.uid}" data-type="${esc(r.type)}" data-plan="${esc(r.planId||"")}">Approve</button>
          <button class="del" data-ract="reject" data-rid="${r.id}">Reject</button>
        </div>` : ""}
      </div>`).join("");
    $("moreRequests")?.remove();
    if (cursor) list.insertAdjacentHTML("beforeend",rows); else list.innerHTML=rows;
    if (snap.size===20) {
      list.insertAdjacentHTML("beforeend", '<button class="btn btn-ghost mt-2" id="moreRequests">Load more requests</button>');
      $("moreRequests").onclick = () => loadRequests(snap.docs.at(-1));
    }
    list.querySelectorAll("[data-ract]").forEach(b => {
      b.onclick = () => {
        if (b.dataset.ract === "approve") return approveRequest(b.dataset.rid, b.dataset.uid, b.dataset.type, b.dataset.plan);
        else return rejectRequest(b.dataset.rid);
      };
    });
  } catch (e) { list.innerHTML = `<p class="muted" style="color:var(--red)">${esc(e.message)}</p>`; }
  bindFastButtons(list);
}
async function loadQs() {
  const list = $("questionsList");
  if (!list) return;
  try {
const idx = adminQuestionSet;
    const token = ++questionLoadId;
    state._allQs = [];
    list.innerHTML = '<p class="muted center">Loading…</p>';
    $("qCount").textContent = "";
    await memoRead("admin-catalog", () => readCatalog(true), 30000);
    const rows = await readSetRows(idx,{admin:true});
    if (!list.isConnected || token !== questionLoadId || idx !== adminQuestionSet) return;
    state._allQs = rows;
    $("qCount").textContent = `${rows.length} questions`;
    filterQuestions();
  } catch (e) { list.innerHTML = `<p class="muted" style="color:var(--red)">${esc(e.message)}</p>`; }
}
function filterQuestions() {
 const q=($("qSearch")?.value||"").toLowerCase(), set=$("qSet")?.value, sec=$("qSection")?.value;
 state._visibleQs=(state._allQs||[]).filter(r=>(!set||r.set===+set)&&(!sec||r.section===sec)&&[r.question,r.passage].join(" ").toLowerCase().includes(q));
 renderQRows(state._visibleQs);
}
function renderQRows(rows) {
  const list = $("questionsList");
  if (!list) return;
  if (!rows.length) { list.innerHTML = `<p class="muted center" style="padding:24px">No questions.</p>`; return; }
  list.innerHTML = rows.map((r, i) => `
    <div class="admin-q-item">
      <div class="badges">
        <span class="badge badge-info">Set ${setNumber(r.set)}</span>
        <span class="badge badge-muted">${esc((SECTIONS.find(s => s.key === r.section) || {}).short || r.section)}</span>
        <span class="badge badge-muted">Ans: ${esc(r.answer)}</span>
        ${r.image ? '<span class="badge badge-muted"></span>' : ""}
        ${r.audio ? '<span class="badge badge-muted"></span>' : ""}
      </div>
      <label><input type="checkbox" data-qcheck="${esc(r.id)}"> Select question</label><div class="qtxt">${esc((r.question || "").slice(0, 200))}</div>
      <div class="actions">
        <button class="preview" data-qact="preview" data-i="${i}">Preview</button>
        <button data-qact="up" data-i="${i}">Move up</button><button data-qact="down" data-i="${i}">Move down</button><button class="edit" data-qact="edit" data-i="${i}">Edit</button>
        <button class="del" data-qact="del" data-i="${i}">Delete</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-qact]").forEach(b => {
    b.onclick = () => {
      const row = rows[+b.dataset.i];
      if(["up","down"].includes(b.dataset.qact)) return moveQuestion(row,b.dataset.qact==="up"?-1:1);
      if (b.dataset.qact === "preview") previewQ(row);
      else if (b.dataset.qact === "edit") openQEditor(row);
      else if (b.dataset.qact === "del") deleteQ(row);
    };
  });
  bindFastButtons(list);
}
function openQEditor(rowOrNull) {
  const isEdit = !!rowOrNull;
  const r = rowOrNull || { set:adminQuestionSet, section:"sv", question:"", passage:"", image:"", audio:"", answer:"A", A:"", B:"", C:"", D:"" };
  modal(isEdit ? "Edit Question" : "Add Question", `
    <div class="grid-2">
      <div class="field"><label>Set</label>
        <select id="qeSet" class="input">${groupSets(adminQuestionGroup).map(s =>
          `<option value="${s.idx}" ${r.set===s.idx?"selected":""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Section</label>
        <select id="qeSec" class="input">${SECTIONS.map(s =>
          `<option value="${s.key}" ${r.section === s.key ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Question</label><textarea id="qeQ" class="input">${esc(r.question)}</textarea></div>
    <div class="field"><label>Passage (optional · HTML supported)</label><textarea id="qeP" class="input">${esc(r.passage || "")}</textarea></div>
    <div class="field"><label>Image</label><input type="text" id="qeImg" class="input" value="${esc(r.image || "")}" placeholder="photos/q1.jpg"></div>
    <div class="field"><label>Audio</label><input type="text" id="qeAu" class="input" value="${esc(r.audio || "")}" placeholder="audio/q1.mp3"></div>
    <div class="field"><label>Marks (optional)<input id="qeMarks" type="number" min="1" max="250" class="input" value="${esc(r.marks ?? "")}"></label></div>
    <div class="field"><label>Explanation (optional)<textarea id="qeExplain" class="input">${esc(r.explanation || "")}</textarea></label></div>
    <div class="field"><label>Correct</label>
      <select id="qeAns" class="input">${"ABCD".split("").map(l =>
        `<option value="${l}" ${r.answer === l ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="grid-2">
      <div class="field"><label>A</label><input type="text" id="qeA" class="input" value="${esc(r.A)}"></div>
      <div class="field"><label>B</label><input type="text" id="qeB" class="input" value="${esc(r.B)}"></div>
      <div class="field"><label>C</label><input type="text" id="qeC" class="input" value="${esc(r.C)}"></div>
      <div class="field"><label>D (optional)</label><input type="text" id="qeD" class="input" value="${esc(r.D)}"></div>
    </div>`,
    [
      { label: "Cancel", cls: "btn-ghost" },
      { label: isEdit ? "Update" : "Add", cls: "btn-primary", onClick: () => saveQ(rowOrNull, isEdit) }
    ]);
}
async function saveQ(original, isEdit) {
  const row = {
    ...original,id:original?.id||uuid(),set:+$("qeSet").value,section:$("qeSec").value,
    question:$("qeQ").value.trim(),passage:$("qeP").value.trim(),
    image:$("qeImg").value.trim(),audio:$("qeAu").value.trim(),answer:$("qeAns").value,
    marks:$("qeMarks").value === "" ? null : Number($("qeMarks").value),
    explanation:$("qeExplain").value.trim()
  };
  for (const key of "ABCD") row[key] = $(`qe${key}`).value.trim();
  if (!validQuestion(row)) return toast("Check the question, options, correct answer and marks.","err");
  try {
    const source = original?.set || row.set;
    await writeBanks([...new Set([source,row.set])], banks => {
      const rows = banks.get(source);
      if (isEdit) {
        const index = rows.findIndex(item => item.id === original.id);
        if (index < 0) throw new Error("This question was removed. Reload and try again.");
        if (source === row.set) {rows[index] = row; return;}
        rows.splice(index,1);
      }
      banks.get(row.set).push(row);
    });
    toast(isEdit ? "Updated" : "Added","ok");
    await loadQs();
  } catch (error) {toast(error.message,"err");}
}

function validQuestion(row) {
  return row && Number.isInteger(row.set) && defaultSets[row.set] && SECTIONS.some(section => section.key===row.section)
    && row.question && row.A && row.B && row.C && /^[ABCD]$/.test(row.answer) && !!row[row.answer]
    && (row.marks == null || row.marks === "" || (Number(row.marks)>0 && Number(row.marks)<=250));
}

function previewQ(row) { if(row){modal("Question preview",questionPreview(row));bindMedia();} }

async function deleteQ(row) {
  modal("Delete question?","This removes the question from the set.",[{label:"Cancel",cls:"btn-ghost"},
    {label:"Delete",cls:"btn-danger",onClick:async () => {
      try {await mutateQuestions(row.set, rows => rows.filter(item => item.id!==row.id)); await loadQs();}
      catch (error) {toast(error.message,"err");}
    }}]);
}

async function refreshQuestions() {
  clearQCache();
  clearFastReads("admin-catalog");
  if ($("questionsList")) return loadQs();
  for (const key of fastReads.keys()) if (key.includes(":stat:statQuestions")) fastReads.delete(key);
  return loadStats();
}

function downloadJSON(filename,content) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:"application/json"}));
  const link = document.createElement("a");
  link.href=url;link.download=filename;link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function exportJSON() {
  const idx = adminQuestionSet;
  try {
    await readCatalog(true);
    const rows = await readSetRows(idx,{admin:true});
    downloadJSON(`${groupFor(idx)}-${setKey(idx)}.json`,{
      group:groupFor(idx),questions:rows.map(row => ({...row,set:setNumber(row.set)}))
    });
  } catch (error) {toast(error.message,"err");}
}

async function importJSON() {
  const group = adminQuestionGroup;
  const selected = adminQuestionSet;
  try {
    const parsed = JSON.parse($("importText").value);
    const input = Array.isArray(parsed) ? parsed : parsed.questions;
    if (!Array.isArray(input) || !input.length) throw new Error("Provide a nonempty questions array.");
    if (parsed.group && parsed.group!==group) throw new Error("Select the group named in the JSON.");
    const grouped = new Map();
    for (const source of input) {
      const raw = Array.isArray(source) ? source[0] : source?.set;
      const number = raw == null || raw === "" ? setNumber(selected) : Number(raw);
      const idx = GROUPS[group].first+number-1;
      if (!Number.isInteger(number) || number<1 || number>6) throw new Error("Each set number must be between 1 and 6.");
      const row = normalizeRow(source);
      if (!row) throw new Error("Invalid question row.");
      row.set=idx;row.id ||= uuid();
      if (!validQuestion(row)) throw new Error(`Invalid question in set ${number}. Check its section, answer, options and marks.`);
      if (!grouped.has(idx)) grouped.set(idx,[]);
      grouped.get(idx).push(row);
    }
    const targets = [...grouped.keys()].map(setNumber).sort((a,b)=>a-b).join(", ");
    if (!confirm(`Replace ${GROUPS[group].label} set(s) ${targets} with ${input.length} questions? Export existing questions first.`)) return;
    await writeBanks([...grouped.keys()], banks => {
      for (const [idx,rows] of grouped) banks.set(idx,rows);
    });
    renderMockSettings();toast(`Imported ${input.length} questions`,"ok");
  } catch (error) {toast(error.message,"err");}
}
async function grantPremium(uid) {
 const plans=state.plans.length ? state.plans : await memoRead("admin-plans",loadPlans,60000);
 if (!plans.length) return toast("Create a premium plan in Settings first.","warn");
 modal("Grant Premium",`<label>Plan</label><select class="input" id="grantPlan">${plans.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><label>Number of days</label><input id="grantDays" class="input" type="number" min="1" max="3650" step="1" value="15"><label>Admin note</label><textarea id="grantNote" class="input"></textarea>`,[
 {label:"Cancel",cls:"btn-ghost"},{label:"Activate",onClick:async()=>{const days=Number($("grantDays").value);if(!Number.isInteger(days)||days<1||days>3650)return toast("Enter 1 to 3650 whole days","err");if(await safeAction("adminMembership",{action:"grant",uid,planId:$("grantPlan").value,days,note:$("grantNote").value})) {toast("Premium activated","ok");loadStudents();}}}]);
}
async function togglePractice(uid, value) {
  clearStudentPages();
  try {
    await updateDoc(doc(db, "users", uid), { practiceAccess: value });
    toast(`Practice ${value ? "granted" : "revoked"} `, "ok");
    loadStudents();
  } catch (e) { toast("Failed: " + e.message, "err"); }
}
async function toggleBlock(uid, currentStatus) {
  const newStatus = currentStatus === "blocked" ? "active" : "blocked";
  modal(`${newStatus === "blocked" ? "Block" : "Unblock"} user?`, `Status will change to "${newStatus}".`,
    [{ label: "Cancel", cls: "btn-ghost" },
     { label: "Confirm", cls: newStatus === "blocked" ? "btn-danger" : "btn-primary", onClick: async () => {
       try {
         await updateDoc(doc(db, "users", uid), { status: newStatus });
         clearStudentPages();
         toast(`User ${newStatus}`, "ok"); loadStudents();
       } catch (e) { toast("Failed: " + e.message, "err"); }
     }}]);
}
async function approveRequest(rid,uid,type,planId) {
 if(type!=="premium") return toast("Legacy practice requests cannot activate paid access. Choose Grant Premium in Students.","warn");
 if(await safeAction("adminMembership",{action:"approve",rid,uid,planId})){void updatePendingCount();toast("Payment approved and premium activated","ok");loadRequests();}
}
async function rejectRequest(rid) {
  try {
    await updateDoc(doc(db, "accessRequests", rid), { status: "rejected" });
    clearFastReads("adminRequests","stat:statPending");void updatePendingCount();
    toast("Rejected", "ok"); loadRequests();
  } catch (e) { toast("Failed: " + e.message, "err"); }
}

/* ============ AUTH LISTENER & BOOT ============ */
function renderWithBootTarget(screen, params) {
  if (screen === "loading" || screen === "login" || screen === "signup") {
    replaceNavigate(params.next || "home");
  } else if (screen === "exam") {
    const saved = loadExamState();
    if (saved) {
      state.screen = "exam";
      state.params = params;
      void resumeExamFromSaved(saved);
    } else {
      replaceNavigate("sets");
    }
  } else {
    state.screen = screen;
    state.params = params;
    render();
  }
}

const loadedViews = new Map();

async function loadView(key, load, apply, ttl = 60000) {
  const uid = state.user?.uid;
  const screen = state.screen;
  const tab = adminTab;
  const scoped = `${uid}:${key}`;
  const previous = loadedViews.get(scoped);
  if (previous?.pending || (previous && Date.now() - previous.time < ttl)) return;
  const entry = {pending:true,time:Date.now()};
  loadedViews.set(scoped, entry);
  try {
    const value = await load();
    if (state.user?.uid !== uid || loadedViews.get(scoped) !== entry) return;
    apply(value);
    entry.time = Date.now();
    if (!state.exam && !state.practice && state.screen===screen && (screen!=="admin" || tab===adminTab)) render();
  } catch (error) {
    entry.time = Date.now();
    toast(error.message || "Could not load this view", "err");
  } finally { entry.pending = false; }
}

async function readAppConfig() {
  const data = await memoRead("config", async () => {
    const cached = await publicCache("main");
    if (cached) return cached;
    const snap = await getDocFromServer(doc(db, "appConfig", "main"));
    const value = snap.data() || {};
    void publicCache("main", value);
    return value;
  }, PUBLIC_CACHE_TTL);
  appConfig = {...appConfig, ...data};
  return appConfig;
}

function loadRouteData() {
  if (!state.user || !state.profile || state.profile.status === "blocked") return;
  const uid = state.user.uid;
  const screen = state.screen;
  if (["home","sets","start"].includes(screen)) {
    void loadView("catalog", () => readCatalog(), () => {}, PUBLIC_CACHE_TTL);
  }
  if (screen === "start") {
    const idx = Number(state.params.set || 0)+1;
    if (defaultSets[idx] && visibleSet(idx)) void loadView(`start-result:${idx}`, () => loadSetResult(uid,idx), row => {
      if (row) state.results=latestBySet([row,...state.results]);
    },RESULTS_TTL);
  }
  if (screen === "profile") {
    void memoRead("support-config",readAppConfig,PUBLIC_CACHE_TTL).catch(console.warn);
    void loadView("results", () => memoRead("progress-results", () => loadResults(uid), RESULTS_TTL), rows => {state.results = latestBySet([...rows,...state.results]);}, RESULTS_TTL);
  }
  if (screen === "profile" || screen === "premium") {
    void loadView("profile-refresh", freshProfile, () => {}, 60000);
  }
  if (screen === "premium" || (screen === "admin" && adminTab === "settings")) {
    void loadView("plans", async () => Promise.all([
      screen === "premium" ? loadPlansCached() : loadPlans(), readAppConfig()
    ]), ([plans]) => {state.plans = plans;});
  }
  if (screen === "admin" && adminTab !== "students") void updatePendingCount();
  if (screen === "leaderboard") {
    const group = studentGroup();
    void loadView(`leaderboard:${group}`, () => loadLeaderboard(group), rows => {
      (state.leaderboards ||= {})[group] = rows;
    }, 30000);
  }
  if (screen === "bookmarks") {
    void loadView("bookmarks", async () => {try {state.bookmarkError=null;return await loadBookmarkSets();} catch(error) {state.bookmarkError=error.message;return []; }}, sets => {state.sets = sets;}, 30000);
  }
}

async function freshProfile() {
  const uid = requireSession();
  return memoRead("profile-server", async () => {
    const snap = await getDocFromServer(doc(db, "users", uid));
    if (state.user?.uid !== uid || !snap.exists()) throw new Error("Please sign in again");
    state.profile = {uid, ...snap.data()};
    saveProfileCache(uid, state.profile);
    return state.profile;
  }, 0);
}

async function ensureSetAccess(idx, profile) {
  if (!defaultSets[idx]) throw new Error("Invalid mock test set");
  if (!profile) [, profile] = await Promise.all([readCatalog(true), freshProfile()]);
  if (!visibleSet(idx)) { comingSoon(); return false; }
  if (state.isAdmin) return true;
  if (profile.status !== "active") throw new Error("This account is unavailable.");
  if (setMeta(idx).access === "free") return true;
  await checkFreeAccess(profile);
  return true;
}

async function loadBookmarkSets() {
const ids = [...new Set((state.profile.bookmarks || []).map(mark => mark.set))];
  if (!ids.length) return [];
  const [, profile] = await Promise.all([readCatalog(true),freshProfile()]);
  const permitted = ids.filter(idx => defaultSets[idx] && visibleSet(idx) && canUseSet(idx));
  if (permitted.some(idx => setMeta(idx).access === "premium")) await checkFreeAccess(profile);
  const rows = await Promise.all(permitted.map(idx => readSetRows(idx)));
  return buildSets(rows.flat());
}

async function updatePendingCount() {
  if (!state.isAdmin) return;
  const uid = state.user.uid;
  try {
    const count = await memoRead("stat:statPending", () => getCountFromServer(query(collection(db,"accessRequests"),where("status","==","pending"))).then(snap => snap.data().count),60000);
    if (state.user?.uid !== uid) return;
    state._pendingCount=count;
    if ($("pendingAdminCount")) $("pendingAdminCount").textContent=String(count);
  } catch {}
}

function loadDataInBackground() {
  loadedViews.clear();
  clearFastReads("catalog", "catalog-server");
  return loadRouteData();
}
let presenceTimer;

function startPresence() {
  clearInterval(presenceTimer);
  if (state.isAdmin || state.profile?.status !== "active") return;
  void touchPresence();
  presenceTimer = setInterval(touchPresence, 5 * 60000);
}

async function touchPresence() {
  const uid = state.user?.uid;
  if (!uid || state.isAdmin || state.profile?.status !== "active" || document.visibilityState !== "visible") return;
  if (navigator.onLine === false) return;
  const key = `dj_presence_${uid}`;
  try {
    const now = Date.now();
    if (now - Number(localStorage.getItem(key)) < 4 * 60000) return;
    localStorage.setItem(key, String(now));
    await updateDoc(doc(db, "users", uid), { lastSeen: serverTimestamp() });
  } catch (error) {
    console.warn("Could not update recent activity", error);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void touchPresence();
});

let authGeneration = 0;
onAuthStateChanged(auth, async (user) => {
  const generation = ++authGeneration;
  const previousUid = state.user?.uid;
  clearInterval(presenceTimer);
  clearInterval(state._tick);
  clearInterval(state._lockTick);
  stopAudio();
  clearFastReads();
  fastJobs.clear();
  loadedViews.clear();
  questionCache.clear();
  warmMedia.clear();
  state._studentSearch="";state._studentFilter="all";state._studentPage=0;state._studentAll=false;state.reviewAllowed=null;state._pendingCount=0;
  adminQuestionGroup=OCT;adminQuestionSet=1;adminTab="overview";
  clearStudentPages();
  if (previousUid && previousUid !== user?.uid) {
    clearProfileCache();
    clearExamState();
    clearResult();
    invalidateResultsCache(previousUid);
  }
  Object.assign(state, {user,profile:null,isAdmin:false,sets:[],results:[],plans:[],leaderboards:{},exam:null,
    practice:null,_allStudents:null,_allQs:null,_paymentDraft:null});
  if (!user) {
    closeModal();
    const {screen} = parseHash();
    replaceNavigate(screen === "signup" ? "signup" : "login", ["signup","login","home"].includes(screen) ? {} : {next:screen});
    return;
  }
  state.isAdmin = user.email === ADMIN_EMAIL && user.emailVerified;
  state.results = latestBySet([...(loadResultsCache(user.uid) || []), ...readLocalAttempts(user.uid)]);
  let redirectTarget;
  try { redirectTarget = sessionStorage.getItem(REDIRECT_AFTER_KEY); sessionStorage.removeItem(REDIRECT_AFTER_KEY); } catch {}
  if (redirectTarget?.startsWith("#/")) history.replaceState({}, "", redirectTarget);
  const {screen,params} = parseHash();
  const cached = loadProfileCache(user.uid);
  if (cached && cached.status === "active" && ["home","login","signup"].includes(screen) && !params.next) {
    state.profile = cached;
    state.screen = "home";
    render();
  }
  try {
    const profile = await ensureUserProfile(user);
    if (generation !== authGeneration || auth.currentUser?.uid !== user.uid) return;
    state.profile = profile;
    loadedViews.set(`${user.uid}:profile-refresh`,{time:Date.now()});
    if (profile.status !== "active" && !state.isAdmin) {
      state.screen = "home";
      render();
      modal("Account Blocked", "<p>Your account is unavailable. Contact the administrator.</p>",
        [{label:"Logout",cls:"btn-danger",onClick:logout,keepOpen:true}]);
      return;
    }
    if (state.screen === "home" && cached && ["home","login","signup"].includes(screen) && !params.next) {
      if (screen !== "home") replaceNavigate("home");
      else render();
    } else renderWithBootTarget(screen, params);
    startPresence();
  } catch (error) {
    if (generation !== authGeneration) return;
    toast("Load error: " + error.message, "err");
    await signOut(auth);
  }
});
// Save one compact checkpoint when the page is hidden; elapsed time uses startedAt.
window.addEventListener("pagehide",()=>{if(state.exam)saveExamState(state.exam);});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&state.exam)saveExamState(state.exam);});
/* Keyboard shortcuts for exam */
window.addEventListener("keydown", (e) => {
  if (state.screen !== "exam") return;
  if (e.target.matches("input, textarea, select")) return;
  if (document.querySelector(".overlay.show")) return;
  const k = e.key.toLowerCase();
  if (["a","b","c","d"].includes(k)) {
    const opt = document.querySelector(`[data-opt="${"abcd".indexOf(k)}"]`);
    if (opt) opt.click();
  } else if (k === "arrowright") $("nextBtn")?.click();
  else if (k === "arrowleft") $("prevBtn")?.click();
});

/* Firestore-only edition: no Cloud Functions. */
let appConfig={esewaNumber:"",whatsappNumber:"97766157755",qrPath:"photos/esewa.jpg",installPromptEnabled:true};
let deferredInstall=null;
function navIcon(key){const paths={home:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',sets:'M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5',premium:'m3 7 5 4 4-7 4 7 5-4-2 13H5Z',profile:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3'};return `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key]||paths.home}"/></svg>`;}

function uuid(){const bytes=crypto.getRandomValues(new Uint8Array(16));return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
function deviceId(){
 let id=localStorage.getItem("dj_device_v2");
 if(!id || !/^[a-f0-9]{64}$/i.test(id)){id=uuid()+uuid();localStorage.setItem("dj_device_v2",id);}
 return id;
}
/* BEGIN FIRESTORE ACTIONS: browser-managed transactions; no paid server runtime. */
function membershipUntil(value){
 if(value?.toMillis)return value.toMillis();
 if(value?.toDate)return value.toDate().getTime();
 if(value && typeof value==='object' && (value.seconds??value._seconds)!=null)return (value.seconds??value._seconds)*1000;
 return value ? new Date(value).getTime() : 0;
}
function requireSession(){if(!state.user)throw new Error('Please sign in first');return state.user.uid;}
function activeProfile(profile){return !!profile && profile.status!=='blocked' && membershipUntil(profile.premium?.expiry)>Date.now();}
function rowList(data){
 const raw=Array.isArray(data?.questions)?data.questions:Object.values(data||{}).find(Array.isArray)||[];
 return raw.map(normalizeRow).filter(Boolean).map((r,i)=>({...r,id:r.id||`legacy_${i}`}));
}
async function checkFreeAccess(profile) {
  const uid = requireSession();
  if (state.isAdmin) return {ok:true};
  const current = profile || await freshProfile();
  if (!activeProfile(current)) throw new Error("An active premium plan is required.");
  const browser = deviceId();
  return onceJob("browser-access", async () => {
    const ref = doc(db, "deviceBindings", uid);
    const binding = await getDocFromServer(ref);
    if (state.user?.uid !== uid) throw new Error("Please sign in again");
    if (binding.exists()) {
      if (binding.data().deviceId !== browser) throw new Error("Premium is linked to another browser. Ask the admin to reset your device.");
    } else {
      try { await setDoc(ref, {deviceId:browser,boundAt:serverTimestamp()}); }
      catch (error) {
        const existing = await getDocFromServer(ref);
        if (!existing.exists() || existing.data().deviceId !== browser) throw error;
      }
    }
    return {ok:true};
  });
}
async function createPremiumRequest(data){
 const uid=requireSession();
 if(typeof data.planId!=='string'||!data.planId||data.planId.includes('/'))throw new Error('Select a valid plan');
 const reference=String(data.paymentRef||'').trim();if(!reference||reference.length>120)throw new Error('Enter a valid eSewa transaction reference');
 // Preserve pending requests created by the older version as well.
 const legacy=await getDocs(query(collection(db,'accessRequests'),where('uid','==',uid),where('status','==','pending')));
 if(!legacy.empty)throw new Error('You already have a pending request. Please wait for admin verification.');
 const requestRef=doc(db,'accessRequests',uid),browser=deviceId();
 await runTransaction(db,async tx=>{
  const [u,p,r,b]=await Promise.all([tx.get(doc(db,'users',uid)),tx.get(doc(db,'plans',data.planId)),tx.get(requestRef),tx.get(doc(db,'deviceBindings',uid))]);
  if(!u.exists()||u.data().status==='blocked')throw new Error('Account unavailable');
  if(r.exists()&&r.data().status==='pending')throw new Error('You already have a pending request');
  if(!p.exists()||p.data().active===false)throw new Error('This plan is unavailable');
  const plan=p.data();
  if(typeof plan.name!=='string'||!plan.name.trim()||!Number.isInteger(plan.days)||plan.days<1||plan.days>3650||typeof plan.price!=='number'||!Number.isFinite(plan.price)||plan.price<0)throw new Error('Admin must save a valid plan name, numeric price and whole number of days in Settings');
  if(b.exists()&&b.data().deviceId!==browser)throw new Error('Use your linked browser, or ask admin to reset the device');
  tx.set(requestRef,{uid,email:state.user.email||'',name:String(u.data().name||'Student').slice(0,100),type:'premium',planId:data.planId,planName:plan.name,planPrice:plan.price,days:plan.days,paymentRef:reference,deviceId:browser,status:'pending',createdAt:serverTimestamp()});
 });
 return {requestId:uid};
}
async function changeMembership(data){
 requireSession();if(!state.isAdmin)throw new Error('Verified admin required');
 const uid=data.uid,action=data.action;
 if(typeof uid!=='string'||!uid||uid.includes('/'))throw new Error('Invalid student');
 if(!['approve','grant','revoke','resetDevice'].includes(action))throw new Error('Invalid membership action');
 if(action==='approve'&&(typeof data.rid!=='string'||!data.rid||data.rid.includes('/')))throw new Error('Invalid request');
 const auditRef=doc(collection(db,'adminAuditLogs'));
 await runTransaction(db,async tx=>{
  const userRef=doc(db,'users',uid),bindingRef=doc(db,'deviceBindings',uid);
  const u=await tx.get(userRef);if(!u.exists())throw new Error('Student not found');
  let reqRef=null,request=null,plan=null,days=Number(data.days),planId=data.planId||'',browser=null;
  if(action==='approve'){
   reqRef=doc(db,'accessRequests',data.rid);const snap=await tx.get(reqRef);
   if(!snap.exists())throw new Error('Request not found');request=snap.data();
   if(request.uid!==uid||request.status!=='pending'||request.type!=='premium')throw new Error('This request is not awaiting premium approval');
   planId=request.planId||planId;
   if(planId && !planId.includes('/')){const p=await tx.get(doc(db,'plans',planId));if(p.exists())plan=p.data();}
   days=Number(request.days??plan?.days);
   plan={name:request.planName||plan?.name||'Premium'};browser=request.deviceId||null;
  }else if(action==='grant'){
   if(typeof planId!=='string'||!planId||planId.includes('/'))throw new Error('Select a plan first');
   const p=await tx.get(doc(db,'plans',planId));if(!p.exists())throw new Error('Plan not found');plan=p.data();
  }
  // All transaction reads above this point, all writes below.
  if(action==='revoke')tx.update(userRef,{premium:null,practiceAccess:false,searchGrams:studentGrams({...u.data(),premium:null})});
  else if(action==='resetDevice')tx.delete(bindingRef);
  else {
   if(!Number.isInteger(days)||days<1||days>3650)throw new Error('Enter 1 to 3650 whole days');
   const now=Date.now(),existing=membershipUntil(u.data().premium?.expiry)||0,note=String(data.note??(action==='approve'?'Payment approved':'')).slice(0,1000);
   const premium={plan:String(plan.name||"Premium"),planId,start:new Date(now),expiry:new Date(Math.max(now,existing)+days*86400000),note};
   tx.update(userRef,{premium,practiceAccess:false,note,searchGrams:studentGrams({...u.data(),note,premium})});
   if(browser)tx.set(bindingRef,{deviceId:browser,boundAt:serverTimestamp()});
   if(reqRef)tx.update(reqRef,{status:'approved',resolvedAt:serverTimestamp()});
  }
  tx.set(auditRef,{admin:state.user.uid,uid,action,createdAt:serverTimestamp()});
 });
 return {ok:true};
}
async function firestoreAction(name,data={}){
 requireSession();
 switch(name){
  case 'requestPremium':return createPremiumRequest(data);
  case 'adminMembership':return changeMembership(data);

  default:throw new Error('Unknown app action');
 }
}
async function safeAction(name,data={}){
 try{const result=await onceJob("action:"+name+":"+JSON.stringify(data),()=>firestoreAction(name,data));if(["requestPremium","adminMembership"].includes(name)){clearStudentPages();clearFastReads("adminRequests","pendingRequests");}return result;}catch(error){
  console.error('Dream Japan Firestore action failed',{action:name,code:error.code||'app/error',message:error.message});
  const code=String(error.code||'');
  const message=code.includes('permission-denied')?'Access denied. Publish the new no-upgrade Firestore rules, then sign out and sign in again.':code.includes('unavailable')?'Connection unavailable. Reconnect and try again.':error.message||'Unable to complete this action';
  toast(message,'err');return null;
 }
}
/* END FIRESTORE ACTIONS */

function hasPremium(){return !!state.user && state.profile?.status!=="blocked" && (state.isAdmin || !!state.profile?.premium && daysLeft(state.profile.premium.expiry)>0);}

function audioClock(sec){return Number.isFinite(sec)?`${pad(Math.floor(sec/60))}:${pad(Math.floor(sec%60))}`:"00:00";}
function mediaMarkup(q){return `<div class="media fixed-media">${q.img?`<div class="image-slot"><img src="${esc(resolveUrl(q.img))}" alt="Question illustration" decoding="async" fetchpriority="high" data-question-img><span class="image-error" hidden>Image unavailable</span><button type="button" class="image-zoom" aria-label="Zoom in image" data-image-zoom>⊕</button></div>`:""}${q.au?`<div class="audio-row" id="audRow"><button class="play-btn" id="playBtn" aria-label="Play or pause audio">Play</button><div class="audio-details"><span id="audioTime">00:00 / 00:00</span><progress id="audioProgress" value="0" max="100" aria-label="Audio progress"></progress><small id="audioLeft">${state.practice?"Unlimited practice":Math.max(0,MAX_PLAYS-(q.played||0))+" plays left"}</small></div></div>`:""}</div>`;}
function previewMedia(q){return `${q.img?`<div class="image-slot"><img src="${esc(resolveUrl(q.img))}" alt="Question illustration" loading="lazy" data-question-img><span class="image-error" hidden>Image unavailable</span><button type="button" class="image-zoom" aria-label="Zoom in image" data-image-zoom>⊕</button></div>`:""}${q.au? q.au.startsWith("tts:")?"<p>Japanese speech audio</p>":`<audio controls preload="none" src="${esc(resolveUrl(q.au))}"></audio>`:""}`;}

function openQuestionReport() {
  const exam = state.practice || state.exam;
  const section = exam?.sections[exam.si];
  const question = section?.questions[exam.qi];
  if (!question || !state.user) return;
  const ref = doc(collection(db, "questionReports"));
  const uid = state.user.uid;
  const questionNumber = exam.qi + 1;
  modal("Report this question", `
    <p>Set ${setNumber(question.set)} · ${esc(section.name)} · Q${questionNumber}</p>
    <label class="field mt-2">What needs fixing?
      <textarea id="reportReason" class="input" maxlength="1000" rows="3" required></textarea>
    </label><p class="muted small">Your report goes to the Dream Japan admin dashboard.</p>`,
    [{label: "Cancel", cls: "btn-ghost"}, {label: "Submit report", keepOpen: true, onClick: async () => {
      const reason = $("reportReason")?.value.trim();
      if (!reason) return toast("Describe the issue first", "warn");
      if (state.user?.uid !== uid) return toast("Please sign in again", "err");
      try {
        await setDoc(ref, {
          uid, email: state.user.email || "", setIdx: Number(question.set),
          section: section.key, questionId: String(question.id || "").slice(0, 160), questionNumber,
          question: String(question.q || "").slice(0, 500), reason, status: "open",
          createdAt: serverTimestamp()
        });
        if ($("reportReason")) closeModal();
        clearFastReads("adminOpenReports");
        toast("Report submitted to the admin", "ok");
      } catch (error) {
        toast("Could not submit report. Please try again.", "err");
        console.warn("Question report", error);
      }
    }}]);
}

function bindMedia(){
 prefetchUpcoming();
 document.querySelectorAll("[data-image-zoom]").forEach(b=>b.onclick=()=>{const img=b.parentElement.querySelector("img");if(img?.naturalWidth)openImageZoom(img.src);});

 document.querySelectorAll("[data-report]").forEach(button => button.onclick = openQuestionReport);
 document.querySelectorAll("[data-question-img]").forEach(img=>{img.onerror=()=>{img.style.visibility="hidden";const e=img.parentElement.querySelector(".image-error");if(e)e.hidden=false;};});
 document.querySelectorAll("[data-bookmark]").forEach(b=>{
  const ex=state.practice||state.exam, sec=ex?.sections[ex.si], q=sec?.questions[ex.qi];
  if(!q)return;
  const qi=q.originalIndex??ex.qi;
  const selected=(state.profile?.bookmarks||[]).some(v=>v.set===q.set&&(q.id&&v.id ? v.id===q.id : v.section===q.section&&v.qi===qi));
  b.textContent=selected?"▣ Bookmarked":"▢ Bookmark";b.setAttribute("aria-pressed",String(selected));
  b.onclick=async()=>{await toggleBookmark(q.set,q.section,qi);bindMedia();};
 });
}

const mediaJobs=new Map(),heldMedia=new Map();
function warmAsset(source,isAudio=false,priority="low"){
 const url=resolveUrl(source);if(!url||/^(tts:|scene:)/.test(url))return Promise.resolve(true);
 if(Date.now()-(warmMedia.get(url)||0)<300000)return Promise.resolve(true);
 if(mediaJobs.has(url))return mediaJobs.get(url);
 const job=new Promise(resolve=>{
  const el=isAudio?new Audio():new Image();heldMedia.set(url,el);
  let done=false;
  const finish=ok=>{if(done)return;done=true;clearTimeout(timer);el.onload=el.onerror=el.oncanplaythrough=el.onloadeddata=null;if(ok)warmMedia.set(url,Date.now());else heldMedia.delete(url);resolve(ok);};
  const timer=setTimeout(()=>finish(false),10000);
  el.onerror=()=>finish(false);
  if(isAudio){el.preload="auto";el.oncanplaythrough=el.onloadeddata=()=>finish(true);}
  else {el.decoding="async";el.fetchPriority=priority;el.onload=()=>finish(true);}
  el.src=url;if(isAudio)el.load();
 });mediaJobs.set(url,job);job.finally(()=>mediaJobs.delete(url));return job;
}
function warmQuestion(q,priority="low"){return Promise.all([warmAsset(q.img,false,priority),warmAsset(q.au,true,priority)]);}
function prefetchUpcoming(){
 const ex=state.practice||state.exam;if(!ex)return;
 const upcoming=ex.sections.flatMap((s,i)=>i<ex.si?[]:i===ex.si?s.questions.slice(ex.qi+1):s.questions).slice(0,3);
 upcoming.forEach(q=>void warmQuestion(q));
}

function openImageZoom(src){
 const dialog=document.createElement("dialog");dialog.className="image-viewer";
 dialog.innerHTML=`<div class="zoom-toolbar"><button type="button" data-scale aria-label="Zoom in">⊕</button><button type="button" data-close aria-label="Zoom out and close">⊖ Close</button></div><div class="zoom-scroll"><img src="${esc(src)}" alt="Enlarged question image"></div>`;
 document.body.append(dialog);let large=false;const button=dialog.querySelector("[data-scale]");button.onclick=()=>{large=!large;dialog.classList.toggle("magnified",large);button.textContent=large?"⊖":"⊕";button.setAttribute("aria-label",large?"Zoom out":"Zoom in");};
 dialog.querySelector("[data-close]").onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();
}
async function copyText(value){try{await navigator.clipboard.writeText(value);toast("Copied","ok");}catch{modal("Copy this value",`<input class="input" readonly value="${esc(value)}" onclick="this.select()">`);}}
async function openPayment(planId){
 const plan=state.plans.find(p=>p.id===planId);if(!plan)return;
 const token=state._paymentOpenToken=(state._paymentOpenToken||0)+1;
 modal("Opening payment",`<p>Loading payment details…</p>`,[{label:"Cancel",cls:"btn-ghost"}]);
 let pending;
 try{[pending]=await Promise.all([getDocs(query(collection(db,"accessRequests"),where("uid","==",state.user.uid),where("status","==","pending"))),readAppConfig()]);}catch(error){if(token===state._paymentOpenToken)closeModal();throw error;}
 if(token!==state._paymentOpenToken||!$("modal").classList.contains("show"))return;
 if(!pending.empty)return modal("Request already pending","Your payment request is waiting for admin verification. Please do not submit again.");
 const email=state.user.email||"";
 modal("Pay with eSewa",`<p><b>${esc(plan.name)} · NPR ${Number(plan.price)}</b> · ${Number(plan.days)} days</p><img class="payment-qr" src="${esc(resolveUrl(appConfig.qrPath))}" alt="Admin eSewa payment QR"><p>eSewa number</p><button class="copy-value" id="copyEsewa">${esc(appConfig.esewaNumber||"Admin must configure the payment number")} · Copy</button><p class="mt-2">Payment remark: your email</p><button class="copy-value" id="copyEmail">${esc(email)} · Copy</button><label class="field mt-2">eSewa transaction reference<input id="paymentRef" class="input" maxlength="120" value="${esc(state._paymentDraft?.planId===planId?state._paymentDraft.reference:"")}" placeholder="Enter transaction ID" required></label><p class="muted small">Use this same browser after payment. Admin verification is required.</p>`,[{label:"Cancel",cls:"btn-ghost"},{label:"Payment completed",keepOpen:true,onClick:async()=>{
 const ref=$("paymentRef").value.trim();state._paymentDraft={planId,reference:ref};if(!ref)return toast("Enter your eSewa transaction reference","err");
 if(state._requestSubmitting)return;
 state._requestSubmitting=true;
 let r;try{r=await safeAction("requestPremium",{planId,paymentRef:ref});}finally{state._requestSubmitting=false;}
 if(!r)return;
 closeModal();
 const msg=`Dream Japan premium payment verification\nEmail: ${email}\nPlan: ${plan.name}\nAmount: NPR ${plan.price}\nReference: ${ref}\nRequest: ${r.requestId}`;
 modal("Payment request submitted",`<p>The admin can now see your pending request in Requests.</p><a class="btn btn-primary mt-2" target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(String(appConfig.whatsappNumber).replace(/\D/g,""))}?text=${encodeURIComponent(msg)}">Open WhatsApp message</a><p class="muted small mt-2">Review and send the message in WhatsApp.</p>`);
 }}]);
 $("copyEsewa").onclick=()=>copyText(appConfig.esewaNumber||"");$("copyEmail").onclick=()=>copyText(email);
}
function questionPreview(row){const q=buildSets([row])[row.set-1]?.sections.find(s=>s.key===row.section)?.questions[0];if(!q)return "Invalid question";return `<article class="q-card"><p class="muted">Set ${setNumber(row.set)} · ${esc(row.section)}</p><div class="q-text">${esc(q.q)}</div>${q.p?`<div class="passage">${passageHTML(q.p)}</div>`:""}${previewMedia(q)}<div class="opts">${q.o.map((v,i)=>v?`<div class="opt ${i===q.a?"sel":""}"><div class="opt-ltr">${"ABCD"[i]}</div><div class="opt-tx">${esc(v)}</div></div>`:"").join("")}</div><p class="muted small">Admin answer: ${esc(row.answer)}</p>${q.explanation ? `<p class="small">${esc(q.explanation)}</p>` : ""}</article>`;}
function previewSet(){const rows=state._visibleQs||[];if(!rows.length)return toast("No questions to preview","warn");modal("Set preview",rows.map(questionPreview).join(""));bindMedia();}
const MAX_BANK_BYTES = 700000;

function serializeBank(rows, version) {
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Question IDs must be unique within each set.");
  const payload = {version,questions:rows};
  if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_BANK_BYTES) {
    throw new Error("This set exceeds the size budget. Use media URLs and shorten oversized question fields.");
  }
  return {...payload,updatedAt:serverTimestamp()};
}

async function writeBanks(ids, transform) {
  if (!state.isAdmin) throw new Error("Admin access required.");
  const next = await runTransaction(db, async tx => {
    const snapshot = await tx.get(catalogRef());
    const data = snapshot.data() || {legacySplit:false,sets:{}};
    if (ids.some(idx => groupFor(idx)===OCT) && !data.legacySplit)
      throw new Error("Split the October–November bank in Settings first.");
    const refs = ids.map(bankRef);
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    const banks = new Map(ids.map((idx,i) => [idx,rowList(snapshots[i].data())]));
    transform(banks);
    data.sets ||= {};
    for (let i=0; i<ids.length; i++) {
      const idx = ids[i], rows = banks.get(idx);
      const meta = catalogEntry(data,idx);
      const version = meta.version+1;
      data.sets[setKey(idx)] = {...meta,version,questionCount:rows.length,
        isPublished:meta.isPublished && rows.length>0};
      tx.set(refs[i],serializeBank(rows,version));
    }
    tx.set(catalogRef(),data);
    return data;
  });
  cachedCatalog(next);
}

function mutateQuestions(idx, transform) {
  return writeBanks([idx],banks => banks.set(idx,transform(banks.get(idx))));
}

async function moveQuestion(row,delta) {
  try {
    await mutateQuestions(row.set, rows => {
      const at = rows.findIndex(item => item.id===row.id);
      if (at < 0) throw new Error("Question was removed.");
      const same = rows.map((item,i) => item.section===row.section ? i : -1).filter(i => i>=0);
      const other = same[same.indexOf(at)+delta];
      if (other!==undefined) [rows[at],rows[other]]=[rows[other],rows[at]];
      return rows;
    });
    await loadQs();
  } catch (error) {toast(error.message,"err");}
}

function deleteSelected() {
  const ids = new Set([...document.querySelectorAll("[data-qcheck]:checked")].map(input => input.dataset.qcheck));
  if (!ids.size) return toast("Select questions first","warn");
  const idx = adminQuestionSet;
  modal("Delete selected questions?",`${ids.size} questions will be removed.`,[{label:"Cancel",cls:"btn-ghost"},
    {label:"Delete",cls:"btn-danger",onClick:async () => {
      try {await mutateQuestions(idx,rows => rows.filter(row => !ids.has(row.id))); await loadQs();}
      catch (error) {toast(error.message,"err");}
    }}]);
}

async function exportLegacyBank() {
  try {
    const snapshot = await getDocFromServer(doc(db,QUESTIONS_DOC));
    if (!snapshot.exists()) throw new Error("Original bank was not found.");
    downloadJSON("dream-japan-original-octnov-bank.json",snapshot.data());
  } catch (error) {toast(error.message,"err");}
}

function splitLegacyBank() {
  modal("Split the October–November bank", "<p>Back up the original bank first. This copies the six sets into separate documents and switches the app to those copies.</p>",
    [{label:"Cancel",cls:"btn-ghost"},{label:"Split bank",onClick:async () => {
      try {
        const next = await runTransaction(db, async tx => {
          const [meta,source,...existing] = await Promise.all([
            tx.get(catalogRef()),tx.get(doc(db,QUESTIONS_DOC)),...groupSetIds(OCT).map(idx => tx.get(bankRef(idx)))
          ]);
          const data = meta.data() || {legacySplit:false,sets:{}};
          if (data.legacySplit) return data;
          if (!source.exists() || existing.some(snap => snap.exists())) throw new Error("Original bank is missing or target documents already exist.");
          const rows = rowList(source.data());
          if (!rows.length || rows.some(row => !groupSetIds(OCT).includes(row.set))) throw new Error("Original bank contains unknown set numbers.");
          data.sets ||= {};
          for (const idx of groupSetIds(OCT)) {
            const bank = rows.filter(row => row.set===idx);
            const previous = catalogEntry(data,idx);
            data.sets[setKey(idx)] = {...previous,version:1,questionCount:bank.length};
            tx.set(bankRef(idx),serializeBank(bank,1));
          }
          data.legacySplit=true;
          tx.set(catalogRef(),data);
          return data;
        });
        cachedCatalog(next);renderMockSettings();toast("October–November bank split","ok");
      } catch (error) {toast(error.message,"err");}
    }}]);
}

function indexStudentDirectory() {
  modal("Build student search index","<p>This setup reads existing profiles in batches and writes searchable fields. Leave this tab open until it completes.</p>",
    [{label:"Cancel",cls:"btn-ghost"},{label:"Build index",onClick:backfillStudentDirectory}]);
}

async function backfillStudentDirectory() {
  const uid = requireSession();
  const progress = $("studentIndexStatus");
  let cursor, checked=0, changed=0;
  try {
    while (state.user?.uid===uid && state.isAdmin) {
      const snapshot = await getDocs(query(collection(db,"users"),orderBy("__name__"),
        ...(cursor?[startAfter(cursor)]:[]),limit(100)));
      if (snapshot.empty) break;
      await Promise.all(snapshot.docs.map(profile => runTransaction(db,async tx => {
        const current = await tx.get(profile.ref);
        if (!current.exists()) return;
        const data = current.data();
        const directoryStudent = current.id!==uid && data.email!==ADMIN_EMAIL;
        const searchGrams = studentGrams(data);
        const createdAt = data.createdAt || data.lastLogin || new Date(0);
        if (data.directoryStudent===directoryStudent && JSON.stringify(data.searchGrams)===JSON.stringify(searchGrams) && data.createdAt) return;
        tx.update(profile.ref,{directoryStudent,searchGrams,createdAt});
        return true;
      }))).then(updates => {changed+=updates.filter(Boolean).length;});
      checked+=snapshot.size;
      cursor=snapshot.docs.at(-1);
      if (progress?.isConnected) progress.textContent=`Checked ${checked} accounts. Updated ${changed}.`;
      if (snapshot.size<100) break;
    }
    if (state.user?.uid !== uid || !state.isAdmin) return;
    await setDoc(doc(db,"appConfig","studentDirectory"),{version:1,initializedAt:serverTimestamp()});
    clearStudentPages();
    if (progress?.isConnected) progress.textContent=`Student index ready. Checked ${checked} accounts. Updated ${changed}.`;
    toast("Student search index ready","ok");
  } catch (error) {toast(error.message,"err");}
}
async function studentAction(action,uid){
 if(action==="note"){const u=state._allStudents?.find(u=>u.uid===uid);modal("Student note",`<textarea class="input" id="studentNote">${esc(u?.note||"")}</textarea>`,[{label:"Cancel",cls:"btn-ghost"},{label:"Save",onClick:async()=>{try{const note=$("studentNote").value.slice(0,1000);await updateDoc(doc(db,"users",uid),{note,searchGrams:studentGrams({...u,note})});clearStudentPages();loadStudents();}catch(e){toast(e.message,"err");}}}]);return;}
 modal(action==="device"?"Reset this student's device?":"Remove premium?",action==="device"?"The next browser to access premium will become the bound browser.":"Paid tests and practice will be disabled.",[{label:"Cancel",cls:"btn-ghost"},{label:"Confirm",onClick:async()=>{if(await safeAction("adminMembership",{uid,action:action==="device"?"resetDevice":"revoke"})){toast("Updated","ok");loadStudents();}}}]);
}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;updateInstallBanner();});
window.addEventListener("appinstalled",()=>{deferredInstall=null;document.getElementById("installBanner")?.remove();});
function updateInstallBanner(){
 const existing=document.getElementById("installBanner");
 if(!appConfig.installPromptEnabled||!deferredInstall||["exam","practice","admin"].includes(state.screen)||matchMedia("(display-mode: standalone)").matches){existing?.remove();return;}
 if(existing||sessionStorage.getItem("dj_install_dismiss"))return;
 const div=document.createElement("div");div.id="installBanner";div.className="install-banner";div.innerHTML='<span>Install Dream Japan for a full screen app experience.</span><button class="btn btn-primary btn-sm" id="installNow">Install</button><button class="btn btn-ghost btn-sm" id="dismissInstall">Later</button>';document.body.append(div);
 $("installNow").onclick=async()=>{await deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;div.remove();};
 $("dismissInstall").onclick=()=>{sessionStorage.setItem("dj_install_dismiss","1");div.remove();};
}

function enhancedSettings(){return `<div class="card mt-2"><h3>Payment and install settings</h3><label>eSewa number<input class="input" id="cfgEsewa" value="${esc(appConfig.esewaNumber)}"></label><label>WhatsApp number with country code<input class="input" id="cfgWhatsapp" value="${esc(appConfig.whatsappNumber)}"></label><label>QR path<input class="input" id="cfgQR" value="${esc(appConfig.qrPath)}"></label><label><input type="checkbox" id="cfgInstall" ${appConfig.installPromptEnabled?"checked":""}> Show install suggestion</label><button class="btn btn-primary mt-2" id="saveConfig">Save settings</button></div><div class="card mt-2"><h3>Premium plans</h3><div id="adminPlans">${state.plans.map(p=>`<div class="plan-row"><b>${esc(p.name)}</b><span>NPR ${Number(p.price)} · ${Number(p.days)} days · ${p.active!==false?"Active":"Hidden"}</span><button class="btn btn-sm btn-ghost" data-edit-plan="${esc(p.id)}">Edit</button></div>`).join("")}</div><button id="addPlan" class="btn btn-primary mt-2">Add plan</button></div>`;}
function editPlan(id){const p=state.plans.find(p=>p.id===id)||{name:"",price:500,days:15,active:true,benefits:[]};modal(id?"Edit plan":"Add plan",`<label>Name<input id="planName" class="input" value="${esc(p.name)}"></label><label>Price NPR<input id="planPrice" class="input" type="number" min="0" value="${Number(p.price)}"></label><label>Days<input id="planDays" class="input" type="number" min="1" value="${Number(p.days)}"></label><label>Benefits, one per line<textarea id="planBenefits" class="input">${esc(p.benefits.join("\n"))}</textarea></label><label><input id="planActive" type="checkbox" ${p.active!==false?"checked":""}> Available for purchase</label>`,[{label:"Cancel",cls:"btn-ghost"},{label:"Save",onClick:async()=>{const plan={name:$("planName").value.trim(),price:Number($("planPrice").value),days:Number($("planDays").value),active:$("planActive").checked,benefits:$("planBenefits").value.split("\n").map(v=>v.trim()).filter(Boolean)};if(!plan.name||!Number.isFinite(plan.price)||plan.price<0||!Number.isInteger(plan.days)||plan.days<1||plan.days>3650)return toast("Enter valid plan details","err");try{await setDoc(doc(db,"plans",id||uuid()),plan);state.plans=await loadPlans();render();}catch(e){toast(e.message,"err");}}}]);}
window.addEventListener("unhandledrejection",e=>{console.error(e.reason);toast(e.reason?.message||"Request failed. Please retry.","err");});
window.addEventListener("offline",()=>toast("Connection lost. Current media may remain available; reconnect to save results.","warn"));

/* Requested additions: renewal, upcoming series and home learning insights. */
function renewalEligible(profile = state.profile) {
  return !!state.user && !state.isAdmin && profile?.status !== "blocked" &&
    !!profile?.premium && Number.isFinite(membershipUntil(profile.premium.expiry)) &&
    membershipUntil(profile.premium.expiry) > 0;
}
function renewalPrice(plan) {
  return Math.round(Number(plan.price) * 60) / 100;
}
function renewalNoticeHTML() {
  if (!renewalEligible() || membershipUntil(state.profile.premium.expiry) > Date.now()) return "";
  return `<aside id="renewalNotice" class="renewal-notice wrap" aria-label="Premium expiry notification"><div><span class="badge badge-danger">Premium expired</span><h3>Your next chapter starts with 40% off</h3><p>${state.screen === "home" ? `Your premium expired on ${esc(fmtDate(state.profile.premium.expiry))}. Renew with your 40% returning-member discount.` : `तपाईंको premium ${esc(fmtDate(state.profile.premium.expiry))} मा सकिएको छ। पुरानो सदस्य भएकाले renewal मा 40% छुट पाउनुहोस्।`}</p></div><button class="btn btn-prem" id="renewFromNotice">Renew · Save 40% →</button></aside>`;
}
function updateRenewalNotice() {
  const existing = document.getElementById("renewalNotice");
  if (!state.user || ["exam", "practice", "loading", "admin"].includes(state.screen)) { existing?.remove(); return; }
  const html = renewalNoticeHTML();
  if (!html) { existing?.remove(); return; }
  if (!existing) document.querySelector("#app .topbar")?.insertAdjacentHTML("afterend", html);
  if ($("renewFromNotice")) $("renewFromNotice").onclick = () => navigate("premium");
  const key = `dj_expiry_notice_${state.user.uid}_${membershipUntil(state.profile.premium.expiry)}`;
  let shown = state._expiryNoticeKey === key;
  try { shown ||= sessionStorage.getItem(key) === "1"; } catch {}
  if (!shown) {
    state._expiryNoticeKey = key;
    try { sessionStorage.setItem(key, "1"); } catch {}
    toast("Your premium has expired. Renew with 40% off on WhatsApp.", "warn");
  }
}
async function openRenewal(planId) {
  if (!renewalEligible()) return toast("A previous premium membership is required for this offer.", "warn");
  const plan = state.plans.find(p => p.id === planId && p.active !== false);
  if (!plan || !Number.isFinite(Number(plan.price)) || Number(plan.price) < 0) return toast("This plan is unavailable.", "warn");
  const uid = state.user.uid;
  const discounted = renewalPrice(plan);
  modal("40% off your premium renewal", `<p>Preparing your WhatsApp renewal message…</p>`);
  try {
    await readAppConfig();
  } catch {
    if (state.user?.uid === uid && $("modal").classList.contains("show")) modal("Please reconnect", "Could not load the admin WhatsApp number. Please reconnect and try again.");
    return;
  }
  if (state.user?.uid !== uid || !renewalEligible() || !$("modal").classList.contains("show")) return;
  const number = String(appConfig.whatsappNumber || "").replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(number)) return modal("Contact admin", "The admin needs to configure a valid WhatsApp number in Settings.");
  const message = `नमस्ते Dream Japan! म पुरानो premium सदस्य हुँ र 40% discount मा renew गर्न चाहन्छु।\nName: ${state.profile.name || "Student"}\nEmail: ${state.user.email || ""}\nStudent ID: ${uid}\nPrevious plan: ${state.profile.premium.plan || "Premium"}\nPremium expiry: ${fmtDate(state.profile.premium.expiry)}\nRenewal plan: ${plan.name}\nDuration: ${Number(plan.days)} days\nRegular price: NPR ${Number(plan.price)}\nRenewal discount: 40%\nRenewal amount: NPR ${discounted}\nकृपया मेरो पुरानो membership verify गरेर renewal payment details पठाइदिनुहोस्।`;
  modal("Your 40% renewal offer", `<div class="renewal-offer"><span class="badge badge-prem">SAVE 40%</span><h2>${esc(plan.name)}</h2><p><s>NPR ${Number(plan.price).toLocaleString()}</s> <strong>NPR ${discounted.toLocaleString()}</strong></p><p>${Number(plan.days)} days access</p></div><a class="btn btn-teal btn-block mt-2" target="_blank" rel="noopener noreferrer" href="https://wa.me/${number}?text=${encodeURIComponent(message)}">Continue on WhatsApp →</a><p class="muted small mt-2">Review and send in WhatsApp. Admin approval required.</p>`, [{label:"Cancel", cls:"btn-ghost"}]);
}
function openUpcomingMock() { navigate("sets", {group:DEC}); }
function learningSummary(rows = state.results || []) {
  const latest = latestBySet(rows);
  const sections = SECTIONS.map(meta => {
    let correct = 0, total = 0, samples = 0, score = 0, max = 0;
    latest.forEach(row => {
      const section = (row.sections || []).find(s => s.key === meta.key || s.name === meta.name || s.short === meta.short);
      if (!section) return;
      const items = Array.isArray(section.items) ? section.items : [];
      if (items.length) {
        correct += items.filter(it => it.yourAns != null && it.yourAns === it.correctAns).length;
        total += items.length;
      } else if (Number.isFinite(Number(section.score)) && Number(section.max) > 0) {
        score += Number(section.score); max += Number(section.max);
      }
      if (items.length || Number(section.max) > 0) samples++;
    });
    // Score-only legacy results are converted to question-equivalent counts using section marks.
    const equivalentTotal = total + max / meta.marks;
    const equivalentCorrect = correct + score / meta.marks;
    const percent = equivalentTotal > 0 ? Math.min(100, Math.max(0, Math.round(equivalentCorrect / equivalentTotal * 100))) : null;
    return {...meta, percent, samples, total};
  });
  const scored = latest.filter(r => Number.isFinite(Number(r.score)) && Number(r.maxScore) > 0);
  const max = scored.reduce((sum, r) => sum + Number(r.maxScore), 0);
  const average = max ? Math.round(scored.reduce((sum, r) => sum + Number(r.score), 0) / max * 100) : null;
  return {latest, sections, average};
}
function renderLearningSummary() {
  const {latest, sections, average} = learningSummary();
  const tips = {
    sv: "Review scripts and everyday vocabulary. Make flashcards for missed words.",
    ce: "Practise everyday dialogues and response patterns. Read examples aloud.",
    lc: "Listen for time, place and key details. Replay audio to check missed words.",
    rc: "Read short notices and messages. Look for keywords, dates and times."
  };
  const measured = sections.filter(s => s.percent !== null).sort((a,b) => a.percent - b.percent);
  const weak = measured.filter(s => s.percent < 80);
  const priorities = weak.slice(0,2);
  return `<section class="card learning-summary mt-2" aria-labelledby="learningSummaryTitle"><div class="flex-between"><div><h3 id="learningSummaryTitle">Latest results</h3></div><span class="badge badge-info">${latest.length}/${ALL_SET_IDS.length} sets</span></div><p class="muted small mt-1">Latest attempt per set · Target: 80%.</p>${!latest.length ? `<div class="learning-empty"><b>Your progress starts here</b><p class="muted">Complete a mock test to see your results, weak areas and next steps.</p><button class="btn btn-primary btn-sm mt-2" data-go="sets">Start a mock test →</button></div>` : `<div class="learning-stats"><div><strong>${average === null ? "—" : average + "%"}</strong><span>Overall score</span></div><div><strong>${latest.filter(r=>Number(r.percentage)>=80).length}/${latest.length}</strong><span>Sets at target</span></div><div><strong>${weak.length}</strong><span>Sections to improve</span></div></div><div class="learning-section-list">${sections.map(s=>`<article class="learning-section"><div class="flex-between"><b>${esc(s.short)}</b><span class="badge ${s.percent === null ? "badge-muted" : s.percent < 60 ? "badge-danger" : s.percent < 80 ? "badge-warn" : "badge-success"}">${s.percent === null ? "No data" : s.percent + "% · " + (s.percent < 60 ? "Focus first" : s.percent < 80 ? "Improve" : "On target")}</span></div><div class="learning-track" role="meter" aria-label="${esc(s.name)}" aria-valuemin="0" aria-valuemax="100" ${s.percent === null ? 'aria-valuetext="No data"' : `aria-valuenow="${s.percent}"`}><span style="width:${s.percent ?? 0}%;background:${s.percent < 60 ? "var(--red)" : s.percent < 80 ? "var(--amber)" : "var(--green)"}"></span></div></article>`).join("")}</div><div class="learning-advice"><h4>${priorities.length ? "Focus on these next" : measured.length ? "Good progress. Keep going." : "Section details not available"}</h4>${priorities.map(s=>`<p><b>${esc(s.short)}:</b> ${tips[s.key]}</p>`).join("")}${!priorities.length ? `<p>${measured.length ? "Your measured sections are on target. Try remaining sets and review missed questions." : "Complete another mock test to unlock section tips."}</p>` : ""}<button class="btn btn-ghost btn-sm mt-1" data-go="practice">Practise a section →</button></div>`}<details class="learning-sets" ><summary>Latest results by set</summary>${ALL_SET_IDS.map(idx=>{const set=setMeta(idx);const r=latest.find(row=>Number(row.setIdx)===idx);return `<div class="learning-set-row"><span><b>${GROUPS[set.group].label} · Set ${set.number}</b> · ${esc(set.name)}</span>${r ? `<button class="btn btn-ghost btn-sm" data-summary-set="${idx}">${Number(r.percentage)||0}% · View result →</button>` : `<span class="badge badge-muted">Not attempted</span>`}</div>`;}).join("")}</details></section>`;
}
async function openLearningProgress() {
  const uid = requireSession();
  const local = memoRead("progress-results", () => loadResults(uid), RESULTS_TTL);
  const rows = await local;
  if (state.user?.uid !== uid || state.screen !== "home") return;
  state.results = latestBySet([...rows,...state.results]);
  modal("Your learning progress", `<div class="progress-dialog">${renderLearningSummary()}</div>`, [{label:"Back", cls:"btn-ghost"}, {label:"Done", cls:"btn-primary"}]);
  bindAddedFeatures();
  $("modal").querySelectorAll("[data-go]").forEach(button => button.onclick = () => {closeModal();navigate(button.dataset.go);});
}
function bindAddedFeatures() {
  if ($("homeProgressButton")) $("homeProgressButton").onclick=openLearningProgress;
  document.querySelectorAll("[data-renew-plan]").forEach(b=>b.onclick=()=>openRenewal(b.dataset.renewPlan));
  if ($("upcomingMockButton")) $("upcomingMockButton").onclick=openUpcomingMock;
  document.querySelectorAll("[data-summary-set]").forEach(b=>b.onclick=()=>{
    const result=(state.results||[]).find(r=>Number(r.setIdx)===Number(b.dataset.summarySet));
    if (result) {closeModal();saveResult(result);navigate("result");}
  });
}

/* ============ INIT ============ */
clearQCache();
initHistory();
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});

// Refresh expiry notices while the app is open, and when returning to the tab.
setInterval(updateRenewalNotice, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateRenewalNotice(); });
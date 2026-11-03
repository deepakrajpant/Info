/* ============================================================
   Dream Japan — JFT Mock Test (3-file SPA)
   v4.1.0 — faster button feedback, deduplicated reads, compact exam checkpoints
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot, orderBy, limit, runTransaction, deleteDoc
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
const CACHE_TTL = 60 * 60 * 1000;                // was 30 min
const PLANS_CACHE_KEY = "dj_plans_v1";
const PLANS_TTL = 24 * 60 * 60 * 1000;           // 24h
const PROFILE_CACHE_KEY = "dj_profile_v1";
const PROFILE_TTL = 24 * 60 * 60 * 1000;
const RESULTS_CACHE_KEY = "dj_results_v1";
const RESULTS_TTL = 60 * 60 * 1000;
const LAST_LOGIN_KEY = "dj_last_login_update";
const EXAM_MIN = 60;
const MAX_PLAYS = 2;
const PASS_PCT = 0.8;
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
  _userSub: null, _tick: null, _audio: null,
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
 fastReads.set(scoped,next);return next.promise;
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
function mergeAttempts(cloud,local){const map=new Map();for(const r of [...cloud,...local]){const id=r.attemptId||r.id;if(!map.has(id))map.set(id,r);}return [...map.values()].sort((a,b)=>resultTime(b)-resultTime(a));}
function resultTime(r){const t=r.submittedAt;return t?.seconds?t.seconds*1000:Date.parse(t)||0;}
function saveLocalAttempts(){if(!state.user)return;try{localStorage.setItem("dj_attempt_history_"+state.user.uid,JSON.stringify(state.results));}catch{toast("Browser storage is full; keep this result open until cloud saving completes.","warn");}}
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
  if (state._userSub) { state._userSub(); state._userSub = null; }
  if(state._requestsSub){state._requestsSub();state._requestsSub=null;}
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
    const last = +localStorage.getItem(LAST_LOGIN_KEY) || 0;
    if (Date.now() - last < 60 * 60 * 1000) return;
    await updateDoc(doc(db, "users", uid), { lastLogin: serverTimestamp() });
    localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()));
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
    createdAt: serverTimestamp(), lastLogin: serverTimestamp()
  };
  try {
    await setDoc(doc(db, "users", user.uid), profile);
    localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()));
  } catch (e) { throw e; }
  return { uid: user.uid, ...profile };
}

// NO cache → getDoc; has cache → return cache (background refresh handled elsewhere)
async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const profile = { uid: user.uid, ...snap.data() };
      saveProfileCache(user.uid, profile);
      touchLastLogin(user.uid); // background, throttled
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
  if (Array.isArray(r)) r = {set:r[0],section:r[1],question:r[2],passage:r[3],image:r[4],audio:r[5],answer:r[6],A:r[7],B:r[8],C:r[9],D:r[10]};
  const clean = v => /^(NA|null|undefined)$/i.test(String(v).trim()) ? "" : String(v ?? "").trim();
  const row = {id:clean(r.id),set:Number(r.set)||1,section:clean(r.section||"sv").toLowerCase()};
  for (const k of ["question","passage","image","audio","answer","A","B","C","D"]) row[k]=clean(r[k]);
  row.answer=(row.answer||"A").toUpperCase();
  if(row.image && !/^(https?:|data:|scene:|photos\/)/.test(row.image)) row.image="photos/"+row.image;
  if(row.audio && !/^(https?:|tts:|audio\/)/.test(row.audio)) row.audio="audio/"+row.audio;
  return row;
}

// NEW: localStorage instead of sessionStorage
function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || c.v !== 5 || !Array.isArray(c.rows)) return null;
    if (Date.now() - c.ts > CACHE_TTL) return null;
    return c;
  } catch { return null; }
}
function setCache(rows) { /* Paid question banks remain in memory only. */ }
function clearQCache() {
  clearFastReads("questions");
  try { localStorage.removeItem(CACHE_KEY); } catch {}
  try { sessionStorage.removeItem("dj_q_cache_v4"); } catch {}
}

async function fetchQuestionsFromFirestore() {
 if(!state.isAdmin)await checkFreeAccess();
 return readQuestionRows();
}
async function readQuestionRows(){
 return memoRead("questions",async()=>{
  const snapshot=await getDoc(doc(db,QUESTIONS_DOC));
  if(!snapshot.exists())throw new Error("Questions not found");
  return rowList(snapshot.data());
 },30000);
}
async function loadQuestions() {
  const rows = await fetchQuestionsFromFirestore();
  return {rows, fromCache:false};
}
function buildSets(rows) {
  const sets = SET_NAMES.map((n, i) => ({
    idx: i + 1, name: n.name, kana: n.kana,
    sections: SECTIONS.map(s => ({
      key: s.key, name: s.name, short: s.short, marks: s.marks, count: 0, questions: [], icon: s.icon
    }))
  }));
  rows.forEach(r => {
    const row = normalizeRow(r);
    if (!row || row.set < 1 || row.set > 6) return;
    const set = sets[row.set - 1];
    const sec = set.sections.find(s => s.key === row.section);
    if (!sec) return;
    const ansIdx = Math.max(0, Math.min(3, row.answer.charCodeAt(0) - 65));
    sec.questions.push({
      id: row.id, set: row.set, section: row.section, q: row.question, p: row.passage || null,
      img: row.image ? (row.image.startsWith("scene:") ? sceneData(row.image.slice(6)) : resolveUrl(row.image)) : null,
      au: row.audio || null,
      o: [row.A, row.B, row.C, row.D],
      a: ansIdx, sel: undefined, locked: false, played: 0
    });
  });
  sets.forEach(s => s.sections.forEach(sec => sec.count = sec.questions.length));
  return sets;
}
function recomputeTotals() {
 state.totalQ=state.sets.reduce((a,s)=>a+s.sections.reduce((n,c)=>n+c.questions.length,0),0);
 state.fullMarks=250; state.passMarks=200;
}
async function loadResults(uid) {
  try {
    const q = query(collection(db, "users", uid, "results"), orderBy("submittedAt", "desc"));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    const merged=mergeAttempts(out,readLocalAttempts(uid));saveResultsCache(uid,merged);
    return merged;
  } catch { return mergeAttempts(loadResultsCache(uid)||[],readLocalAttempts(uid)); }
}
async function loadResultsCached(uid) {
  const cached = loadResultsCache(uid);
  if (cached) return mergeAttempts(cached,readLocalAttempts(uid));
  return await loadResults(uid);
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
async function loadLeaderboard() {
 try {
  const snap=await getDocs(query(collection(db,"leaderboard"),orderBy("bestScore","desc"),limit(20)));
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
  const qid=state.sets[setIdx-1]?.sections.find(s=>s.key===secKey)?.questions[qi]?.id;
  const idx = bms.findIndex(b => qid&&b.id ? b.id===qid : b.set === setIdx && b.section === secKey && b.qi === qi);
  if (idx >= 0) bms.splice(idx, 1);
  else bms.push({ id:state.sets[setIdx-1]?.sections.find(s=>s.key===secKey)?.questions[qi]?.id||"", set: setIdx, section: secKey, qi, addedAt: Date.now() });
  try {
    await updateDoc(doc(db, "users", state.user.uid), { bookmarks: bms });
    state.profile.bookmarks = bms;
    saveProfileCache(state.user.uid, state.profile);
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
function saveResult(res) { try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(res)); } catch {} }
function loadResult() {
  try { const r = sessionStorage.getItem(RESULT_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearResult() { try { sessionStorage.removeItem(RESULT_KEY); } catch {} }

/* ============ RENDER ============ */
function render() {
  const root = $("app");
  const s = state.screen;
  let html = "";

  if (state.user && ["exam","practice","bookmarks","review","past-sets"].includes(s) && !hasPremium()) {
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
  postRender();bindMedia();updateInstallBanner();bindFastButtons(root);
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

function renderHomeScreen() {
  const p = state.profile || {};
  const results = state.results || [];
  const completed = results.length;
  const best = completed ? Math.max(...results.map(r => r.percentage || 0)) : 0;
  const premiumActive = p.premium && daysLeft(p.premium.expiry) > 0;
  const hasAccess = premiumActive || state.isAdmin;
  const streak = (p.streak && p.streak.count) || 0;

  return `${topbarHTML()}<div class="wrap">
    <div class="hero" data-go="sets">
      <small>JFT-BASIC · PRACTICE SERIES</small>
    <h2>Mock Test 2026</h2>
<p><strong>OCTOBER–NOVEMBER IMPORTANT SETS</strong><br>
Your Next Step Towards JFT Success.</p>
<div class="hero-stats">
  <div><strong>6</strong><span>Sets</span></div>
        <div><strong>${completed}</strong><span>Completed</span></div>
        <div><strong>${completed ? best + "%" : "–"}</strong><span>Best %</span></div>
      </div>
      <div class="hero-cta">Start practising →</div>
    </div>
    ${streak > 0 ? `<div class="streak-banner"><div class="fire"></div><div style="flex:1"><h4>${streak}-day streak!</h4><p>Keep it up — practice daily to improve faster.</p></div></div>` : ""}
    <button type="button" class="past-home-card" data-go="past-sets"><span class="past-home-icon">▧</span><span class="past-home-copy"><strong>Past JFT Mock Test Sets</strong><small>Explore previous practice sets</small></span><span class="past-home-arrow">→</span></button>
    ${!hasAccess ? `<div class="card mt-2" style="background:#fef3c7;border-color:var(--orange)">
      <div class="flex" style="align-items:flex-start">
        <div style="font-size:28px"></div>
        <div style="flex:1">
          <h3 style="margin-bottom:6px">Access Required</h3>
          <p class="muted" style="margin-bottom:12px">You need premium to take tests.</p>
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" data-go="premium">View Plans</button>
            <button class="btn btn-ghost btn-sm" id="reqAccessBtn">Request Access</button>
          </div>
        </div>
      </div>
    </div>` : ""}
    <div class="grid-2 mt-2">
      <div class="card" style="cursor:pointer;text-align:center" data-go="practice">
        <div style="font-size:28px;margin-bottom:6px"></div>
        <h4 style="font-size:13px">Quick Practice</h4><p class="muted small">Pick a section</p>
      </div>
      <div class="card" style="cursor:pointer;text-align:center" data-go="bookmarks">
        <div style="font-size:28px;margin-bottom:6px"></div>
        <h4 style="font-size:13px">Bookmarks</h4><p class="muted small">${(p.bookmarks || []).length} saved</p>
      </div>
      <div class="card" style="cursor:pointer;text-align:center" data-go="leaderboard">
        <div style="font-size:28px;margin-bottom:6px"></div>
        <h4 style="font-size:13px">Leaderboard</h4><p class="muted small">Top students</p>
      </div>
      <div class="card" style="cursor:pointer;text-align:center" data-go="premium">
        <div style="font-size:28px;margin-bottom:6px"></div>
        <h4 style="font-size:13px">Premium</h4>
        <p class="muted small">${premiumActive ? daysLeft(p.premium.expiry) + "d left" : "View plans"}</p>
      </div>
    </div>
    <div class="card mt-2">
      <div class="flex-between mb-2">
        <h3>Recent Activity</h3>
        <button class="btn btn-ghost btn-sm" data-go="profile">Profile →</button>
      </div>
      ${completed ? results.slice(0, 3).map(r => `
        <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div><h4>Set ${r.setIdx} · ${esc(r.setName || "—")}</h4><p class="muted small">${fmtDate(r.submittedAt)}</p></div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:900;color:${r.percentage >= 80 ? "var(--green)" : "var(--orange)"}">${r.percentage}%</div>
            <div class="muted small">${Math.round(r.score)}/${r.maxScore}</div>
          </div>
        </div>`).join("") : `<p class="muted center" style="padding:24px 0">No attempts yet. Start your first exam!</p>`}
    </div>
  </div>${bottomNavHTML("home")}`;
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
  if(!hasPremium()){setTimeout(()=>navigate("premium"),0);return renderPremium();}
  if(!state.sets.length)return `${topbarHTML()}<main class="wrap page-space"><h2>Mock test sets</h2><div class="card"><p>${esc(state.contentError||"Loading your question bank…")}</p><button class="btn btn-primary mt-2" id="retryContent">Retry loading</button></div></main>${bottomNavHTML("sets")}`;
  if (!state.sets.length) {
    return `${topbarHTML()}<div class="wrap" style="padding:16px 0 80px">
      <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
      <h2 class="mb-2">Choose a Set</h2>
      <div class="card center" style="padding:40px 20px">
        <div class="spinner" style="margin:0 auto 12px"></div>
        <p class="muted">Loading questions…</p>
      </div>
    </div>${bottomNavHTML("sets")}`;
  }
  return `${topbarHTML()}<div class="wrap" style="padding-top:16px;padding-bottom:80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
    <h2 class="mb-2">Choose a Set</h2>
    ${state.sets.map((s, i) => `
      <div class="set-card" data-set="${i}">
        <div class="set-kana">${s.kana}</div>
        <div class="set-info">
          <small>SET ${s.idx}</small><h3>${s.name}</h3>
          <em>${s.sections.reduce((a, sec) => a + sec.count, 0)} questions · 60 min</em>
        </div>
        <div style="color:var(--purple);font-size:20px">→</div>
      </div>`).join("")}
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
function attemptHistory(set){
 const attempts=state.results.filter(r=>Number(r.setIdx)===set.idx);
 if(!attempts.length)return "";
 const latest=attempts[0];
 return `<section class="attempt-summary card mt-2"><div class="flex-between"><div><span class="muted small">YOUR PROGRESS</span><h3>Previous attempt</h3></div><span class="badge badge-info">${attempts.length} attempt${attempts.length===1?"":"s"}</span></div><div class="attempt-score"><b>${Math.round(latest.score)}<small> / 250</small></b><span>${Number(latest.percentage)}% · ${fmtDate(latest.submittedAt)}</span></div><div class="result-stats"><div><h4>Correct</h4><p class="g">${latest.correct}</p></div><div><h4>Wrong</h4><p class="r">${latest.wrong}</p></div><div><h4>Skipped</h4><p>${latest.unanswered}</p></div><div><h4>Best</h4><p>${Math.round(Math.max(...attempts.map(a=>a.score)))}</p></div></div><div class="attempt-reviews">${["all","correct","wrong"].map(f=>`<button class="btn btn-ghost btn-sm" data-attempt="${esc(latest.attemptId||latest.id)}" data-attempt-filter="${f}">${f==="all"?"Review all":f==="correct"?"Right answers":"Wrong answers"}</button>`).join("")}</div><p class="muted small mt-1">${attempts.length>1?"Recent attempts below · ":""}Practice again to improve your score.</p>${attempts.slice(1).map(r=>`<button class="attempt-row" data-attempt="${esc(r.attemptId||r.id)}" data-attempt-filter="all"><span>${fmtDate(r.submittedAt)}</span><b>${Math.round(r.score)} / 250</b><span>Review →</span></button>`).join("")}</section>`;
}

function renderStart() {
  const setIdx = +state.params.set || 0;
  const set = state.sets[setIdx];
  if (!hasPremium()) {setTimeout(()=>navigate("premium"),0);return renderPremium();}
  if (!set) return renderSets();
  const p = state.profile || {};
  const premiumActive = p.premium && daysLeft(p.premium.expiry) > 0;
  const hasAccess = premiumActive || state.isAdmin;

  if (!hasAccess) {
    return `${topbarHTML()}<div class="wrap" style="padding-top:16px">
      <button class="btn btn-ghost btn-sm mb-2" data-go="sets">← Back</button>
      <div class="card center">
        <div style="font-size:48px;margin-bottom:12px"></div>
        <h2>Access Required</h2>
        <p class="muted mt-1 mb-3">Premium is needed to start exams.</p>
        <button class="btn btn-primary btn-block mb-1" data-go="premium">View Plans</button>
        
      </div>
    </div>`;
  }

  return `${topbarHTML()}<div class="wrap" style="padding-top:16px;padding-bottom:40px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="sets">← Back</button>
    <div class="card card-lg">
      <div style="width:70px;height:70px;border-radius:50%;background:var(--grad);color:#fff;
        display:grid;place-items:center;font-size:32px;font-weight:800;margin:0 auto 16px">${set.kana}</div>
      <h2 class="center">${set.name}</h2>
      <p class="center muted mt-1" style="font-size:11px;letter-spacing:1.2px;font-weight:800;color:var(--purple)">JFT-BASIC PRACTICE MOCK TEST</p>
      <div class="grid-2 mt-3 mb-3">
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${set.sections.reduce((n,s)=>n+s.questions.length,0)}</div><div class="muted small">Questions</div></div>
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${state.fullMarks}</div><div class="muted small">Total Marks</div></div>
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">60</div><div class="muted small">Minutes</div></div>
        <div class="center" style="background:var(--bg);border-radius:12px;padding:14px">
          <div style="font-size:22px;font-weight:900">${state.passMarks}</div><div class="muted small">Pass Mark</div></div>
      </div>
      ${attemptHistory(set)}
      <h3 class="mb-1 mt-2">Exam Rules</h3>
      <ol class="muted mb-3" style="padding-left:18px;font-size:12.5px;line-height:1.7">
        <li>Once you finish a section you cannot return to it</li>
        <li>Timer auto-submits the exam at 00:00</li>
        <li>Answer each question before moving forward</li>
        <li>Audio can be replayed ${MAX_PLAYS} times per question</li>
        <li>Pass mark: ${state.passMarks} / ${state.fullMarks} (80%)</li>
        <li>Your progress is saved if you refresh the page</li>
      </ol>
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
      <b>Set ${ex.set.idx} · ${esc(ex.set.name)}</b>
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
  const pass = r.score >= state.passMarks;
  const pct = r.percentage;
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 40px">
    <div class="result-card">
      ${r.cloudSaved===false?`<p class="muted small">Saved on this browser. Cloud saving is pending.</p><button id="retryCloud" class="btn btn-ghost btn-sm">Retry cloud save</button>`:""}
      <div class="result-badge ${pass ? "pass" : "fail"}">${pass ? "PASSED" : "NOT PASSED"}</div>
      <span class="muted" style="font-size:11px;letter-spacing:1.2px;font-weight:800">SET ${r.setIdx} · ${esc(r.setName)}</span>
      <div class="ring mt-2">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle class="bg" cx="80" cy="80" r="68"/>
          <circle class="fg" id="resultRing" cx="80" cy="80" r="68" stroke-dasharray="427.3" stroke-dashoffset="427.3"
            stroke="${pass ? "var(--green)" : "var(--red)"}"/>
        </svg>
        <div><b>${Math.round(r.score)}</b><span>/ ${r.maxScore}</span></div>
      </div>
      <div class="grade-text">${pass ? (pct >= 95 ? " Outstanding!" : " Passed — well done!") : ` Need ${Math.max(0,state.passMarks - Math.round(r.score))} more marks to pass`}</div>
      <div class="result-stats">
        <div><h4>Correct</h4><p class="g">${r.correct}</p></div>
        <div><h4>Wrong</h4><p class="r">${r.wrong}</p></div>
        <div><h4>Skipped</h4><p>${r.unanswered}</p></div>
        <div><h4>Percent</h4><p>${pct}%</p></div>
      </div>
    </div>
    <section class="card jft-result mt-2">
      <div class="jft-heading"><div><small>総合得点 · Total Score</small><strong>${Math.round(r.score)} <small>/ 250</small></strong></div><div><small>判定結果 · Assessment</small><strong>${pass?"A2 practice target":"Below A2 practice target"}</strong></div></div>
      <p class="muted small">Dream Japan practice estimate · Target: ${state.passMarks}/250</p>
      <div class="jft-score-track"><i style="left:${Math.min(100,Math.max(0,r.score/250*100))}%"><span>${Math.round(r.score)}</span></i><b class="jft-target" style="left:80%"></b></div><div class="flex-between small"><span>0</span><span>200 target</span><span>250</span></div>
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

function renderReview() {
  const r = loadResult();
  const filter = state.params.filter || "all";
  if (!r) return renderHomeScreen();
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
      const items = s.items.filter(it => filter === "all" || (filter === "correct" ? it.yourAns != null && it.yourAns === it.correctAns : it.yourAns !== it.correctAns));
      if (!items.length) return "";
      return `<h3 class="mt-2 mb-1" style="color:var(--purple);font-size:12px;letter-spacing:.8px;text-transform:uppercase">${esc(s.name)}</h3>
        ${items.map(it => `
          <div class="card q-card mb-1" style="border-left:4px solid ${it.yourAns === it.correctAns ? "var(--green)" : "var(--red)"}">
            <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:6px">Q${it.idx + 1}${it.yourAns == null ? " · not answered" : ""}</div>
            <div class="q-text">${esc(it.q)}</div>${it.p ? `<div class="passage">${passageHTML(it.p)}</div>` : ""}
            ${it.img ? `<img src="${esc(it.img)}" loading="lazy" style="width:100%;border-radius:10px;margin-bottom:8px" onerror="this.style.display='none'">` : ""}
            ${it.au && !it.au.startsWith("tts:") ? `<audio controls preload="none" src="${esc(resolveUrl(it.au))}"></audio>` : ""}
            
            ${it.o.map((txt, i) => {
              if (i === 3 && !txt) return "";
              const isC = i === it.correctAns, isY = i === it.yourAns;
              const style = isC ? "background:#d1fae5;border-color:var(--green)" : (isY && !isC ? "background:#fee2e2;border-color:var(--red)" : "");
              return `<div style="padding:9px 11px;border:1px solid var(--border);border-radius:9px;margin-top:6px;font-size:12.5px;${style}">
                ${"ABCD"[i]}. ${esc(txt)} ${isC ? " Correct" : ""} ${isY && !isC ? " Your answer" : ""}</div>`;
            }).join("")}
          </div>`).join("")}`;
    }).join("")}
  </div>`;
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
      <div class="stat-card center"><div class="num">${state.results.length}</div><div class="lbl">Tests</div></div>
      <div class="stat-card center"><div class="num">${streak}</div><div class="lbl">Streak</div></div>
      <div class="stat-card center"><div class="num">${p.bestScore || 0}%</div><div class="lbl">Best</div></div>
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
    ${state.isAdmin ? `<button class="btn btn-primary btn-block mt-2" data-go="admin"> Open Admin Dashboard</button>` : ""}
    <button class="btn btn-ghost btn-block mt-1" data-go="bookmarks"> My Bookmarks (${(p.bookmarks || []).length})</button>
    <button class="btn btn-ghost btn-block mt-1" data-go="leaderboard"> Leaderboard</button>
    <button class="btn btn-ghost btn-block mt-1" data-go="premium">View Premium Plans</button>
    <button class="btn btn-danger btn-block mt-1" id="logoutBtn">Logout</button>
  </div>${bottomNavHTML("profile")}`;
}

function renderPremium() {
 const p=state.profile||{}, active=p.premium && daysLeft(p.premium.expiry)>0;
 return `${topbarHTML()}<main class="wrap page-space"><div class="premium-status"><p>YOUR NEXT STEP</p><h2>Practice with confidence</h2><p>All sets, listening practice and progress in one place.</p></div>
 ${p.premium?`<div class="card mt-2"><h3>${active?"Active":"Expired"}: ${esc(p.premium.plan)}</h3><p>${fmtDate(p.premium.start)} to ${fmtDate(p.premium.expiry)} · ${daysLeft(p.premium.expiry)} days remaining</p><p class="muted">Access is tied to the browser used for payment.</p></div>`:""}
 <h3 class="mt-3 mb-2">Available plans</h3>${state.plans.length?state.plans.filter(pl=>pl.active!==false).map(pl=>`<article class="plan-card"><div class="flex-between"><h3>${esc(pl.name)}</h3><div><b class="price">NPR ${Number(pl.price||0).toLocaleString()}</b><p>${Number(pl.days)} days</p></div></div><ul class="benefits">${(pl.benefits||[]).map(b=>`<li>${esc(b)}</li>`).join("")}</ul><button class="btn btn-primary btn-block mt-2" data-plan="${esc(pl.id)}">${active?"Extend or choose plan":"Select plan"}</button></article>`).join(""):"<div class='card'>No plans available. Please contact the admin.</div>"}
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
  if(!hasPremium())return renderPremium();
  const p = state.profile || {};
  if(state.contentError)return `${topbarHTML()}<main class="wrap page-space"><div class="card">${esc(state.contentError)}<button class="btn btn-primary" id="retryContent">Retry loading</button></div></main>`;
  const bms = p.bookmarks || [];
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
      const q = bm.id ? sec.questions.find(q=>q.id===bm.id) : sec.questions[bm.qi]; if (!q) return "";
      return `<div class="card q-card mb-1">
        <div class="flex-between mb-1">
          <span class="badge badge-info">Set ${bm.set} · ${sec.short}</span>
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
  const lb = state.leaderboard || [];
  return `${topbarHTML()}<div class="wrap" style="padding:16px 0 80px">
    <button class="btn btn-ghost btn-sm mb-2" data-go="home">← Back</button>
    <h2 class="mb-1"> Leaderboard</h2>
    <p class="muted mb-3">Top 20 students by best practice score. Scores are reported by student browsers.</p>
    <div class="card">
      ${lb.length ? lb.map((u, i) => {
        const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        return `<div class="lb-row">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-info"><b>${esc(u.name)}</b><span> ${u.streak}-day streak</span></div>
          <div class="lb-score">${u.bestScore}%</div>
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
    { id:"settings", label:"Settings" }
  ];
  const contentMap = {
    overview: adminOverviewHTML, students: adminStudentsHTML, requests: adminRequestsHTML,
    questions: adminQuestionsHTML, settings: adminSettingsHTML
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
  return `<div class="grid-2">
    <button class="stat-card" data-stat="statTotal" data-admin-tab="students"><div class="num" id="statTotal">…</div><div class="lbl">Total Students</div></button>
    <button class="stat-card" data-stat="statActive" data-admin-tab="students"><div class="num" id="statActive">…</div><div class="lbl">Active</div></button>
    <button class="stat-card" data-stat="statBlocked" data-admin-tab="students"><div class="num" id="statBlocked">…</div><div class="lbl">Blocked</div></button>
    <button class="stat-card" data-stat="statPremium" data-admin-tab="students"><div class="num" id="statPremium">…</div><div class="lbl">Premium</div></button>
    <button class="stat-card" data-stat="statPending" data-admin-tab="requests"><div class="num" id="statPending">…</div><div class="lbl">Pending Requests</div></button>
    <button class="stat-card" data-stat="statQuestions" data-admin-tab="questions"><div class="num" id="statQuestions">…</div><div class="lbl">Questions</div></button>
  </div>
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
    <select class="input mb-2" id="studentFilter"><option value="all">All students</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="premium">Premium</option><option value="expired">Expired premium</option></select><div id="studentsList"><p class="muted center" style="padding:24px">Loading…</p></div>`;
}
function adminRequestsHTML() {
  return `<div id="requestsList"><p class="muted center" style="padding:24px">Loading…</p></div>`;
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
  <div class="toolbar"><select class="input" id="qSet"><option value="">All sets</option>${SET_NAMES.map((x,i)=>`<option value="${i+1}">Set ${i+1} · ${esc(x.name)}</option>`).join("")}</select><select class="input" id="qSection"><option value="">All sections</option>${SECTIONS.map(x=>`<option value="${x.key}">${x.name}</option>`).join("")}</select></div><div class="toolbar mb-2"><button class="btn btn-ghost" id="setPreview">Preview filtered questions</button><button class="btn btn-danger" id="deleteSelected">Delete selected</button><label><input type="checkbox" id="selectAll"> Select all shown</label></div><div id="questionsList"><p class="muted center" style="padding:24px">Loading…</p></div>`;
}
function adminSettingsHTML() {
  return enhancedSettings()+`<div class="card">
    <h3 class="mb-2">System Info</h3>
    <div class="flex-between" style="padding:8px 0"><span class="muted small">Admin Email</span><span style="font-size:12px">${esc(ADMIN_EMAIL)}</span></div>
    <div class="flex-between" style="padding:8px 0;border-top:1px solid var(--border)"><span class="muted small">Questions Doc</span><span style="font-size:11px">${esc(QUESTIONS_DOC)}</span></div>
    <div class="flex-between" style="padding:8px 0;border-top:1px solid var(--border)"><span class="muted small">Total Q</span><span style="font-size:12px">${state.totalQ}</span></div>
  </div>
  <div class="card mt-2"><h3 class="mb-2">Export / Import</h3>
    <button class="btn btn-primary btn-block mb-2" id="exportBtn"> Download questions.json</button>
    <textarea id="importText" class="input" placeholder='{"questions": [...]}' style="min-height:100px"></textarea>
    <button class="btn btn-teal btn-block mt-2" id="importBtn">Import</button>
  </div>`;
}

/* ============ POST-RENDER ============ */
function postRender() {
  document.querySelectorAll("[data-attempt]").forEach(b=>b.onclick=()=>{const r=state.results.find(r=>(r.attemptId||r.id)===b.dataset.attempt);if(r){saveResult(r);navigate("review",{filter:b.dataset.attemptFilter||"all"});}});
  if($("copyPastPassword")) $("copyPastPassword").onclick=async()=>{try{await navigator.clipboard.writeText("myreservasi");toast("Password copied","ok");}catch(e){const el=document.createElement("textarea");el.value="myreservasi";document.body.append(el);el.select();const ok=document.execCommand("copy");el.remove();toast(ok?"Password copied":"Please copy the password manually",ok?"ok":"err");}};
  if($("retryCloud"))$("retryCloud").onclick=async()=>{const r=loadResult();if(!r)return;try{await saveResultToDb(r,r.attemptId);render();toast("Saved to cloud","ok");}catch(e){toast(e.message,"err");}};
  if($("pendingAdminButton"))$("pendingAdminButton").onclick=()=>{adminTab="requests";navigate("admin");};
  if($("retryContent"))$("retryContent").onclick=()=>loadDataInBackground();
  document.querySelectorAll("[data-go]").forEach(el => {
    el.onclick = () => navigate(el.dataset.go);
  });
  document.querySelectorAll("[data-nav]").forEach(el => {
    el.onclick = () => navigate(el.dataset.nav);
  });
  document.querySelectorAll("[data-admin-tab]").forEach(el => {
    el.onclick = () => { adminTab = el.dataset.adminTab; state._studentFilter=({statActive:"active",statBlocked:"blocked",statPremium:"premium"})[el.dataset.stat]||"all"; render(); if($("studentFilter")) $("studentFilter").value=state._studentFilter; };
  });
  document.querySelectorAll("[data-review]").forEach(el => {
    el.onclick = () => navigate("review", { filter: el.dataset.review });
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
    el.onclick = () => hasPremium()?navigate("start", { set: el.dataset.set }):navigate("premium");
  });

  const agree = $("agree"), startBtn = $("startBtn");
  if (agree && startBtn) {
    agree.onchange = () => { startBtn.disabled = !agree.checked; };
    startBtn.onclick = () => {
      if (!agree.checked) return toast("Please agree to the rules", "err");
      return beginExam(+state.params.set);
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
    if (r) navigate("start", { set: r.setIdx - 1 });
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

  if (state.screen === "admin" && state.isAdmin) bindAdminTab();
}

/* ============ EXAM ENGINE ============ */
async function beginExam(setIdx, force = false) {
 return onceJob("beginExam",async()=>{
  if(!hasPremium())return navigate("premium");
  showPreparing("Preparing your exam", "Getting your questions ready…");
  const prepared=await safeAction("startAttempt",{setIdx:setIdx+1});
  if(!prepared){closeModal();return;}
  const set=buildSets(prepared.questions)[setIdx];
  if (!set || !set.sections.some(s=>s.questions.length)) {closeModal();return toast("This set has no questions","err");}
  if(!await preloadMedia(set.sections.flatMap(s=>s.questions))) return;
  const activated=await safeAction("activateAttempt",{attemptId:prepared.attemptId});
  if(!activated){closeModal();return;}
  state._attemptId=prepared.attemptId;
  state._attemptStartedAt=activated.startedAt;
  state.sets[setIdx]=structuredClone(set);
  set.sections=set.sections.filter(s=>s.questions.length);
  if (!force && isExamLockedByOther(setIdx)) {
    modal("Another tab has this exam", "It looks like this exam is already open in another tab. Starting here may cause duplicate submissions.", [
      { label: "Cancel", cls: "btn-ghost" },
      { label: "Start Anyway", cls: "btn-primary", onClick: () => beginExam(setIdx, true) }
    ]);
    return;
  }
  const sections = set.sections.map(s => ({
    ...s,
    questions: s.questions.map(q => ({ ...q, sel: undefined, locked: false, played: 0 }))
  }));
  state.exam = {
    set, setIdx, sections, attemptId:state._attemptId, si: 0, qi: 0,
    left: EXAM_MIN * 60, paused: false,
    answeredCount: 0, maxReachable: 0,
    startedAt: state._attemptStartedAt||Date.now()
  };
  acquireExamLock(setIdx);
  saveExamState(state.exam);
  startTimer();
  bumpStreak();
  closeModal();
  navigate("exam");
 });
}

async function resumeExamFromSaved(saved) {
  if(saved.uid!==state.user?.uid || !await authorizeContent()) {clearExamState(); return navigate("premium");}
  const set = saved.snapshot || state.sets[saved.setIdx];
  if (!set) { clearExamState(); replaceNavigate("sets"); return; }
  const sections = set.sections.map((s, si) => ({
    ...s,
    questions: s.questions.map((q, qi) => ({
      ...q,
      sel: saved.answers?.[si]?.[qi] ?? undefined,
      locked: !!(saved.locked?.[si]?.[qi]),
      played: saved.played?.[si]?.[qi] || 0
    }))
  }));
  state.exam = {
    set, setIdx: saved.setIdx, attemptId:saved.attemptId, sections,
    si: saved.si || 0, qi: saved.qi || 0,
    left: Math.max(0, EXAM_MIN*60-(Date.now()-saved.startedAt)/1000),
    paused: false,
    answeredCount: sections[saved.si || 0].questions.filter(x => x.sel !== undefined).length,
    maxReachable: saved.maxReachable || 0,
    startedAt: saved.startedAt || Date.now()
  };
  refreshExamLock(saved.setIdx);
  startTimer();
  render();
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
  if(state.exam && !hasPremium()){clearInterval(state._tick);stopAudio();state.exam=null;clearExamState();navigate("premium");return;}
  const ex = state.exam;
  if (!ex) { clearInterval(state._tick); return; }
  if (ex.paused) {
    state._perfStart = performance.now();
    state._perfLeftAtStart = ex.left;
    return;
  }
  const elapsedSec = (Date.now()-ex.startedAt)/1000;
  ex.left = Math.max(0, EXAM_MIN*60-elapsedSec);
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
  const used = Math.min(EXAM_MIN*60,Math.max(0,Math.round(EXAM_MIN * 60 - ex.left)));

  let score = 0, correct = 0, unanswered = 0;
  const sections = ex.sections.map(s => {
    const items = s.questions.map((q, idx) => ({
      idx, q: q.q, p: q.p, img: q.img, au: q.au, o: q.o,
      correctAns: q.a, yourAns: q.sel
    }));
    let c = 0, u = 0;
    s.questions.forEach(q => {
      if (q.sel === undefined) u++;
      else if (q.sel === q.a) c++;
    });
    const sc = c * s.marks;
    score += sc; correct += c; unanswered += u;
    return { name: s.name, short: s.short, marks: s.marks, score: sc, max: s.questions.length * s.marks, items };
  });

  const totalQ=ex.sections.reduce((n,s)=>n+s.questions.length,0);
  const originalFullMarks=ex.sections.reduce((n,s)=>n+s.questions.length*s.marks,0);
  sections.forEach(s=>{s.score=+(s.score*250/originalFullMarks).toFixed(2);s.max=+(s.max*250/originalFullMarks).toFixed(2);});
  score=Math.round(score*250/originalFullMarks);
  const wrong = totalQ - correct - unanswered;
  const percentage = Math.round(score / state.fullMarks * 100);
  const attemptId = `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = {
    cloudSaved:false, attemptId:ex.attemptId||attemptId, answers:ex.sections.map(s=>({key:s.key,answers:s.questions.map(q=>q.sel??null)})),
    setIdx: ex.set.idx, setName: ex.set.name,
    score, maxScore: state.fullMarks, percentage,
    correct, wrong, unanswered, sections, timeUsed: used,
    startedAt: new Date(ex.startedAt).toISOString(),
    submittedAt: new Date().toISOString()
  };

  saveResult(result);
  state.results.unshift({...result,id:result.attemptId});
  saveLocalAttempts();
  clearExamState();
  invalidateResultsCache(state.user.uid);   // force re-fetch next visit

  state._submitting=false;
  const setIdx = ex.setIdx;
  state.exam = null;
  releaseExamLock(setIdx);

  closeModal();
  replaceNavigate("result");
  saveResultToDb(result, attemptId).then(()=>{if(state.screen==="result" && loadResult()?.attemptId===result.attemptId)render();}).catch(error=>{console.warn("Result kept on this browser",error);if(state.screen==="result")toast("Result saved on this browser. Cloud save is pending.");});
}

async function saveResultToDb(result,attemptId) {
 const uid=requireSession();await checkFreeAccess();
 const id=result.attemptId||attemptId||uuid();
 const {id:ignoredId,...payload}=result;
 const clean=JSON.parse(JSON.stringify({...payload,attemptId:id,cloudSaved:true,scoreSource:"browser"}));
 const resultRef=doc(db,"users",uid,"results",id),userRef=doc(db,"users",uid),leaderRef=doc(db,"leaderboard",uid);
 await runTransaction(db,async tx=>{
  const [previous,u,lb]=await Promise.all([tx.get(resultRef),tx.get(userRef),tx.get(leaderRef)]);
  if(previous.exists())return;
  if(!u.exists()||(!state.isAdmin&&!activeProfile(u.data())))throw new Error("Premium expired before the result could be saved");
  if(!Number.isFinite(clean.score)||clean.score<0||clean.score>250||!Number.isInteger(clean.percentage)||clean.percentage<0||clean.percentage>100)throw new Error("Invalid mock-test result");
  const best=Math.max(lb.exists()?Number(lb.data().bestScore)||0:0,clean.percentage);
  tx.set(resultRef,{...clean,submittedAt:serverTimestamp()});
  tx.set(leaderRef,{name:String(u.data().name||"Student").slice(0,80),bestScore:best,streak:Number(u.data().streak?.count)||0,latestAttempt:id,updatedAt:serverTimestamp(),scoreSource:"browser"});
  if(best>(Number(u.data().bestScore)||0))tx.update(userRef,{bestScore:best});
 });
 Object.assign(result,{attemptId:id,cloudSaved:true,scoreSource:"browser"});if(loadResult()?.attemptId===id)saveResult(result);
 const at=state.results.findIndex(r=>(r.attemptId||r.id)===id);if(at<0)state.results.unshift({...result,id});else state.results[at]={...result,id};saveLocalAttempts();
 invalidateResultsCache(uid);void loadLeaderboard().then(rows=>state.leaderboard=rows).catch(()=>{});
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
  if(!await authorizeContent()) return;
  if(!hasPremium()) return navigate("premium");
  const pool = [];
  state.sets.forEach(s => {
    const sec = s.sections.find(x => x.key === sectionKey);
    if (sec) sec.questions.forEach(q => pool.push({ ...q, sel: undefined, locked: false, played: 0 }));
  });
  if (pool.length < 1) return toast("Not enough questions in this section", "err");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Math.min(10, pool.length));
  if(!await preloadMedia(picked)) return;
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
    const rb = $("refreshQBtn");
    if (rb) rb.onclick = refreshQuestions;
  }
  if (adminTab === "students") {
    $("studentSearch").oninput = debounce(filterStudents);
    $("studentFilter").onchange=filterStudents;
    loadStudents();
  }
  if (adminTab === "requests") loadRequests();
  if (adminTab === "questions") {
    $("qSearch").oninput = debounce(filterQuestions);
    $("qSet").onchange=$("qSection").onchange=filterQuestions;
    $("setPreview").onclick=()=>previewSet();
    $("deleteSelected").onclick=deleteSelected;
    $("selectAll").onchange=e=>document.querySelectorAll("[data-qcheck]").forEach(c=>c.checked=e.target.checked);
    $("addQBtn").onclick = () => openQEditor(null);
    $("refreshQ2").onclick = refreshQuestions;
    loadQs();
  }
  if (adminTab === "settings") {
    $("saveConfig").onclick=async()=>{try{appConfig={...appConfig,esewaNumber:$("cfgEsewa").value.trim(),whatsappNumber:$("cfgWhatsapp").value.trim(),qrPath:$("cfgQR").value.trim(),installPromptEnabled:$("cfgInstall").checked};await setDoc(doc(db,"appConfig","main"),appConfig,{merge:true});clearFastReads("config");toast("Settings saved","ok");}catch(e){toast(e.message,"err");}};
    $("addPlan").onclick=()=>editPlan();
    document.querySelectorAll("[data-edit-plan]").forEach(b=>b.onclick=()=>editPlan(b.dataset.editPlan));
    $("exportBtn").onclick = exportJSON;
    $("importBtn").onclick = importJSON;
  }
}
async function loadStats() {
  try {
    const [usersSnap,reqSnap,questions]=await Promise.all([memoRead("adminUsers",()=>getDocs(collection(db,"users"))),memoRead("pendingRequests",()=>getDocs(query(collection(db,"accessRequests"),where("status","==","pending")))),readQuestionRows()]);
    let total = 0, active = 0, blocked = 0, premiumActive = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      total++;
      if (u.status === "blocked") blocked++; else active++;
      if (u.premium && u.premium.expiry && daysLeft(u.premium.expiry) > 0) premiumActive++;
    });
    if ($("statTotal")) $("statTotal").textContent = total;
    if ($("statActive")) $("statActive").textContent = active;
    if ($("statBlocked")) $("statBlocked").textContent = blocked;
    if ($("statPremium")) $("statPremium").textContent = premiumActive;
    if ($("statPending")) $("statPending").textContent = reqSnap.size;
    if ($("statQuestions")) $("statQuestions").textContent = questions.length;
  } catch(e) {toast("Stats: "+e.message,"err");}
}
async function loadStudents() {
  const list = $("studentsList");
  if (!list) return;
  try {
    const snap = await memoRead("adminUsers",()=>getDocs(collection(db,"users")));
    const users = [];
    snap.forEach(d => {
      if (state.user && d.id === state.user.uid) return;
      users.push({ uid: d.id, ...d.data() });
    });
    state._allStudents = users;
    filterStudents();
  } catch (e) {
    list.innerHTML = `<p class="muted" style="color:var(--red)">Error: ${esc(e.message)}</p>`;
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
      <p class="muted small">Note: ${esc(u.note||u.premium?.note||"No note")}</p><p class="muted small">Premium expires: ${fmtDate(u.premium?.expiry)}</p><div class="actions">
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
 const q=($("studentSearch")?.value||"").toLowerCase(), f=$("studentFilter")?.value||"all";
 renderStudentRows((state._allStudents||[]).filter(u=>{
 const active=u.premium && daysLeft(u.premium.expiry)>0;
 return [u.name,u.email,u.note,u.premium?.note].join(" ").toLowerCase().includes(q) && (f==="all" || f==="premium"&&active || f==="expired"&&u.premium&&!active || f==="blocked"&&u.status==="blocked" || f==="active"&&u.status!=="blocked");
 }));
}
async function loadRequests() {
  const list = $("requestsList");
  if (!list) return;
  try {
    const snap = await memoRead("adminRequests",()=>getDocs(query(collection(db,"accessRequests"),orderBy("createdAt","desc"))));
    const reqs = [];
    snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
    if (!reqs.length) { list.innerHTML = `<p class="muted center" style="padding:24px">No requests yet.</p>`; return; }
    list.innerHTML = reqs.map(r => `
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
    const rows = await fetchQuestionsFromFirestore();
    state._allQs = rows;
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
        <span class="badge badge-info">Set ${r.set}</span>
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
  const r = rowOrNull || { set:1, section:"sv", question:"", passage:"", image:"", audio:"", answer:"A", A:"", B:"", C:"", D:"" };
  modal(isEdit ? "Edit Question" : "Add Question", `
    <div class="grid-2">
      <div class="field"><label>Set</label>
        <select id="qeSet" class="input">${SET_NAMES.map((s, i) =>
          `<option value="${i + 1}" ${r.set === i + 1 ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
      <div class="field"><label>Section</label>
        <select id="qeSec" class="input">${SECTIONS.map(s =>
          `<option value="${s.key}" ${r.section === s.key ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Question</label><textarea id="qeQ" class="input">${esc(r.question)}</textarea></div>
    <div class="field"><label>Passage (optional · HTML supported)</label><textarea id="qeP" class="input">${esc(r.passage || "")}</textarea></div>
    <div class="field"><label>Image</label><input type="text" id="qeImg" class="input" value="${esc(r.image || "")}" placeholder="photos/q1.jpg"></div>
    <div class="field"><label>Audio</label><input type="text" id="qeAu" class="input" value="${esc(r.audio || "")}" placeholder="audio/q1.mp3"></div>
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
async function saveQ(origRow, isEdit) {
  const newRow = {
    id:origRow?.id||uuid(),
    set: +$("qeSet").value, section: $("qeSec").value,
    question: $("qeQ").value.trim(), passage: $("qeP").value.trim(),
    image: $("qeImg").value.trim(), audio: $("qeAu").value.trim(),
    answer: $("qeAns").value,
    A: $("qeA").value.trim(), B: $("qeB").value.trim(),
    C: $("qeC").value.trim(), D: $("qeD").value.trim()
  };
  if (!newRow.question || !newRow.A || !newRow.B || !newRow.C) return toast("Question, A, B, C required", "err");
  if (newRow.answer === "D" && !newRow.D) return toast("Answer D but option D empty", "err");
  try {
    const list=await mutateQuestions(rows=>{
      if(isEdit){const i=rows.findIndex(r=>r.id===origRow.id);if(i<0)throw new Error("Question was removed. Refresh and retry.");rows[i]=newRow;}else rows.push(newRow);
      return rows;
    });
    clearQCache(); setCache(list);
    state.sets = buildSets(list); recomputeTotals();
    toast(isEdit ? "Updated " : "Added ", "ok");
    loadQs();
  } catch (e) { toast("Failed: " + e.message, "err"); }
}
function previewQ(row) { if(row){modal("Question preview",questionPreview(row));bindMedia();} }
async function deleteQ(row) {
 modal("Delete question?","This removes the question from the set.",[{label:"Cancel",cls:"btn-ghost"},{label:"Delete",cls:"btn-danger",onClick:async()=>{try{await mutateQuestions(rows=>rows.filter(r=>r.id!==row.id));await loadQs();}catch(e){toast(e.message,"err");}}}]);
}
async function refreshQuestions() {
  toast("Refreshing…");
  try {
    clearQCache();
    const rows = await fetchQuestionsFromFirestore();
    setCache(rows);
    state.sets = buildSets(rows); recomputeTotals();
    if ($("questionsList")) loadQs();
    toast("Refreshed ", "ok");
  } catch (e) { toast("Failed: " + e.message, "err"); }
}
async function exportJSON() {
  try {
    const rows = await fetchQuestionsFromFirestore();
    const blob = new Blob([JSON.stringify({ questions: rows }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "questions.json"; a.click();
    URL.revokeObjectURL(url);
    toast("Downloaded", "ok");
  } catch (e) { toast("Failed: " + e.message, "err"); }
}
async function importJSON() {
  const text = ($("importText").value || "").trim();
  if (!text) return toast("Paste JSON first", "err");
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return toast("Invalid JSON: " + e.message, "err"); }
  const rows = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(rows)) return toast("JSON must contain questions array", "err");
  const normalized=rows.map(normalizeRow);
  if(normalized.some(r=>!r||!Number.isInteger(r.set)||r.set<1||r.set>6||!SECTIONS.some(s=>s.key===r.section)||!r.question||!r.A||!r.B||!r.C||!"ABCD".includes(r.answer)||!r[r.answer]))return toast("Every question needs a valid set, section, question, options A/B/C and answer","err");
  if (!confirm(`Replace all questions with ${rows.length}? Cannot be undone.`)) return;
  try {
    await mutateQuestions(()=>rows.map(r=>({...normalizeRow(r),id:r.id||uuid()})));
    clearQCache(); setCache(rows);
    state.sets = buildSets(rows); recomputeTotals();
    toast(`Imported ${rows.length} `, "ok");
  } catch (e) { toast("Failed: " + e.message, "err"); }
}
async function grantPremium(uid) {
 const plans=state.plans;
 modal("Grant Premium",`<label>Plan</label><select class="input" id="grantPlan">${plans.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><label>Number of days</label><input id="grantDays" class="input" type="number" min="1" max="3650" step="1" value="15"><label>Admin note</label><textarea id="grantNote" class="input"></textarea>`,[
 {label:"Cancel",cls:"btn-ghost"},{label:"Activate",onClick:async()=>{const days=Number($("grantDays").value);if(!Number.isInteger(days)||days<1||days>3650)return toast("Enter 1 to 3650 whole days","err");if(await safeAction("adminMembership",{action:"grant",uid,planId:$("grantPlan").value,days,note:$("grantNote").value})) {toast("Premium activated","ok");loadStudents();}}}]);
}
async function togglePractice(uid, value) {
  clearFastReads("adminUsers");
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
         clearFastReads("adminUsers");
         toast(`User ${newStatus}`, "ok"); loadStudents();
       } catch (e) { toast("Failed: " + e.message, "err"); }
     }}]);
}
async function approveRequest(rid,uid,type,planId) {
 if(type!=="premium") return toast("Legacy practice requests cannot activate paid access. Choose Grant Premium in Students.","warn");
 if(await safeAction("adminMembership",{action:"approve",rid,uid,planId})){toast("Payment approved and premium activated","ok");loadRequests();}
}
async function rejectRequest(rid) {
  try {
    await updateDoc(doc(db, "accessRequests", rid), { status: "rejected" });
    clearFastReads("adminRequests","pendingRequests");
    toast("Rejected", "ok"); loadRequests();
  } catch (e) { toast("Failed: " + e.message, "err"); }
}

/* ============ AUTH LISTENER & BOOT ============ */
function renderWithBootTarget(screen, params) {
  if (screen === "loading" || screen === "login" || screen === "signup") {
    navigate(params.next || "home");
  } else if (screen === "exam") {
    const saved = loadExamState();
    if (saved) {
      state.screen = "exam";
      resumeExamFromSaved(saved);
    } else {
      replaceNavigate("sets");
    }
  } else {
    state.screen = screen;
    state.params = params;
    render();
  }
}

function setupRealtimeProfile(user) {
  if (state._userSub) state._userSub();
  state._userSub = onSnapshot(doc(db, "users", user.uid), snap => {
    if (!snap.exists()) return;
    const fresh = { uid: user.uid, ...snap.data() };
    const prev = state.profile;
    if(prev?.status!==fresh.status||membershipUntil(prev?.premium?.expiry)!==membershipUntil(fresh.premium?.expiry))clearFastReads("questions");
    state.profile = fresh;
    if(fresh.status==="blocked" || (!state.isAdmin && !(fresh.premium && daysLeft(fresh.premium.expiry)>0))){
      stopAudio();state.sets=[];state.practice=null;
      if(state.screen==="practice")navigate("premium");
      if(state.exam){state.exam=null;clearExamState();clearInterval(state._tick);navigate("premium");}
    }
    if(prev?.premium?.expiry?.seconds!==fresh.premium?.expiry?.seconds) loadDataInBackground();
    state.isAdmin = (user.email === ADMIN_EMAIL && user.emailVerified);
    saveProfileCache(user.uid, fresh);
    // Only re-render on meaningful changes
    if (!prev) return;
    const changed =
      (prev.premium?.expiry?.seconds || prev.premium?.expiry || null) !== (fresh.premium?.expiry?.seconds || fresh.premium?.expiry || null) ||
      prev.practiceAccess !== fresh.practiceAccess ||
      prev.status !== fresh.status ||
      prev.role !== fresh.role ||
      (prev.bookmarks?.length || 0) !== (fresh.bookmarks?.length || 0) ||
      prev.name !== fresh.name ||
      prev.photoURL !== fresh.photoURL;
    if (changed && !["exam", "practice", "result"].includes(state.screen)) {
      render();
    }
  });
}

async function loadDataInBackground() {
 return onceJob("background",async()=>{
 await Promise.allSettled([
  (async()=>{state.plans=await loadPlans();})(),
  (async()=>{if(state.user) state.results=await loadResults(state.user.uid);})(),
  (async()=>{const c=await getDoc(doc(db,"appConfig","main"));appConfig=c.exists()?{...appConfig,...c.data()}:appConfig;})(),
  (async()=>{state.leaderboard=await loadLeaderboard();})(),
  (async()=>{if(hasPremium()){try{const qr=await loadQuestions();state.sets=buildSets(qr.rows);state.contentError=null;recomputeTotals();}catch(e){state.contentError=e.message;state.sets=[];}}})()
 ]);
 if(state.user && ["home","profile","sets","start","premium","bookmarks","leaderboard"].includes(state.screen)) render();
 updateInstallBanner();setupAdminNotifications();
 });
}

onAuthStateChanged(auth, async (user) => {
  if (state._userSub) { state._userSub(); state._userSub = null; }
  if(state._requestsSub){state._requestsSub();state._requestsSub=null;}
  if (state._lockTick) { clearInterval(state._lockTick); state._lockTick = null; }

  if (!user) {
    state.user = null; state.profile = null; state.isAdmin = false;
    state.sets = []; state.results = []; state.plans = [];
    const { screen, params } = parseHash();
    if (screen === "login" || screen === "signup") {
      state.screen = screen; state.params = params; render();
    } else {
      navigate("login", screen && screen !== "loading" ? { next: screen } : {});
    }
    return;
  }

  state.user = user;
  const { screen, params } = parseHash();

  // Try cache for instant render
  const cachedProfile = loadProfileCache(user.uid);
  if (cachedProfile) {
    state.profile = cachedProfile;
    state.isAdmin = (user.email === ADMIN_EMAIL && user.emailVerified);
    if (cachedProfile.status === "blocked") {
      modal("Account Blocked", "Your account has been blocked. Contact the administrator.",
        [{ label: "Logout", cls: "btn-danger", onClick: logout }]);
      return;
    }
    // Show target screen immediately from cache
    renderWithBootTarget(screen, params);
    // Realtime updates
    setupRealtimeProfile(user);
    // Background data
    loadDataInBackground();
    return;
  }

  // No cache — full load (slow path first time only)
  state.screen = "loading";
  render();
  try {
    state.profile = await ensureUserProfile(user);
    state.isAdmin = (user.email === ADMIN_EMAIL && user.emailVerified);
    saveProfileCache(user.uid, state.profile);
    if (state.profile.status === "blocked") {
      modal("Account Blocked", "Your account has been blocked. Contact the administrator.",
        [{ label: "Logout", cls: "btn-danger", onClick: logout }]);
      return;
    }
    loadDataInBackground();
    setupRealtimeProfile(user);

    // Handle Google redirect return
    const redirectTarget = sessionStorage.getItem(REDIRECT_AFTER_KEY);
    if (redirectTarget) {
      sessionStorage.removeItem(REDIRECT_AFTER_KEY);
      if (location.hash !== redirectTarget) {
        history.replaceState({}, "", redirectTarget);
      }
    }

    renderWithBootTarget(screen, params);
  } catch (e) {
    console.error("Boot error", e);
    toast("Load error: " + e.message, "err");
    state.screen = state.profile?"home":"login";
    if(!state.profile){state.user=null;await signOut(auth);}
    render();
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
async function checkFreeAccess(){
 const uid=requireSession();if(state.isAdmin)return {ok:true};
 const browser=deviceId();
 return runTransaction(db,async tx=>{
  const uref=doc(db,'users',uid),bref=doc(db,'deviceBindings',uid);
  const [u,b]=await Promise.all([tx.get(uref),tx.get(bref)]);
  const p=u.exists()?u.data():null;
  if(!activeProfile(p))throw new Error('An active premium plan is required. Contact the admin if your payment was approved.');
  if(b.exists()&&b.data().deviceId!==browser)throw new Error('Premium is linked to another browser. Ask the admin to reset your device.');
  if(!b.exists())tx.set(bref,{deviceId:browser,boundAt:serverTimestamp()});
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
  if(action==='revoke')tx.update(userRef,{premium:null,practiceAccess:false});
  else if(action==='resetDevice')tx.delete(bindingRef);
  else {
   if(!Number.isInteger(days)||days<1||days>3650)throw new Error('Enter 1 to 3650 whole days');
   const now=Date.now(),existing=membershipUntil(u.data().premium?.expiry)||0,note=String(data.note??(action==='approve'?'Payment approved':'')).slice(0,1000);
   tx.update(userRef,{premium:{plan:String(plan.name||'Premium'),planId,start:new Date(now),expiry:new Date(Math.max(now,existing)+days*86400000),note},practiceAccess:false,note});
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
  case 'checkAccess':return checkFreeAccess();
  case 'requestPremium':return createPremiumRequest(data);
  case 'adminMembership':return changeMembership(data);
  case 'startAttempt':{
   await checkFreeAccess();const set=Number(data.setIdx);
   if(!Number.isInteger(set)||set<1||set>6)throw new Error('Invalid set');
   const bankRows=await readQuestionRows();
   const questions=bankRows.filter(r=>r.set===set&&SECTIONS.some(s=>s.key===r.section));
   if(!questions.length)throw new Error('This set has no questions');
   return {attemptId:uuid(),questions};
  }
  case 'activateAttempt':await checkFreeAccess();return {startedAt:Date.now()};
  default:throw new Error('Unknown app action');
 }
}
async function safeAction(name,data={}){
 try{const result=await onceJob("action:"+name+":"+JSON.stringify(data),()=>firestoreAction(name,data));if(["requestPremium","adminMembership"].includes(name))clearFastReads("adminUsers","adminRequests","pendingRequests");return result;}catch(error){
  console.error('Dream Japan Firestore action failed',{action:name,code:error.code||'app/error',message:error.message});
  const code=String(error.code||'');
  const message=code.includes('permission-denied')?'Access denied. Publish the new no-upgrade Firestore rules, then sign out and sign in again.':code.includes('unavailable')?'Connection unavailable. Reconnect and try again.':error.message||'Unable to complete this action';
  toast(message,'err');return null;
 }
}
/* END FIRESTORE ACTIONS */

function hasPremium(){return !!state.user && state.profile?.status!=="blocked" && (state.isAdmin || !!state.profile?.premium && daysLeft(state.profile.premium.expiry)>0);}
async function authorizeContent(){
 if(!hasPremium()){navigate("premium");return false;}
 if(!await safeAction("checkAccess"))return false;
 return true;
}
function audioClock(sec){return Number.isFinite(sec)?`${pad(Math.floor(sec/60))}:${pad(Math.floor(sec%60))}`:"00:00";}
function mediaMarkup(q){return `<div class="media fixed-media">${q.img?`<div class="image-slot"><img src="${esc(resolveUrl(q.img))}" alt="Question illustration" decoding="async" fetchpriority="high" data-question-img><span class="image-error" hidden>Image unavailable</span><button type="button" class="image-zoom" aria-label="Zoom in image" data-image-zoom>⊕</button></div>`:""}${q.au?`<div class="audio-row" id="audRow"><button class="play-btn" id="playBtn" aria-label="Play or pause audio">Play</button><div class="audio-details"><span id="audioTime">00:00 / 00:00</span><progress id="audioProgress" value="0" max="100" aria-label="Audio progress"></progress><small id="audioLeft">${state.practice?"Unlimited practice":Math.max(0,MAX_PLAYS-(q.played||0))+" plays left"}</small></div></div>`:""}</div>`;}
function previewMedia(q){return `${q.img?`<div class="image-slot"><img src="${esc(resolveUrl(q.img))}" alt="Question illustration" loading="lazy" data-question-img><span class="image-error" hidden>Image unavailable</span><button type="button" class="image-zoom" aria-label="Zoom in image" data-image-zoom>⊕</button></div>`:""}${q.au? q.au.startsWith("tts:")?"<p>Japanese speech audio</p>":`<audio controls preload="none" src="${esc(resolveUrl(q.au))}"></audio>`:""}`;}
function bindMedia(){
 prefetchUpcoming();
 document.querySelectorAll("[data-image-zoom]").forEach(b=>b.onclick=()=>{const img=b.parentElement.querySelector("img");if(img?.naturalWidth)openImageZoom(img.src);});
 document.querySelectorAll("[data-report]").forEach(b=>b.onclick=()=>{
 const ex=state.practice||state.exam,sec=ex?.sections[ex.si],q=sec?.questions[ex.qi];if(!q)return;
 modal("Report this question",`<p>Set ${q.set} · ${esc(sec.name)} · Q${ex.qi+1}</p><textarea id="reportReason" class="input" maxlength="1000" placeholder="Describe the issue with this question"></textarea><p class="muted small">Copy your report or open WhatsApp to review and send it to the admin.</p>`,[{label:"Close",cls:"btn-ghost"},{label:"Copy report",keepOpen:true,onClick:()=>copyText(reportText())},{label:"Open WhatsApp",keepOpen:true,onClick:()=>{const number=String(appConfig.whatsappNumber||"").replace(/\D/g,"");if(!number)return toast("Admin contact is unavailable. Copy your report instead.","warn");window.open(`https://wa.me/${number}?text=${encodeURIComponent(reportText())}`,"_blank","noopener,noreferrer");}}]);
 function reportText(){return `Dream Japan question report\nSet ${q.set} · ${sec.name} · Q${ex.qi+1}\nID: ${q.id||""}\n${q.q}\nIssue: ${$("reportReason")?.value||""}`;}
 });
 document.querySelectorAll("[data-question-img]").forEach(img=>{img.onerror=()=>{img.style.visibility="hidden";const e=img.parentElement.querySelector(".image-error");if(e)e.hidden=false;};});
 document.querySelectorAll("[data-bookmark]").forEach(b=>{
  const ex=state.practice||state.exam, sec=ex?.sections[ex.si], q=sec?.questions[ex.qi];
  if(!q)return;
  const qi=state.sets[q.set-1]?.sections.find(s=>s.key===q.section)?.questions.findIndex(v=>v.id===q.id);
  const selected=(state.profile?.bookmarks||[]).some(v=>q.id?v.id===q.id:v.set===q.set&&v.section===q.section&&v.qi===qi);
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
async function preloadMedia(questions){
 showPreparing("Preparing your exam", "Preparing questions, images and listening audio…");
 const first=questions.slice(0,3);
 await Promise.race([Promise.all(first.map(q=>warmQuestion(q,"high"))),new Promise(resolve=>setTimeout(resolve,3500))]);
 // Keep the first screen responsive. Remaining assets are warmed as each question opens.
 closeModal();return true;
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
 let pending,c;
 try{[pending,c]=await Promise.all([getDocs(query(collection(db,"accessRequests"),where("uid","==",state.user.uid),where("status","==","pending"))),memoRead("config",()=>getDoc(doc(db,"appConfig","main")),30000)]);}catch(error){if(token===state._paymentOpenToken)closeModal();throw error;}
 if(token!==state._paymentOpenToken||!$("modal").classList.contains("show"))return;
 if(!pending.empty)return modal("Request already pending","Your payment request is waiting for admin verification. Please do not submit again.");
 if(c.exists())appConfig={...appConfig,...c.data()};
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
function questionPreview(row){const q=buildSets([row])[row.set-1]?.sections.find(s=>s.key===row.section)?.questions[0];if(!q)return "Invalid question";return `<article class="q-card"><p class="muted">Set ${row.set} · ${esc(row.section)}</p><div class="q-text">${esc(q.q)}</div>${q.p?`<div class="passage">${passageHTML(q.p)}</div>`:""}${previewMedia(q)}<div class="opts">${q.o.map((v,i)=>v?`<div class="opt ${i===q.a?"sel":""}"><div class="opt-ltr">${"ABCD"[i]}</div><div class="opt-tx">${esc(v)}</div></div>`:"").join("")}</div><p class="muted small">Admin answer: ${esc(row.answer)}</p></article>`;}
function previewSet(){const rows=state._visibleQs||[];if(!rows.length)return toast("No questions to preview","warn");modal("Set preview",rows.map(questionPreview).join(""));bindMedia();}
async function mutateQuestions(transform){
 if(!state.isAdmin)throw new Error("Admin required");
 const out=await runTransaction(db,async t=>{
  const ref=doc(db,QUESTIONS_DOC),snap=await t.get(ref),data=snap.data()||{};
  const raw=Array.isArray(data.questions)?data.questions:Object.values(data).find(Array.isArray)||[];
  const rows=raw.map(normalizeRow).filter(Boolean).map((r,i)=>({...r,id:r.id||`legacy_${i}`}));
  const updated=transform(rows);t.set(ref,{questions:updated,updatedAt:serverTimestamp()},{merge:true});return updated;
 });
 state._allQs=out;state.sets=buildSets(out);recomputeTotals();clearQCache();return out;
}
async function moveQuestion(row,delta){try{await mutateQuestions(rows=>{const i=rows.findIndex(r=>r.id===row.id);const same=rows.map((r,i)=>({r,i})).filter(x=>x.r.set===row.set&&x.r.section===row.section);const at=same.findIndex(x=>x.i===i),target=same[at+delta]?.i;if(target!==undefined)[rows[i],rows[target]]=[rows[target],rows[i]];return rows;});filterQuestions();}catch(e){toast(e.message,"err");}}
function deleteSelected(){const ids=[...document.querySelectorAll("[data-qcheck]:checked")].map(c=>c.dataset.qcheck);if(!ids.length)return toast("Select questions first","warn");modal("Delete selected questions?",`${ids.length} questions will be removed. Export a backup first if needed.`,[{label:"Cancel",cls:"btn-ghost"},{label:"Delete",cls:"btn-danger",onClick:async()=>{try{await mutateQuestions(rows=>rows.filter(r=>!ids.includes(r.id)));filterQuestions();}catch(e){toast(e.message,"err");}}}]);}
async function studentAction(action,uid){
 if(action==="note"){const u=state._allStudents?.find(u=>u.uid===uid);modal("Student note",`<textarea class="input" id="studentNote">${esc(u?.note||"")}</textarea>`,[{label:"Cancel",cls:"btn-ghost"},{label:"Save",onClick:async()=>{try{await updateDoc(doc(db,"users",uid),{note:$("studentNote").value});clearFastReads("adminUsers");loadStudents();}catch(e){toast(e.message,"err");}}}]);return;}
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
function setupAdminNotifications(){
 if(!state.isAdmin||state._requestsSub)return;
 let first=true;
 state._requestsSub=onSnapshot(query(collection(db,"accessRequests"),where("status","==","pending")),snap=>{
 const previous=state._pendingCount||0;state._pendingCount=snap.size;clearFastReads("adminRequests","pendingRequests");
 if(!first&&snap.size>previous)toast("New premium payment request received","ok");first=false;
 if($("pendingAdminCount"))$("pendingAdminCount").textContent=String(snap.size);
 if(state.screen==="admin"&&adminTab==="requests")loadRequests();
 },e=>toast("Request notifications: "+e.message,"err"));
}
function enhancedSettings(){return `<div class="card mt-2"><h3>Payment and install settings</h3><label>eSewa number<input class="input" id="cfgEsewa" value="${esc(appConfig.esewaNumber)}"></label><label>WhatsApp number with country code<input class="input" id="cfgWhatsapp" value="${esc(appConfig.whatsappNumber)}"></label><label>QR path<input class="input" id="cfgQR" value="${esc(appConfig.qrPath)}"></label><label><input type="checkbox" id="cfgInstall" ${appConfig.installPromptEnabled?"checked":""}> Show install suggestion</label><button class="btn btn-primary mt-2" id="saveConfig">Save settings</button></div><div class="card mt-2"><h3>Premium plans</h3><div id="adminPlans">${state.plans.map(p=>`<div class="plan-row"><b>${esc(p.name)}</b><span>NPR ${Number(p.price)} · ${Number(p.days)} days · ${p.active!==false?"Active":"Hidden"}</span><button class="btn btn-sm btn-ghost" data-edit-plan="${esc(p.id)}">Edit</button></div>`).join("")}</div><button id="addPlan" class="btn btn-primary mt-2">Add plan</button></div>`;}
function editPlan(id){const p=state.plans.find(p=>p.id===id)||{name:"",price:500,days:15,active:true,benefits:[]};modal(id?"Edit plan":"Add plan",`<label>Name<input id="planName" class="input" value="${esc(p.name)}"></label><label>Price NPR<input id="planPrice" class="input" type="number" min="0" value="${Number(p.price)}"></label><label>Days<input id="planDays" class="input" type="number" min="1" value="${Number(p.days)}"></label><label>Benefits, one per line<textarea id="planBenefits" class="input">${esc(p.benefits.join("\n"))}</textarea></label><label><input id="planActive" type="checkbox" ${p.active!==false?"checked":""}> Available for purchase</label>`,[{label:"Cancel",cls:"btn-ghost"},{label:"Save",onClick:async()=>{const plan={name:$("planName").value.trim(),price:Number($("planPrice").value),days:Number($("planDays").value),active:$("planActive").checked,benefits:$("planBenefits").value.split("\n").map(v=>v.trim()).filter(Boolean)};if(!plan.name||!Number.isFinite(plan.price)||plan.price<0||!Number.isInteger(plan.days)||plan.days<1||plan.days>3650)return toast("Enter valid plan details","err");try{await setDoc(doc(db,"plans",id||uuid()),plan);state.plans=await loadPlans();render();}catch(e){toast(e.message,"err");}}}]);}
window.addEventListener("unhandledrejection",e=>{console.error(e.reason);toast(e.reason?.message||"Request failed. Please retry.","err");});
window.addEventListener("offline",()=>toast("Connection lost. Current media may remain available; reconnect to save results.","warn"));

/* ============ INIT ============ */
clearQCache();
initHistory();
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});

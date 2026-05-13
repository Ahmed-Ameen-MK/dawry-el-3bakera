const SB_URL = 'https://spbbtsrabohqaspqzsph.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwYmJ0c3JhYm9ocWFzcHF6c3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTk4ODEsImV4cCI6MjA5MzYzNTg4MX0.SfgtGV2RpvmpthbR9D036bXWJZdBkDQFrUJbqsOjHsI';

const Q_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Prefer': 'return=representation'
};

// ==================== SUPABASE REALTIME (native WebSocket — no library) ====================
// يتصل مباشرة بـ Supabase Realtime WebSocket بدون أي مكتبة خارجية
const RT_URL = SB_URL.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + SB_KEY + '&vsn=1.0.0';

let _rtSocket = null;       // WebSocket الرئيسي المشترك
let _rtChannels = {};       // { channelKey: { topic, filter, callback, ref } }
let _rtRef = 1;             // رقم متسلسل للرسائل
let _rtPingInterval = null; // heartbeat

function rtConnect(onReady) {
  if (_rtSocket && _rtSocket.readyState === WebSocket.OPEN) {
    if (onReady) onReady();
    return;
  }
  _rtSocket = new WebSocket(RT_URL);

  _rtSocket.onopen = () => {
    // heartbeat كل 25 ثانية
    _rtPingInterval = setInterval(() => {
      if (_rtSocket.readyState === WebSocket.OPEN)
        _rtSocket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(_rtRef++) }));
    }, 25000);
    if (onReady) onReady();
    // أعد تسجيل أي channels كانت موجودة
    Object.values(_rtChannels).forEach(ch => _rtJoin(ch));
  };

  _rtSocket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      // Supabase Realtime: postgres_changes جاية في payload.data.record
      const data = msg.payload && msg.payload.data;
      if (!data || data.type !== 'UPDATE') return;
      const record = data.record;
      if (!record) return;
      Object.values(_rtChannels).forEach(ch => {
        if (ch.topic === msg.topic) ch.callback(record);
      });
    } catch(err) {}
  };

  _rtSocket.onclose = () => {
    clearInterval(_rtPingInterval);
    // إعادة الاتصال بعد 3 ثوانٍ
    setTimeout(() => rtConnect(), 3000);
  };
  _rtSocket.onerror = () => _rtSocket.close();
}

function _rtJoin(ch) {
  if (!_rtSocket || _rtSocket.readyState !== WebSocket.OPEN) return;
  const payload = {
    config: {
      broadcast: { self: false },
      presence: { key: '' },
      postgres_changes: [{ event: 'UPDATE', schema: 'public', table: 'system', filter: ch.filter }]
    }
  };
  _rtSocket.send(JSON.stringify({ topic: ch.topic, event: 'phx_join', payload, ref: String(_rtRef++) }));
}

// اشترك في تغييرات صف معيّن
// filter مثال: "id=eq.12345"
// callback(record) تستقبل الصف الجديد
// كل المستمعين على صف المستخدم نفسه يُدمجون في channel واحد
// callbacks مخزّنة هنا بدلاً من channels منفصلة
let _myRowCallbacks = {}; // { key: callback }
let _myRowJoined = false;

function rtSubscribe(key, filter, callback) {
  // إذا كان filter لصف المستخدم نفسه → استخدم channel مشترك
  if (currentUser && filter === 'id=eq.' + currentUser.id) {
    _myRowCallbacks[key] = callback;
    if (!_myRowJoined) {
      _myRowJoined = false; // سيُعيَّن true بعد phx_join
      const topic = 'realtime:public:system:id=eq.' + currentUser.id;
      const ch = {
        key: '__myrow__',
        topic,
        filter,
        callback: (record) => Object.values(_myRowCallbacks).forEach(cb => cb(record))
      };
      _rtChannels['__myrow__'] = ch;
      rtConnect(() => _rtJoin(ch));
    }
    return;
  }
  // غير ذلك → channel مستقل
  const topic = 'realtime:public:system:' + filter;
  const ch = { key, topic, filter, callback };
  _rtChannels[key] = ch;
  rtConnect(() => _rtJoin(ch));
}

function rtUnsubscribe(key) {
  if (_myRowCallbacks[key]) {
    delete _myRowCallbacks[key];
    // لا نغلق الـ channel المشترك إلا إذا فرغ تماماً
    if (Object.keys(_myRowCallbacks).length === 0) {
      const ch = _rtChannels['__myrow__'];
      if (ch && _rtSocket && _rtSocket.readyState === WebSocket.OPEN) {
        _rtSocket.send(JSON.stringify({ topic: ch.topic, event: 'phx_leave', payload: {}, ref: String(_rtRef++) }));
      }
      delete _rtChannels['__myrow__'];
      _myRowJoined = false;
    }
    return;
  }
  const ch = _rtChannels[key];
  if (ch && _rtSocket && _rtSocket.readyState === WebSocket.OPEN) {
    _rtSocket.send(JSON.stringify({ topic: ch.topic, event: 'phx_leave', payload: {}, ref: String(_rtRef++) }));
  }
  delete _rtChannels[key];
}

// QUESTIONS loaded from questions.js (included before this script)

// ==================== STATE ====================
let currentUser = null;
let matchInterval = null;
let qTimerInterval = null;
let matchData = null;
let currentQ = null;
let answered = false;
let myMatchPts = 0;
let oppMatchPts = 0;
let matchStartTime = null;
let usedQIds = [];
let matchTotalTimer = null;
let searchPollInterval = null;
let searchTimerInterval = null;
let opponent = null;
let chatPollInterval = null;
let lastChatTs = 0;

// ==================== UTILS ====================
async function sbFetch(path, opts={}, retries=2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(SB_URL + path, {
        ...opts,
        headers: { ...Q_HEADERS, ...(opts.headers||{}) },
        signal: controller.signal
      });
      clearTimeout(timer);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (!res.ok) { console.error('Supabase Error:', res.status, json); return { __error: true, status: res.status, ...json }; }
        return json;
      } catch(e) { console.error('Parse error:', text); return null; }
    } catch(e) {
      console.error('Fetch error attempt ' + (attempt+1) + ':', e);
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

async function getCountry() {
  try {
    const r = await fetch('https://ipapi.co/json/');
    const d = await r.json();
    return (d.country_name || 'غير معروف') + ' ' + (d.country_code ? countryFlag(d.country_code) : '');
  } catch { return 'غير معروف'; }
}

function countryFlag(cc) {
  return cc.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt()));
}

function showMsg(el, txt, type) {
  el.innerHTML = `<div class="msg ${type}">${txt}</div>`;
}

// ==================== PAGES ====================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const nb = document.getElementById('nav-' + (name === 'leaderboard' ? 'lb' : name === 'profile' ? 'profile' : 'home'));
  if (nb) nb.classList.add('active');
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'profile') loadProfile();
}

function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
  // إعادة تحميل Turnstile عند تبديل التبويب
  if (window.turnstile) {
    try { window.turnstile.reset('#turnstile-login'); } catch(e){}
    try { window.turnstile.reset('#turnstile-register'); } catch(e){}
  }
}

// ==================== AUTH ====================
async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value.trim();
  const msgEl = document.getElementById('reg-msg');
  if (!name || !email || !pass) return showMsg(msgEl, 'يرجى ملء جميع الحقول', 'error');
  // التحقق من Turnstile
  const turnstileToken = document.querySelector('#turnstile-register [name="cf-turnstile-response"]');
  if (!turnstileToken || !turnstileToken.value) return showMsg(msgEl, 'يرجى إتمام التحقق الأمني أولاً', 'error');
  // التحقق من صيغة البريد الإلكتروني
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return showMsg(msgEl, 'صيغة البريد الإلكتروني غير صحيحة (مثال: user@example.com)', 'error');
  // التحقق من الباسوورد: لا يحتوي على < : = >
  if (/[<:=>]/.test(pass)) return showMsg(msgEl, 'كلمة المرور لا يجب أن تحتوي على الرموز: < : = >', 'error');
  if (pass.length < 6) return showMsg(msgEl, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
  showMsg(msgEl, 'جاري إنشاء الحساب...', 'info');
  const country = await getCountry();
  const check = await sbFetch(`/rest/v1/system?email=eq.${encodeURIComponent(email)}&select=id`, { method: 'GET' });
  if (check && check.length > 0) return showMsg(msgEl, 'هذا البريد مسجل مسبقاً', 'error');
  const newId = Date.now() + Math.floor(Math.random() * 9999);
  const res = await sbFetch('/rest/v1/system', {
    method: 'POST',
    body: JSON.stringify({ id: newId, name, email, password: pass, country, match: 'off', points: 0, question: 0, answer: 'none', 'match-message': '' })
  });
  if (res && res[0] && res[0].id) {
    showMsg(msgEl, 'تم إنشاء الحساب بنجاح!', 'success');
    setTimeout(() => { loginUser(res[0]); }, 1000);
  } else if (res && res.__error) {
    showMsg(msgEl, `خطأ: ${res.message || res.hint || JSON.stringify(res)}`, 'error');
  } else {
    showMsg(msgEl, `حدث خطأ: ${JSON.stringify(res)}`, 'error');
  }
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  const msgEl = document.getElementById('login-msg');
  if (!email || !pass) return showMsg(msgEl, 'يرجى ملء جميع الحقول', 'error');
  // التحقق من Turnstile
  const turnstileToken = document.querySelector('#turnstile-login [name="cf-turnstile-response"]');
  if (!turnstileToken || !turnstileToken.value) return showMsg(msgEl, 'يرجى إتمام التحقق الأمني أولاً', 'error');
  showMsg(msgEl, 'جاري التحقق...', 'info');
  const res = await sbFetch(`/rest/v1/system?email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(pass)}&select=*`, { method: 'GET' });
  if (res && res.length > 0) { loginUser(res[0]); }
  else { showMsg(msgEl, 'البريد أو كلمة المرور غير صحيحة', 'error'); }
}

function loginUser(user) {
  currentUser = user;
  localStorage.setItem('genius_user', JSON.stringify(user));
  showDashboard();
}

function showDashboard() {
  document.getElementById('auth-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
  document.getElementById('nav-profile').style.display = '';
  const u = currentUser;
  const initial = u.name ? u.name[0].toUpperCase() : '?';
  const dashAvatarEl = document.getElementById('dash-avatar');
  if (u.avatar_url) {
    dashAvatarEl.innerHTML = '';
    dashAvatarEl.style.background = 'none';
    dashAvatarEl.style.border = 'none';
    dashAvatarEl.style.padding = '0';
    const img = document.createElement('img');
    img.src = u.avatar_url;
    img.style.cssText = 'width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.3);display:block;';
    img.onerror = () => { dashAvatarEl.innerHTML = initial; dashAvatarEl.style.cssText = ''; };
    dashAvatarEl.appendChild(img);
  } else {
    dashAvatarEl.innerHTML = initial;
    dashAvatarEl.style.cssText = '';
  }
  document.getElementById('dash-name').textContent = u.name;
  document.getElementById('dash-email').textContent = u.email;
  document.getElementById('dash-country').textContent = u.country || '';
  document.getElementById('dash-points').textContent = u.level || 0;
  document.getElementById('stat-pts').textContent = u.level || 0;
  document.getElementById('stat-country').textContent = u.country || '';
  loadRank();
  updateNavAvatar();
  startLiveStats();
  startLeaderboardRealtime();
  loadMiniLeaderboard();
}

function updateNavAvatar() {
  const u = currentUser;
  if (!u) return;
  const navBtn = document.getElementById('nav-profile');
  if (!navBtn) return;
  if (u.avatar_url) {
    navBtn.innerHTML = `<img src="${u.avatar_url}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;vertical-align:middle;border:1.5px solid var(--line)"> <span class="nav-text">حسابي</span>`;
  } else {
    navBtn.innerHTML = `<i class="fa-solid fa-user"></i> <span class="nav-text">حسابي</span>`;
  }
}

async function loadRank() {
  const all = await sbFetch('/rest/v1/system?select=id,level&order=level.desc', { method: 'GET' });
  if (all) {
    const idx = all.findIndex(u => u.id === currentUser.id);
    document.getElementById('stat-rank').textContent = '#' + (idx + 1);
  }
}

function doLogout() {
  cancelSearch();
  currentUser = null;
  localStorage.removeItem('genius_user');
  localStorage.removeItem('genius_sb_token');
  document.getElementById('auth-section').style.display = '';
  document.getElementById('dashboard-section').style.display = 'none';
  document.getElementById('nav-profile').style.display = 'none';
  showPage('home');
}

// ==================== GOOGLE AUTH (SUPABASE) ====================
function doGoogleLogin() {
  const redirectTo = window.location.href.split('?')[0].split('#')[0];
  window.location.href = `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function handleGoogleCallback(preToken) {
  // Check URL hash for access_token (Supabase OAuth callback)
  const hash = window.location.hash;
  if (!hash && !preToken) return false;
  const params = new URLSearchParams(hash ? hash.substring(1) : '');
  const accessToken = preToken || params.get('access_token');
  if (!accessToken) return false;

  // Clear hash from URL
  history.replaceState(null, '', window.location.pathname);

  // Get user info from Supabase
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + accessToken }
  });
  if (!userRes.ok) return false;
  const userData = await userRes.json();

  // تحقق أن المزود هو Google
  const provider = userData.app_metadata?.provider || '';
  if (provider !== 'google') return false;

  const email = userData.email;
  const googleName = userData.user_metadata?.full_name || userData.user_metadata?.name || email.split('@')[0];
  const googleAvatar = userData.user_metadata?.avatar_url || userData.user_metadata?.picture || '';

  // Save token for later use
  localStorage.setItem('genius_sb_token', accessToken);

  // Check if user already exists in system table
  const existing = await sbFetch(`/rest/v1/system?email=eq.${encodeURIComponent(email)}&select=*`, { method: 'GET' });
  if (existing && existing.length > 0) {
    // Update avatar if from Google
    let user = existing[0];
    if (googleAvatar && !user.avatar_url) {
      await sbFetch(`/rest/v1/system?id=eq.${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url: googleAvatar })
      });
      user.avatar_url = googleAvatar;
    }
    loginUser(user);
    return true;
  }

  // New user — create record in system table
  const country = await getCountry();
  const newId = Date.now() + Math.floor(Math.random() * 9999);
  const newUser = {
    id: newId,
    name: googleName,
    email: email,
    password: 'google-oauth',
    country,
    avatar_url: googleAvatar,
    match: 'off',
    points: 0,
    question: 0,
    answer: 'none',
    'match-message': ''
  };
  const created = await sbFetch('/rest/v1/system', {
    method: 'POST',
    body: JSON.stringify(newUser)
  });
  if (created && created[0]) {
    loginUser(created[0]);
    return true;
  }
  return false;
}

// ==================== GITHUB AUTH (SUPABASE) ====================
function doGithubLogin() {
  const redirectTo = window.location.href.split('?')[0].split('#')[0];
  window.location.href = `${SB_URL}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function handleGithubCallback(accessToken) {
  // Get user info from Supabase
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + accessToken }
  });
  if (!userRes.ok) return false;
  const userData = await userRes.json();

  // تحقق أن المزود هو GitHub
  const provider = userData.app_metadata?.provider || '';
  if (provider !== 'github') return false;

  const email = userData.email || userData.user_metadata?.email || '';
  const githubName = userData.user_metadata?.full_name || userData.user_metadata?.user_name || userData.user_metadata?.name || (email ? email.split('@')[0] : 'مستخدم');
  const githubAvatar = userData.user_metadata?.avatar_url || '';

  localStorage.setItem('genius_sb_token', accessToken);

  // Check if user already exists
  const existing = await sbFetch(`/rest/v1/system?email=eq.${encodeURIComponent(email)}&select=*`, { method: 'GET' });
  if (existing && existing.length > 0) {
    let user = existing[0];
    if (githubAvatar && !user.avatar_url) {
      await sbFetch(`/rest/v1/system?id=eq.${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url: githubAvatar })
      });
      user.avatar_url = githubAvatar;
    }
    loginUser(user);
    return true;
  }

  // New GitHub user — create record
  const country = await getCountry();
  const newId = Date.now() + Math.floor(Math.random() * 9999);
  const newUser = {
    id: newId,
    name: githubName,
    email: email,
    password: 'github-oauth',
    country,
    avatar_url: githubAvatar,
    match: 'off',
    points: 0,
    question: 0,
    answer: 'none',
    'match-message': ''
  };
  const created = await sbFetch('/rest/v1/system', {
    method: 'POST',
    body: JSON.stringify(newUser)
  });
  if (created && created[0]) {
    loginUser(created[0]);
    return true;
  }
  return false;
}

// ==================== MATCHMAKING ====================
const SEARCH_MAX = 60;

async function startSearch() {
  if (!currentUser) return;
  document.getElementById('play-btn').disabled = true;
  document.getElementById('searching-anim').classList.add('show');
  document.getElementById('cancel-btn').style.display = '';
  document.getElementById('search-msg').innerHTML = '';

  await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ match: 'searching' })
  });

  // ── Realtime: استمع لتغيير حقل match في صفي ──
  rtSubscribe('match-listen', `id=eq.${currentUser.id}`, async (record) => {
    const newMatch = record?.match;
    if (!newMatch || newMatch === 'searching' || newMatch === 'off') return;
    // وجدنا خصماً!
    clearInterval(searchTimerInterval);
    clearInterval(searchPollInterval);
    rtUnsubscribe('match-listen');
    const opp = await sbFetch(`/rest/v1/system?id=eq.${newMatch}&select=id,name,country,points,level,avatar_url`, { method: 'GET' });
    if (opp && opp[0]) startMatch(opp[0]);
  });

  // countdown
  let timeLeft = SEARCH_MAX;
  document.getElementById('search-countdown-num').textContent = timeLeft;
  document.getElementById('search-bar-fill').style.width = '100%';

  searchTimerInterval = setInterval(() => {
    timeLeft--;
    document.getElementById('search-countdown-num').textContent = timeLeft;
    document.getElementById('search-bar-fill').style.width = (timeLeft / SEARCH_MAX * 100) + '%';

    if (timeLeft === SEARCH_MAX - 10) {
      const offlineBtn = document.getElementById('offline-mode-btn');
      if (offlineBtn) { offlineBtn.style.display = 'inline-flex'; offlineBtn.style.animation = 'fadeInBtn 0.4s ease'; }
    }

    if (timeLeft <= 0) {
      clearInterval(searchTimerInterval);
      clearInterval(searchPollInterval);
      rtUnsubscribe('match-listen');
      if (currentUser) sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ match: 'off' }) });
      document.getElementById('searching-anim').classList.remove('show');
      document.getElementById('play-btn').disabled = false;
      document.getElementById('cancel-btn').style.display = 'none';
      const offBtn = document.getElementById('offline-mode-btn');
      if (offBtn) offBtn.style.display = 'none';
      document.getElementById('search-countdown-num').textContent = SEARCH_MAX;
      document.getElementById('search-bar-fill').style.width = '100%';
      document.getElementById('search-text').textContent = 'جاري البحث عن خصم...';
      document.getElementById('search-msg').innerHTML = '<div class="msg error"><i class="fa-solid fa-clock" style="margin-left:6px"></i>انتهى وقت البحث، حاول مرة أخرى</div>';
    }
  }, 1000);

  // polling خفيف كل 4 ثوانٍ فقط للتزاوج (اللاعب الأول يُعيِّن الخصم لكليهما)
  const countEl = document.getElementById('search-text');
  searchPollInterval = setInterval(async () => {
    countEl.textContent = 'جاري البحث عن خصم...';
    await matchMake();
  }, 4000);
}

async function matchMake() {
  // أولاً: تحقق من حالتي في قاعدة البيانات مباشرةً
  const meData = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}&select=match`, { method: 'GET' });
  if (!meData || !meData[0]) return;

  const myMatchVal = meData[0].match;

  // إذا تغيّر حقل match إلى معرّف خصم (ليس searching وليس off) → ابدأ المباراة فوراً
  if (myMatchVal && myMatchVal !== 'searching' && myMatchVal !== 'off') {
    clearInterval(searchPollInterval);
    clearInterval(searchTimerInterval);
    const oppId = myMatchVal;
    const opp = await sbFetch(`/rest/v1/system?id=eq.${oppId}&select=id,name,country,points,level,avatar_url`, { method: 'GET' });
    if (opp && opp[0]) startMatch(opp[0]);
    return;
  }

  // ما زلت searching → تحقق من قائمة المنتظرين وحاول التزاوج
  const searchers = await sbFetch(`/rest/v1/system?match=eq.searching&select=id,name,country,points,level,avatar_url&order=id.asc`, { method: 'GET' });
  if (!searchers) return;
  const myIdx = searchers.findIndex(u => u.id === currentUser.id);
  if (myIdx === -1 || myIdx % 2 !== 0) return; // انتظر دورك أو لست في قائمة

  const partner = searchers[myIdx + 1];
  if (!partner) return;

  // أنا الطرف الزوجي → أُعيِّن الخصم لكلينا
  clearInterval(searchPollInterval);
  clearInterval(searchTimerInterval);
  await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ match: String(partner.id) }) });
  await sbFetch(`/rest/v1/system?id=eq.${partner.id}`, { method: 'PATCH', body: JSON.stringify({ match: String(currentUser.id) }) });
  startMatch(partner);
}


async function cancelSearch() {
  clearInterval(searchPollInterval);
  clearInterval(searchTimerInterval);
  rtUnsubscribe('match-listen');
  if (currentUser) {
    await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ match: 'off' }) });
  }
  document.getElementById('searching-anim').classList.remove('show');
  document.getElementById('play-btn').disabled = false;
  document.getElementById('cancel-btn').style.display = 'none';
  const offlineBtnC = document.getElementById('offline-mode-btn');
  if (offlineBtnC) offlineBtnC.style.display = 'none';
  document.getElementById('search-countdown-num').textContent = SEARCH_MAX;
  document.getElementById('search-bar-fill').style.width = '100%';
}


// ==================== OFFLINE MODE ====================
let isOfflineMatch = false;

function startOfflineMatch() {
  // إيقاف البحث أولاً
  clearInterval(searchPollInterval);
  clearInterval(searchTimerInterval);
  if (currentUser) sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ match: 'off' }) });

  document.getElementById('searching-anim').classList.remove('show');
  document.getElementById('play-btn').disabled = false;
  document.getElementById('cancel-btn').style.display = 'none';
  const offBtn = document.getElementById('offline-mode-btn');
  if (offBtn) offBtn.style.display = 'none';
  document.getElementById('search-countdown-num').textContent = SEARCH_MAX;
  document.getElementById('search-bar-fill').style.width = '100%';

  // ابدأ مباراة offline محلية
  isOfflineMatch = true;
  opponent = { id: 'cpu', name: 'النمط الفردي', country: '🤖', level: 0, avatar_url: '' };
  myMatchPts = 0;
  oppMatchPts = 0;
  usedQIds = [];
  matchStartTime = Date.now();
  isInMatch = true;
  history.pushState(null, '', window.location.href);

  document.getElementById('my-name-m').textContent = currentUser ? currentUser.name : 'أنت';
  document.getElementById('my-pts-m').textContent = '0';
  document.getElementById('my-country-m').textContent = currentUser ? (currentUser.country || '') : '';
  document.getElementById('opp-name-m').textContent = 'النمط الفردي';
  document.getElementById('opp-pts-m').textContent = '-';
  document.getElementById('opp-country-m').textContent = '🤖';

  const myAvatarEl = document.getElementById('my-avatar-m');
  if (myAvatarEl && currentUser) {
    if (currentUser.avatar_url) {
      myAvatarEl.innerHTML = `<img src="${currentUser.avatar_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${currentUser.name ? currentUser.name[0].toUpperCase() : '?'}'">`;
    } else {
      myAvatarEl.textContent = currentUser.name ? currentUser.name[0].toUpperCase() : '?';
    }
  }
  const oppAvatarEl = document.getElementById('opp-avatar-m');
  if (oppAvatarEl) oppAvatarEl.innerHTML = '<i class="fa-solid fa-robot" style="font-size:20px;color:rgba(255,255,255,0.7)"></i>';

  // أخفِ الدردشة
  document.getElementById('match-chat').style.display = 'none';

  showPage('match');

  // Match total timer: 5 minutes
  matchTotalTimer = setInterval(() => {
    const elapsed = Date.now() - matchStartTime;
    const remaining = (5 * 60 * 1000) - elapsed;
    if (remaining <= 0) { endOfflineMatch('time'); return; }
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('match-timer-display').textContent =
      `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);

  loadNextOfflineQuestion();
}

function loadNextOfflineQuestion() {
  const available = QUESTIONS.filter(q => !usedQIds.includes(q.id));
  if (!available.length) { endOfflineMatch('time'); return; }
  const q = available[Math.floor(Math.random() * available.length)];
  usedQIds.push(q.id);
  currentQ = q;
  answered = false;
  renderQuestion(q);
  startOfflineQTimer();
}

function startOfflineQTimer() {
  clearInterval(qTimerInterval);
  let t = 30; // 30 ثانية بدلاً من 60
  document.getElementById('q-timer-text').textContent = t;
  document.getElementById('q-timer-bar').style.width = '100%';
  document.getElementById('q-timer-bar').style.background = 'var(--blue)';
  qTimerInterval = setInterval(() => {
    t--;
    document.getElementById('q-timer-text').textContent = t;
    document.getElementById('q-timer-bar').style.width = (t / 30 * 100) + '%';
    if (t <= 10) document.getElementById('q-timer-bar').style.background = 'var(--red)';
    if (t <= 0) {
      clearInterval(qTimerInterval);
      setStatus('⏱ انتهى وقت السؤال!', 'warn');
      disableOptions();
      const btns2 = document.querySelectorAll('.option-btn');
      if (btns2[currentQ.a]) btns2[currentQ.a].classList.add('correct');
      setTimeout(() => loadNextOfflineQuestion(), 2200);
    }
  }, 1000);
}

async function answerOfflineQ(idx, btn) {
  if (answered) return;
  answered = true;
  clearInterval(qTimerInterval);
  disableOptions();

  const correct = idx === currentQ.a;
  btn.classList.add(correct ? 'correct' : 'wrong');

  if (correct) {
    playCorrectSound();
    myMatchPts += 10;
    document.getElementById('my-pts-m').textContent = myMatchPts;
    setStatus('إجابة صحيحة! +10 نقاط ✓', 'good');
    if (myMatchPts >= 100) { setTimeout(() => endOfflineMatch('win'), 1500); return; }
    setTimeout(() => loadNextOfflineQuestion(), 1800);
  } else {
    playWrongSound();
    myMatchPts = Math.max(0, myMatchPts - 5);
    document.getElementById('my-pts-m').textContent = myMatchPts;
    const btns = document.querySelectorAll('.option-btn');
    if (btns[currentQ.a]) btns[currentQ.a].classList.add('correct');
    setStatus('❌ إجابة خاطئة!', 'bad');
    setTimeout(() => loadNextOfflineQuestion(), 2200);
  }
}

async function endOfflineMatch(reason) {
  isInMatch = false;
  isOfflineMatch = false;
  clearInterval(matchTotalTimer);
  clearInterval(qTimerInterval);

  let matchResult = '';
  let levelDelta = 0;

  if (reason === 'win') {
    matchResult = 'win';
    levelDelta = 1; // نقطة واحدة فقط في الوضع الفردي
  } else {
    matchResult = myMatchPts >= 50 ? 'draw' : 'lose';
    levelDelta = myMatchPts >= 50 ? 1 : 0;
  }

  if (currentUser && levelDelta > 0) {
    const newLevel = Math.max(0, (currentUser.level || 0) + levelDelta);
    await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ level: newLevel })
    });
    currentUser.level = newLevel;
    localStorage.setItem('genius_user', JSON.stringify(currentUser));
  }

  // اعرض نتيجة مخصصة للوضع الفردي
  const overlay = document.getElementById('win-overlay');
  overlay.classList.add('show');
  const icon = document.getElementById('win-icon');

  if (matchResult === 'win') {
    icon.innerHTML = '<i class="fa-solid fa-trophy"></i>';
    icon.className = 'win-icon trophy';
    document.getElementById('win-title').textContent = 'أحسنت! 🎉';
    document.getElementById('win-sub').textContent = `وصلت لـ 100 نقطة في الوضع الفردي! حصلت على +1 نقطة في لوحة الصدارة`;
  } else if (matchResult === 'draw') {
    icon.innerHTML = '<i class="fa-solid fa-star"></i>';
    icon.className = 'win-icon';
    document.getElementById('win-title').textContent = 'أداء جيد!';
    document.getElementById('win-sub').textContent = `حصلت على ${myMatchPts} نقطة في الوضع الفردي. +1 نقطة صدارة`;
  } else {
    icon.innerHTML = '<i class="fa-regular fa-face-sad-tear"></i>';
    icon.className = 'win-icon lose';
    document.getElementById('win-title').textContent = 'حاول مرة أخرى!';
    document.getElementById('win-sub').textContent = `حصلت على ${myMatchPts} نقطة في الوضع الفردي. استمر في التدرب!`;
  }
}


// ==================== MATCH ====================
function startMatch(opp) {
  opponent = opp;
  myMatchPts = 0;
  oppMatchPts = 0;
  usedQIds = [];
  matchStartTime = Date.now();
  lastChatTs = Date.now();
  isInMatch = true;
  history.pushState(null, '', window.location.href); // لاعتراض زر الرجوع

  document.getElementById('my-name-m').textContent = currentUser.name;
  document.getElementById('my-pts-m').textContent = '0';
  document.getElementById('my-country-m').textContent = currentUser.country || '';
  document.getElementById('opp-name-m').textContent = opp.name;
  document.getElementById('opp-pts-m').textContent = '0';
  document.getElementById('opp-country-m').textContent = opp.country || '';

  // set avatars in match header
  const myAvatarEl = document.getElementById('my-avatar-m');
  if (myAvatarEl) {
    if (currentUser.avatar_url) {
      myAvatarEl.innerHTML = `<img src="${currentUser.avatar_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${currentUser.name ? currentUser.name[0].toUpperCase() : '?'}'">`;
    } else {
      myAvatarEl.textContent = currentUser.name ? currentUser.name[0].toUpperCase() : '?';
    }
  }
  const oppAvatarEl = document.getElementById('opp-avatar-m');
  if (oppAvatarEl) {
    if (opp.avatar_url) {
      oppAvatarEl.innerHTML = `<img src="${opp.avatar_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${opp.name ? opp.name[0].toUpperCase() : '?'}'">`;
    } else {
      oppAvatarEl.textContent = opp.name ? opp.name[0].toUpperCase() : '?';
    }
  }

  // clear chat
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('match-chat').style.display = 'block';

  showPage('match');

  // Match total timer (5 minutes)
  matchTotalTimer = setInterval(() => {
    const elapsed = Date.now() - matchStartTime;
    const remaining = (5 * 60 * 1000) - elapsed;
    if (remaining <= 0) { endMatch('time'); return; }
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('match-timer-display').textContent =
      `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);

  // clear my match-message on start
  sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ 'match-message': '' }) });

  startChatPolling();
  startOpponentResultPolling();

  const iAmSmaller = currentUser.id < opponent.id;
  if (iAmSmaller) loadNextQuestion();
  else pollForQuestion();
}

async function loadNextQuestion() {
  const available = QUESTIONS.filter(q => !usedQIds.includes(q.id));
  if (!available.length) { endMatch('time'); return; }
  const q = available[Math.floor(Math.random() * available.length)];
  usedQIds.push(q.id);
  currentQ = q;
  answered = false;
  await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ question: Number(q.id), answer: 'none' }) });
  await sbFetch(`/rest/v1/system?id=eq.${opponent.id}`, { method: 'PATCH', body: JSON.stringify({ question: Number(q.id), answer: 'none' }) });
  renderQuestion(q);
  startQTimer();
  pollForOpponentAnswer();
}

function pollForQuestion() {
  let tries = 0;
  const lastQ = currentQ ? currentQ.id : 0;
  const poll = setInterval(async () => {
    tries++;
    if (tries > 30) { clearInterval(poll); return; }
    const me = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}&select=question,answer`, { method: 'GET' });
    if (me && me[0] && me[0].question && me[0].question !== 0 && me[0].question !== lastQ && me[0].answer === 'none') {
      clearInterval(poll);
      const q = QUESTIONS.find(q => q.id === Number(me[0].question));
      if (!q) return;
      usedQIds.push(q.id);
      currentQ = q;
      answered = false;
      renderQuestion(q);
      startQTimer();
      pollForOpponentAnswer();
    }
  }, 1500);
}

function renderQuestion(q) {
  const labels = ['أ', 'ب', 'ج', 'د'];
  document.getElementById('q-num').textContent = `السؤال ${usedQIds.length}`;
  document.getElementById('q-text').textContent = q.q;
  setStatus('', '');
  const grid = document.getElementById('options-grid');
  grid.innerHTML = '';
  q.opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="option-label">${labels[i]}</span>${opt}`;
    btn.onclick = () => isOfflineMatch ? answerOfflineQ(i, btn) : answerQ(i, btn);
    grid.appendChild(btn);
  });
}

function setStatus(text, cls='') {
  const el = document.getElementById('match-status');
  el.textContent = text;
  el.className = 'status-bar' + (cls ? ' ' + cls : '');
}

function startQTimer() {
  clearInterval(qTimerInterval);
  let t = 60;
  document.getElementById('q-timer-text').textContent = t;
  document.getElementById('q-timer-bar').style.width = '100%';
  document.getElementById('q-timer-bar').style.background = 'var(--blue)';
  qTimerInterval = setInterval(() => {
    t--;
    document.getElementById('q-timer-text').textContent = t;
    document.getElementById('q-timer-bar').style.width = (t / 60 * 100) + '%';
    if (t <= 15) document.getElementById('q-timer-bar').style.background = 'var(--red)';
    if (t <= 0) {
      clearInterval(qTimerInterval);
      setStatus('⏱ انتهى وقت السؤال!', 'warn');
      disableOptions();
      // أظهر الإجابة الصحيحة
      const btns2 = document.querySelectorAll('.option-btn');
      if (btns2[currentQ.a]) btns2[currentQ.a].classList.add('correct');
      // إذا لم يُجب اللاعب بعد → سجّل answer = 'timeout' في DB
      if (!answered) {
        answered = true;
        sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
          method: 'PATCH', body: JSON.stringify({ answer: 'timeout' })
        });
      }
      setTimeout(() => nextQuestion(), 2200);
    }
  }, 1000);
}

// ==================== SOUND EFFECTS ====================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playCorrectSound() {
  try {
    const ctx = getAudioCtx();
    // نغمتان صاعدتان = إحساس الفوز
    [[520, 0, 0.15], [660, 0.15, 0.15], [880, 0.30, 0.25]].forEach(([freq, start, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.28, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    });
  } catch(e) {}
}

function playWrongSound() {
  try {
    const ctx = getAudioCtx();
    // نغمتان هابطتان = إحساس الخطأ
    [[300, 0, 0.18], [220, 0.18, 0.22]].forEach(([freq, start, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.18, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    });
  } catch(e) {}
}

// حالة إجابة الخصم للسؤال الحالي (نحتاجها لتحديد متى ننتقل)
let oppAnsweredIdx = null; // index الإجابة التي اختارها الخصم أو null

async function answerQ(idx, btn) {
  if (answered) return;
  answered = true;
  clearInterval(qTimerInterval);
  disableOptions();

  const correct = idx === currentQ.a;
  btn.classList.add(correct ? 'correct' : 'wrong');

  if (correct) {
    playCorrectSound();
    myMatchPts += 10;
    document.getElementById('my-pts-m').textContent = myMatchPts;
    setStatus('إجابة صحيحة! +10 نقاط ✓', 'good');
    await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
      method: 'PATCH', body: JSON.stringify({ answer: 'correct', points: (currentUser.points || 0) + 10 })
    });
    currentUser.points = (currentUser.points || 0) + 10;
    if (myMatchPts >= 100) { setTimeout(() => endMatch('win'), 1500); return; }
    // إذا الخصم أجاب بالفعل (صح أو غلط) → انتقل فوراً
    // إذا الخصم لم يجب بعد → انتقل فوراً لأن "أحد اللاعبين خطف السؤال"
    setTimeout(() => nextQuestion(), 1800);
  } else {
    playWrongSound();
    myMatchPts = Math.max(0, myMatchPts - 5);
    document.getElementById('my-pts-m').textContent = myMatchPts;
    // أظهر الإجابة الصحيحة والخيار الذي اخترته
    const btns = document.querySelectorAll('.option-btn');
    if (btns[currentQ.a]) btns[currentQ.a].classList.add('correct');
    await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
      method: 'PATCH', body: JSON.stringify({ answer: `wrong:${idx}`, points: Math.max(0, (currentUser.points || 0) - 5) })
    });
    currentUser.points = Math.max(0, (currentUser.points || 0) - 5);

    // هل الخصم أخطأ هو الآخر؟
    if (oppAnsweredIdx !== null && oppAnsweredIdx !== 'correct') {
      // كلانا أخطأ → انتقل للسؤال التالي
      setStatus('❌ كلاكما أخطأ! ننتقل للسؤال التالي...', 'bad');
      setTimeout(() => nextQuestion(), 2000);
    } else if (oppAnsweredIdx === null) {
      // الخصم لم يجب بعد → انتظر، وأخبر اللاعب
      setStatus('❌ أخطأت! انتظر خصمك...', 'bad');
      // الانتقال سيحدث عند pollForOpponentAnswer
    }
    // لو oppAnsweredIdx === 'correct' → الخصم أجاب صح قبلي، الانتقال سيحدث من pollForOpponentAnswer
  }
}

function pollForOpponentAnswer() {
  let tries = 0;
  oppAnsweredIdx = null;
  const watchedQ = currentQ ? currentQ.id : 0;
  const poll = setInterval(async () => {
    tries++;
    if (tries > 60) { clearInterval(poll); return; }
    if (currentQ && currentQ.id !== watchedQ) { clearInterval(poll); return; }
    const opp = await sbFetch(`/rest/v1/system?id=eq.${opponent.id}&select=answer,points`, { method: 'GET' });
    if (!opp || !opp[0] || !opp[0].answer || opp[0].answer === 'none') return;
    clearInterval(poll);

    const rawAns = opp[0].answer; // 'correct' أو 'wrong:N' أو 'timeout'
    const oppCorrect = rawAns === 'correct';
    const oppTimeout = rawAns === 'timeout';
    const oppChoiceIdx = (!oppCorrect && !oppTimeout) ? parseInt(rawAns.split(':')[1]) : null;
    oppAnsweredIdx = oppCorrect ? 'correct' : (oppTimeout ? 'timeout' : oppChoiceIdx);

    // تحديث نقاط الخصم
    oppMatchPts = opp[0].points || 0;
    document.getElementById('opp-pts-m').textContent = oppMatchPts;

    // تحقق من فوز الخصم بنقاط المباراة (100+)
    if (oppMatchPts >= 100) {
      clearInterval(poll);
      setTimeout(() => endMatch('lose'), 500);
      return;
    }

    if (oppCorrect) {
      if (!answered) {
        // خصمي أجاب صح وأنا لم أجب → خطف السؤال
        setStatus('⚡ خصمك خطف السؤال!', 'warn');
        disableOptions();
        answered = true;
        clearInterval(qTimerInterval);
        const btns = document.querySelectorAll('.option-btn');
        if (btns[currentQ.a]) btns[currentQ.a].classList.add('correct');
        setTimeout(() => nextQuestion(), 2200);
      } else {
        // أنا أجبت خطأ قبله، والآن هو أجاب صح → انتقل للسؤال التالي
        setStatus('⚡ خصمك أجاب صحيحاً! ننتقل...', 'warn');
        setTimeout(() => nextQuestion(), 2000);
      }
    } else {
      // الخصم أخطأ → أظهر الإجابة التي اختارها
      const btns = document.querySelectorAll('.option-btn');
      if (!isNaN(oppChoiceIdx) && btns[oppChoiceIdx] && !btns[oppChoiceIdx].classList.contains('correct')) {
        btns[oppChoiceIdx].classList.add('opp-wrong');
      }

      if (!answered) {
        // أنا لم أجب بعد → أخبرني أن الخصم أخطأ، أنتظر إجابتي
        setStatus('❌ خصمك أخطأ!', 'good');
      } else {
        // أنا أجبت خطأ أيضاً → الاتنين أخطآ → انتقل
        setStatus('❌ كلاكما أخطأ! ننتقل للسؤال التالي...', 'bad');
        setTimeout(() => nextQuestion(), 2000);
      }
    }
  }, 1500);
}

function disableOptions() {
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
}

function nextQuestion() {
  clearInterval(qTimerInterval);
  const iAmSmaller = currentUser.id < opponent.id;
  if (iAmSmaller) loadNextQuestion();
  else pollForQuestion();
}

async function endMatch(reason) {
  isInMatch = false;
  clearInterval(matchTotalTimer);
  clearInterval(qTimerInterval);
  clearInterval(chatPollInterval);
  clearInterval(oppResultPollInterval);
  rtUnsubscribe('chat-listen');
  document.getElementById('match-chat').style.display = 'none';

  // حساب نتيجة لوحة الصدارة (level)
  let levelDelta = 0;
  let matchResult = ''; // 'win' | 'lose' | 'draw'

  if (reason === 'win') {
    matchResult = 'win';
    levelDelta = 3;
  } else if (reason === 'lose') {
    matchResult = 'lose';
    levelDelta = -2;
  } else {
    // انتهى الوقت
    if (myMatchPts > oppMatchPts) { matchResult = 'win'; levelDelta = 3; }
    else if (myMatchPts === oppMatchPts) { matchResult = 'draw'; levelDelta = 1; }
    else { matchResult = 'lose'; levelDelta = -2; }
  }

  const newLevel = Math.max(0, (currentUser.level || 0) + levelDelta);

  // إعادة ضبط النقاط (points) بعد المباراة + تحديث level
  await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ match: 'off', question: 0, answer: 'none', 'match-message': '', points: 0, level: newLevel })
  });
  currentUser.points = 0;
  currentUser.level = newLevel;
  localStorage.setItem('genius_user', JSON.stringify(currentUser));

  // إشعار الخصم بنتيجته
  if (opponent) {
    const oppLevelDelta = matchResult === 'win' ? -2 : matchResult === 'lose' ? 3 : 1;
    const oppNewLevel = Math.max(0, (opponent.level || 0) + oppLevelDelta);
    const oppResult = matchResult === 'win' ? 'lose' : matchResult === 'lose' ? 'win' : 'draw';
    await sbFetch(`/rest/v1/system?id=eq.${opponent.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ match: 'off', question: 0, answer: 'none', 'match-message': '', points: 0, level: oppNewLevel,
        'end-result': oppResult })
    });
  }

  showMatchResult(matchResult);
}

function showMatchResult(result) {
  const overlay = document.getElementById('win-overlay');
  overlay.classList.add('show');
  const icon = document.getElementById('win-icon');

  if (result === 'win') {
    icon.innerHTML = '<i class="fa-solid fa-trophy"></i>';
    icon.className = 'win-icon trophy';
    document.getElementById('win-title').textContent = 'أنت الفائز! 🎉';
    document.getElementById('win-sub').textContent = `أحسنت! حصلت على +3 نقاط في لوحة الصدارة`;
  } else if (result === 'win-forfeit') {
    icon.innerHTML = '<i class="fa-solid fa-trophy"></i>';
    icon.className = 'win-icon trophy';
    document.getElementById('win-title').textContent = 'فزت! 🏆';
    document.getElementById('win-sub').textContent = 'خصمك انسحب من المباراة — حصلت على +3 نقاط في لوحة الصدارة';
  } else if (result === 'lose') {
    icon.innerHTML = '<i class="fa-regular fa-face-sad-tear"></i>';
    icon.className = 'win-icon lose';
    document.getElementById('win-title').textContent = 'خسرت المباراة 😔';
    document.getElementById('win-sub').textContent = 'لا تستسلم! -2 نقطة من لوحة الصدارة. حاول مرة أخرى!';
  } else {
    icon.innerHTML = '<i class="fa-solid fa-handshake"></i>';
    icon.className = 'win-icon';
    document.getElementById('win-title').textContent = 'تعادل!';
    document.getElementById('win-sub').textContent = `نقاطك: ${myMatchPts} | خصمك: ${oppMatchPts} — +1 نقطة لوحة صدارة`;
  }
}

function closeMatch() {
  document.getElementById('win-overlay').classList.remove('show');
  showPage('home');
  showDashboard();
}

// ==================== FORFEIT / BACK DURING MATCH ====================
let isInMatch = false; // نتتبع هل اللاعب في مباراة

function confirmForfeit() {
  if (!confirm('هل تريد الانسحاب؟ ستُعدّ خاسراً وسيُخبَر خصمك بالفوز.')) return;
  forfeitMatch();
}

async function forfeitMatch() {
  if (!isInMatch || !opponent) return;
  isInMatch = false;

  clearInterval(matchTotalTimer);
  clearInterval(qTimerInterval);
  clearInterval(chatPollInterval);
  clearInterval(oppResultPollInterval);
  rtUnsubscribe('chat-listen');

  const newLevel = Math.max(0, (currentUser.level || 0) - 2);

  // سجّل خسارتي + أبلغ الخصم بالفوز
  await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ match: 'off', question: 0, answer: 'none', 'match-message': '', points: 0, level: newLevel })
  });
  currentUser.points = 0;
  currentUser.level = newLevel;
  localStorage.setItem('genius_user', JSON.stringify(currentUser));

  if (opponent) {
    const oppNewLevel = Math.max(0, (opponent.level || 0) + 3);
    await sbFetch(`/rest/v1/system?id=eq.${opponent.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        match: 'off', question: 0, answer: 'none', 'match-message': '', points: 0,
        level: oppNewLevel, 'end-result': 'win-forfeit'
      })
    });
  }

  document.getElementById('match-chat').style.display = 'none';
  document.getElementById('win-overlay').classList.remove('show');
  showPage('home');
  showDashboard();
}

// اعتراض أزرار التنقل أثناء المباراة
function safeShowPage(name) {
  if (isInMatch && name !== 'match') {
    if (!confirm('أنت في مباراة! الخروج سيُعدّك خاسراً. هل تريد المتابعة؟')) return;
    forfeitMatch();
    return;
  }
  showPage(name);
}

// اعتراض زر الرجوع في المتصفح
window.addEventListener('popstate', function(e) {
  if (isInMatch) {
    history.pushState(null, '', window.location.href);
    if (confirm('أنت في مباراة! الرجوع سيُعدّك خاسراً. هل تريد المتابعة؟')) {
      forfeitMatch();
    }
  }
});

// ==================== DELETE ACCOUNT ====================
async function confirmDeleteAccount() {
  const first = confirm('هل أنت متأكد من حذف حسابك نهائياً؟ لا يمكن التراجع عن هذا الإجراء.');
  if (!first) return;
  const second = confirm('تأكيد أخير: سيتم حذف جميع بياناتك بشكل دائم. هل تريد المتابعة؟');
  if (!second) return;

  const msgEl = document.getElementById('delete-account-msg');
  showMsg(msgEl, 'جاري حذف الحساب...', 'info');

  const res = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, { method: 'DELETE' });
  if (res !== null) {
    currentUser = null;
    localStorage.removeItem('genius_user');
    localStorage.removeItem('genius_sb_token');
    document.getElementById('auth-section').style.display = '';
    document.getElementById('dashboard-section').style.display = 'none';
    document.getElementById('nav-profile').style.display = 'none';
    showPage('home');
    alert('تم حذف حسابك بنجاح.');
  } else {
    showMsg(msgEl, 'حدث خطأ أثناء الحذف، حاول مرة أخرى', 'error');
  }
}

// ==================== OPPONENT WIN DETECTION ====================
let oppResultPollInterval = null;
function startOpponentResultPolling() {
  clearInterval(oppResultPollInterval);
  oppResultPollInterval = setInterval(async () => {
    if (!currentUser || !opponent) return;
    const me = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}&select=end-result`, { method: 'GET' });
    if (me && me[0] && me[0]['end-result']) {
      const rawResult = me[0]['end-result'];
      clearInterval(oppResultPollInterval);
      clearInterval(matchTotalTimer);
      clearInterval(qTimerInterval);
      clearInterval(chatPollInterval);
      isInMatch = false;
      document.getElementById('match-chat').style.display = 'none';
      // امسح نتيجة الخصم من قاعدة البيانات
      await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ 'end-result': '' })
      });
      // win-forfeit = فاز لأن خصمه انسحب
      const displayResult = rawResult === 'win-forfeit' ? 'win-forfeit' : rawResult;
      showMatchResult(displayResult);
    }
  }, 2000);
}

// ==================== MATCH CHAT ====================
async function sendChatMsg() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !opponent) return;
  input.value = '';

  // أضف الرسالة محلياً فوراً
  addChatBubble(text, true, currentUser.name);

  // أرسل عبر Supabase في عمود match-message للخصم
  await sbFetch(`/rest/v1/system?id=eq.${opponent.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ 'match-message': JSON.stringify({ from: currentUser.name, text, ts: Date.now() }) })
  });
}

function addChatBubble(text, mine, name) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + (mine ? 'mine' : 'theirs');
  div.innerHTML = `<div class="cb-name">${name}</div>${text}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function startChatPolling() {
  clearInterval(chatPollInterval);
  rtUnsubscribe('chat-listen');

  rtSubscribe('chat-listen', `id=eq.${currentUser.id}`, async (record) => {
    const raw = record?.['match-message'];
    if (!raw) return;
    try {
      const msg = JSON.parse(raw);
      if (msg.ts && msg.ts > lastChatTs) {
        lastChatTs = msg.ts;
        addChatBubble(msg.text, false, msg.from);
        await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ 'match-message': '' })
        });
      }
    } catch(e) {}
  });
}

// ==================== SIDEBAR LEADERBOARD ====================
function startLeaderboardRealtime() {
  rtSubscribe('lb-changes', 'level=gte.0', () => {
    loadMiniLeaderboard();
    if (document.getElementById('page-leaderboard').classList.contains('active')) {
      loadLeaderboard();
    }
  });
}

async function loadMiniLeaderboard() {
  const data = await sbFetch('/rest/v1/system?select=id,name,country,level,avatar_url&order=level.desc&limit=5', { method: 'GET' });
  const el = document.getElementById('side-lb-list');
  if (!el) return;
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--ink3);padding:24px;font-size:13px">لا يوجد لاعبون بعد</div>';
    return;
  }
  const rankClass = ['r1','r2','r3'];
  const rankIcon = [
    '<i class="fa-solid fa-medal" style="color:#c9a227;font-size:16px"></i>',
    '<i class="fa-solid fa-medal" style="color:#909090;font-size:16px"></i>',
    '<i class="fa-solid fa-medal" style="color:#b07d4a;font-size:16px"></i>'
  ];
  el.innerHTML = data.map((u, i) => {
    const initial = u.name ? u.name[0].toUpperCase() : '?';
    const isMe = currentUser && u.id === currentUser.id;
    const avatarHtml = u.avatar_url
      ? `<img src="${u.avatar_url}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;" onerror="this.parentElement.textContent='${initial}'">`
      : initial;
    const rankHtml = i < 3 ? rankIcon[i] : `<span class="side-lb-rank ${rankClass[i]||''}">${i+1}</span>`;
    return `
      <div class="side-lb-row${isMe ? ' me-row' : ''}">
        <div class="side-lb-rank ${rankClass[i]||''}">${rankHtml}</div>
        <div class="side-lb-avatar">${avatarHtml}</div>
        <div class="side-lb-info">
          <div class="side-lb-name">${u.name || 'لاعب'}${isMe ? ' <span style="font-size:10px;color:var(--blue)">(أنت)</span>' : ''}</div>
          <div class="side-lb-country">${u.country || ''}</div>
        </div>
        <div class="side-lb-pts">${u.level || 0}</div>
      </div>
    `;
  }).join('');
}


let lbAllData = [];

async function loadLeaderboard() {
  const data = await sbFetch('/rest/v1/system?select=name,country,level,avatar_url&order=level.desc&limit=100', { method: 'GET' });
  const el = document.getElementById('lb-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--ink3);padding:40px">لا يوجد لاعبون بعد</div>';
    return;
  }
  lbAllData = data;
  document.getElementById('lb-search').value = '';
  renderLeaderboard(data);
}

function filterLeaderboard() {
  const q = document.getElementById('lb-search').value.trim().toLowerCase();
  if (!q) return renderLeaderboard(lbAllData);
  const filtered = lbAllData.filter(u => (u.name||'').toLowerCase().includes(q) || (u.country||'').toLowerCase().includes(q));
  renderLeaderboard(filtered, q);
}

function renderLeaderboard(data, highlight='') {
  const el = document.getElementById('lb-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--ink3);padding:40px">لا توجد نتائج مطابقة</div>';
    return;
  }
  const rankClass = ['gold','silver','bronze'];
  el.innerHTML = data.map((u, i) => {
    const globalRank = lbAllData.indexOf(u);
    const displayRank = globalRank + 1;
    let nameDisplay = u.name || 'لاعب';
    if (highlight) {
      const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      nameDisplay = nameDisplay.replace(regex, '<mark style="background:#fff3b0;border-radius:3px;padding:0 1px">$1</mark>');
    }
    return `
    <div class="lb-row">
      <div class="lb-rank ${rankClass[globalRank]||''}">
        ${globalRank === 0 ? '<i class="fa-solid fa-medal"></i>' : globalRank === 1 ? '<i class="fa-solid fa-medal" style="color:#aaa"></i>' : globalRank === 2 ? '<i class="fa-solid fa-medal" style="color:#b07d4a"></i>' : displayRank}
      </div>
      <div class="lb-avatar">${u.avatar_url ? `<img src="${u.avatar_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;display:block;" onerror="this.parentElement.textContent='${u.name ? u.name[0].toUpperCase() : '?'}'">` : (u.name ? u.name[0].toUpperCase() : '?')}</div>
      <div class="lb-info">
        <div class="lb-name">${nameDisplay}</div>
        <div class="lb-country">${u.country || ''}</div>
      </div>
      <div class="lb-pts">${u.level || 0} <span style="font-size:11px;color:var(--ink3);font-weight:400">نقطة صدارة</span></div>
    </div>
  `}).join('');
}

// ==================== PROFILE ====================
function loadProfile() {
  if (!currentUser) return;
  document.getElementById('edit-email').value = '';
  document.getElementById('edit-pass').value = '';
  document.getElementById('edit-msg').innerHTML = '';
  const avatarUrl = currentUser.avatar_url || '';
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" class="avatar-img" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--line)">`
    : `<div class="avatar" style="width:60px;height:60px;font-size:22px;background:var(--ink);color:#fff">${currentUser.name[0].toUpperCase()}</div>`;
  document.getElementById('profile-info').innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
      <div class="profile-avatar-wrap" onclick="document.getElementById('avatar-file-input').click()" title="تغيير الصورة الشخصية">
        ${avatarHtml}
        <div class="profile-avatar-overlay"><i class="fa-solid fa-camera"></i></div>
      </div>
      <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="uploadAvatar(event)">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--ink)">${currentUser.name}</div>
        <div style="color:var(--ink3);font-size:14px">${currentUser.email}</div>
        <div style="color:var(--blue);margin-top:4px;font-size:14px">${currentUser.country||''}</div>
        <div style="color:var(--ink3);font-size:12px;margin-top:4px"><i class="fa-solid fa-camera" style="margin-left:4px"></i>انقر على الصورة لتغييرها</div>
      </div>
    </div>
    <div id="avatar-upload-msg"></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="num">${currentUser.level||0}</div><div class="lbl"><i class="fa-solid fa-ranking-star" style="font-size:10px;color:var(--blue);margin-left:3px"></i> نقاط الصدارة</div></div>
      <div class="stat-card"><div class="num" id="profile-rank">#-</div><div class="lbl"><i class="fa-solid fa-trophy" style="font-size:10px;color:var(--gold);margin-left:3px"></i> ترتيبك في الصدارة</div></div>
    </div>
  `;
  loadProfileRank();
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const msgEl = document.getElementById('avatar-upload-msg');
  if (!msgEl) return;

  // تحقق من الحجم (أقصى 2MB)
  if (file.size > 2 * 1024 * 1024) {
    return showMsg(msgEl, 'حجم الصورة يجب أن لا يتجاوز 2 ميغابايت', 'error');
  }

  showMsg(msgEl, 'جاري رفع الصورة...', 'info');

  const fileExt = file.name.split('.').pop();
  const fileName = `avatar_${currentUser.id}.${fileExt}`;

  // رفع الصورة إلى Supabase Storage bucket "avatars"
  const uploadRes = await fetch(`${SB_URL}/storage/v1/object/avatars/${fileName}`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': file.type,
      'x-upsert': 'true'
    },
    body: file
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    return showMsg(msgEl, `فشل رفع الصورة: ${err.message || uploadRes.status}`, 'error');
  }

  const publicUrl = `${SB_URL}/storage/v1/object/public/avatars/${fileName}`;

  // حفظ رابط الصورة في جدول system
  await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ avatar_url: publicUrl })
  });

  currentUser.avatar_url = publicUrl;
  localStorage.setItem('genius_user', JSON.stringify(currentUser));
  showMsg(msgEl, 'تم حفظ الصورة بنجاح! ✓', 'success');
  updateNavAvatar();
  showDashboard();
}

async function loadProfileRank() {
  const all = await sbFetch('/rest/v1/system?select=id,level&order=level.desc', { method: 'GET' });
  if (all) {
    const idx = all.findIndex(u => u.id === currentUser.id);
    const el = document.getElementById('profile-rank');
    if (el) el.textContent = '#' + (idx + 1);
  }
}

async function saveProfileEdit() {
  const newEmail = document.getElementById('edit-email').value.trim();
  const newPass = document.getElementById('edit-pass').value.trim();
  const msgEl = document.getElementById('edit-msg');

  if (!newEmail && !newPass) return showMsg(msgEl, 'أدخل بريداً أو كلمة مرور جديدة للتعديل', 'error');

  // التحقق من صيغة البريد
  if (newEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) return showMsg(msgEl, 'صيغة البريد الإلكتروني غير صحيحة (مثال: user@example.com)', 'error');
    // تأكد من عدم وجود بريد مكرر
    const check = await sbFetch(`/rest/v1/system?email=eq.${encodeURIComponent(newEmail)}&select=id`, { method: 'GET' });
    if (check && check.length > 0 && check[0].id !== currentUser.id) return showMsg(msgEl, 'هذا البريد مستخدم من قبل حساب آخر', 'error');
  }

  // التحقق من الباسوورد
  if (newPass) {
    if (/[<:=>]/.test(newPass)) return showMsg(msgEl, 'كلمة المرور لا يجب أن تحتوي على الرموز: < : = >', 'error');
    if (newPass.length < 6) return showMsg(msgEl, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
  }

  showMsg(msgEl, 'جاري الحفظ...', 'info');
  const updates = {};
  if (newEmail) updates.email = newEmail;
  if (newPass) updates.password = newPass;

  const res = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });

  if (res !== null) {
    if (newEmail) currentUser.email = newEmail;
    localStorage.setItem('genius_user', JSON.stringify(currentUser));
    showMsg(msgEl, 'تم حفظ التعديلات بنجاح!', 'success');
    document.getElementById('edit-email').value = '';
    document.getElementById('edit-pass').value = '';
    loadProfile();
  } else {
    showMsg(msgEl, 'حدث خطأ أثناء الحفظ، حاول مرة أخرى', 'error');
  }
}



// ── LIVE STATS (polling every 0.5s) ──
let liveStatsInterval = null;

async function fetchLiveStats() {
  try {
    // Searching players: status = 'searching'
    const [searchRes, matchRes] = await Promise.all([
      sbFetch('/rest/v1/system?status=eq.searching&select=id', { method: 'GET' }),
      sbFetch('/rest/v1/system?match=not.is.null&select=id,match', { method: 'GET' })
    ]);

    const searchingCount = Array.isArray(searchRes) ? searchRes.length : 0;

    // Active matches: rows where match column has an opponent player id
    let activeMatchIds = new Set();
    if (Array.isArray(matchRes)) {
      matchRes.forEach(row => {
        if (row.match && String(row.match).trim() !== '') {
          activeMatchIds.add(row.match);
        }
      });
    }
    const activeMatches = Math.floor(activeMatchIds.size); // each match counted once (2 players share 1 match)

    updateLiveStatsPills(searchingCount, activeMatches);
  } catch(e) {
    // silently fail
  }
}

function updateLiveStatsPills(searching, matches) {
  const sPill = document.getElementById('searching-pill');
  const mPill = document.getElementById('matches-pill');
  const sDot = document.getElementById('searching-dot');
  const mDot = document.getElementById('matches-dot');
  const sCount = document.getElementById('searching-count');
  const mCount = document.getElementById('matches-count');

  if (!sPill || !mPill) return;

  if (sCount) sCount.textContent = searching;
  if (mCount) mCount.textContent = matches;

  // Color: green if >0, red if 0
  [sPill, sDot].forEach(el => {
    if (!el) return;
    if (searching > 0) {
      sPill.classList.remove('red-state'); sPill.classList.add('green');
      sDot.classList.remove('red-dot'); sDot.classList.add('green-dot');
    } else {
      sPill.classList.remove('green'); sPill.classList.add('red-state');
      sDot.classList.remove('green-dot'); sDot.classList.add('red-dot');
    }
  });

  if (matches > 0) {
    mPill.classList.remove('red-state'); mPill.classList.add('green');
    mDot.classList.remove('red-dot'); mDot.classList.add('green-dot');
  } else {
    mPill.classList.remove('green'); mPill.classList.add('red-state');
    mDot.classList.remove('green-dot'); mDot.classList.add('red-dot');
  }
}

function startLiveStats() {
  fetchLiveStats();
  if (!liveStatsInterval) {
    liveStatsInterval = setInterval(fetchLiveStats, 500);
  }
}

function stopLiveStats() {
  if (liveStatsInterval) {
    clearInterval(liveStatsInterval);
    liveStatsInterval = null;
  }
}

// Start polling whenever dashboard is visible
const _origShowDashboard = window.showDashboard;
if (typeof showDashboard === 'function') {
  const __sd = showDashboard;
  window.showDashboard = function(...args) {
    __sd.apply(this, args);
    startLiveStats();
  };
}

// Also start on DOMContentLoaded if user is already logged in
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('dashboard-section') &&
      document.getElementById('dashboard-section').style.display !== 'none') {
    startLiveStats();
  }
});

// Fallback: start polling 1s after page load
setTimeout(() => {
  if (document.getElementById('live-stats-row')) startLiveStats();
}, 1000);

// ── SHARE WEBSITE ──
function shareWebsite() {
  const shareData = {
    title: 'دوري العباقرة',
    text: 'تحدّى أسئلة المعرفة مع لاعبين حقيقيين من حول العالم! العب الآن 🧠',
    url: window.location.href
  };
  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else {
    navigator.clipboard.writeText(window.location.href).then(() => {
      const btn = document.querySelector('.btn-share');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> تم نسخ الرابط!';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
      }
    }).catch(() => {
      prompt('انسخ الرابط:', window.location.href);
    });
  }
}


// ==================== GIFTS ====================
async function openAdModal() {
  if (!currentUser) { alert('يجب تسجيل الدخول أولاً'); return; }
  // أضف نقطة صدارة فوراً
  const newLevel = (currentUser.level || 0) + 1;
  const res = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ level: newLevel })
  });
  if (res && !res.__error) {
    currentUser.level = newLevel;
    localStorage.setItem('genius_user', JSON.stringify(currentUser));
    // حدّث العرض
    const el = document.getElementById('dash-points');
    if (el) el.textContent = newLevel;
    const el2 = document.getElementById('stat-pts');
    if (el2) el2.textContent = newLevel;
    // افتح رابط الإعلان
    window.open('https://compassionpersonify.com/itiwsytjz?key=8d8cc90db7cbab3815688ec5a02959ab', '_blank');
    document.getElementById('modal-ad').classList.add('show');
  }
}

function openWhatsappModal() {
  if (!currentUser) { alert('يجب تسجيل الدخول أولاً'); return; }
  document.getElementById('modal-whatsapp').classList.add('show');
}

function openLegendModal() {
  if (!currentUser) { alert('يجب تسجيل الدخول أولاً'); return; }
  document.getElementById('modal-legend').classList.add('show');
  document.getElementById('legend-msg').innerHTML = '';
  document.getElementById('legend-channel-url').value = '';
}

async function shareWhatsapp() {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent('العب معي في دوري العباقرة! اختبر معرفتك في مسابقات مباشرة مع لاعبين من حول العالم');
  window.open(`https://wa.me/?text=${text}%20${url}`, '_blank');
  document.getElementById('modal-whatsapp').classList.remove('show');
  // أضف 5 نقاط بعد الضغط
  if (!currentUser) return;
  const newLevel = (currentUser.level || 0) + 5;
  const res = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ level: newLevel })
  });
  if (res && !res.__error) {
    currentUser.level = newLevel;
    localStorage.setItem('genius_user', JSON.stringify(currentUser));
    const el = document.getElementById('dash-points');
    if (el) el.textContent = newLevel;
    const el2 = document.getElementById('stat-pts');
    if (el2) el2.textContent = newLevel;
  }
}

async function submitLegend() {
  const channelUrl = document.getElementById('legend-channel-url').value.trim();
  const msgEl = document.getElementById('legend-msg');
  if (!channelUrl) {
    msgEl.innerHTML = '<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="margin-left:4px"></i>يرجى إدخال رابط القناة</span>';
    return;
  }
  if (!channelUrl.startsWith('http')) {
    msgEl.innerHTML = '<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="margin-left:4px"></i>يرجى إدخال رابط صحيح يبدأ بـ https://</span>';
    return;
  }
  if (!currentUser) {
    msgEl.innerHTML = '<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="margin-left:4px"></i>يجب تسجيل الدخول أولاً</span>';
    return;
  }
  msgEl.innerHTML = '<span style="color:var(--blue)"><i class="fa-solid fa-spinner fa-spin" style="margin-left:4px"></i>جاري الإرسال...</span>';
  // نحدّث عمود web-sharing في صف المستخدم في جدول system
  const res = await sbFetch(`/rest/v1/system?id=eq.${currentUser.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ 'web-sharing': channelUrl })
  });
  if (res !== null && !res?.__error) {
    msgEl.innerHTML = '<span style="color:var(--green)"><i class="fa-solid fa-circle-check" style="margin-left:4px"></i>تم الإرسال! سيراجع فريقنا مشاركة الموقع في قناتك، ثم ستحصل على هديتك قريباً.</span>';
    setTimeout(() => { document.getElementById('modal-legend').classList.remove('show'); }, 3500);
  } else {
    msgEl.innerHTML = '<span style="color:var(--red)"><i class="fa-solid fa-circle-exclamation" style="margin-left:4px"></i>حدث خطأ، يرجى المحاولة مرة أخرى</span>';
    console.error('web-sharing error:', res);
  }
}

// Close modals on overlay click
['modal-ad','modal-whatsapp','modal-legend'].forEach(id => {
  document.getElementById(id).addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });
});


// ==================== CONTACT FAB ====================
let contactFabOpen = false;
let selectedStars = 0;

function toggleContactFab() {
  contactFabOpen = !contactFabOpen;
  const popup = document.getElementById('contact-popup');
  const btn = document.getElementById('contact-fab-btn');
  popup.classList.toggle('open', contactFabOpen);
  btn.classList.toggle('open', contactFabOpen);
}

// Close when clicking outside
document.addEventListener('click', function(e) {
  if (!document.getElementById('contact-fab').contains(e.target)) {
    contactFabOpen = false;
    document.getElementById('contact-popup').classList.remove('open');
    document.getElementById('contact-fab-btn').classList.remove('open');
  }
});

function switchContactTab(tab) {
  ['message','review','buy'].forEach(t => {
    document.getElementById('ctab-' + t).classList.toggle('active', t === tab);
    document.getElementById('cpanel-' + t).classList.toggle('active', t === tab);
  });
}

function setStars(n) {
  selectedStars = n;
  document.querySelectorAll('#star-rating span').forEach((s, i) => {
    s.style.color = i < n ? 'var(--gold)' : 'var(--line)';
  });
}

async function sendContactMessage() {
  const text = document.getElementById('contact-msg-text').value.trim();
  const resultEl = document.getElementById('contact-msg-result');
  if (!text) { resultEl.innerHTML = '<div class="msg error">يرجى كتابة رسالتك أولاً</div>'; return; }
  resultEl.innerHTML = '<div class="msg info"><i class="fa-solid fa-spinner fa-spin" style="margin-left:6px"></i> جاري الإرسال...</div>';
  const sender = currentUser ? currentUser.name : 'زائر';
  const senderId = currentUser ? currentUser.id : 'guest';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(SB_URL + '/rest/v1/contact_feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ type: 'message', sender, sender_id: String(senderId), content: text, created_at: new Date().toISOString() }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok || res.status === 201 || res.status === 200) {
      resultEl.innerHTML = '<div class="contact-success"><i class="fa-solid fa-check-circle" style="font-size:20px;margin-bottom:6px;display:block"></i>تم إرسال رسالتك بنجاح! شكراً لتواصلك معنا.</div>';
      document.getElementById('contact-msg-text').value = '';
    } else {
      const errText = await res.text().catch(() => '');
      console.error('Send message error:', res.status, errText);
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-triangle-exclamation" style="margin-left:6px"></i>حدث خطأ أثناء الإرسال، حاول مرة أخرى</div>';
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-clock" style="margin-left:6px"></i>انتهت مهلة الاتصال، تحقق من الإنترنت وحاول مرة أخرى</div>';
    } else {
      console.error('Send message exception:', e);
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-wifi" style="margin-left:6px"></i>تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مرة أخرى</div>';
    }
  }
}

async function sendContactReview() {
  const text = document.getElementById('contact-review-text').value.trim();
  const resultEl = document.getElementById('contact-review-result');
  if (!selectedStars) { resultEl.innerHTML = '<div class="msg error">يرجى اختيار تقييم بالنجوم أولاً</div>'; return; }
  resultEl.innerHTML = '<div class="msg info"><i class="fa-solid fa-spinner fa-spin" style="margin-left:6px"></i> جاري الإرسال...</div>';
  const sender = currentUser ? currentUser.name : 'زائر';
  const senderId = currentUser ? currentUser.id : 'guest';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(SB_URL + '/rest/v1/contact_feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ type: 'review', sender, sender_id: String(senderId), stars: selectedStars, content: text || '', created_at: new Date().toISOString() }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok || res.status === 201 || res.status === 200) {
      resultEl.innerHTML = '<div class="contact-success"><i class="fa-solid fa-star" style="color:var(--gold);font-size:20px;margin-bottom:6px;display:block"></i>تم إرسال تقييمك! شكراً لك.</div>';
      document.getElementById('contact-review-text').value = '';
      setStars(0);
    } else {
      const errText = await res.text().catch(() => '');
      console.error('Send review error:', res.status, errText);
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-triangle-exclamation" style="margin-left:6px"></i>حدث خطأ أثناء الإرسال، حاول مرة أخرى</div>';
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-clock" style="margin-left:6px"></i>انتهت مهلة الاتصال، تحقق من الإنترنت وحاول مرة أخرى</div>';
    } else {
      console.error('Send review exception:', e);
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-wifi" style="margin-left:6px"></i>تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مرة أخرى</div>';
    }
  }
}

async function sendBuyOffer() {
  const price = document.getElementById('buy-price').value.trim();
  const currency = document.getElementById('buy-currency').value;
  const note = document.getElementById('buy-note').value.trim();
  const resultEl = document.getElementById('contact-buy-result');
  if (!price || isNaN(price) || Number(price) <= 0) { resultEl.innerHTML = '<div class="msg error">يرجى إدخال سعر صحيح</div>'; return; }
  resultEl.innerHTML = '<div class="msg info"><i class="fa-solid fa-spinner fa-spin" style="margin-left:6px"></i> جاري إرسال عرضك...</div>';
  const sender = currentUser ? currentUser.name : 'زائر';
  const senderId = currentUser ? currentUser.id : 'guest';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(SB_URL + '/rest/v1/contact_feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ type: 'buy-offer', sender, sender_id: String(senderId), content: `${price} ${currency}${note ? ' — ' + note : ''}`, created_at: new Date().toISOString() }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok || res.status === 201 || res.status === 200) {
      resultEl.innerHTML = '<div class="contact-success"><i class="fa-solid fa-handshake" style="color:var(--green);font-size:20px;margin-bottom:6px;display:block"></i>تم إرسال عرضك! سيراجع فريقنا عرضك وسيردّ عليك قريباً.</div>';
      document.getElementById('buy-price').value = '';
      document.getElementById('buy-note').value = '';
    } else {
      const errText = await res.text().catch(() => '');
      console.error('Send buy offer error:', res.status, errText);
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-triangle-exclamation" style="margin-left:6px"></i>حدث خطأ أثناء الإرسال، حاول مرة أخرى</div>';
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-clock" style="margin-left:6px"></i>انتهت مهلة الاتصال، تحقق من الإنترنت وحاول مرة أخرى</div>';
    } else {
      console.error('Send buy offer exception:', e);
      resultEl.innerHTML = '<div class="msg error"><i class="fa-solid fa-wifi" style="margin-left:6px"></i>تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مرة أخرى</div>';
    }
  }
}

const saved = localStorage.getItem('genius_user');

// Handle OAuth callback (Google or GitHub) — both use same hash params from Supabase
if (window.location.hash && window.location.hash.includes('access_token')) {
  const _hashParams = new URLSearchParams(window.location.hash.substring(1));
  const _accessToken = _hashParams.get('access_token');

  // Try GitHub first (checks provider in user metadata), then fallback to Google
  handleGithubCallback(_accessToken).then(ok => {
    if (ok) return;
    return handleGoogleCallback(_accessToken).then(ok2 => {
      if (!ok2 && saved) {
        try { currentUser = JSON.parse(saved); showDashboard(); }
        catch(e) { localStorage.removeItem('genius_user'); }
      }
    });
  });
} else if (saved) {
  try {
    currentUser = JSON.parse(saved);
    sbFetch(`/rest/v1/system?id=eq.${currentUser.id}&select=*`, { method: 'GET' }).then(res => {
      if (res && res[0]) { currentUser = res[0]; localStorage.setItem('genius_user', JSON.stringify(currentUser)); }
      showDashboard();
    });
  } catch(e) { localStorage.removeItem('genius_user'); }
}

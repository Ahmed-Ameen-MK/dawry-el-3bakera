// api/abqari/[slug].js
// يعمل كـ Vercel Serverless Function

const SB_URL = 'https://spbbtsrabohqaspqzsph.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwYmJ0c3JhYm9ocWFzcHF6c3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTk4ODEsImV4cCI6MjA5MzYzNTg4MX0.SfgtGV2RpvmpthbR9D036bXWJZdBkDQFrUJbqsOjHsI';

const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const STORE_ITEMS = [
  { key: 'p1', name: 'المخ الفضي',        img: '/store/p1.png', badge: 'نادر',      badgeClass: 'rare',      section: 'جوائز الصدارة' },
  { key: 'p2', name: 'المخ الذهبي',       img: '/store/p2.png', badge: 'ذهبي',      badgeClass: 'rare',      section: 'جوائز الصدارة' },
  { key: 'p3', name: 'كأس العباقرة',      img: '/store/p3.png', badge: 'أسطوري',    badgeClass: 'legendary', section: 'ألقاب أسطورية' },
  { key: 'p4', name: 'إمبراطور العباقرة', img: '/store/p4.png', badge: 'إمبراطور',  badgeClass: 'legendary', section: 'ألقاب أسطورية' },
];

export default async function handler(req, res) {
  const { slug } = req.query;

  // ── POST: إرسال هدية coin ──
  if (req.method === 'POST') {
    return handleGiftSend(req, res);
  }

  // ── POST: like / dislike ──
  // (يُعالَج عبر query param action)
  if (req.method === 'GET' && req.query.action === 'react') {
    return handleReact(req, res);
  }

  let user     = null;
  let rank     = null;
  let awards   = [];
  let error    = '';

  if (!slug) {
    error = 'رابط غير صحيح';
  } else {
    try {
      const nameFromSlug = slug.replace(/-/g, ' ');

      // ── جلب بيانات المستخدم — level هو عمود نقاط الصدارة الصحيح ──
      const userRes = await fetch(
        `${SB_URL}/rest/v1/system?name=ilike.${encodeURIComponent(nameFromSlug)}&select=id,name,email,level,coin,country,avatar_url,like,dislike`,
        { headers: SB_HEADERS }
      );
      const userData = await userRes.json();

      if (userData && userData[0]) {
        user = userData[0];

        // ── حساب الترتيب الصحيح بناءً على عمود level ──
        const rankRes = await fetch(
          `${SB_URL}/rest/v1/system?level=gt.${parseInt(user.level || 0)}&select=id`,
          { headers: SB_HEADERS }
        );
        const rankData = await rankRes.json();
        rank = (Array.isArray(rankData) ? rankData.length : 0) + 1;

        // ── جلب جوائز المستخدم ──
        const storeRes = await fetch(
          `${SB_URL}/rest/v1/store?id=eq.${user.id}&select=p1,p2,p3,p4`,
          { headers: SB_HEADERS }
        );
        const storeData = await storeRes.json();
        if (storeData && storeData[0]) {
          awards = STORE_ITEMS.filter(item => storeData[0][item.key] == 1);
        }
      } else {
        error = 'لم يُعثر على هذا الحساب';
      }
    } catch (e) {
      error = 'حدث خطأ أثناء جلب البيانات';
    }
  }

  const name     = escHtml(user?.name       ?? 'غير معروف');
  const email    = escHtml(user?.email      ?? '');
  const level    = parseInt(user?.level     ?? 0);   // نقاط الصدارة الحقيقية
  const coin     = parseInt(user?.coin      ?? 0);
  const country  = escHtml(user?.country    ?? '');
  const avatarRaw = user?.avatar_url ? escHtml(user.avatar_url) : '';
  const initial  = name.slice(0, 1);
  const userId   = user?.id ?? '';
  const likeCount    = parseInt(user?.like    ?? 0);
  const dislikeCount = parseInt(user?.dislike ?? 0);

  const slugSafe = user?.name
    ? escHtml(user.name.trim().replace(/\s+/g, '-'))
    : escHtml(slug ?? '');

  let rankColor = '#0071e3';
  if (rank === 1)      rankColor = '#f0c040';
  else if (rank === 2) rankColor = '#aaa';
  else if (rank === 3) rankColor = '#cd7f32';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderHTML({
    user, rank, error,
    name, email, level, coin, country,
    avatar: avatarRaw, initial,
    rankColor, slugSafe, awards,
    userId, likeCount, dislikeCount,
  }));
}

// ── معالج إرسال هدية الـ coin ──
async function handleGiftSend(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { senderId, receiverId, amount } = body;

    if (!senderId || !receiverId || !amount || amount < 1) {
      return res.status(400).json({ error: 'بيانات غير صحيحة' });
    }

    // جلب بيانات المُرسِل
    const senderRes = await fetch(
      `${SB_URL}/rest/v1/system?id=eq.${senderId}&select=id,coin`,
      { headers: SB_HEADERS }
    );
    const senderData = await senderRes.json();
    const sender = senderData && senderData[0];
    if (!sender) return res.status(404).json({ error: 'المُرسِل غير موجود' });
    if ((sender.coin || 0) < amount) return res.status(400).json({ error: 'رصيدك غير كافٍ' });

    // جلب بيانات المُستقبِل
    const recvRes = await fetch(
      `${SB_URL}/rest/v1/system?id=eq.${receiverId}&select=id,coin`,
      { headers: SB_HEADERS }
    );
    const recvData = await recvRes.json();
    const recv = recvData && recvData[0];
    if (!recv) return res.status(404).json({ error: 'المُستقبِل غير موجود' });

    // خصم من المُرسِل
    await fetch(`${SB_URL}/rest/v1/system?id=eq.${senderId}`, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify({ coin: (sender.coin || 0) - amount }),
    });

    // إضافة للمُستقبِل
    await fetch(`${SB_URL}/rest/v1/system?id=eq.${receiverId}`, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify({ coin: (recv.coin || 0) + amount }),
    });

    return res.status(200).json({ ok: true, newSenderCoin: (sender.coin || 0) - amount });
  } catch (e) {
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
}

// ── معالج الإعجاب / عدم الإعجاب ──
async function handleReact(req, res) {
  try {
    const { targetId, type } = req.query; // type: 'like' | 'dislike'
    if (!targetId || !['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'بيانات غير صحيحة' });
    }

    // جلب القيمة الحالية
    const curRes = await fetch(
      `${SB_URL}/rest/v1/system?id=eq.${targetId}&select=like,dislike`,
      { headers: SB_HEADERS }
    );
    const curData = await curRes.json();
    const cur = curData && curData[0];
    if (!cur) return res.status(404).json({ error: 'مستخدم غير موجود' });

    const newLike    = type === 'like'    ? (parseInt(cur.like    || 0) + 1) : parseInt(cur.like    || 0);
    const newDislike = type === 'dislike' ? (parseInt(cur.dislike || 0) + 1) : parseInt(cur.dislike || 0);

    await fetch(`${SB_URL}/rest/v1/system?id=eq.${targetId}`, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify({ like: newLike, dislike: newDislike }),
    });

    return res.status(200).json({ ok: true, like: newLike, dislike: newDislike });
  } catch (e) {
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
}

// ══════════════════════════════════════════════════════════════
// HTML TEMPLATE
// ══════════════════════════════════════════════════════════════
function renderHTML({ user, rank, error, name, email, level, coin, country, avatar, initial, rankColor, slugSafe, awards, userId, likeCount, dislikeCount }) {
  const title  = user ? `${name} | دوري العباقرة` : 'حساب غير موجود | دوري العباقرة';
  const ogDesc = user ? `${name} — نقاط الصدارة: ${level} | الترتيب: #${rank}` : '';
  const ogImg  = avatar || 'https://dawry-el-3bakera.vercel.app/icon.png';
  const profileUrl = `https://dawry-el-3bakera.vercel.app/abqari/${encodeURIComponent(slugSafe)}`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${user ? `صفحة ${name} في دوري العباقرة — نقاط: ${level}` : 'حساب غير موجود'}">
<meta property="og:title"       content="${title}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:url"         content="${profileUrl}">
<meta property="og:image"       content="${ogImg}">
<link rel="icon" type="image/png" href="/icon.png">
<link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
/* ══ RESET & BASE ══ */
:root{
  --bg:#f5f5f7;--bg2:#fff;--bg3:#e8e8ed;
  --ink:#1d1d1f;--ink2:#3d3d3f;--ink3:#6e6e73;
  --line:#d2d2d7;--line2:rgba(0,0,0,0.06);
  --blue:#0071e3;--blue-h:#0077ed;
  --green:#1d8348;--green-bg:#f0faf4;
  --red:#c0392b;--red-bg:#fef1ef;
  --gold:#b5882e;--gold-bg:#fdf6e3;
  --purple:#7b2ff7;
  --radius:18px;--radius-sm:10px;
  --shadow:0 2px 20px rgba(0,0,0,0.07);
  --shadow-lg:0 8px 40px rgba(0,0,0,0.12);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'El Messiri',sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}

/* ══ HEADER ══ */
header{
  border-bottom:1px solid var(--line);padding:0 24px;
  position:sticky;top:0;z-index:50;
  background:rgba(255,255,255,0.88);backdrop-filter:blur(20px);
}
.header-inner{
  max-width:1200px;margin:0 auto;
  display:flex;align-items:center;justify-content:space-between;height:52px;
}
.brand{font-size:17px;font-weight:700;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:8px}
.brand i{color:var(--blue)}
.back-btn{
  display:flex;align-items:center;gap:6px;
  background:var(--bg3);border:1px solid var(--line);
  border-radius:20px;padding:6px 16px;
  font-family:'El Messiri',sans-serif;font-size:13px;font-weight:500;
  color:var(--ink2);text-decoration:none;transition:all .15s;
}
.back-btn:hover{background:var(--line);color:var(--ink)}

/* ══ PAGE LAYOUT ══ */
.page-body{
  max-width:1200px;margin:0 auto;
  padding:40px 24px 80px;
  display:grid;
  grid-template-columns:300px 1fr;
  gap:28px;
  align-items:start;
}
@media(max-width:900px){
  .page-body{grid-template-columns:1fr;padding:24px 16px 60px}
}

/* ══ GLASS CARD ══ */
.glass{
  background:var(--bg2);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);
  overflow:hidden;
}

/* ══ LEFT SIDEBAR ══ */
.sidebar{display:flex;flex-direction:column;gap:16px;position:sticky;top:72px}
@media(max-width:900px){.sidebar{position:static}}

/* ── Profile Card ── */
.profile-card{padding:32px 24px;text-align:center}

.avatar-wrap{position:relative;display:inline-block;margin-bottom:16px}
.avatar-img{
  width:110px;height:110px;border-radius:50%;
  object-fit:cover;border:3px solid var(--line);display:block;
}
.avatar-initial{
  width:110px;height:110px;border-radius:50%;
  background:linear-gradient(135deg,#0071e3,#34aadc);
  display:flex;align-items:center;justify-content:center;
  font-size:42px;font-weight:700;color:#fff;
  border:3px solid var(--line);margin:0 auto;
}
.rank-badge{
  position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);
  color:#fff;border-radius:20px;padding:3px 12px;
  font-size:12px;font-weight:700;white-space:nowrap;
  border:2px solid var(--bg2);
  box-shadow:0 2px 10px rgba(0,0,0,0.18);
}
.profile-name{font-size:24px;font-weight:700;letter-spacing:-.4px;margin-bottom:4px}
.profile-country{font-size:13px;color:var(--ink3);margin-bottom:20px}

/* ── Stats Row ── */
.stats-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px}
.stat-box{
  background:var(--bg);border:1px solid var(--line);
  border-radius:12px;padding:12px 6px;text-align:center;
}
.stat-val{font-size:20px;font-weight:800;color:var(--ink);line-height:1}
.stat-lbl{font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600}

/* ── Like / Dislike ── */
.reaction-row{
  display:flex;gap:8px;margin-bottom:20px;
}
.react-btn{
  flex:1;padding:10px;border-radius:12px;
  border:1.5px solid var(--line);background:var(--bg);
  font-family:'El Messiri',sans-serif;font-size:14px;font-weight:700;
  cursor:pointer;transition:all .18s;
  display:flex;align-items:center;justify-content:center;gap:6px;
  color:var(--ink2);
}
.react-btn.like-btn:hover{background:var(--green-bg);border-color:rgba(29,131,72,.4);color:var(--green)}
.react-btn.like-btn.active{background:var(--green-bg);border-color:var(--green);color:var(--green)}
.react-btn.dislike-btn:hover{background:var(--red-bg);border-color:rgba(192,57,43,.4);color:var(--red)}
.react-btn.dislike-btn.active{background:var(--red-bg);border-color:var(--red);color:var(--red)}

/* ── Share btn ── */
.share-btn{
  width:100%;padding:11px;
  background:var(--blue);color:#fff;
  border:none;border-radius:var(--radius-sm);
  font-family:'El Messiri',sans-serif;font-size:14px;font-weight:600;
  cursor:pointer;transition:all .15s;
  display:flex;align-items:center;justify-content:center;gap:7px;
}
.share-btn:hover{background:var(--blue-h)}
.share-btn:active{transform:scale(.98)}

/* ── Profile URL ── */
.profile-url{
  margin-top:10px;padding:9px 12px;
  background:var(--bg);border:1px solid var(--line);border-radius:var(--radius-sm);
  font-size:11px;color:var(--ink3);word-break:break-all;text-align:right;
  display:flex;align-items:center;gap:6px;
}
.profile-url i{color:var(--blue);flex-shrink:0;font-size:11px}

/* ── GIFT SEND CARD ── */
.gift-card{padding:20px 20px 22px}
.gift-card-title{
  display:flex;align-items:center;gap:8px;
  font-size:15px;font-weight:700;color:var(--ink);
  margin-bottom:14px;
}
.gift-card-title i{color:var(--gold);font-size:14px}
.gift-input-row{display:flex;gap:8px;align-items:center}
.gift-input{
  flex:1;padding:10px 14px;
  border:1.5px solid var(--line);border-radius:10px;
  font-family:'El Messiri',sans-serif;font-size:15px;font-weight:600;
  color:var(--ink);background:var(--bg);
  outline:none;transition:border .15s;
}
.gift-input:focus{border-color:var(--blue)}
.gift-send-btn{
  padding:10px 18px;
  background:linear-gradient(135deg,var(--gold),#f0c040);
  border:none;border-radius:10px;
  font-family:'El Messiri',sans-serif;font-size:14px;font-weight:700;
  color:#fff;cursor:pointer;transition:all .15s;white-space:nowrap;
  display:flex;align-items:center;gap:6px;
  box-shadow:0 3px 12px rgba(181,136,46,.35);
}
.gift-send-btn:hover{transform:translateY(-1px);box-shadow:0 5px 18px rgba(181,136,46,.45)}
.gift-send-btn:active{transform:scale(.97)}
.gift-send-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.gift-msg{margin-top:8px;font-size:12px;font-weight:600;min-height:18px}
.gift-msg.ok{color:var(--green)}
.gift-msg.err{color:var(--red)}
.gift-login-note{font-size:12px;color:var(--ink3);text-align:center;padding:10px 0}
.gift-login-note a{color:var(--blue);font-weight:600;text-decoration:none}

/* ══ RIGHT MAIN COLUMN ══ */
.main-col{display:flex;flex-direction:column;gap:20px}

/* ── Section Card ── */
.section-card{padding:24px 28px}
@media(max-width:600px){.section-card{padding:18px 16px}}
.section-title{
  display:flex;align-items:center;gap:10px;
  font-size:17px;font-weight:700;color:var(--ink);
  margin-bottom:20px;padding-bottom:14px;
  border-bottom:1px solid var(--line2);
}
.section-title .icon-wrap{
  width:36px;height:36px;border-radius:9px;
  background:var(--bg);border:1px solid var(--line);
  display:flex;align-items:center;justify-content:center;
  font-size:15px;flex-shrink:0;
}

/* ── Big Stats Grid ── */
.big-stats{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(140px,1fr));
  gap:14px;
}
.big-stat{
  background:linear-gradient(160deg,var(--bg) 60%,var(--bg3) 100%);
  border:1px solid var(--line);border-radius:14px;
  padding:18px 14px;text-align:center;
  transition:transform .2s,box-shadow .2s;
}
.big-stat:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
.big-stat-val{font-size:28px;font-weight:800;color:var(--ink);line-height:1;letter-spacing:-.5px}
.big-stat-lbl{font-size:12px;color:var(--ink3);margin-top:6px;font-weight:600}
.big-stat-icon{font-size:20px;margin-bottom:6px;display:block}

/* ── Awards Grid ── */
.awards-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(140px,1fr));
  gap:14px;
}
.award-card{
  border-radius:14px;overflow:hidden;
  border:1.5px solid var(--line);background:var(--bg2);
  box-shadow:0 1px 8px rgba(0,0,0,0.05);
  transition:transform .2s,box-shadow .2s;
}
.award-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
.award-img-wrap{
  width:100%;aspect-ratio:1;
  background:linear-gradient(135deg,var(--bg),var(--bg3));
  display:flex;align-items:center;justify-content:center;overflow:hidden;
}
.award-img{width:100%;height:100%;object-fit:cover;display:block}
.award-info{padding:10px 10px 12px;border-top:1px solid var(--line)}
.award-name{font-size:12px;font-weight:700;color:var(--ink);margin-bottom:3px}
.award-section{font-size:10px;color:var(--ink3)}
.award-badge{
  display:inline-block;margin-top:5px;
  border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700;
}
.badge-rare{background:linear-gradient(135deg,#b5882e,#f0c040);color:#fff}
.badge-legendary{background:linear-gradient(135deg,#7b2ff7,#e040fb);color:#fff}
.no-awards{
  grid-column:1/-1;text-align:center;padding:32px;
  color:var(--ink3);font-size:14px;
  background:var(--bg);border:1px dashed var(--line);border-radius:14px;
}
.no-awards i{display:block;font-size:28px;margin-bottom:8px;opacity:.35}

/* ── Email / Link rows ── */
.info-row{
  display:flex;align-items:center;gap:10px;
  background:var(--bg);border:1px solid var(--line);
  border-radius:10px;padding:12px 16px;
  font-size:14px;color:var(--ink2);margin-bottom:10px;
}
.info-row i{color:var(--blue);font-size:14px;flex-shrink:0}
.info-row:last-child{margin-bottom:0}

/* ══ ERROR PAGE ══ */
.error-card{
  max-width:480px;margin:100px auto;padding:60px 32px;text-align:center;
  background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);
}
.error-card .err-icon{font-size:52px;color:var(--ink3);margin-bottom:16px}
.error-card h2{font-size:24px;font-weight:700;margin-bottom:8px}
.error-card p{color:var(--ink3);font-size:15px;margin-bottom:28px;line-height:1.6}

/* ══ TOAST ══ */
.toast{
  position:fixed;top:68px;left:50%;transform:translateX(-50%);
  padding:10px 24px;border-radius:28px;
  font-family:'El Messiri',sans-serif;font-size:14px;font-weight:700;
  color:#fff;z-index:9999;
  box-shadow:0 8px 28px rgba(0,0,0,0.25);
  opacity:0;pointer-events:none;transition:opacity .25s;
  white-space:nowrap;
}
.toast.show{opacity:1}
.toast.ok-t{background:var(--green)}
.toast.err-t{background:var(--red)}
.toast.info-t{background:var(--blue)}
</style>
</head>
<body>

<!-- HEADER -->
<header>
  <div class="header-inner">
    <a class="brand" href="/"><i class="fa-solid fa-crown"></i> دوري العباقرة</a>
    <a class="back-btn" href="/"><i class="fa-solid fa-arrow-right"></i> الرئيسية</a>
  </div>
</header>

${user ? renderProfile({ name, email, level, coin, country, avatar: avatarRaw ?? '', initial, rank, rankColor, slugSafe, awards, userId, likeCount, dislikeCount, profileUrl }) : renderError(error)}

<!-- TOAST -->
<div class="toast" id="global-toast"></div>

<script>
// ──────────────────────────────────────────────
// GLOBALS (injected from server)
// ──────────────────────────────────────────────
const PROFILE_URL  = '${profileUrl}';
const PROFILE_NAME = '${name}';
const PROFILE_LEVEL= ${level};
const PROFILE_RANK = ${rank ?? 'null'};
const TARGET_ID    = '${userId}';

// المستخدم الحالي (من localStorage)
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem('genius_user') || 'null'); } catch{}

// ──────────────────────────────────────────────
// SHARE
// ──────────────────────────────────────────────
function shareProfile() {
  const text = PROFILE_NAME + ' في دوري العباقرة — نقاط: ' + PROFILE_LEVEL + ' | الترتيب: #' + PROFILE_RANK;
  if (navigator.share) {
    navigator.share({ title: PROFILE_NAME + ' | دوري العباقرة', text, url: PROFILE_URL });
  } else {
    navigator.clipboard.writeText(PROFILE_URL).then(() => {
      const btn = document.querySelector('.share-btn');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> تم نسخ الرابط!';
        setTimeout(() => btn.innerHTML = orig, 2200);
      }
    });
  }
}

// ──────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────
function showToast(msg, type='info') {
  const t = document.getElementById('global-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type + '-t';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2800);
}

// ──────────────────────────────────────────────
// LIKE / DISLIKE
// ──────────────────────────────────────────────
const REACT_KEY = 'genius_react_' + TARGET_ID;

function initReactions() {
  if (!TARGET_ID) return;
  const saved = localStorage.getItem(REACT_KEY); // 'like' | 'dislike' | null
  if (saved) {
    const btn = document.querySelector('.react-btn.' + saved + '-btn');
    if (btn) btn.classList.add('active');
  }
}

async function sendReact(type) {
  if (!TARGET_ID) return;
  const saved = localStorage.getItem(REACT_KEY);
  if (saved) {
    showToast('لقد أبديت رأيك في هذه الصفحة من قبل!', 'err');
    return;
  }
  // إذا كانت صفحة اللاعب نفسه
  if (currentUser && String(currentUser.id) === String(TARGET_ID)) {
    showToast('لا يمكنك إعطاء رأيك في صفحتك الخاصة!', 'err');
    return;
  }
  try {
    const r = await fetch(window.location.pathname + '?action=react&targetId=' + encodeURIComponent(TARGET_ID) + '&type=' + type);
    const data = await r.json();
    if (data.ok) {
      localStorage.setItem(REACT_KEY, type);
      document.getElementById('like-count').textContent    = data.like;
      document.getElementById('dislike-count').textContent = data.dislike;
      const btn = document.querySelector('.react-btn.' + type + '-btn');
      if (btn) btn.classList.add('active');
      showToast(type === 'like' ? '👍 شكراً على إعجابك!' : '👎 تم تسجيل رأيك', type === 'like' ? 'ok' : 'info');
    }
  } catch { showToast('حدث خطأ، حاول مجدداً', 'err'); }
}

// ──────────────────────────────────────────────
// SEND GIFT
// ──────────────────────────────────────────────
async function sendGift() {
  const btn    = document.getElementById('gift-send-btn');
  const input  = document.getElementById('gift-amount-input');
  const msgEl  = document.getElementById('gift-msg');
  const amount = parseInt(input.value);

  if (!currentUser) {
    msgEl.className = 'gift-msg err';
    msgEl.textContent = 'يجب تسجيل الدخول أولاً';
    return;
  }
  if (String(currentUser.id) === String(TARGET_ID)) {
    msgEl.className = 'gift-msg err';
    msgEl.textContent = 'لا يمكنك إرسال هدية لنفسك!';
    return;
  }
  if (!amount || amount < 1) {
    msgEl.className = 'gift-msg err';
    msgEl.textContent = 'أدخل عدد صحيح من العملات';
    return;
  }
  if ((currentUser.coin || 0) < amount) {
    msgEl.className = 'gift-msg err';
    msgEl.textContent = 'رصيدك غير كافٍ (' + (currentUser.coin || 0) + ' coin)';
    return;
  }

  btn.disabled = true;
  msgEl.className = 'gift-msg';
  msgEl.textContent = 'جاري الإرسال...';

  try {
    const r = await fetch(window.location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId:   currentUser.id,
        receiverId: TARGET_ID,
        amount,
      }),
    });
    const data = await r.json();
    if (data.ok) {
      currentUser.coin = data.newSenderCoin;
      localStorage.setItem('genius_user', JSON.stringify(currentUser));
      input.value = '';
      msgEl.className = 'gift-msg ok';
      msgEl.textContent = '✅ تم إرسال ' + amount + ' coin بنجاح!';
      showToast('🎁 تم الإرسال!', 'ok');
    } else {
      msgEl.className = 'gift-msg err';
      msgEl.textContent = '❌ ' + (data.error || 'حدث خطأ');
    }
  } catch {
    msgEl.className = 'gift-msg err';
    msgEl.textContent = 'تعذّر الاتصال بالخادم';
  }

  btn.disabled = false;
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initReactions();

  // إظهار زر إرسال الهدية فقط للمستخدمين المسجّلين
  const giftSection = document.getElementById('gift-section');
  const giftLogin   = document.getElementById('gift-login-note');
  if (giftSection && giftLogin) {
    if (currentUser && String(currentUser.id) !== String(TARGET_ID)) {
      giftSection.style.display = 'flex';
      giftLogin.style.display   = 'none';
    } else if (!currentUser) {
      giftSection.style.display = 'none';
      giftLogin.style.display   = 'block';
    } else {
      // نفس الشخص — أخفِ الهدية
      const giftCard = document.getElementById('gift-card-wrap');
      if (giftCard) giftCard.style.display = 'none';
    }
  }
});
</script>
</body>
</html>`;
}

// ── PROFILE RENDER ──────────────────────────────────────────
function renderProfile({ name, email, level, coin, country, avatar, initial, rank, rankColor, slugSafe, awards, userId, likeCount, dislikeCount, profileUrl }) {

  // ── رف الجوائز ──
  let awardsContent;
  if (awards && awards.length > 0) {
    awardsContent = awards.map(item => `
      <div class="award-card">
        <div class="award-img-wrap">
          <img class="award-img" src="${item.img}" alt="${item.name}" onerror="this.style.display='none'">
        </div>
        <div class="award-info">
          <div class="award-name">${item.name}</div>
          <div class="award-section">${item.section}</div>
          <span class="award-badge badge-${item.badgeClass}">${item.badge}</span>
        </div>
      </div>`).join('');
  } else {
    awardsContent = `
      <div class="no-awards">
        <i class="fa-solid fa-trophy"></i>
        لا توجد جوائز بعد
      </div>`;
  }

  // ── نقاط الصدارة بالأرقام العربية ──
  const lvlFmt  = parseInt(level).toLocaleString('ar-EG');
  const coinFmt = parseInt(coin).toLocaleString('ar-EG');

  // ── بطاقة الهدية ──
  const giftCard = userId ? `
  <div class="glass gift-card" id="gift-card-wrap">
    <div class="gift-card-title"><i class="fa-solid fa-gift"></i> أرسل هدية</div>

    <div class="gift-input-row" id="gift-section" style="display:none">
      <input
        id="gift-amount-input"
        class="gift-input"
        type="number"
        min="1"
        placeholder="عدد العملات"
        onkeydown="if(event.key==='Enter')sendGift()"
      >
      <button id="gift-send-btn" class="gift-send-btn" onclick="sendGift()">
        <i class="fa-solid fa-paper-plane"></i> إرسال
      </button>
    </div>

    <p class="gift-login-note" id="gift-login-note" style="display:none">
      <a href="/">سجّل الدخول</a> لترسل هدية لـ ${name}
    </p>

    <div class="gift-msg" id="gift-msg"></div>
  </div>` : '';

  return `
<div class="page-body">

  <!-- ══ SIDEBAR ══ -->
  <aside class="sidebar">

    <!-- Profile Card -->
    <div class="glass profile-card">

      <div class="avatar-wrap">
        ${avatar
          ? `<img class="avatar-img" src="${avatar}" alt="${name}" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <div class="avatar-initial" ${avatar ? 'style="display:none"' : ''}>${initial}</div>
        ${rank ? `<div class="rank-badge" style="background:${rankColor}">${rank === 1 ? '👑 ' : ''}#${rank}</div>` : ''}
      </div>

      <div class="profile-name">${name}</div>
      ${country ? `<div class="profile-country"><i class="fa-solid fa-earth-africa" style="margin-left:4px;font-size:12px"></i>${country}</div>` : ''}

      <!-- Stats 3-col -->
      <div class="stats-3">
        <div class="stat-box">
          <div class="stat-val">${lvlFmt}</div>
          <div class="stat-lbl"><i class="fa-solid fa-ranking-star" style="color:var(--blue);font-size:9px;margin-left:2px"></i>صدارة</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${rank ? '#' + rank : '—'}</div>
          <div class="stat-lbl">الترتيب</div>
        </div>
        <div class="stat-box">
          <div class="stat-val" style="color:var(--gold)">${coinFmt}</div>
          <div class="stat-lbl"><i class="fa-solid fa-coins" style="color:var(--gold);font-size:9px;margin-left:2px"></i>coin</div>
        </div>
      </div>

      <!-- Like / Dislike -->
      <div class="reaction-row">
        <button class="react-btn like-btn" onclick="sendReact('like')">
          <i class="fa-solid fa-thumbs-up"></i>
          <span id="like-count">${likeCount}</span>
        </button>
        <button class="react-btn dislike-btn" onclick="sendReact('dislike')">
          <i class="fa-solid fa-thumbs-down"></i>
          <span id="dislike-count">${dislikeCount}</span>
        </button>
      </div>

      <!-- Share -->
      <button class="share-btn" onclick="shareProfile()">
        <i class="fa-solid fa-share-nodes"></i> شارك الصفحة
      </button>

      <div class="profile-url">
        <i class="fa-solid fa-link"></i>
        <span>dawry-el-3bakera.vercel.app/abqari/${slugSafe}</span>
      </div>
    </div>

    <!-- Gift Card -->
    ${giftCard}

  </aside>

  <!-- ══ MAIN COLUMN ══ -->
  <main class="main-col">

    <!-- الإحصائيات المفصّلة -->
    <div class="glass section-card">
      <div class="section-title">
        <div class="icon-wrap" style="color:var(--blue)"><i class="fa-solid fa-chart-bar"></i></div>
        إحصائيات اللاعب
      </div>
      <div class="big-stats">
        <div class="big-stat">
          <span class="big-stat-icon"><i class="fa-solid fa-ranking-star" style="color:var(--blue)"></i></span>
          <div class="big-stat-val">${lvlFmt}</div>
          <div class="big-stat-lbl">نقاط الصدارة</div>
        </div>
        <div class="big-stat">
          <span class="big-stat-icon">${rank === 1 ? '👑' : '<i class="fa-solid fa-medal" style="color:var(--gold)"></i>'}</span>
          <div class="big-stat-val">#${rank ?? '—'}</div>
          <div class="big-stat-lbl">الترتيب العالمي</div>
        </div>
        <div class="big-stat">
          <span class="big-stat-icon"><i class="fa-solid fa-coins" style="color:var(--gold)"></i></span>
          <div class="big-stat-val" style="color:var(--gold)">${coinFmt}</div>
          <div class="big-stat-lbl">عدد العملات</div>
        </div>
        <div class="big-stat">
          <span class="big-stat-icon"><i class="fa-solid fa-thumbs-up" style="color:var(--green)"></i></span>
          <div class="big-stat-val" style="color:var(--green)">${likeCount}</div>
          <div class="big-stat-lbl">إعجاب</div>
        </div>
        <div class="big-stat">
          <span class="big-stat-icon"><i class="fa-solid fa-thumbs-down" style="color:var(--red)"></i></span>
          <div class="big-stat-val" style="color:var(--red)">${dislikeCount}</div>
          <div class="big-stat-lbl">عدم إعجاب</div>
        </div>
        ${country ? `
        <div class="big-stat">
          <span class="big-stat-icon"><i class="fa-solid fa-earth-africa" style="color:var(--ink3)"></i></span>
          <div class="big-stat-val" style="font-size:18px">${country}</div>
          <div class="big-stat-lbl">البلد</div>
        </div>` : ''}
      </div>
    </div>

    <!-- رف الجوائز -->
    <div class="glass section-card">
      <div class="section-title">
        <div class="icon-wrap" style="color:var(--gold)"><i class="fa-solid fa-trophy"></i></div>
        رف الجوائز ${awards.length > 0 ? `<span style="font-size:12px;color:var(--ink3);font-weight:500;margin-right:auto">(${awards.length})</span>` : ''}
      </div>
      <div class="awards-grid">
        ${awardsContent}
      </div>
    </div>

    <!-- معلومات إضافية -->
    ${email ? `
    <div class="glass section-card">
      <div class="section-title">
        <div class="icon-wrap" style="color:var(--ink3)"><i class="fa-solid fa-circle-info"></i></div>
        معلومات الحساب
      </div>
      <div class="info-row"><i class="fa-solid fa-envelope"></i><span>${email}</span></div>
      <div class="info-row"><i class="fa-solid fa-link"></i><span style="font-size:12px;color:var(--ink3)">dawry-el-3bakera.vercel.app/abqari/${slugSafe}</span></div>
    </div>` : ''}

  </main>

</div>`;
}

// ── ERROR PAGE ───────────────────────────────────────────────
function renderError(error) {
  return `
<div style="max-width:1200px;margin:0 auto;padding:40px 24px">
  <div class="error-card">
    <div class="err-icon"><i class="fa-solid fa-user-slash"></i></div>
    <h2>الحساب غير موجود</h2>
    <p>${escHtml(error)}</p>
    <a href="/" style="display:inline-flex;align-items:center;gap:8px;background:var(--blue);color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-family:'El Messiri',sans-serif;font-weight:600;font-size:15px">
      <i class="fa-solid fa-house"></i> العودة للرئيسية
    </a>
  </div>
</div>`;
}

// ── HELPERS ──────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

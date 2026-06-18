// api/abqari/[slug].js
// يعمل كـ Vercel Serverless Function
// الأرشفة تعتمد على عمود name مع استبدال الفراغات بـ - في الرابط
//
// ── ملاحظة مهمة عن الترتيب والنقاط ──
// باقي الموقع (script.js) يحسب "نقاط الصدارة" والترتيب بالاعتماد على عمود level
// (وليس عمود points الذي يُصفَّر بعد كل مباراة). تم تصحيح هذا هنا للتطابق مع باقي الموقع.

const SB_URL = 'https://spbbtsrabohqaspqzsph.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwYmJ0c3JhYm9ocWFzcHF6c3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTk4ODEsImV4cCI6MjA5MzYzNTg4MX0.SfgtGV2RpvmpthbR9D036bXWJZdBkDQFrUJbqsOjHsI';

const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

// قائمة الجوائز — تطابق ما في store.html
const STORE_ITEMS = [
  { key: 'p1', name: 'المخ الفضي',        img: '/store/p1.png', badge: 'نادر',      badgeClass: 'rare',      section: 'جوائز الصدارة' },
  { key: 'p2', name: 'المخ الذهبي',       img: '/store/p2.png', badge: 'ذهبي',      badgeClass: 'rare',      section: 'جوائز الصدارة' },
  { key: 'p3', name: 'كأس العباقرة',      img: '/store/p3.png', badge: 'أسطوري',    badgeClass: 'legendary', section: 'ألقاب أسطورية' },
  { key: 'p4', name: 'إمبراطور العباقرة', img: '/store/p4.png', badge: 'إمبراطور',  badgeClass: 'legendary', section: 'ألقاب أسطورية' },
];

export default async function handler(req, res) {
  const { slug } = req.query;

  // ── معالجة طلبات POST (إرسال هدية / تصويت لايك-دسلايك) ──
  if (req.method === 'POST') {
    return handleAction(req, res, slug);
  }

  let user = null;
  let rank = null;
  let awards = [];
  let error = '';

  if (!slug) {
    error = 'رابط غير صحيح';
  } else {
    try {
      // تحويل الرابط إلى اسم: استبدال الشرطات بفراغات للبحث
      const nameFromSlug = slug.replace(/-/g, ' ');

      // البحث بالاسم (case-insensitive)
      const userRes = await fetch(
        `${SB_URL}/rest/v1/system?name=ilike.${encodeURIComponent(nameFromSlug)}&select=id,name,email,points,level,coin,country,like,dislike`,
        { headers: SB_HEADERS }
      );
      const userData = await userRes.json();

      if (userData && userData[0]) {
        user = userData[0];

        // حساب الترتيب اعتماداً على level (نفس معيار باقي الموقع)
        const myLevel = parseInt(user.level) || 0;
        const rankRes = await fetch(
          `${SB_URL}/rest/v1/system?level=gt.${myLevel}&select=id`,
          { headers: SB_HEADERS }
        );
        const rankData = await rankRes.json();
        rank = (Array.isArray(rankData) ? rankData.length : 0) + 1;

        // جلب جوائز المستخدم من جدول store
        const storeRes = await fetch(
          `${SB_URL}/rest/v1/store?id=eq.${user.id}&select=p1,p2,p3,p4`,
          { headers: SB_HEADERS }
        );
        const storeData = await storeRes.json();
        if (storeData && storeData[0]) {
          const row = storeData[0];
          awards = STORE_ITEMS.filter(item => row[item.key] == 1);
        }
      } else {
        error = 'لم يُعثر على هذا الحساب';
      }
    } catch (e) {
      error = 'حدث خطأ أثناء جلب البيانات';
    }
  }

  // بيانات للعرض
  const name    = escHtml(user?.name    ?? 'غير معروف');
  const email   = escHtml(user?.email   ?? '');
  const level   = parseInt(user?.level ?? 0);
  const coin    = parseInt(user?.coin  ?? 0);
  const likes   = parseInt(user?.like    ?? 0);
  const dislikes= parseInt(user?.dislike ?? 0);
  const country = escHtml(user?.country ?? '');
  const avatar  = '';
  const initial = name.slice(0, 1);
  const userId  = user?.id ?? '';
  // إعادة بناء الرابط من الاسم الفعلي (وليس من slug المُدخل)
  const slugSafe = user?.name ? escHtml(user.name.trim().replace(/\s+/g, '-')) : escHtml(slug ?? '');

  // لون الرانك
  let rankColor = '#0071e3';
  if (rank === 1) rankColor = '#f0c040';
  else if (rank === 2) rankColor = '#aaa';
  else if (rank === 3) rankColor = '#cd7f32';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderHTML({
    user, rank, error,
    name, email, level, coin, country, avatar, initial,
    rankColor, slugSafe, awards, userId, likes, dislikes,
  }));
}

// ── معالجة الإجراءات (POST) ────────────────────────────────────
async function handleAction(req, res, slug) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const action = body.action;

  try {
    // ── إرسال هدية (coins) ──
    if (action === 'gift') {
      const { senderId, amount } = body;
      const amt = parseInt(amount);

      if (!senderId) return res.status(400).json({ ok: false, error: 'يجب تسجيل الدخول لإرسال هدية' });
      if (!amt || amt <= 0) return res.status(400).json({ ok: false, error: 'عدد الكوينز غير صحيح' });

      // جلب المستلم بالاسم من slug
      const nameFromSlug = (slug || '').replace(/-/g, ' ');
      const recvRes = await fetch(
        `${SB_URL}/rest/v1/system?name=ilike.${encodeURIComponent(nameFromSlug)}&select=id,coin,name`,
        { headers: SB_HEADERS }
      );
      const recvData = await recvRes.json();
      if (!recvData || !recvData[0]) return res.status(404).json({ ok: false, error: 'الحساب المستلم غير موجود' });
      const receiver = recvData[0];

      if (String(receiver.id) === String(senderId)) {
        return res.status(400).json({ ok: false, error: 'لا يمكنك إرسال هدية لنفسك' });
      }

      // جلب المرسل للتأكد من وجود كوينز كافية
      const senderRes = await fetch(
        `${SB_URL}/rest/v1/system?id=eq.${senderId}&select=id,coin`,
        { headers: SB_HEADERS }
      );
      const senderData = await senderRes.json();
      if (!senderData || !senderData[0]) return res.status(404).json({ ok: false, error: 'حسابك غير موجود، حاول تسجيل الدخول من جديد' });
      const sender = senderData[0];

      const senderCoin = parseInt(sender.coin) || 0;
      if (senderCoin < amt) return res.status(400).json({ ok: false, error: 'لا يوجد لديك عدد كافٍ من الكوينز' });

      const newSenderCoin = senderCoin - amt;
      const newReceiverCoin = (parseInt(receiver.coin) || 0) + amt;

      // خصم من المرسل
      const upd1 = await fetch(`${SB_URL}/rest/v1/system?id=eq.${senderId}`, {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({ coin: newSenderCoin }),
      });
      if (!upd1.ok) return res.status(500).json({ ok: false, error: 'فشل خصم الكوينز من حسابك' });

      // إضافة للمستلم
      const upd2 = await fetch(`${SB_URL}/rest/v1/system?id=eq.${receiver.id}`, {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({ coin: newReceiverCoin }),
      });
      if (!upd2.ok) {
        // محاولة استرجاع الكوينز للمرسل في حال فشل الإضافة
        await fetch(`${SB_URL}/rest/v1/system?id=eq.${senderId}`, {
          method: 'PATCH', headers: SB_HEADERS, body: JSON.stringify({ coin: senderCoin }),
        });
        return res.status(500).json({ ok: false, error: 'فشل إرسال الكوينز للمستلم، تم إرجاع الكوينز لحسابك' });
      }

      return res.status(200).json({ ok: true, newSenderCoin, newReceiverCoin, receiverName: receiver.name });
    }

    // ── لايك / دسلايك ──
    if (action === 'vote') {
      const { type } = body; // 'like' | 'dislike'
      if (type !== 'like' && type !== 'dislike') {
        return res.status(400).json({ ok: false, error: 'نوع التصويت غير صحيح' });
      }

      const nameFromSlug = (slug || '').replace(/-/g, ' ');
      const targetRes = await fetch(
        `${SB_URL}/rest/v1/system?name=ilike.${encodeURIComponent(nameFromSlug)}&select=id,like,dislike`,
        { headers: SB_HEADERS }
      );
      const targetData = await targetRes.json();
      if (!targetData || !targetData[0]) return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
      const target = targetData[0];

      const field = type; // 'like' or 'dislike'
      const newVal = (parseInt(target[field]) || 0) + 1;

      const upd = await fetch(`${SB_URL}/rest/v1/system?id=eq.${target.id}`, {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({ [field]: newVal }),
      });
      if (!upd.ok) return res.status(500).json({ ok: false, error: 'فشل حفظ التصويت' });

      return res.status(200).json({
        ok: true,
        like: type === 'like' ? newVal : (parseInt(target.like) || 0),
        dislike: type === 'dislike' ? newVal : (parseInt(target.dislike) || 0),
      });
    }

    return res.status(400).json({ ok: false, error: 'إجراء غير معروف' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'حدث خطأ في الخادم' });
  }
}

// ── HTML Template ──────────────────────────────────────────────
function renderHTML({ user, rank, error, name, email, level, coin, country, avatar, initial, rankColor, slugSafe, awards, userId, likes, dislikes }) {
  const title = user
    ? `${name} | دوري العباقرة`
    : 'حساب غير موجود | دوري العباقرة';

  const ogDesc = user
    ? `${name} - نقاط الصدارة: ${level} | الترتيب: #${rank}`
    : '';

  const ogImage = avatar || 'https://dawry-el-3bakera.vercel.app/icon.png';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${user ? `صفحة ${name} في دوري العباقرة - نقاط: ${level}` : 'حساب غير موجود'}">

<!-- Open Graph -->
<meta property="og:title" content="${title}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:url" content="https://dawry-el-3bakera.vercel.app/abqari/${encodeURIComponent(slugSafe)}">
<meta property="og:image" content="${ogImage}">

<link rel="icon" type="image/png" href="/icon.png">
<link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

<style>
:root {
  --bg:#ffffff; --bg2:#f5f5f7; --bg3:#e8e8ed;
  --ink:#1d1d1f; --ink2:#3d3d3f; --ink3:#6e6e73;
  --line:#d2d2d7; --blue:#0071e3; --blue-hover:#0077ed;
  --green:#1d8348; --green-bg:#f0faf4;
  --red:#c0392b; --red-bg:#fef1ef;
  --gold:#b5882e; --gold-bg:#fdf6e3;
  --radius:18px; --radius-sm:12px;
  --shadow:0 2px 20px rgba(0,0,0,0.08);
  --shadow-lg:0 8px 40px rgba(0,0,0,0.12);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'El Messiri',sans-serif;background:var(--bg2);color:var(--ink);min-height:100vh}

header{border-bottom:1px solid var(--line);padding:0 24px;background:rgba(255,255,255,0.9);backdrop-filter:blur(20px);position:sticky;top:0;z-index:50}
.header-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:52px}
.brand{font-size:17px;font-weight:700;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:8px}
.brand i{color:var(--blue)}
.back-btn{display:flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--line);border-radius:20px;padding:6px 14px;font-family:'El Messiri',sans-serif;font-size:13px;font-weight:500;color:var(--ink2);text-decoration:none;transition:all 0.15s}
.back-btn:hover{background:var(--bg3)}

/* ── تخطيط الصفحة: عرض كامل على الشاشات الواسعة ── */
.page-wrap{max-width:1200px;margin:0 auto;padding:32px 24px 60px}
.profile-grid{display:grid;grid-template-columns:1fr;gap:20px}

@media (min-width: 900px){
  .page-wrap{padding:48px 32px 70px}
  .profile-grid{grid-template-columns:340px 1fr;gap:28px;align-items:start}
  .sidebar-col{position:sticky;top:90px}
}

/* ── العمود الجانبي (الهوية) ── */
.sidebar-card{background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);padding:32px 28px;box-shadow:var(--shadow);text-align:center}

.avatar-wrap{position:relative;display:inline-block;margin-bottom:16px}
.avatar{width:108px;height:108px;border-radius:50%;object-fit:cover;border:3px solid var(--line)}
.avatar-initial{width:108px;height:108px;border-radius:50%;background:linear-gradient(135deg,#0071e3,#34aadc);display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:700;color:#fff;border:3px solid var(--line);margin:0 auto}
.rank-badge{position:absolute;bottom:0;left:50%;transform:translateX(-50%);background:${rankColor};color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.15)}

.profile-name{font-size:24px;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px}
.profile-country{font-size:14px;color:var(--ink3);margin-bottom:20px}

.info-row{display:flex;align-items:center;gap:10px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:11px 14px;font-size:13px;color:var(--ink2);margin-bottom:10px;text-align:right}
.info-row i{color:var(--blue);font-size:13px;flex-shrink:0}
.info-row span{word-break:break-all}

.share-btn{width:100%;padding:12px;background:var(--blue);color:#fff;border:none;border-radius:10px;font-family:'El Messiri',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.15s;margin-top:6px;display:flex;align-items:center;justify-content:center;gap:8px}
.share-btn:hover{background:var(--blue-hover)}
.share-btn:active{transform:scale(0.98)}

/* ── لايك / دسلايك ── */
.vote-row{display:flex;gap:10px;margin-top:14px}
.vote-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg2);font-family:'El Messiri',sans-serif;font-size:14px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all 0.15s}
.vote-btn i{font-size:14px}
.vote-btn.like:hover, .vote-btn.like.voted{background:var(--green-bg);color:var(--green);border-color:rgba(29,131,72,0.3)}
.vote-btn.dislike:hover, .vote-btn.dislike.voted{background:var(--red-bg);color:var(--red);border-color:rgba(192,57,43,0.3)}
.vote-btn.disabled{opacity:0.55;cursor:not-allowed}
.vote-btn .vcount{font-size:13px;font-weight:700}

/* ── العمود الرئيسي ── */
.main-col{display:flex;flex-direction:column;gap:20px}

.stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.stat-box{background:var(--bg);border:1px solid var(--line);border-radius:var(--radius-sm);padding:20px 14px;text-align:center;box-shadow:var(--shadow)}
.stat-box .stat-icon{font-size:18px;color:var(--blue);margin-bottom:8px}
.stat-box.gold .stat-icon{color:var(--gold)}
.stat-val{font-size:26px;font-weight:700;color:var(--ink)}
.stat-lbl{font-size:12px;color:var(--ink3);margin-top:3px}

.section-card{background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow)}
.section-title{font-size:15px;font-weight:700;color:var(--ink2);margin-bottom:16px;display:flex;align-items:center;gap:7px}
.section-title i{color:var(--gold)}

/* ── رف الجوائز ── */
.awards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px}
.award-card{border-radius:14px;overflow:hidden;border:1.5px solid var(--line);background:var(--bg);box-shadow:0 1px 8px rgba(0,0,0,0.06);transition:transform 0.2s,box-shadow 0.2s}
.award-card:hover{transform:translateY(-3px);box-shadow:0 6px 20px rgba(0,0,0,0.1)}
.award-img{width:100%;height:auto;display:block;object-fit:cover}
.award-info{padding:8px 9px 10px;background:var(--bg2);border-top:1px solid var(--line)}
.award-name{font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.award-section{font-size:10px;color:var(--ink3);margin-top:2px}
.award-badge-rare{display:inline-block;margin-top:4px;background:linear-gradient(135deg,#b5882e,#f0c040);color:#fff;border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700}
.award-badge-legendary{display:inline-block;margin-top:4px;background:linear-gradient(135deg,#7b2ff7,#e040fb);color:#fff;border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700}
.no-awards{text-align:center;color:var(--ink3);font-size:13px;padding:26px 0;background:var(--bg2);border:1px solid var(--line);border-radius:12px}
.no-awards i{display:block;font-size:26px;margin-bottom:8px;opacity:0.4}

/* ── أداة إرسال هدية ── */
.gift-form{display:flex;flex-direction:column;gap:12px}
.gift-input-row{display:flex;gap:10px;flex-wrap:wrap}
.gift-input-row input{flex:1;min-width:140px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:11px 14px;font-family:'El Messiri',sans-serif;font-size:15px;color:var(--ink);outline:none;transition:border-color 0.15s}
.gift-input-row input:focus{border-color:var(--blue);background:var(--bg)}
.gift-quick{display:flex;gap:8px;flex-wrap:wrap}
.gift-quick button{background:var(--bg2);border:1px solid var(--line);border-radius:20px;padding:6px 14px;font-family:'El Messiri',sans-serif;font-size:13px;font-weight:600;color:var(--ink2);cursor:pointer;transition:all 0.15s}
.gift-quick button:hover{background:var(--bg3)}
.gift-send-btn{background:linear-gradient(135deg,#b5882e,#f0c040);color:#fff;border:none;border-radius:10px;padding:12px;font-family:'El Messiri',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:8px}
.gift-send-btn:hover{filter:brightness(1.05)}
.gift-send-btn:disabled{opacity:0.5;cursor:not-allowed}
.gift-msg{font-size:13px;text-align:center;border-radius:10px;padding:10px 14px}
.gift-msg.error{background:var(--red-bg);color:var(--red)}
.gift-msg.success{background:var(--green-bg);color:var(--green)}
.gift-note{font-size:12px;color:var(--ink3);display:flex;align-items:center;gap:6px}
.gift-note i{color:var(--blue)}
.gift-self-note{text-align:center;color:var(--ink3);font-size:13px;padding:18px 0;background:var(--bg2);border:1px solid var(--line);border-radius:12px}

.error-card{text-align:center;padding:60px 24px;max-width:420px;margin:80px auto;background:var(--bg);border-radius:var(--radius);box-shadow:var(--shadow)}
.error-card .icon{font-size:48px;margin-bottom:16px;color:var(--ink3)}
.error-card h2{font-size:22px;font-weight:700;margin-bottom:8px}
.error-card p{color:var(--ink3);font-size:15px;margin-bottom:24px}
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <a class="brand" href="/"><i class="fa-solid fa-trophy"></i> دوري العباقرة</a>
    <a class="back-btn" href="/"><i class="fa-solid fa-arrow-right"></i> الصفحة الرئيسية</a>
  </div>
</header>

<div class="page-wrap">
${user ? renderProfile({ name, email, level, coin, country, avatar, initial, rank, rankColor, slugSafe, awards, userId, likes, dislikes }) : renderError(error)}
</div>

<script>
const PROFILE_USER_ID = ${JSON.stringify(userId)};
const PROFILE_SLUG = ${JSON.stringify(slugSafe)};
const PROFILE_NAME = ${JSON.stringify(name)};
const PROFILE_LEVEL = ${JSON.stringify(level)};
const PROFILE_RANK = ${JSON.stringify(rank)};

function shareProfile() {
  const url = 'https://dawry-el-3bakera.vercel.app/abqari/' + encodeURIComponent(PROFILE_SLUG);
  const text = PROFILE_NAME + ' في دوري العباقرة - نقاط: ' + PROFILE_LEVEL + ' | الترتيب: #' + PROFILE_RANK;
  if (navigator.share) {
    navigator.share({ title: PROFILE_NAME + ' | دوري العباقرة', text, url });
  } else {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('.share-btn');
      btn.innerHTML = '<i class="fa-solid fa-check"></i> تم نسخ الرابط!';
      setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> شارك الصفحة', 2000);
    });
  }
}

// ── الحصول على المستخدم الحالي (من نفس الموقع) ──
function getCurrentUser() {
  try {
    const raw = localStorage.getItem('genius_user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ── لايك / دسلايك ──
function getVoteKey() { return 'genius_voted_' + PROFILE_SLUG; }

function initVotes() {
  const existing = localStorage.getItem(getVoteKey());
  if (existing) {
    const btn = document.querySelector('.vote-btn.' + existing);
    if (btn) btn.classList.add('voted');
    document.querySelectorAll('.vote-btn').forEach(b => {
      if (!b.classList.contains(existing)) b.classList.add('disabled');
    });
  }
}

async function castVote(type) {
  const existing = localStorage.getItem(getVoteKey());
  if (existing) return; // تم التصويت من قبل على هذا الجهاز

  try {
    const res = await fetch(window.location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vote', type })
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem(getVoteKey(), type);
      const likeEl = document.getElementById('vcount-like');
      const dislikeEl = document.getElementById('vcount-dislike');
      if (likeEl) likeEl.textContent = data.like;
      if (dislikeEl) dislikeEl.textContent = data.dislike;
      document.querySelector('.vote-btn.' + type).classList.add('voted');
      document.querySelectorAll('.vote-btn').forEach(b => {
        if (!b.classList.contains(type)) b.classList.add('disabled');
      });
    }
  } catch (e) { /* صمت */ }
}

// ── إرسال هدية كوينز ──
function setGiftAmount(val) {
  const input = document.getElementById('gift-amount');
  if (input) input.value = val;
}

async function sendGift() {
  const me = getCurrentUser();
  const msgEl = document.getElementById('gift-msg');
  const btn = document.getElementById('gift-send-btn');
  const input = document.getElementById('gift-amount');

  if (!me || !me.id) {
    showGiftMsg('يجب تسجيل الدخول أولاً من الصفحة الرئيسية لإرسال هدية', 'error');
    return;
  }

  const amount = parseInt(input.value);
  if (!amount || amount <= 0) {
    showGiftMsg('أدخل عدد كوينز صحيح', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإرسال...';

  try {
    const res = await fetch(window.location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gift', senderId: me.id, amount })
    });
    const data = await res.json();

    if (data.ok) {
      me.coin = data.newSenderCoin;
      localStorage.setItem('genius_user', JSON.stringify(me));
      showGiftMsg('تم إرسال ' + amount + ' كوين بنجاح إلى ' + data.receiverName + ' 🎉', 'success');
      input.value = '';
      const coinEl = document.getElementById('stat-coin-self');
      if (coinEl) coinEl.textContent = data.newReceiverCoin;
    } else {
      showGiftMsg(data.error || 'حدث خطأ، حاول مجدداً', 'error');
    }
  } catch (e) {
    showGiftMsg('فشل الاتصال بالخادم', 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-gift"></i> إرسال الهدية';
}

function showGiftMsg(text, type) {
  const msgEl = document.getElementById('gift-msg');
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className = 'gift-msg ' + type;
  msgEl.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', initVotes);
</script>
</body>
</html>`;
}

function renderProfile({ name, email, level, coin, country, avatar, initial, rank, slugSafe, awards, userId, likes, dislikes }) {
  const lvl = parseInt(level).toLocaleString('ar-EG');
  const coinFmt = parseInt(coin).toLocaleString('ar-EG');

  // بناء رف الجوائز
  let awardsHtml = '';
  if (awards && awards.length > 0) {
    const cardsHtml = awards.map(item => `
      <div class="award-card">
        <img class="award-img" src="${item.img}" alt="${item.name}" onerror="this.style.display='none'">
        <div class="award-info">
          <div class="award-name">${item.name}</div>
          <div class="award-section">${item.section}</div>
          <div class="award-badge-${item.badgeClass}">${item.badge}</div>
        </div>
      </div>`).join('');
    awardsHtml = `<div class="awards-grid">${cardsHtml}</div>`;
  } else {
    awardsHtml = `<div class="no-awards"><i class="fa-solid fa-trophy"></i>لا توجد جوائز بعد</div>`;
  }

  return `
  <div class="profile-grid">

    <!-- العمود الجانبي: الهوية -->
    <div class="sidebar-col">
      <div class="sidebar-card">
        <div class="avatar-wrap">
          ${avatar
            ? `<img class="avatar" src="${avatar}" alt="${name}">`
            : `<div class="avatar-initial">${initial}</div>`
          }
          ${rank ? `<div class="rank-badge">${rank === 1 ? '👑' : ''}#${rank}</div>` : ''}
        </div>

        <div class="profile-name">${name}</div>
        ${country ? `<div class="profile-country">${country}</div>` : ''}

        ${email ? `<div class="info-row"><i class="fa-solid fa-envelope"></i><span>${email}</span></div>` : ''}
        <div class="info-row">
          <i class="fa-solid fa-link"></i>
          <span style="font-size:12px;color:var(--ink3)">dawry-el-3bakera.vercel.app/abqari/${slugSafe}</span>
        </div>

        <button class="share-btn" onclick="shareProfile()">
          <i class="fa-solid fa-share-nodes"></i> شارك الصفحة
        </button>

        <div class="vote-row">
          <button class="vote-btn like" onclick="castVote('like')">
            <i class="fa-solid fa-thumbs-up"></i>
            <span class="vcount" id="vcount-like">${likes}</span>
          </button>
          <button class="vote-btn dislike" onclick="castVote('dislike')">
            <i class="fa-solid fa-thumbs-down"></i>
            <span class="vcount" id="vcount-dislike">${dislikes}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- العمود الرئيسي -->
    <div class="main-col">

      <div class="stats-row">
        <div class="stat-box">
          <div class="stat-icon"><i class="fa-solid fa-ranking-star"></i></div>
          <div class="stat-val">${lvl}</div>
          <div class="stat-lbl">نقاط الصدارة</div>
        </div>
        <div class="stat-box">
          <div class="stat-icon"><i class="fa-solid fa-medal"></i></div>
          <div class="stat-val">#${rank ?? '-'}</div>
          <div class="stat-lbl">الترتيب العام</div>
        </div>
        <div class="stat-box gold">
          <div class="stat-icon"><i class="fa-solid fa-coins"></i></div>
          <div class="stat-val" id="stat-coin-self">${coinFmt}</div>
          <div class="stat-lbl">الكوينز</div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-title"><i class="fa-solid fa-trophy"></i> رف الجوائز (${awards.length})</div>
        ${awardsHtml}
      </div>

      <div class="section-card">
        <div class="section-title"><i class="fa-solid fa-gift" style="color:var(--blue)"></i> إرسال هدية كوينز</div>
        <div class="gift-form">
          <div class="gift-input-row">
            <input type="number" id="gift-amount" placeholder="عدد الكوينز" min="1" inputmode="numeric">
            <button class="gift-send-btn" id="gift-send-btn" onclick="sendGift()" style="flex:0 0 auto;padding:11px 22px">
              <i class="fa-solid fa-gift"></i> إرسال الهدية
            </button>
          </div>
          <div class="gift-quick">
            <button onclick="setGiftAmount(10)">10</button>
            <button onclick="setGiftAmount(25)">25</button>
            <button onclick="setGiftAmount(50)">50</button>
            <button onclick="setGiftAmount(100)">100</button>
          </div>
          <div class="gift-note"><i class="fa-solid fa-circle-info"></i> سيتم خصم الكوينز من حسابك وإضافتها مباشرة لحساب ${name}</div>
          <div class="gift-msg" id="gift-msg" style="display:none"></div>
        </div>
      </div>

    </div>
  </div>`;
}

function renderError(error) {
  return `
<div class="error-card">
  <div class="icon"><i class="fa-solid fa-user-slash"></i></div>
  <h2>الحساب غير موجود</h2>
  <p>${escHtml(error)}</p>
  <a href="/" style="display:inline-flex;align-items:center;gap:8px;background:#0071e3;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600">
    <i class="fa-solid fa-house"></i> العودة للرئيسية
  </a>
</div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// api/abqari/[slug].js
// يعمل كـ Vercel Serverless Function
// الأرشفة تعتمد على عمود name مع استبدال الفراغات بـ - في الرابط

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
        `${SB_URL}/rest/v1/system?name=ilike.${encodeURIComponent(nameFromSlug)}&select=id,name,email,points,country`,
        { headers: SB_HEADERS }
      );
      const userData = await userRes.json();

      if (userData && userData[0]) {
        user = userData[0];

        // حساب الترتيب
        const rankRes = await fetch(
          `${SB_URL}/rest/v1/system?points=gt.${parseInt(user.points)}&select=id`,
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
  const points  = parseInt(user?.points ?? 0);
  const country = escHtml(user?.country ?? '');
  const avatar  = '';
  const initial = name.slice(0, 1);
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
    name, email, points, country, avatar, initial,
    rankColor, slugSafe, awards,
  }));
}

// ── HTML Template ──────────────────────────────────────────────
function renderHTML({ user, rank, error, name, email, points, country, avatar, initial, rankColor, slugSafe, awards }) {
  const title = user
    ? `${name} | دوري العباقرة`
    : 'حساب غير موجود | دوري العباقرة';

  const ogDesc = user
    ? `${name} - نقاط الصدارة: ${points} | الترتيب: #${rank}`
    : '';

  const ogImage = avatar || 'https://dawry-el-3bakera.vercel.app/icon.png';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${user ? `صفحة ${name} في دوري العباقرة - نقاط: ${points}` : 'حساب غير موجود'}">

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
  --line:#d2d2d7; --blue:#0071e3;
  --radius:18px; --shadow:0 2px 20px rgba(0,0,0,0.08);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'El Messiri',sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}

header{border-bottom:1px solid var(--line);padding:0 24px;background:rgba(255,255,255,0.9);backdrop-filter:blur(20px)}
.header-inner{max-width:700px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:52px}
.brand{font-size:17px;font-weight:700;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:8px}
.brand i{color:var(--blue)}
.back-btn{display:flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--line);border-radius:20px;padding:6px 14px;font-family:'El Messiri',sans-serif;font-size:13px;font-weight:500;color:var(--ink2);text-decoration:none;transition:all 0.15s}
.back-btn:hover{background:var(--bg3)}

.profile-wrap{max-width:520px;margin:60px auto 40px;padding:0 24px}
.profile-card{background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);padding:40px 32px;box-shadow:var(--shadow);text-align:center}

.avatar-wrap{position:relative;display:inline-block;margin-bottom:20px}
.avatar{width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid var(--line)}
.avatar-initial{width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,#0071e3,#34aadc);display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;color:#fff;border:3px solid var(--line);margin:0 auto 20px}
.rank-badge{position:absolute;bottom:0;left:50%;transform:translateX(-50%);background:${rankColor};color:#fff;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.15)}

.profile-name{font-size:26px;font-weight:700;letter-spacing:-0.5px;margin-bottom:6px}
.profile-country{font-size:14px;color:var(--ink3);margin-bottom:24px}

.stats-row{display:flex;gap:12px;margin-bottom:24px;justify-content:center}
.stat-box{flex:1;max-width:140px;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:14px 10px}
.stat-val{font-size:24px;font-weight:700;color:var(--ink)}
.stat-lbl{font-size:12px;color:var(--ink3);margin-top:2px}

.info-row{display:flex;align-items:center;gap:10px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:12px 16px;font-size:14px;color:var(--ink2);margin-bottom:12px;text-align:right}
.info-row i{color:var(--blue);font-size:14px;flex-shrink:0}

/* ── رف الجوائز ── */
.awards-shelf{margin:20px 0 4px;text-align:right}
.awards-shelf-title{font-size:14px;font-weight:700;color:var(--ink2);margin-bottom:12px;display:flex;align-items:center;gap:7px}
.awards-shelf-title i{color:#b5882e}
.awards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
.award-card{border-radius:14px;overflow:hidden;border:1.5px solid var(--line);background:var(--bg);box-shadow:0 1px 8px rgba(0,0,0,0.06);transition:transform 0.2s,box-shadow 0.2s}
.award-card:hover{transform:translateY(-3px);box-shadow:0 6px 20px rgba(0,0,0,0.1)}
.award-img{width:100%;height:auto;display:block;object-fit:cover}
.award-info{padding:7px 8px 9px;background:var(--bg2);border-top:1px solid var(--line)}
.award-name{font-size:11px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.award-section{font-size:10px;color:var(--ink3);margin-top:2px}
.award-badge-rare{display:inline-block;margin-top:3px;background:linear-gradient(135deg,#b5882e,#f0c040);color:#fff;border-radius:20px;padding:1px 7px;font-size:9px;font-weight:700}
.award-badge-legendary{display:inline-block;margin-top:3px;background:linear-gradient(135deg,#7b2ff7,#e040fb);color:#fff;border-radius:20px;padding:1px 7px;font-size:9px;font-weight:700}
.no-awards{text-align:center;color:var(--ink3);font-size:13px;padding:20px 0;background:var(--bg2);border:1px solid var(--line);border-radius:12px}
.no-awards i{display:block;font-size:24px;margin-bottom:6px;opacity:0.4}

.share-btn{width:100%;padding:12px;background:var(--blue);color:#fff;border:none;border-radius:10px;font-family:'El Messiri',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.15s;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px}
.share-btn:hover{background:#0077ed}
.share-btn:active{transform:scale(0.98)}

.error-card{text-align:center;padding:60px 24px;max-width:400px;margin:80px auto}
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

${user ? renderProfile({ name, email, points, country, avatar, initial, rank, rankColor, slugSafe, awards }) : renderError(error)}

<script>
function shareProfile() {
  const url = 'https://dawry-el-3bakera.vercel.app/abqari/${encodeURIComponent(slugSafe)}';
  const text = '${name} في دوري العباقرة - نقاط: ${points} | الترتيب: #${rank}';
  if (navigator.share) {
    navigator.share({ title: '${name} | دوري العباقرة', text, url });
  } else {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('.share-btn');
      btn.innerHTML = '<i class="fa-solid fa-check"></i> تم نسخ الرابط!';
      setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> شارك الصفحة', 2000);
    });
  }
}
</script>
</body>
</html>`;
}

function renderProfile({ name, email, points, country, avatar, initial, rank, slugSafe, awards }) {
  const pts = parseInt(points).toLocaleString('ar-EG');

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
    awardsHtml = `
    <div class="awards-shelf">
      <div class="awards-shelf-title"><i class="fa-solid fa-trophy"></i> رف الجوائز (${awards.length})</div>
      <div class="awards-grid">${cardsHtml}</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">`;
  } else {
    awardsHtml = `
    <div class="awards-shelf">
      <div class="awards-shelf-title"><i class="fa-solid fa-trophy"></i> رف الجوائز</div>
      <div class="no-awards"><i class="fa-solid fa-trophy"></i>لا توجد جوائز بعد</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">`;
  }

  return `
<div class="profile-wrap">
  <div class="profile-card">

    <div class="avatar-wrap">
      ${avatar
        ? `<img class="avatar" src="${avatar}" alt="${name}">`
        : `<div class="avatar-initial">${initial}</div>`
      }
      ${rank ? `<div class="rank-badge">${rank === 1 ? '👑' : ''}#${rank}</div>` : ''}
    </div>

    <div class="profile-name">${name}</div>
    ${country ? `<div class="profile-country">${country}</div>` : ''}

    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-val">${pts}</div>
        <div class="stat-lbl"><i class="fa-solid fa-ranking-star" style="margin-left:3px;color:#0071e3;font-size:10px"></i> نقطة</div>
      </div>
      ${rank ? `<div class="stat-box"><div class="stat-val">#${rank}</div><div class="stat-lbl">الترتيب</div></div>` : ''}
    </div>

    ${awardsHtml}

    ${email ? `<div class="info-row"><i class="fa-solid fa-envelope"></i><span>${email}</span></div>` : ''}

    <div class="info-row">
      <i class="fa-solid fa-link"></i>
      <span style="font-size:12px;color:var(--ink3);word-break:break-all">
        dawry-el-3bakera.vercel.app/abqari/${slugSafe}
      </span>
    </div>

    <button class="share-btn" onclick="shareProfile()">
      <i class="fa-solid fa-share-nodes"></i> شارك الصفحة
    </button>

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

<?php
// ============================================================
// abqari/[slug].php  →  https://dawry-el-3bakera.vercel.app/abqari/ahmed-ameen
// ملف: abqari/index.php  (يتعامل مع ?slug= أو عبر .htaccess / vercel.json)
// ============================================================

$SB_URL = 'https://spbbtsrabohqaspqzsph.supabase.co';
$SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwYmJ0c3JhYm9ocWFzcHF6c3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTk4ODEsImV4cCI6MjA5MzYzNTg4MX0.SfgtGV2RpvmpthbR9D036bXWJZdBkDQFrUJbqsOjHsI';

// استخراج الـ slug من الـ URL
// vercel.json يحوّل /abqari/ahmed-ameen → /abqari/index.php?slug=ahmed-ameen
$slug = isset($_GET['slug']) ? trim($_GET['slug']) : '';

$user = null;
$rank = null;
$error = '';

if ($slug) {
    // جلب المستخدم من Supabase
    $url = $SB_URL . '/rest/v1/system?slug=eq.' . urlencode($slug)
         . '&select=id,name,email,points,country,avatar';
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . $SB_KEY,
            'Authorization: Bearer ' . $SB_KEY,
            'Content-Type: application/json',
        ]
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    
    $data = json_decode($res, true);
    if (!empty($data[0])) {
        $user = $data[0];
        
        // حساب الترتيب: كم شخص نقاطه أكثر منه
        $rankUrl = $SB_URL . '/rest/v1/system?points=gt.' . intval($user['points'])
                 . '&select=id&order=points.desc';
        $ch2 = curl_init($rankUrl);
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'apikey: ' . $SB_KEY,
                'Authorization: Bearer ' . $SB_KEY,
                'Prefer: count=exact',
                'Range: 0-0',
            ]
        ]);
        $rankRes = curl_exec($ch2);
        $rankHeaders = curl_getinfo($ch2, CURLINFO_HEADER_SIZE);
        // Supabase يرجع Content-Range header
        $headerStr = '';
        curl_setopt($ch2, CURLOPT_HEADER, true);
        curl_close($ch2);
        
        // طريقة أبسط للرانك: عدّ من نقاطه أكبر + 1
        $rankData = json_decode($rankRes, true);
        $rank = (is_array($rankData) ? count($rankData) : 0) + 1;
    } else {
        $error = 'لم يُعثر على هذا الحساب';
    }
} else {
    $error = 'رابط غير صحيح';
}

// بيانات للعرض
$name    = htmlspecialchars($user['name'] ?? 'غير معروف');
$email   = htmlspecialchars($user['email'] ?? '');
$points  = intval($user['points'] ?? 0);
$country = htmlspecialchars($user['country'] ?? '');
$avatar  = htmlspecialchars($user['avatar'] ?? '');
$initial = mb_substr($name, 0, 1, 'UTF-8');

// لون الرانك
$rankColor = '#0071e3';
if ($rank == 1) $rankColor = '#f0c040';
elseif ($rank == 2) $rankColor = '#aaa';
elseif ($rank == 3) $rankColor = '#cd7f32';
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= $user ? $name . ' | دوري العباقرة' : 'حساب غير موجود | دوري العباقرة' ?></title>
<meta name="description" content="<?= $user ? 'صفحة ' . $name . ' في دوري العباقرة - نقاط: ' . $points : 'حساب غير موجود' ?>">

<!-- Open Graph (للمشاركة على سوشيال ميديا) -->
<meta property="og:title" content="<?= $user ? $name . ' | دوري العباقرة' : 'دوري العباقرة' ?>">
<meta property="og:description" content="<?= $user ? $name . ' - نقاط الصدارة: ' . $points . ' | الترتيب: #' . $rank : '' ?>">
<meta property="og:url" content="https://dawry-el-3bakera.vercel.app/abqari/<?= urlencode($slug) ?>">
<meta property="og:image" content="<?= $avatar ?: 'https://dawry-el-3bakera.vercel.app/icon.png' ?>">

<link rel="icon" type="image/png" href="/icon.png">
<link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

<style>
:root {
  --bg: #ffffff; --bg2: #f5f5f7; --bg3: #e8e8ed;
  --ink: #1d1d1f; --ink2: #3d3d3f; --ink3: #6e6e73;
  --line: #d2d2d7; --blue: #0071e3;
  --radius: 18px; --shadow: 0 2px 20px rgba(0,0,0,0.08);
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'El Messiri', sans-serif;
  background: var(--bg); color: var(--ink);
  min-height: 100vh;
}

/* HEADER */
header {
  border-bottom: 1px solid var(--line);
  padding: 0 24px;
  background: rgba(255,255,255,0.9);
  backdrop-filter: blur(20px);
}
.header-inner {
  max-width: 700px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  height: 52px;
}
.brand { font-size: 17px; font-weight: 700; color: var(--ink); text-decoration: none; display: flex; align-items: center; gap: 8px; }
.brand i { color: var(--blue); }
.back-btn {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg2); border: 1px solid var(--line);
  border-radius: 20px; padding: 6px 14px;
  font-family: 'El Messiri', sans-serif;
  font-size: 13px; font-weight: 500; color: var(--ink2);
  text-decoration: none; transition: all 0.15s;
}
.back-btn:hover { background: var(--bg3); }

/* PROFILE CARD */
.profile-wrap {
  max-width: 520px; margin: 60px auto 40px; padding: 0 24px;
}
.profile-card {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 40px 32px;
  box-shadow: var(--shadow);
  text-align: center;
}

/* AVATAR */
.avatar-wrap { position: relative; display: inline-block; margin-bottom: 20px; }
.avatar {
  width: 100px; height: 100px; border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--line);
}
.avatar-initial {
  width: 100px; height: 100px; border-radius: 50%;
  background: linear-gradient(135deg, #0071e3, #34aadc);
  display: flex; align-items: center; justify-content: center;
  font-size: 38px; font-weight: 700; color: #fff;
  border: 3px solid var(--line);
  margin: 0 auto 20px;
}
.rank-badge {
  position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
  background: <?= $rankColor ?>; color: #fff;
  border-radius: 20px; padding: 3px 10px;
  font-size: 12px; font-weight: 700;
  white-space: nowrap; border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.profile-name { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6px; }
.profile-country { font-size: 14px; color: var(--ink3); margin-bottom: 24px; }

/* STATS */
.stats-row {
  display: flex; gap: 12px; margin-bottom: 24px; justify-content: center;
}
.stat-box {
  flex: 1; max-width: 140px;
  background: var(--bg2); border: 1px solid var(--line);
  border-radius: 12px; padding: 14px 10px;
}
.stat-val { font-size: 24px; font-weight: 700; color: var(--ink); }
.stat-lbl { font-size: 12px; color: var(--ink3); margin-top: 2px; }

/* INFO ROW */
.info-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg2); border: 1px solid var(--line);
  border-radius: 10px; padding: 12px 16px;
  font-size: 14px; color: var(--ink2);
  margin-bottom: 12px; text-align: right;
}
.info-row i { color: var(--blue); font-size: 14px; flex-shrink: 0; }

/* SHARE */
.share-btn {
  width: 100%; padding: 12px;
  background: var(--blue); color: #fff;
  border: none; border-radius: 10px;
  font-family: 'El Messiri', sans-serif;
  font-size: 15px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; margin-top: 8px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.share-btn:hover { background: #0077ed; }
.share-btn:active { transform: scale(0.98); }

/* ERROR */
.error-card {
  text-align: center; padding: 60px 24px;
  max-width: 400px; margin: 80px auto;
}
.error-card .icon { font-size: 48px; margin-bottom: 16px; color: var(--ink3); }
.error-card h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.error-card p { color: var(--ink3); font-size: 15px; margin-bottom: 24px; }
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <a class="brand" href="/"><i class="fa-solid fa-trophy"></i> دوري العباقرة</a>
    <a class="back-btn" href="/"><i class="fa-solid fa-arrow-right"></i> الصفحة الرئيسية</a>
  </div>
</header>

<?php if ($user): ?>
<div class="profile-wrap">
  <div class="profile-card">
    
    <!-- AVATAR -->
    <div class="avatar-wrap">
      <?php if ($avatar): ?>
        <img class="avatar" src="<?= $avatar ?>" alt="<?= $name ?>">
      <?php else: ?>
        <div class="avatar-initial"><?= $initial ?></div>
      <?php endif; ?>
      <?php if ($rank): ?>
        <div class="rank-badge">
          <?php if ($rank == 1): ?>👑<?php endif; ?>
          #<?= $rank ?>
        </div>
      <?php endif; ?>
    </div>

    <div class="profile-name"><?= $name ?></div>
    <?php if ($country): ?>
      <div class="profile-country"><?= $country ?></div>
    <?php endif; ?>

    <!-- STATS -->
    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-val"><?= number_format($points) ?></div>
        <div class="stat-lbl"><i class="fa-solid fa-ranking-star" style="margin-left:3px;color:#0071e3;font-size:10px"></i> نقطة</div>
      </div>
      <?php if ($rank): ?>
      <div class="stat-box">
        <div class="stat-val">#<?= $rank ?></div>
        <div class="stat-lbl">الترتيب</div>
      </div>
      <?php endif; ?>
    </div>

    <!-- INFO -->
    <?php if ($email): ?>
    <div class="info-row">
      <i class="fa-solid fa-envelope"></i>
      <span><?= $email ?></span>
    </div>
    <?php endif; ?>

    <div class="info-row">
      <i class="fa-solid fa-link"></i>
      <span style="font-size:12px;color:var(--ink3);word-break:break-all">
        dawry-el-3bakera.vercel.app/abqari/<?= htmlspecialchars($slug) ?>
      </span>
    </div>

    <!-- SHARE -->
    <button class="share-btn" onclick="shareProfile()">
      <i class="fa-solid fa-share-nodes"></i> شارك الصفحة
    </button>

  </div>
</div>

<?php else: ?>
<div class="error-card">
  <div class="icon"><i class="fa-solid fa-user-slash"></i></div>
  <h2>الحساب غير موجود</h2>
  <p><?= htmlspecialchars($error) ?></p>
  <a href="/" style="display:inline-flex;align-items:center;gap:8px;background:var(--blue);color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600">
    <i class="fa-solid fa-house"></i> العودة للرئيسية
  </a>
</div>
<?php endif; ?>

<script>
function shareProfile() {
  const url = 'https://dawry-el-3bakera.vercel.app/abqari/<?= urlencode($slug) ?>';
  const text = '<?= $name ?> في دوري العباقرة - نقاط: <?= $points ?> | الترتيب: #<?= $rank ?>';
  if (navigator.share) {
    navigator.share({ title: '<?= $name ?> | دوري العباقرة', text, url });
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
</html>

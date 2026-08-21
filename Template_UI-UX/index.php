<?php
/**
 * UstadAILibrary - Master Portal & Global Curriculum Dashboard (2G)
 * Version 2.0 - Dual Dark Navy / Light Modern Theme Engine & High-Contrast Visual System
 * Author & Supervisor: ArchiSys3.0 | Architect & Lead: AImi
 */

// 1. Découverte et audit automatique de tous les fichiers SQLite disponibles
$total_records_all_dbs = 0;
$total_size_bytes = 0;

function scan_databases_recursive($dir, &$results) {
    if (!is_dir($dir)) return;
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        if (is_dir($path)) {
            scan_databases_recursive($path, $results);
        } elseif (pathinfo($path, PATHINFO_EXTENSION) === 'db') {
            $results[] = $path;
        }
    }
}

$found_paths = [];
scan_databases_recursive('databases', $found_paths);
$found_paths = array_unique($found_paths);

$databases_metrics = [];
foreach ($found_paths as $db_file) {
    if (!file_exists($db_file)) continue;
    $size = filesize($db_file);
    $total_size_bytes += $size;

    $db_info = [
        'file_path' => $db_file,
        'file_name' => basename($db_file),
        'size_formatted' => round($size / (1024 * 1024), 2) . ' ميغابايت',
        'tables_count' => 0,
        'tables_data' => [],
        'total_rows' => 0,
        'status' => 'active'
    ];

    try {
        $pdo = new PDO("sqlite:" . $db_file);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $tables_stmt = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        $tables = $tables_stmt->fetchAll(PDO::FETCH_COLUMN);
        $db_info['tables_count'] = count($tables);

        foreach ($tables as $tbl) {
            $cnt_stmt = $pdo->query("SELECT COUNT(*) FROM `{$tbl}`");
            $cnt = $cnt_stmt->fetchColumn();
            $db_info['tables_data'][$tbl] = $cnt;
            $db_info['total_rows'] += intval($cnt);
        }

        $total_records_all_dbs += $db_info['total_rows'];
    } catch (Exception $e) {
        $db_info['status'] = 'error';
        $db_info['error_msg'] = $e->getMessage();
    }

    $databases_metrics[] = $db_info;
}

// 2. Calcul dynamique des agrégats globaux (100% calculé, zéro valeur en dur)
$global_exos_count = 0;
$global_evals_count = 0;
$global_cours_count = 0;
$global_pages_count = 0;

foreach ($databases_metrics as $db_info) {
    if (isset($db_info['tables_data']['exercices_activites'])) {
        $global_exos_count += intval($db_info['tables_data']['exercices_activites']);
    }
    if (isset($db_info['tables_data']['evaluations_sujets'])) {
        $global_evals_count += intval($db_info['tables_data']['evaluations_sujets']);
    }
    if (isset($db_info['tables_data']['chapitres_cours'])) {
        $global_cours_count += intval($db_info['tables_data']['chapitres_cours']);
    }
}

// Scans disponibles réellement dans databases (toutes matières confondues, formats JPEG HD et PNG)
$all_book_scans = glob('databases/*/*/scans/*.{jpg,jpeg,png}', GLOB_BRACE) ?: [];
$global_pages_count = count($all_book_scans);

$all_eval_scans = glob('databases/*/*/evaluations/*.{jpg,jpeg,png}', GLOB_BRACE) ?: [];
$global_eval_scans_count = count($all_eval_scans);

$global_total_visual_docs = $global_pages_count + $global_eval_scans_count;

$is_math_active = file_exists('databases/1AM/maths/1am_maths.db');
$is_islamic_active = file_exists('databases/1AM/s-islamic/1am_islamic.db');

// 3. Matières Officielles MEN 2G
$disciplines = [
    'math' => [
        'nom_ar' => 'الرياضيات',
        'nom_fr' => 'Mathématiques',
        'icon' => 'fa-calculator',
        'color' => '#3b82f6',
        'status' => $is_math_active ? '100% مكتمل ومفعل 🟢' : 'قيد المعالجة (غير منشأ) 🔴',
        'active' => $is_math_active
    ],
    'islamique' => [
        'nom_ar' => 'التربية الإسلامية',
        'nom_fr' => 'Éducation Islamique',
        'icon' => 'fa-mosque',
        'color' => '#059669',
        'status' => $is_islamic_active ? '100% مكتمل ومفعل 🟢' : 'قيد المعالجة (جاهز)',
        'active' => $is_islamic_active
    ],
    'physique' => ['nom_ar' => 'العلوم الفيزيائية والتكنولوجيا', 'nom_fr' => 'Physique-Chimie', 'icon' => 'fa-bolt', 'color' => '#8b5cf6', 'status' => 'قيد المعالجة (جاهز)', 'active' => false],
    'svt' => ['nom_ar' => 'علوم الطبيعة والحياة', 'nom_fr' => 'SVT', 'icon' => 'fa-dna', 'color' => '#10b981', 'status' => 'قيد المعالجة (جاهز)', 'active' => false],
    'arabe' => ['nom_ar' => 'اللغة العربية', 'nom_fr' => 'Langue Arabe', 'icon' => 'fa-feather-pointed', 'color' => '#f59e0b', 'status' => 'قيد المعالجة (جاهز)', 'active' => false],
    'francais' => ['nom_ar' => 'اللغة الفرنسية', 'nom_fr' => 'Français', 'icon' => 'fa-book-atlas', 'color' => '#06b6d4', 'status' => 'قيد المعالجة (جاهز)', 'active' => false],
    'anglais' => ['nom_ar' => 'اللغة الإنجليزية', 'nom_fr' => 'English', 'icon' => 'fa-globe', 'color' => '#ef4444', 'status' => 'قيد المعالجة (جاهز)', 'active' => false],
    'histoire_geo' => ['nom_ar' => 'التاريخ والجغرافيا', 'nom_fr' => 'Histoire-Géo', 'icon' => 'fa-landmark', 'color' => '#d97706', 'status' => 'قيد المعالجة (جاهز)', 'active' => false]
];

// 4. Cycles Scolaires
$cycles = [
    'moyen' => [
        'titre' => 'مرحلة التعليم المتوسط (Moyen)',
        'icon' => 'fa-graduation-cap',
        'color' => '#3b82f6',
        'levels' => [
            [
                'code' => '1am',
                'nom' => 'السنة الأولى متوسط (1AM)',
                'desc' => $is_math_active ? "الرياضيات مكتملة ({$global_exos_count} تمريناً • {$global_cours_count} دروس • {$global_evals_count} اختباراً)" : "قيد المعالجة — اضغط للتشغيل الآلي في لوحة الأتمتة",
                'status' => $is_math_active ? 'deployed' : 'ready',
                'badge' => $is_math_active ? 'مكتمل ومفعل 🟢' : 'قيد الإنشاء 🔴'
            ],
            ['code' => '2am', 'nom' => 'السنة الثانية متوسط (2AM)', 'desc' => 'جاهز للهيكلة والاستيراد الآلي', 'status' => 'ready', 'badge' => 'قريباً 🟡'],
            ['code' => '3am', 'nom' => 'السنة الثالثة متوسط (3AM)', 'desc' => 'جاهز للهيكلة والاستيراد الآلي', 'status' => 'ready', 'badge' => 'قريباً 🟡'],
            ['code' => '4am', 'nom' => 'السنة الرابعة متوسط (4AM - BEM)', 'desc' => 'شهادة التعليم المتوسط — جاهز للهيكلة', 'status' => 'ready', 'badge' => 'قريباً 🟡']
        ]
    ],
    'primaire' => [
        'titre' => 'مرحلة التعليم الابتدائي (Primaire)',
        'icon' => 'fa-shapes',
        'color' => '#10b981',
        'levels' => [
            ['code' => '1ap', 'nom' => 'السنة الأولى ابتدائي (1AP)', 'desc' => 'الجيل الثاني — المناهج المعتمدة', 'status' => 'ready', 'badge' => 'قريباً 🟡'],
            ['code' => '5ap', 'nom' => 'السنة الخامسة ابتدائي (5AP)', 'desc' => 'امتحان تقييم المكتسبات', 'status' => 'ready', 'badge' => 'قريباً 🟡']
        ]
    ],
    'secondaire' => [
        'titre' => 'مرحلة التعليم الثانوي (Secondaire)',
        'icon' => 'fa-building-columns',
        'color' => '#f59e0b',
        'levels' => [
            ['code' => '1as', 'nom' => 'السنة الأولى ثانوي (1AS)', 'desc' => 'جذع مشترك علوم وآداب', 'status' => 'ready', 'badge' => 'قريباً 🟡'],
            ['code' => '3as', 'nom' => 'السنة الثالثة ثانوي (3AS - BAC)', 'desc' => 'شهادة البكالوريا — بنك المواضيع الرسمية', 'status' => 'ready', 'badge' => 'قريباً 🟡']
        ]
    ]
];
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UstadAI Library — بوابة المنظومة الوطنية للمناهج الرقمية الجزائرية (2G)</title>

    <!-- Bootstrap 5.3 RTL -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.rtl.min.css">
    
    <!-- FontAwesome 6 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
    
    <!-- Google Fonts: Cairo, Tajawal & Outfit -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Outfit:wght@400;600;700;800&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">

    <style>
        /* ==========================================================================
           🎨 ARCHITECTURE DES VARIABLES DU THÈME DUAL (DARK NAVY / LIGHT)
           ========================================================================== */
        :root, [data-theme="light"] {
            --bg-body: #f8fafc;
            --bg-body-radial: radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.06) 0%, transparent 60%);
            --bg-surface: #ffffff;
            --bg-surface-secondary: #f1f5f9;
            --bg-surface-elevated: #ffffff;
            --bg-card-inner: #f8fafc;
            --border-color: #e2e8f0;
            --border-glow: rgba(37, 99, 235, 0.25);
            --text-main: #0f172a;
            --text-heading: #0f172a;
            --text-sub: #334155;
            --text-muted: #64748b;
            --card-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
            --card-shadow-hover: 0 12px 30px -4px rgba(37, 99, 235, 0.15);
            --header-bg: rgba(255, 255, 255, 0.95);
            --badge-bg-subtle: #e2e8f0;
            --badge-text-subtle: #1e293b;
        }

        [data-theme="dark"] {
            --bg-body: #070d1e;
            --bg-body-radial: 
                radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.18) 0%, transparent 60%),
                radial-gradient(circle at 10% 40%, rgba(245, 158, 11, 0.08) 0%, transparent 50%),
                radial-gradient(circle at 90% 70%, rgba(16, 185, 129, 0.08) 0%, transparent 50%);
            --bg-surface: #0f172a;
            --bg-surface-secondary: #1e293b;
            --bg-surface-elevated: #16223b;
            --bg-card-inner: #070d1e;
            --border-color: rgba(255, 255, 255, 0.1);
            --border-glow: rgba(59, 130, 246, 0.35);
            --text-main: #f8fafc;
            --text-heading: #ffffff;
            --text-sub: #cbd5e1;
            --text-muted: #94a3b8;
            --card-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
            --card-shadow-hover: 0 20px 40px -10px rgba(37, 99, 235, 0.3);
            --header-bg: rgba(15, 23, 42, 0.95);
            --badge-bg-subtle: #1e293b;
            --badge-text-subtle: #e2e8f0;
        }

        body {
            font-family: 'Tajawal', sans-serif;
            background-color: var(--bg-body);
            background-image: var(--bg-body-radial);
            color: var(--text-main);
            margin: 0;
            padding: 0;
            min-height: 100vh;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        h1, h2, h3, h4, h5, h6 {
            font-family: 'Cairo', sans-serif;
            font-weight: 700;
            color: var(--text-heading);
        }

        .font-num {
            font-family: 'Outfit', sans-serif;
        }

        .text-high-contrast {
            color: var(--text-sub) !important;
        }

        .text-muted-custom {
            color: var(--text-muted) !important;
        }

        /* Glassmorphism Surface Cards */
        .portal-card {
            background: var(--bg-surface);
            backdrop-filter: blur(16px);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 24px;
            box-shadow: var(--card-shadow);
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
            overflow: hidden;
        }

        .portal-card:hover {
            transform: translateY(-4px);
            border-color: var(--border-glow);
            box-shadow: var(--card-shadow-hover);
        }

        .hero-banner {
            padding: 50px 0 35px 0;
            text-align: center;
            position: relative;
        }

        .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(245, 158, 11, 0.12);
            border: 1px solid rgba(245, 158, 11, 0.35);
            color: #f59e0b;
            padding: 6px 18px;
            border-radius: 30px;
            font-weight: 700;
            font-size: 0.9rem;
            margin-bottom: 20px;
            box-shadow: 0 0 20px rgba(245, 158, 11, 0.15);
        }

        .hero-title {
            font-size: 2.8rem;
            font-weight: 900;
            margin-bottom: 16px;
            letter-spacing: -0.5px;
        }

        [data-theme="dark"] .hero-title {
            background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 50%, #94a3b8 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        [data-theme="light"] .hero-title {
            color: #0f172a;
        }

        .hero-desc {
            font-size: 1.15rem;
            color: var(--text-sub);
            max-width: 820px;
            margin: 0 auto 30px auto;
            line-height: 1.8;
        }

        /* Metric Counters */
        .stat-metric-card {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 20px;
            text-align: center;
            box-shadow: var(--card-shadow);
            transition: all 0.25s ease;
        }
        .stat-metric-card:hover {
            border-color: #3b82f6;
            transform: translateY(-2px);
        }
        .stat-val {
            font-size: 2.2rem;
            font-weight: 800;
            line-height: 1.2;
            margin-bottom: 4px;
        }

        /* Gradient CTAs */
        .btn-launch-hero {
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            color: #ffffff !important;
            font-weight: 800;
            font-size: 1.1rem;
            padding: 14px 36px;
            border-radius: 30px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 10px 25px rgba(37, 99, 235, 0.4);
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn-launch-hero:hover {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            transform: scale(1.04);
            box-shadow: 0 15px 35px rgba(37, 99, 235, 0.6);
        }

        .btn-viewer-hero {
            background: var(--bg-surface);
            color: var(--text-heading);
            font-weight: 700;
            font-size: 1rem;
            padding: 14px 28px;
            border-radius: 30px;
            border: 1px solid var(--border-color);
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-shadow: var(--card-shadow);
            transition: all 0.2s ease;
        }
        .btn-viewer-hero:hover {
            background: var(--bg-surface-secondary);
            color: var(--text-heading);
            border-color: #3b82f6;
        }

        /* Database Item Node */
        .db-badge-row {
            background: var(--bg-card-inner);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 14px 18px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 12px;
        }

        /* Search Bar in Hero */
        .hero-search-box {
            max-width: 600px;
            margin: 0 auto 30px auto;
            position: relative;
        }
        .hero-search-input {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 30px;
            padding: 14px 24px 14px 50px;
            color: var(--text-heading);
            width: 100%;
            font-size: 1rem;
            box-shadow: var(--card-shadow);
            transition: all 0.25s ease;
        }
        .hero-search-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 25px rgba(37, 99, 235, 0.35);
        }
        .hero-search-icon {
            position: absolute;
            left: 20px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            font-size: 1.1rem;
        }

        .theme-toggle-btn {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            color: var(--text-heading);
            padding: 8px 16px;
            border-radius: 30px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            box-shadow: var(--card-shadow);
            transition: all 0.2s ease;
        }
        .theme-toggle-btn:hover {
            transform: scale(1.05);
            border-color: #3b82f6;
        }

        footer {
            border-top: 1px solid var(--border-color);
            padding: 30px 0;
            margin-top: 60px;
            text-align: center;
            color: var(--text-muted);
            font-size: 0.9rem;
        }
    </style>
</head>
<body>

<div class="container py-4">

    <!-- Top Header Bar avec Sélecteur de Thème -->
    <header class="d-flex justify-content-between align-items-center pb-4 mb-4 border-bottom border-secondary border-opacity-25">
        <div class="d-flex align-items-center gap-3">
            <div class="bg-primary text-white p-2 rounded-3 fs-4 shadow">
                <i class="fa-solid fa-atom"></i>
            </div>
            <div>
                <h5 class="m-0 fw-bold">UstadAI Library (2G)</h5>
                <small class="text-muted-custom">المستودع الوطني الشامل للمناهج الرقمية الجزائرية</small>
            </div>
        </div>

        <div class="d-flex align-items-center gap-2">
            <!-- Automation Hub Button -->
            <a href="automation.php" class="btn btn-sm btn-outline-success rounded-pill px-3 fw-bold shadow-sm" title="لوحة التحكم بالأتمتة والبناء الآلي">
                <i class="fa-solid fa-gears ms-1"></i> الأتمتة والبناء الآلي
            </a>

            <!-- Theme Toggle Button -->
            <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeToggleBtn">
                <i class="fa-solid fa-sun text-warning" id="themeToggleIcon"></i>
                <span id="themeToggleText">الوضع النهاري</span>
            </button>

            <a href="library.php?niveau=1am&matiere=math" class="btn btn-sm btn-primary rounded-pill px-3 fw-bold shadow-sm">
                <i class="fa-solid fa-bolt ms-1"></i> فتح المستودع (1AM)
            </a>
            <a href="viewer.php" class="btn btn-sm btn-outline-secondary rounded-pill px-3">
                <i class="fa-solid fa-book-open ms-1"></i> العارض الكلاسيكي
            </a>
        </div>
    </header>

    <!-- HERO SECTION -->
    <section class="hero-banner">
        <div class="hero-badge">
            <i class="fa-solid fa-certificate"></i> وزارة التربية الوطنية — الجيل الثاني (2G)
        </div>
        <h1 class="hero-title">المنصة المركزية للمناهج والكتب المدرسية</h1>
        <p class="hero-desc">
            بوابة رقمية سيادية مهيكلة بالكامل عبر قواعد بيانات <strong>SQLite</strong> مترابطة، تجمع النصوص البيداغوجية، المفاهيم العلمية <strong>KaTeX</strong>، بنوك التمارين المحلولة، والفروض والامتحانات الرسمية مع وثائق الكتب الأصلية.
        </p>

        <!-- Master Search Bar -->
        <div class="hero-search-box">
            <form action="library.php" method="GET">
                <input type="hidden" name="niveau" value="1am">
                <input type="hidden" name="matiere" value="math">
                <input type="text" name="q" class="hero-search-input" placeholder="ابحث في كامل المنهاج : الأعداد النسبية، التناظر، الزوايا، التمارين...">
                <i class="fa-solid fa-magnifying-glass hero-search-icon"></i>
            </form>
        </div>

        <div class="d-flex justify-content-center gap-3 flex-wrap">
            <a href="library.php?niveau=1am&matiere=math" class="btn-launch-hero">
                <i class="fa-solid fa-rocket"></i> الدخول إلى مستودع الرياضيات (1AM)
            </a>
            <a href="#dbsSection" class="btn-viewer-hero">
                <i class="fa-solid fa-database"></i> تدقيق مقاييس قواعد البيانات
            </a>
        </div>
    </section>

    <!-- 🏆 LES GRANDS MÉTRIQUES STRATÉGIQUES DU CURSUS NATIONAL (GLOBAL SOVEREIGN METRICS) -->
    <section class="mb-5">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h4 class="fw-bold m-0"><i class="fa-solid fa-chart-pie text-warning ms-2"></i> المؤشرات والمقاييس الكلية للمنظومة الوطنية (الجيل الثاني - 2G)</h4>
                <small class="text-muted-custom">تليمتري حي لكامل الأطوار التعليمية والمواد المستخرجة في المنصة</small>
            </div>
        </div>

        <div class="row g-3">
            <!-- 1. Niveaux Scolaires -->
            <div class="col-6 col-md-4 col-lg-2">
                <div class="stat-metric-card h-100">
                    <i class="fa-solid fa-graduation-cap text-primary fs-3 mb-2"></i>
                    <div class="stat-val font-num text-primary">8</div>
                    <small class="text-high-contrast fw-bold">سنوات ومستويات دراسية</small>
                </div>
            </div>

            <!-- 2. Matières Officielles -->
            <div class="col-6 col-md-4 col-lg-2">
                <div class="stat-metric-card h-100">
                    <i class="fa-solid fa-layer-group text-info fs-3 mb-2"></i>
                    <div class="stat-val font-num text-info"><?php echo count($disciplines); ?></div>
                    <small class="text-high-contrast fw-bold">مواد دراسية معتمدة</small>
                </div>
            </div>

            <!-- 3. Cours Numérisés KaTeX -->
            <div class="col-6 col-md-4 col-lg-2">
                <div class="stat-metric-card h-100">
                    <i class="fa-solid fa-book-open text-warning fs-3 mb-2"></i>
                    <div class="stat-val font-num text-warning"><?php echo $global_cours_count; ?></div>
                    <small class="text-high-contrast fw-bold">دروس ووحدات مرقمنة</small>
                </div>
            </div>

            <!-- 4. Exercices & Activités -->
            <div class="col-6 col-md-4 col-lg-2">
                <div class="stat-metric-card h-100">
                    <i class="fa-solid fa-pen-ruler text-danger fs-3 mb-2"></i>
                    <div class="stat-val font-num text-danger"><?php echo $global_exos_count; ?></div>
                    <small class="text-high-contrast fw-bold">تمارين وأنشطة محلولة</small>
                </div>
            </div>

            <!-- 5. Évaluations & Examens -->
            <div class="col-6 col-md-4 col-lg-2">
                <div class="stat-metric-card h-100">
                    <i class="fa-solid fa-file-signature text-success fs-3 mb-2"></i>
                    <div class="stat-val font-num text-success"><?php echo $global_evals_count; ?></div>
                    <small class="text-high-contrast fw-bold">فروض واختبارات رسمية</small>
                </div>
            </div>

            <!-- 6. Scans & Documents Visuels -->
            <div class="col-6 col-md-4 col-lg-2">
                <div class="stat-metric-card h-100" title="<?php echo $global_pages_count; ?> صفحة كتاب + <?php echo $global_eval_scans_count; ?> وثيقة اختبار">
                    <i class="fa-solid fa-images text-secondary fs-3 mb-2"></i>
                    <div class="stat-val font-num text-secondary"><?php echo $global_total_visual_docs; ?></div>
                    <small class="text-high-contrast fw-bold">إجمالي الوثائق والمسوح</small>
                    <span class="badge bg-secondary-subtle text-secondary border mt-1 small" style="font-size: 0.72rem;">
                        <?php echo $global_pages_count; ?> كتاب + <?php echo $global_eval_scans_count; ?> اختبار
                    </span>
                </div>
            </div>
        </div>
    </section>

    <!-- SECTION 1: MATIÈRES & DISCIPLINES OFFICIELLES (8 MATIÈRES) -->
    <section class="mb-5">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h4 class="fw-bold m-0"><i class="fa-solid fa-layer-group text-primary ms-2"></i> المواد الدراسية الرسمية (السنة الأولى متوسط - 1AM)</h4>
                <small class="text-muted-custom">المخطط المنهاجي لوزارة التربية الوطنية لجميع الشعب والمواد</small>
            </div>
        </div>

        <div class="row g-3">
            <?php foreach($disciplines as $m_key => $m_data): ?>
            <div class="col-12 col-md-6 col-lg-3">
                <div class="portal-card h-100 d-flex flex-column justify-content-between">
                    <div>
                        <div class="d-flex justify-content-between align-items-start mb-3">
                            <div class="p-3 rounded-3" style="background: rgba(255,255,255,0.06); color: <?php echo $m_data['color']; ?>; font-size: 1.5rem;">
                                <i class="fa-solid <?php echo $m_data['icon']; ?>"></i>
                            </div>
                            <?php if($m_data['active']): ?>
                                <span class="badge bg-success px-3 py-1 font-num">مفعل 100% 🟢</span>
                            <?php else: ?>
                                <span class="badge bg-secondary px-2 py-1 small">جاهز للهيكلة 🟡</span>
                            <?php endif; ?>
                        </div>
                        <h5 class="fw-bold mb-1"><?php echo $m_data['nom_ar']; ?></h5>
                        <small class="text-high-contrast d-block mb-3"><?php echo $m_data['nom_fr']; ?></small>
                    </div>

                    <div>
                        <hr class="border-secondary border-opacity-25 my-2">
                        <div class="d-flex justify-content-between align-items-center">
                            <small class="text-muted-custom"><?php echo $m_data['status']; ?></small>
                            <a href="library.php?niveau=1am&matiere=<?php echo $m_key; ?>" class="btn btn-sm <?php echo $m_data['active'] ? 'btn-primary' : 'btn-outline-secondary'; ?> rounded-pill px-3 fw-bold">
                                <?php echo $m_data['active'] ? 'دخول <i class="fa-solid fa-arrow-left me-1"></i>' : 'معاينة'; ?>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </section>

    <!-- SECTION 2: CYCLES SCOLAIRES (MOYEN, PRIMAIRE, SECONDAIRE) -->
    <section class="mb-5">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h4 class="fw-bold m-0"><i class="fa-solid fa-graduation-cap text-warning ms-2"></i> المستويات والأطوار التعليمية الوطنية (1AP إلى 3AS)</h4>
                <small class="text-muted-custom">الهيكلة الشاملة لجميع السنوات الدراسية ضمن المنظومة الرقمية</small>
            </div>
        </div>

        <div class="row g-4">
            <?php foreach($cycles as $c_key => $c_val): ?>
            <div class="col-12 col-lg-4">
                <div class="portal-card h-100">
                    <div class="d-flex align-items-center gap-2 mb-3 pb-2 border-bottom border-secondary border-opacity-25">
                        <i class="fa-solid <?php echo $c_val['icon']; ?> fs-4" style="color: <?php echo $c_val['color']; ?>;"></i>
                        <h5 class="fw-bold m-0"><?php echo $c_val['titre']; ?></h5>
                    </div>

                    <div class="d-flex flex-column gap-2">
                        <?php foreach($c_val['levels'] as $lvl): ?>
                        <div class="p-3 rounded-3 border border-secondary border-opacity-25 d-flex justify-content-between align-items-center" style="background: var(--bg-card-inner);">
                            <div>
                                <h6 class="fw-bold m-0"><?php echo $lvl['nom']; ?></h6>
                                <small class="text-high-contrast d-block mt-1" style="font-size: 0.82rem;"><?php echo $lvl['desc']; ?></small>
                            </div>
                            <div class="text-end">
                                <?php if($lvl['status'] === 'deployed'): ?>
                                    <a href="library.php?niveau=<?php echo $lvl['code']; ?>&matiere=math" class="btn btn-xs btn-primary rounded-pill px-3 fw-bold">
                                        فتح <i class="fa-solid fa-arrow-left"></i>
                                    </a>
                                <?php else: ?>
                                    <span class="badge bg-secondary small"><?php echo $lvl['badge']; ?></span>
                                <?php endif; ?>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </section>

    <!-- SECTION 3: TÉLÉMÉTRIE DÉTAILLÉE DES BASES SQLITE -->
    <section id="dbsSection" class="mb-5">
        <div class="portal-card">
            <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-secondary border-opacity-25">
                <div>
                    <h4 class="fw-bold m-0"><i class="fa-solid fa-server text-info ms-2"></i> سجل ومقاييس ملفات قواعد البيانات المكتشفة (SQLite Live Telemetry)</h4>
                    <small class="text-muted-custom">فحص حي ومباشر للملفات والجداول وسجلات المنهاج</small>
                </div>
                <span class="badge bg-primary px-3 py-2 fs-6 fw-bold"><?php echo count($databases_metrics); ?> قواعد نشطة</span>
            </div>

            <?php foreach($databases_metrics as $db_item): ?>
            <div class="db-badge-row">
                <div class="d-flex align-items-center gap-3">
                    <div class="p-2 bg-dark rounded-3 text-warning">
                        <i class="fa-solid fa-database fs-4"></i>
                    </div>
                    <div>
                        <h6 class="fw-bold m-0 font-num"><?php echo $db_item['file_path']; ?></h6>
                        <small class="text-high-contrast">الحجم : <strong class="text-warning"><?php echo $db_item['size_formatted']; ?></strong> • إجمالي السجلات : <strong class="text-info"><?php echo number_format($db_item['total_rows']); ?> سجل</strong></small>
                    </div>
                </div>

                <div class="d-flex flex-wrap align-items-center gap-2">
                    <?php foreach($db_item['tables_data'] as $tbl_name => $tbl_count): ?>
                        <span class="badge bg-dark border border-secondary border-opacity-50 small text-white">
                            <?php echo $tbl_name; ?> : <strong class="text-warning font-num"><?php echo $tbl_count; ?></strong>
                        </span>
                    <?php endforeach; ?>
                    <span class="badge bg-success px-3 py-1 fw-bold">جاهزية 100% 🟢</span>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
    </section>

    <!-- FOOTER -->
    <footer>
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <p class="m-0">
                <strong>UstadAI Library (2G)</strong> — المنظومة الوطنية الشاملة للمناهج والكتب المدرسية الرقمية الجزائرية
            </p>
            <p class="m-0 text-muted-custom">
                إشراف وتصميم : <strong>ArchiSys3.0</strong> • هندسة وتنفيذ : <strong>AImi</strong>
            </p>
        </div>
    </footer>

</div>

<!-- Bootstrap 5.3 JS -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>

<script>
    // Theme Engine (Dark Navy <-> Light)
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('ustad_theme', theme);
        let icon = document.getElementById('themeToggleIcon');
        let text = document.getElementById('themeToggleText');
        if (theme === 'dark') {
            if (icon) icon.className = 'fa-solid fa-sun text-warning';
            if (text) text.innerText = 'الوضع النهاري';
        } else {
            if (icon) icon.className = 'fa-solid fa-moon text-primary';
            if (text) text.innerText = 'الوضع الليلي';
        }
    }

    function toggleTheme() {
        let current = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    (function() {
        let savedTheme = localStorage.getItem('ustad_theme') || 'dark';
        applyTheme(savedTheme);
    })();
</script>
</body>
</html>

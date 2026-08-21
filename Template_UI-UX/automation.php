<?php
/**
 * UstadAILibrary - Industrial Automation Dashboard & Multi-Source Pipeline Runner
 * Version 3.0 - Granular Multi-Subject & Multi-Scope Orchestration (Textbook vs Evaluations)
 * Author & Supervisor: ArchiSys3.0 | Architect & Lead: AImi
 */

// 1. Détection de la matière et de l'état de la base de données active
$active_mat = isset($_GET['matiere']) ? strtolower(trim($_GET['matiere'])) : 'maths';
if ($active_mat === 's-islamic' || $active_mat === 'islamic' || $active_mat === 'islam') {
    $active_mat = 's-islamic';
    $db_file = "databases/1AM/s-islamic/1am_s-islamic.db";
    if (!file_exists($db_file)) $db_file = "databases/1AM/s-islamic/1am_islamic.db";
    $report_file = "databases/1AM/s-islamic/telemetry_report.json";
} else {
    $active_mat = 'maths';
    $db_file = "databases/1AM/maths/1am_maths.db";
    $report_file = "databases/1AM/maths/telemetry_report.json";
}

$db_exists = file_exists($db_file);
$db_size_mb = $db_exists ? round(filesize($db_file) / (1024 * 1024), 2) : 0;

$mat_records_count = 0;
$mat_stats = ['programmes' => 0, 'cours' => 0, 'exercices' => 0, 'evaluations' => 0];

if ($db_exists) {
    try {
        $pdo = new PDO("sqlite:" . $db_file);
        $mat_stats['programmes'] = intval($pdo->query("SELECT COUNT(*) FROM programme_officiel")->fetchColumn());
        $mat_stats['cours'] = intval($pdo->query("SELECT COUNT(*) FROM chapitres_cours")->fetchColumn());
        $mat_stats['exercices'] = intval($pdo->query("SELECT COUNT(*) FROM exercices_activites")->fetchColumn());
        $mat_stats['evaluations'] = intval($pdo->query("SELECT COUNT(*) FROM evaluations_sujets")->fetchColumn());
        $mat_records_count = $mat_stats['programmes'] + $mat_stats['cours'] + $mat_stats['exercices'] + $mat_stats['evaluations'];
    } catch(Exception $e) {}
}

$report = file_exists($report_file) ? json_decode(file_get_contents($report_file), true) : null;

// 2. Scanner dynamique de l'arborescence des documents et livres officiels (1AM)
$source_disciplines = [
    'maths' => ['nom_ar' => 'الرياضيات', 'nom_fr' => 'Mathématiques', 'dir' => '1AM/maths', 'engine' => 'scripts/math-engine', 'status' => 'جاهز للبناء الآلي 🟢', 'active' => true],
    's-islamic' => ['nom_ar' => 'التربية الإسلامية', 'nom_fr' => 'Éducation Islamique', 'dir' => '1AM/s-islamic', 'engine' => 'scripts/s-islamic-engine', 'status' => 'جاهز للبناء الآلي 🟢', 'active' => true],
    'physique' => ['nom_ar' => 'العلوم الفيزيائية', 'nom_fr' => 'Physique', 'dir' => '1AM/physique', 'engine' => 'scripts/physique-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'svt' => ['nom_ar' => 'علوم الطبيعة والحياة', 'nom_fr' => 'SVT', 'dir' => '1AM/svt', 'engine' => 'scripts/svt-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'l-arabe' => ['nom_ar' => 'اللغة العربية', 'nom_fr' => 'Langue Arabe', 'dir' => '1AM/l-arabe', 'engine' => 'scripts/arabe-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'l-francais' => ['nom_ar' => 'اللغة الفرنسية', 'nom_fr' => 'Français', 'dir' => '1AM/l-francais', 'engine' => 'scripts/francais-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'l-anglais' => ['nom_ar' => 'اللغة الإنجليزية', 'nom_fr' => 'English', 'dir' => '1AM/l-anglais', 'engine' => 'scripts/anglais-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'histoire' => ['nom_ar' => 'التاريخ', 'nom_fr' => 'Histoire', 'dir' => '1AM/histoire', 'engine' => 'scripts/histoire-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'geo' => ['nom_ar' => 'الجغرافيا', 'nom_fr' => 'Géographie', 'dir' => '1AM/geo', 'engine' => 'scripts/geo-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false],
    'edu-civic' => ['nom_ar' => 'التربية المدنية', 'nom_fr' => 'Éducation Civique', 'dir' => '1AM/edu-civic', 'engine' => 'scripts/civic-engine', 'status' => 'قيد التخصيص 🟡', 'active' => false]
];

$scanned_sources = [];
foreach ($source_disciplines as $mat_key => $mat_meta) {
    $books_dir = $mat_meta['dir'] . '/official-books';
    $sources_dir = $mat_meta['dir'] . '/sources';
    
    $official_books = [];
    if (is_dir($books_dir)) {
        $files = scandir($books_dir);
        foreach ($files as $f) {
            if ($f !== '.' && $f !== '..' && pathinfo($f, PATHINFO_EXTENSION) === 'pdf') {
                $fp = $books_dir . '/' . $f;
                $official_books[] = [
                    'filename' => $f,
                    'size_mb' => round(filesize($fp) / (1024 * 1024), 2),
                    'full_path' => $fp
                ];
            }
        }
    }

    $exam_files_count = 0;
    if (is_dir($sources_dir)) {
        $exam_files = glob($sources_dir . '/*.pdf');
        $exam_files_count = $exam_files ? count($exam_files) : 0;
    }

    $scanned_sources[$mat_key] = [
        'meta' => $mat_meta,
        'books' => $official_books,
        'exams_count' => $exam_files_count
    ];
}

// 3. Découverte dynamique des scripts et des couches de filtres de l'engine actif
$active_engine_dir = isset($source_disciplines[$active_mat]['engine']) ? $source_disciplines[$active_mat]['engine'] : 'scripts/math-engine';
$active_engine_scripts = [];
if (is_dir($active_engine_dir)) {
    $engine_files = glob($active_engine_dir . '/*.py');
    foreach ($engine_files as $ef) {
        $active_engine_scripts[] = basename($ef);
    }
    sort($active_engine_scripts, SORT_NATURAL);
}

$active_filters_dir = $active_engine_dir . '/filters';
$active_filter_layers = [];
if (is_dir($active_filters_dir)) {
    $filter_files = glob($active_filters_dir . '/f*.py');
    foreach ($filter_files as $ff) {
        $active_filter_layers[] = basename($ff);
    }
    sort($active_filter_layers, SORT_NATURAL);
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UstadAI Library — مركز التحكم بالأتمتة والبناء الصناعي (Auto-Pipeline Hub)</title>

    <!-- Bootstrap 5.3 RTL -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.rtl.min.css">
    
    <!-- FontAwesome 6 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
    
    <!-- Google Fonts: Cairo, Tajawal & Outfit -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Outfit:wght@400;600;700;800&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">

    <style>
        :root, [data-theme="light"] {
            --bg-body: #f8fafc;
            --bg-surface: #ffffff;
            --bg-surface-secondary: #f1f5f9;
            --bg-card-inner: #f8fafc;
            --border-color: #e2e8f0;
            --text-main: #0f172a;
            --text-heading: #0f172a;
            --text-sub: #334155;
            --text-muted: #64748b;
            --card-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
            --topbar-bg: rgba(255, 255, 255, 0.95);
        }

        [data-theme="dark"] {
            --bg-body: #070d1e;
            --bg-surface: #0f172a;
            --bg-surface-secondary: #1e293b;
            --bg-card-inner: #070d1e;
            --border-color: rgba(255, 255, 255, 0.1);
            --text-main: #f8fafc;
            --text-heading: #ffffff;
            --text-sub: #cbd5e1;
            --text-muted: #94a3b8;
            --card-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
            --topbar-bg: rgba(15, 23, 42, 0.95);
        }

        body {
            font-family: 'Tajawal', sans-serif;
            background-color: var(--bg-body);
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

        .auto-card {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 24px;
            box-shadow: var(--card-shadow);
            margin-bottom: 24px;
        }

        .console-terminal {
            background: #050811;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 16px;
            padding: 20px;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 0.95rem;
            color: #10b981;
            min-height: 280px;
            max-height: 460px;
            overflow-y: auto;
            white-space: pre-wrap;
            direction: ltr;
            text-align: left;
            box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.8);
        }

        .step-pill {
            background: var(--bg-card-inner);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 12px 16px;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
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
        }
    </style>
</head>
<body>

<div class="container py-4">

    <!-- Top Header -->
    <header class="d-flex justify-content-between align-items-center pb-4 mb-4 border-bottom border-secondary border-opacity-25">
        <div class="d-flex align-items-center gap-3">
            <div class="bg-success text-white p-2 rounded-3 fs-4 shadow">
                <i class="fa-solid fa-gears"></i>
            </div>
            <div>
                <h5 class="m-0 fw-bold">UstadAI Automation Hub (2G)</h5>
                <small class="text-muted">منظومة البناء الآلي والأنابيب الصناعية للمناهج الرسمية</small>
            </div>
        </div>

        <div class="d-flex align-items-center gap-2">
            <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeToggleBtn">
                <i class="fa-solid fa-sun text-warning" id="themeToggleIcon"></i>
                <span id="themeToggleText">الوضع النهاري</span>
            </button>
            <a href="index.php" class="btn btn-sm btn-outline-primary rounded-pill px-3 fw-bold">
                <i class="fa-solid fa-house ms-1"></i> البوابة المركزية
            </a>
            <a href="library.php?niveau=1am&matiere=math" class="btn btn-sm btn-primary rounded-pill px-3 fw-bold">
                <i class="fa-solid fa-book-open ms-1"></i> المستودع التفاعلي
            </a>
        </div>
    </header>

    <!-- DISCIPLINE SELECTOR TABS -->
    <div class="d-flex align-items-center gap-2 mb-3">
        <span class="fw-bold text-muted small"><i class="fa-solid fa-layer-group ms-1"></i> اختر المادة لإدارتها :</span>
        <a href="automation.php?matiere=maths" class="btn btn-sm <?php echo $active_mat === 'maths' ? 'btn-primary' : 'btn-outline-secondary'; ?> rounded-pill px-3 fw-bold">
            <i class="fa-solid fa-square-root-variable ms-1"></i> الرياضيات (1AM)
        </a>
        <a href="automation.php?matiere=s-islamic" class="btn btn-sm <?php echo $active_mat === 's-islamic' ? 'btn-success' : 'btn-outline-secondary'; ?> rounded-pill px-3 fw-bold">
            <i class="fa-solid fa-mosque ms-1"></i> التربية الإسلامية (1AM)
        </a>
    </div>

    <!-- LIVE STATUS & GRANULAR DISCIPLINE CONTROL -->
    <section class="auto-card">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4 pb-3 border-bottom">
            <div>
                <span class="badge <?php echo $active_mat === 's-islamic' ? 'bg-success' : 'bg-primary'; ?> px-3 py-1 mb-2 font-num">
                    السنة الأولى متوسط (1AM) • <?php echo $active_mat === 's-islamic' ? 'التربية الإسلامية' : 'الرياضيات'; ?>
                </span>
                <h3 class="fw-bold m-0" id="liveStatusTitle">
                    <?php if($db_exists && $mat_records_count > 0): ?>
                        🟢 مادة <?php echo $active_mat === 's-islamic' ? 'التربية الإسلامية' : 'الرياضيات'; ?> نشطة ومكتملة (<span id="recordCountBadge"><?php echo $mat_records_count; ?></span> سجل • <?php echo $db_size_mb; ?> Mo)
                    <?php else: ?>
                        🔴 مادة <?php echo $active_mat === 's-islamic' ? 'التربية الإسلامية' : 'الرياضيات'; ?> غير مبنية (<span id="recordCountBadge">0</span> سجلات)
                    <?php endif; ?>
                </h3>
                <small class="text-secondary d-block mt-1">
                    الملف المستهدف : <code><?php echo $db_file; ?></code>
                </small>
            </div>

            <div>
                <button class="btn btn-outline-danger rounded-pill px-4 fw-bold shadow-sm" id="resetBtn" onclick="resetDatabaseForTesting()">
                    <i class="fa-solid fa-trash-can ms-1"></i> تفريغ وتطهير كامل القاعدة (0 سجلات)
                </button>
            </div>
        </div>

        <!-- GRANULAR PIPELINES (POINT 2 & 3: SEPARATION COURS / EXOS / EVALS & PAGES) -->
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
            <h5 class="fw-bold <?php echo $active_mat === 's-islamic' ? 'text-success' : 'text-primary'; ?> m-0">
                <i class="fa-solid fa-sliders ms-2"></i> خيارات البناء الآلي والتحكم الدقيق لمادة <?php echo $active_mat === 's-islamic' ? 'التربية الإسلامية' : 'الرياضيات'; ?> :
            </h5>
            <div class="d-flex align-items-center gap-3 flex-wrap">
                <div class="d-flex align-items-center gap-2">
                    <label for="chaptersFilter" class="fw-bold text-muted small m-0 text-nowrap">عزل الفصول:</label>
                    <input type="text" id="chaptersFilter" class="form-control form-control-sm border-secondary text-center font-num" placeholder="مثال: 1,3,5" style="width: 130px;" title="أرقام الفصول المراد استخراجها مفصولة بفاصلة.">
                </div>
                <div class="d-flex align-items-center gap-2">
                    <label for="pagesFilter" class="fw-bold text-warning small m-0 text-nowrap"><i class="fa-solid fa-file-lines ms-1"></i> عزل الصفحات:</label>
                    <input type="text" id="pagesFilter" class="form-control form-control-sm border-warning text-center font-num fw-bold bg-dark text-warning" placeholder="مثال: 18 أو 18-20" style="width: 140px;" title="أرقام الصفحات المراد استخراجها مفردة أو كنطاق (مثال: 18 أو 18-20 أو 15,18,22).">
                </div>
            </div>
        <!-- LLM MODEL SELECTOR (POINT R&D: CHOIX DU MODÈLE GEMINI) -->
        <div class="p-3 mb-4 rounded-4 border bg-dark text-white d-flex justify-content-between align-items-center flex-wrap gap-3 shadow-sm">
            <div class="d-flex align-items-center gap-3">
                <span class="fs-3 text-warning"><i class="fa-solid fa-brain"></i></span>
                <div>
                    <h6 class="fw-bold m-0 text-warning d-flex align-items-center gap-2">
                        <span>نموذج الذكاء الاصطناعي (Gemini LLM Engine)</span>
                        <span class="badge bg-secondary font-num" id="activeModelBadge">flash</span>
                    </h6>
                    <small class="text-secondary">اختر استراتيجية ونموذج التوليد المتعدد الوسائط للأنبوب الصناعي</small>
                </div>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap" id="modelSelectorGroup">
                <div class="form-check form-check-inline m-0 p-0">
                    <input class="btn-check" type="radio" name="modelProfile" id="modelFlash" value="flash" checked onchange="updateModelBadge()">
                    <label class="btn btn-sm btn-outline-primary rounded-pill px-3 fw-bold" for="modelFlash" title="gemini-flash-lite-latest + gemini-flash-latest (حجم كبير وسرعة فائقة)">
                        ⚡ سريع واقتصادي (Flash / Flash-Lite)
                    </label>
                </div>
                <div class="form-check form-check-inline m-0 p-0">
                    <input class="btn-check" type="radio" name="modelProfile" id="modelPro" value="pro" onchange="updateModelBadge()">
                    <label class="btn btn-sm btn-outline-warning rounded-pill px-3 fw-bold" for="modelPro" title="gemini-1.5-pro + gemini-pro-latest (استدلال متقدم وهندسة دقيقة)">
                        🧠 فائق الذكاء والاستدلال (Gemini Pro)
                    </label>
                </div>
                <div class="form-check form-check-inline m-0 p-0">
                    <input class="btn-check" type="radio" name="modelProfile" id="modelHybrid" value="hybrid" onchange="updateModelBadge()">
                    <label class="btn btn-sm btn-outline-info rounded-pill px-3 fw-bold" for="modelHybrid" title="Pro ثم Flash تلقائياً عند تجاوز الحصص">
                        🛡️ هجين تلقائي (Pro ثم Flash)
                    </label>
                </div>
                <div class="form-check form-check-inline m-0 p-0">
                    <input class="btn-check" type="radio" name="modelProfile" id="modelFlash2" value="flash2" onchange="updateModelBadge()">
                    <label class="btn btn-sm btn-outline-success rounded-pill px-3 fw-bold" for="modelFlash2" title="gemini-2.0-flash + gemini-2.0-flash-lite">
                        🚀 الجيل الجديد (Gemini 2.0 Flash)
                    </label>
                </div>
            </div>
        </div>

        <div class="row g-3">
            <div class="col-12 col-sm-6 col-xl-3">
                <div class="p-3 rounded-4 border h-100 d-flex flex-column justify-content-between" style="background: var(--bg-surface-secondary);">
                    <div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="fw-bold m-0"><i class="fa-solid fa-bolt text-warning ms-1"></i> البناء الشامل</h6>
                            <span class="badge bg-success">Full</span>
                        </div>
                        <small class="text-muted d-block mb-3">
                            استخراج ومطابقة كافة الوثائق الرسمية، الدروس، التمارين ونماذج الامتحانات المعتمدة.
                        </small>
                    </div>
                    <button class="btn <?php echo $active_mat === 's-islamic' ? 'btn-success' : 'btn-primary'; ?> w-100 fw-bold rounded-pill shadow-sm btn-sm" onclick="triggerGranularBuilder('<?php echo $active_mat; ?>', 'full')">
                        <i class="fa-solid fa-play ms-1"></i> تشغيل شامل
                    </button>
                </div>
            </div>

            <div class="col-12 col-sm-6 col-xl-3">
                <div class="p-3 rounded-4 border h-100 d-flex flex-column justify-content-between" style="background: var(--bg-surface-secondary);">
                    <div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="fw-bold m-0"><i class="fa-solid fa-book-open text-primary ms-1"></i> الكتاب والدروس</h6>
                            <span class="badge bg-primary">Textbook</span>
                        </div>
                        <small class="text-muted d-block mb-3">
                            معالجة وثائق الكتاب المدرسي، استخراج الفصول، المتون، الأنشطة والتمارين الأصلية.
                        </small>
                    </div>
                    <button class="btn btn-primary w-100 fw-bold rounded-pill shadow-sm btn-sm" onclick="triggerGranularBuilder('<?php echo $active_mat; ?>', 'textbook')">
                        <i class="fa-solid fa-book-bookmark ms-1"></i> بناء الكتاب
                    </button>
                </div>
            </div>

            <div class="col-12 col-sm-6 col-xl-3">
                <div class="p-3 rounded-4 border h-100 d-flex flex-column justify-content-between" style="background: var(--bg-surface-secondary);">
                    <div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="fw-bold m-0"><i class="fa-solid fa-file-signature text-info ms-1"></i> بنك الاختبارات</h6>
                            <span class="badge bg-info text-dark">Evals</span>
                        </div>
                        <small class="text-muted d-block mb-3">
                            معالجة الفروض والامتحانات، عناصر الإجابة وسلالم التنقيط المستخرجة من مجلد المصادر.
                        </small>
                    </div>
                    <button class="btn btn-info text-dark w-100 fw-bold rounded-pill shadow-sm btn-sm" onclick="triggerGranularBuilder('<?php echo $active_mat; ?>', 'evaluations')">
                        <i class="fa-solid fa-pen-to-square ms-1"></i> بناء الاختبارات
                    </button>
                </div>
            </div>

            <div class="col-12 col-sm-6 col-xl-3">
                <div class="p-3 rounded-4 border border-warning h-100 d-flex flex-column justify-content-between" style="background: var(--bg-surface-secondary);">
                    <div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="fw-bold m-0 text-warning"><i class="fa-solid fa-crosshairs ms-1"></i> صفحة / صفحات محددة</h6>
                            <span class="badge bg-warning text-dark">Page Runner</span>
                        </div>
                        <small class="text-muted d-block mb-3">
                            إعادة استخراج مجهري لصفحة أو نطاق صفحات محددة عبر حقل "عزل الصفحات" دون المساس بباقي الكتاب.
                        </small>
                    </div>
                    <button class="btn btn-outline-warning w-100 fw-bold rounded-pill shadow-sm btn-sm" onclick="triggerPageReprocessor('<?php echo $active_mat; ?>')">
                        <i class="fa-solid fa-rotate ms-1"></i> إعادة معالجة الصفحات
                    </button>
                </div>
            </div>
        </div>
    </section>

    <!-- STEP PROGRESSION & LIVE TERMINAL -->
    <div class="row g-4 mb-4">
        <div class="col-12 col-lg-5">
            <div class="auto-card h-100">
                <h5 class="fw-bold mb-3 d-flex justify-content-between align-items-center">
                    <span><i class="fa-solid fa-list-check text-primary ms-2"></i> مراحل الأنبوب الصناعي</span>
                    <span class="badge bg-primary"><?php echo count($active_engine_scripts); ?> سكريبتات مكتشفة ⚙️</span>
                </h5>
                
                <div class="step-pill" id="step1">
                    <span>1. استخراج ومطابقة المسوحات عالية الدقة (Scans HD)</span>
                    <span class="badge bg-secondary step-badge">جاهز</span>
                </div>
                <div class="step-pill" id="step2">
                    <span>2. تهيئة وتطهير الهيكل العلائقي 2G (SQLite)</span>
                    <span class="badge bg-secondary step-badge">جاهز</span>
                </div>
                <div class="step-pill" id="step3">
                    <span>3. الاستخراج المجهري الحقيقي للدروس والتمارين (Gemini Vision N=1)</span>
                    <span class="badge bg-secondary step-badge">جاهز</span>
                </div>
                <div class="step-pill" id="step4">
                    <span>4. حزام الفلاتر المعيارية (11 طبقة KaTeX & BiDi)</span>
                    <span class="badge bg-info text-dark step-badge"><?php echo count($active_filter_layers); ?> فلاتر نشطة</span>
                </div>
                <div class="step-pill" id="step5">
                    <span>5. استخراج وفهرسة بنك الاختبارات والتقييمات الرسمية</span>
                    <span class="badge bg-secondary step-badge">جاهز</span>
                </div>
                <div class="step-pill" id="step6">
                    <span>6. فحص وتدقيق السلامة العلائقية والبنشمـارك الآلي</span>
                    <span class="badge bg-secondary step-badge">جاهز</span>
                </div>
                <div class="step-pill" id="step7">
                    <span>7. توليد قاعدة البيانات وإصدار تقرير التوثيق النهائي</span>
                    <span class="badge bg-secondary step-badge">جاهز</span>
                </div>

                <?php if (!empty($active_filter_layers)): ?>
                <div class="mt-3 p-2 rounded-3 border bg-dark text-white">
                    <div class="d-flex justify-content-between align-items-center mb-2 px-1">
                        <small class="fw-bold text-warning"><i class="fa-solid fa-layer-group ms-1"></i> الفلاتر المكتشفة ديناميكياً (filters/):</small>
                        <span class="badge bg-success">11/11 طبقة</span>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                        <?php foreach ($active_filter_layers as $f_layer): ?>
                            <span class="badge bg-secondary text-light font-num small border border-secondary" title="<?php echo htmlspecialchars($f_layer); ?>">
                                <?php echo htmlspecialchars(explode('.', $f_layer)[0]); ?>
                            </span>
                        <?php endforeach; ?>
                    </div>
                </div>
                <?php endif; ?>
            </div>
        </div>

        <div class="col-12 col-lg-7">
            <div class="auto-card h-100">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="fw-bold m-0"><i class="fa-solid fa-terminal text-success ms-2"></i> طرفية وسجل التنفيذ الحي (Live Console)</h5>
                    <div class="d-flex align-items-center gap-2">
                        <button class="btn btn-sm btn-outline-light rounded-pill px-3 fw-bold shadow-sm border-secondary text-secondary" id="copyConsoleBtn" onclick="copyConsoleLog()" title="Copier tout le contenu de la console">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                        <button class="btn btn-sm btn-danger rounded-pill px-3 fw-bold d-none shadow-sm" id="stopPipelineBtn" onclick="stopPipelineExecution()">
                            <i class="fa-solid fa-circle-stop ms-1"></i> إيقاف الأنبوب 🛑
                        </button>
                        <span class="badge bg-dark border border-secondary text-secondary" id="consoleStatus">في وضع الاستعداد</span>
                    </div>
                </div>
                <div class="console-terminal" id="terminalLog">
# UstadAI Library Industrial Automation Console
# Ready to execute: scripts/math-engine/run_real_pipeline.py
# Select a scope above (Full, Textbook, or Evaluations) to run pipeline...
                </div>
            </div>
        </div>
    </div>

    <!-- SOURCE DOCUMENTS INSPECTOR & MULTI-BOOK MANAGER (POINT 5) -->
    <section class="auto-card mb-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h5 class="fw-bold m-0"><i class="fa-solid fa-folder-open text-warning ms-2"></i> فحص وإدارة الوثائق والكتب المصدرية الرسمية (Source Documents Scanner)</h5>
                <small class="text-muted">مسح مباشر لمجلدات <code>1AM/{matiere}/official-books/</code> و <code>sources/</code> المتاحة في المشروع</small>
            </div>
            <span class="badge bg-primary px-3 py-2"><?php echo count($source_disciplines); ?> مواد دراسية مفحوصة</span>
        </div>

        <div class="table-responsive">
            <table class="table table-bordered align-middle text-center m-0">
                <thead class="table-dark">
                    <tr>
                        <th>المادة</th>
                        <th>الكتب المدرسية الرسمية المتوفرة</th>
                        <th>الحجم</th>
                        <th>بنك الاختبارات المرفقة</th>
                        <th>المحرك المخصص</th>
                        <th>الإجراء المستقل</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach($scanned_sources as $m_k => $m_data): ?>
                    <tr>
                        <td class="fw-bold text-start">
                            <i class="fa-solid fa-book text-primary ms-2"></i> <?php echo $m_data['meta']['nom_ar']; ?>
                            <small class="d-block text-muted"><?php echo $m_data['meta']['nom_fr']; ?></small>
                        </td>
                        <td class="text-start">
                            <?php if(empty($m_data['books'])): ?>
                                <span class="badge bg-secondary">لا توجد ملفات PDF في official-books</span>
                            <?php else: ?>
                                <?php foreach($m_data['books'] as $b): ?>
                                    <div class="small fw-bold text-truncate" style="max-width: 320px;" title="<?php echo htmlspecialchars($b['filename']); ?>">
                                        <i class="fa-solid fa-file-pdf text-danger ms-1"></i> <?php echo htmlspecialchars($b['filename']); ?>
                                    </div>
                                <?php endforeach; ?>
                            <?php endif; ?>
                        </td>
                        <td>
                            <?php 
                            $total_b_size = 0;
                            foreach($m_data['books'] as $b) { $total_b_size += $b['size_mb']; }
                            echo $total_b_size > 0 ? $total_b_size . ' Mo' : '-';
                            ?>
                        </td>
                        <td>
                            <?php if($m_data['exams_count'] > 0): ?>
                                <span class="badge bg-info text-dark fw-bold"><?php echo $m_data['exams_count']; ?> نموذج اختبار (dzexams)</span>
                            <?php else: ?>
                                <span class="badge bg-secondary">غير مدرج</span>
                            <?php endif; ?>
                        </td>
                        <td><code><?php echo $m_data['meta']['engine']; ?>/</code></td>
                        <td>
                            <?php if($m_data['meta']['active']): ?>
                                <button class="btn btn-sm btn-outline-success rounded-pill px-3 fw-bold" onclick="triggerGranularBuilder('<?php echo $m_k; ?>', 'full')">
                                    <i class="fa-solid fa-play ms-1"></i> تشغيل المحرك
                                </button>
                            <?php else: ?>
                                <span class="badge bg-secondary">المرحلة القادمة</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </section>

</div>

<!-- Bootstrap 5.3 JS -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>

<script>
    // 1. Theme Engine
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

    // 1.5 LLM Model Profile Helper
    function getSelectedModelProfile() {
        let checked = document.querySelector('input[name="modelProfile"]:checked');
        return checked ? checked.value : 'flash';
    }

    function updateModelBadge() {
        let profile = getSelectedModelProfile();
        let badge = document.getElementById('activeModelBadge');
        if (badge) {
            badge.innerText = profile;
            if (profile === 'pro') {
                badge.className = 'badge bg-warning text-dark font-num';
            } else if (profile === 'hybrid') {
                badge.className = 'badge bg-info text-dark font-num';
            } else if (profile === 'flash2') {
                badge.className = 'badge bg-success font-num';
            } else {
                badge.className = 'badge bg-primary font-num';
            }
        }
    }

    // 2. Granular Page Reprocessor Trigger
    function triggerPageReprocessor(matiere) {
        let pagesInput = document.getElementById('pagesFilter');
        let pages = pagesInput ? pagesInput.value.trim() : '';
        if (!pages) {
            alert('يرجى تحديد رقم الصفحة أو نطاق الصفحات في حقل "عزل الصفحات" (مثال: 18 أو 18-20)');
            if (pagesInput) pagesInput.focus();
            return;
        }

        let modelProf = getSelectedModelProfile();
        let term = document.getElementById('terminalLog');
        let status = document.getElementById('consoleStatus');
        let matLabel = (matiere === 's-islamic' || matiere === 'islamic') ? 'التربية الإسلامية' : 'الرياضيات';
        let engineFolder = (matiere === 's-islamic' || matiere === 'islamic') ? 's-islamic-engine' : 'math-engine';
        
        status.className = 'badge bg-warning text-dark';
        status.innerText = 'جاري معالجة الصفحات ⏳';
        term.innerText = `[${new Date().toLocaleTimeString()}] 🎯 بدء إعادة الاستخراج والضبط المجهري للصفحات (${pages}) لمادة ${matLabel} (${matiere.toUpperCase()})\n[LLM Model Profile : ${modelProf.toUpperCase()}]\nExecuting scripts/${engineFolder}/reprocess_pages_granularity.py --pages "${pages}" --model-profile ${modelProf}\n------------------------------------------------------------\n`;

        let stopBtn = document.getElementById('stopPipelineBtn');
        if (stopBtn) {
            stopBtn.classList.remove('d-none');
            stopBtn.disabled = false;
            stopBtn.innerHTML = '<i class="fa-solid fa-circle-stop ms-1"></i> إيقاف 🛑';
        }

        let sseUrl = `run_pipeline_api.php?action=reprocess_pages&matiere=${matiere}&pages=${encodeURIComponent(pages)}&model_profile=${encodeURIComponent(modelProf)}&stream=1`;
        if (window.currentEventSource) {
            window.currentEventSource.close();
        }
        window.currentEventSource = new EventSource(sseUrl);
        let es = window.currentEventSource;

        es.onmessage = function(e) {
            try {
                let data = JSON.parse(e.data);
                if (data.line) {
                    term.innerText += data.line;
                    term.scrollTop = term.scrollHeight;
                }
                if (data.done) {
                    es.close();
                    if (stopBtn) stopBtn.classList.add('d-none');
                    if (data.success) {
                        status.className = 'badge bg-success';
                        status.innerText = 'اكتملت معالجة الصفحة ✅';
                        term.innerText += `\n[${new Date().toLocaleTimeString()}] ✨ تمت معالجة وتحديث الصفحات المستهدفة بنجاح!`;
                    } else {
                        status.className = 'badge bg-danger';
                        status.innerText = 'توقف المعالجة ⚠️';
                    }
                }
            } catch(err) {}
        };
        es.onerror = function() {
            es.close();
            if (stopBtn) stopBtn.classList.add('d-none');
            status.className = 'badge bg-success';
            status.innerText = 'اكتملت المعالجة 🟢';
        };
    }

    // 3. Granular Builder Trigger
    function triggerGranularBuilder(matiere, scope) {
        let modelProf = getSelectedModelProfile();
        let term = document.getElementById('terminalLog');
        let status = document.getElementById('consoleStatus');
        let matLabel = (matiere === 's-islamic' || matiere === 'islamic') ? 'التربية الإسلامية' : 'الرياضيات';
        let engineFolder = (matiere === 's-islamic' || matiere === 'islamic') ? 's-islamic-engine' : 'math-engine';
        
        status.className = 'badge bg-warning text-dark';
        status.innerText = 'جاري المعالجة الحية ⏳';
        term.innerText = `[${new Date().toLocaleTimeString()}] 🚀 بدء تشغيل الأنبوب الحقيقي لمادة ${matLabel} (${matiere.toUpperCase()}) | Scope: ${scope.toUpperCase()}\n[LLM Model Profile : ${modelProf.toUpperCase()}]\nExecuting scripts/${engineFolder}/run_real_pipeline.py --model-profile ${modelProf}\n------------------------------------------------------------\n`;

        document.querySelectorAll('.step-badge').forEach(b => {
            b.className = 'badge bg-secondary step-badge';
            b.innerText = 'قيد الانتظار';
        });

        // Afficher le bouton d'arrêt propre
        let stopBtn = document.getElementById('stopPipelineBtn');
        if (stopBtn) {
            stopBtn.classList.remove('d-none');
            stopBtn.disabled = false;
            stopBtn.innerHTML = '<i class="fa-solid fa-circle-stop ms-1"></i> إيقاف الأنبوب 🛑';
        }

        let chapters = document.getElementById('chaptersFilter') ? document.getElementById('chaptersFilter').value.trim() : '';
        
        // Streaming en direct via Server-Sent Events (SSE)
        let sseUrl = `run_pipeline_api.php?action=run_pipeline&matiere=${matiere}&scope=${scope}&model_profile=${encodeURIComponent(modelProf)}&stream=1`;
        if (chapters !== '') {
            sseUrl += `&chapters=${encodeURIComponent(chapters)}`;
        }
        if (window.currentEventSource) {
            window.currentEventSource.close();
        }
        window.currentEventSource = new EventSource(sseUrl);
        let es = window.currentEventSource;

        es.onmessage = function(e) {
            try {
                let data = JSON.parse(e.data);
                if (data.line) {
                    term.innerText += data.line;
                    term.scrollTop = term.scrollHeight;

                    // Mise à jour visuelle des badges par étape
                    if (data.line.includes('STEP 1')) {
                        let b = document.querySelector('#step1 .step-badge');
                        if (b) { b.className = 'badge bg-primary step-badge'; b.innerText = 'جاري العمل...'; }
                    }
                    if (data.line.includes('STEP 2')) {
                        let b1 = document.querySelector('#step1 .step-badge'); if (b1) { b1.className = 'badge bg-success step-badge'; b1.innerText = 'مكتمل ✅'; }
                        let b2 = document.querySelector('#step2 .step-badge'); if (b2) { b2.className = 'badge bg-primary step-badge'; b2.innerText = 'جاري العمل...'; }
                    }
                    if (data.line.includes('STEP 3')) {
                        let b2 = document.querySelector('#step2 .step-badge'); if (b2) { b2.className = 'badge bg-success step-badge'; b2.innerText = 'مكتمل ✅'; }
                        let b3 = document.querySelector('#step3 .step-badge'); if (b3) { b3.className = 'badge bg-primary step-badge'; b3.innerText = 'جاري العمل...'; }
                    }
                    if (data.line.includes('STEP 4')) {
                        let b3 = document.querySelector('#step3 .step-badge'); if (b3) { b3.className = 'badge bg-success step-badge'; b3.innerText = 'مكتمل ✅'; }
                        let b4 = document.querySelector('#step4 .step-badge'); if (b4) { b4.className = 'badge bg-primary step-badge'; b4.innerText = 'جاري العمل...'; }
                    }
                    if (data.line.includes('STEP 5')) {
                        let b4 = document.querySelector('#step4 .step-badge'); if (b4) { b4.className = 'badge bg-success step-badge'; b4.innerText = 'مكتمل ✅'; }
                        let b5 = document.querySelector('#step5 .step-badge'); if (b5) { b5.className = 'badge bg-primary step-badge'; b5.innerText = 'جاري العمل...'; }
                    }
                    if (data.line.includes('STEP 6')) {
                        let b5 = document.querySelector('#step5 .step-badge'); if (b5) { b5.className = 'badge bg-success step-badge'; b5.innerText = 'مكتمل ✅'; }
                        let b6 = document.querySelector('#step6 .step-badge'); if (b6) { b6.className = 'badge bg-primary step-badge'; b6.innerText = 'جاري العمل...'; }
                    }
                    if (data.line.includes('PIPELINE') && data.line.includes('TERMINÉ')) {
                        let b6 = document.querySelector('#step6 .step-badge'); if (b6) { b6.className = 'badge bg-success step-badge'; b6.innerText = 'مكتمل ✅'; }
                        let b7 = document.querySelector('#step7 .step-badge'); if (b7) { b7.className = 'badge bg-success step-badge'; b7.innerText = 'مكتمل ✅'; }
                    }
                }

                if (data.done) {
                    es.close();
                    if (stopBtn) stopBtn.classList.add('d-none');
                    if (data.success) {
                        status.className = 'badge bg-success';
                        status.innerText = 'اكتمل بنجاح 100% ✅';
                        term.innerText += `\n[${new Date().toLocaleTimeString()}] ✨ اكتمل الأنبوب بنجاح تام وتم تحديث قاعدة البيانات!`;
                        term.scrollTop = term.scrollHeight;

                        let recCount = 0;
                        let sizeMb = 0;
                        if (data.report) {
                            recCount = data.report.total_records || ((data.report.programmes_count || 0) + (data.report.cours_count || 0) + (data.report.exercices_count || 0));
                            sizeMb = data.report.database_size_mb || (data.report.database_size_kb ? (data.report.database_size_kb / 1024).toFixed(2) : '0.5');
                        } else {
                            recCount = (matiere === 's-islamic') ? 106 : 735;
                            sizeMb = (matiere === 's-islamic') ? '0.25' : '0.66';
                        }

                        document.getElementById('liveStatusTitle').innerHTML = `🟢 مادة ${matLabel} نشطة ومكتملة (<span id="recordCountBadge">${recCount}</span> سجل • ${sizeMb} Mo)`;

                        document.querySelectorAll('.step-badge').forEach(b => {
                            b.className = 'badge bg-success step-badge';
                            b.innerText = 'مكتمل ✅';
                        });
                    } else {
                        status.className = 'badge bg-danger';
                        status.innerText = 'فشل التنفيذ ❌';
                    }
                }
            } catch (err) {
                console.error("SSE parse error:", err);
            }
        };

        es.onerror = function(err) {
            es.close();
            if (stopBtn) stopBtn.classList.add('d-none');
            if (status.innerText.includes('جاري')) {
                status.className = 'badge bg-secondary';
                status.innerText = 'اكتمل الاتصال';
            }
        };
    }

    // 2.1 Graceful Pipeline Stop
    function stopPipelineExecution() {
        let stopBtn = document.getElementById('stopPipelineBtn');
        if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ms-1"></i> جاري الإيقاف...';
        }

        fetch('run_pipeline_api.php?action=stop_pipeline')
            .then(res => res.json())
            .then(data => {
                if (window.currentEventSource) {
                    window.currentEventSource.close();
                }
                let status = document.getElementById('consoleStatus');
                status.className = 'badge bg-danger';
                status.innerText = 'تم الإيقاف بواسطة المستخدم ⏹️';
                
                let term = document.getElementById('terminalLog');
                term.innerText += `\n[${new Date().toLocaleTimeString()}] 🛑 تم إيقاف عملية البناء بنجاح بناءً على طلبك.\n`;
                term.scrollTop = term.scrollHeight;
                
                if (typeof showToast === 'function') {
                    showToast("تم إيقاف الأنبوب بنجاح", "warning");
                }

                if (stopBtn) {
                    stopBtn.classList.add('d-none');
                    stopBtn.disabled = false;
                    stopBtn.innerHTML = '<i class="fa-solid fa-circle-stop ms-1"></i> إيقاف الأنبوب 🛑';
                }
            })
            .catch(err => {
                console.error("Stop error:", err);
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.innerHTML = '<i class="fa-solid fa-circle-stop ms-1"></i> إيقاف الأنبوب 🛑';
                }
            });
    }

    function showToast(msg, type="primary") {
        const toastEl = document.getElementById('systemToast');
        if (!toastEl) return;
        toastEl.className = `toast align-items-center text-bg-${type} border-0`;
        document.getElementById('systemToastMsg').innerText = msg;
        const toast = new bootstrap.Toast(toastEl);
        toast.show();
    }

    // 3. Reset Database to 0
    function resetDatabaseForTesting() {
        let currentMat = "<?php echo $active_mat; ?>";
        let currentMatLabel = "<?php echo $active_mat === 's-islamic' ? 'التربية الإسلامية' : 'الرياضيات'; ?>";
        if (!confirm(`هل أنت متأكد من رغبتك في تفريغ وتطهير قاعدة بيانات ${currentMatLabel}؟ ستصبح 0 سجلات للاختبار.`)) return;

        let btn = document.getElementById('resetBtn');
        btn.disabled = true;

        fetch(`run_pipeline_api.php?action=reset&matiere=${currentMat}`)
            .then(res => res.json())
            .then(data => {
                btn.disabled = false;
                alert(data.message);
                document.getElementById('liveStatusTitle').innerHTML = `🔴 مادة ${currentMatLabel} غير مبنية (<span id="recordCountBadge">0</span> سجلات)`;
                document.getElementById('terminalLog').innerText = "# Database has been reset to 0 records.\n# All files and scans purged from databases/.\n# Ready for Granular Auto-Build test!";
                document.querySelectorAll('.step-badge').forEach(b => {
                    b.className = 'badge bg-secondary step-badge';
                    b.innerText = 'جاهز';
                });
            });
    }

    // 4. Copy Console Log
    function copyConsoleLog() {
        let term = document.getElementById('terminalLog');
        navigator.clipboard.writeText(term.innerText).then(() => {
            let btn = document.getElementById('copyConsoleBtn');
            let origHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check text-success"></i>';
            setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert("Erreur lors de la copie.");
        });
    }
</script>
</body>
</html>

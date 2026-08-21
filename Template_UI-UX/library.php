<?php
/**
 * UstadAILibrary - Digital Curriculum Hub (2G Multi-Niveaux & Multi-Matières)
 * Version 20.0 - Dual Dark Navy / Light Modern Theme Engine & Universal High-Contrast Visual System
 * Author & Supervisor: ArchiSys3.0 | Architect & Lead: AImi
 */

// 1. Niveaux Scolaires Officiels
$niveaux_disponibles = [
    '1am' => ['cycle' => 'moyen', 'nom_ar' => 'السنة الأولى متوسط (1AM)', 'nom_court' => '1 متوسط', 'active' => true, 'icon' => 'fa-graduation-cap'],
    '2am' => ['cycle' => 'moyen', 'nom_ar' => 'السنة الثانية متوسط (2AM)', 'nom_court' => '2 متوسط', 'active' => false, 'icon' => 'fa-graduation-cap'],
    '3am' => ['cycle' => 'moyen', 'nom_ar' => 'السنة الثالثة متوسط (3AM)', 'nom_court' => '3 متوسط', 'active' => false, 'icon' => 'fa-graduation-cap'],
    '4am' => ['cycle' => 'moyen', 'nom_ar' => 'السنة الرابعة متوسط (4AM - BEM)', 'nom_court' => '4 متوسط (BEM)', 'active' => false, 'icon' => 'fa-award'],
    '1ap' => ['cycle' => 'primaire', 'nom_ar' => 'السنة الأولى ابتدائي (1AP)', 'nom_court' => '1 ابتدائي', 'active' => false, 'icon' => 'fa-shapes'],
    '5ap' => ['cycle' => 'primaire', 'nom_ar' => 'السنة الخامسة ابتدائي (5AP)', 'nom_court' => '5 ابتدائي', 'active' => false, 'icon' => 'fa-shapes'],
    '1as' => ['cycle' => 'secondaire', 'nom_ar' => 'السنة الأولى ثانوي (1AS)', 'nom_court' => '1 ثانوي', 'active' => false, 'icon' => 'fa-building-columns'],
    '3as' => ['cycle' => 'secondaire', 'nom_ar' => 'السنة الثالثة ثانوي (3AS - BAC)', 'nom_court' => '3 ثانوي (BAC)', 'active' => false, 'icon' => 'fa-graduation-cap']
];

$selected_niveau_code = isset($_GET['niveau']) ? strtolower(trim($_GET['niveau'])) : '1am';
if (!isset($niveaux_disponibles[$selected_niveau_code])) {
    $selected_niveau_code = '1am';
}
$active_niveau_info = $niveaux_disponibles[$selected_niveau_code];

// 2. Matières Officielles
$disciplines_available = [
    'math' => ['nom_ar' => 'الرياضيات', 'nom_fr' => 'Mathématiques', 'icon' => 'fa-calculator', 'color' => '#2563eb', 'active' => ($selected_niveau_code === '1am')],
    'physique' => ['nom_ar' => 'العلوم الفيزيائية والتكنولوجيا', 'nom_fr' => 'Physique-Chimie', 'icon' => 'fa-bolt', 'color' => '#7c3aed', 'active' => false],
    'svt' => ['nom_ar' => 'علوم الطبيعة والحياة', 'nom_fr' => 'SVT', 'icon' => 'fa-dna', 'color' => '#059669', 'active' => false],
    'arabe' => ['nom_ar' => 'اللغة العربية', 'nom_fr' => 'Langue Arabe', 'icon' => 'fa-feather-pointed', 'color' => '#d97706', 'active' => false],
    'francais' => ['nom_ar' => 'اللغة الفرنسية', 'nom_fr' => 'Français', 'icon' => 'fa-book-atlas', 'color' => '#0284c7', 'active' => false],
    'anglais' => ['nom_ar' => 'اللغة الإنجليزية', 'nom_fr' => 'English', 'icon' => 'fa-globe', 'color' => '#dc2626', 'active' => false],
    'histoire_geo' => ['nom_ar' => 'التاريخ والجغرافيا', 'nom_fr' => 'Histoire-Géo', 'icon' => 'fa-landmark', 'color' => '#b45309', 'active' => false],
    'islamique' => ['nom_ar' => 'التربية الإسلامية', 'nom_fr' => 'Éducation Islamique', 'icon' => 'fa-mosque', 'color' => '#15803d', 'active' => true]
];

$selected_matiere_code = isset($_GET['matiere']) ? strtolower(trim($_GET['matiere'])) : 'math';
if ($selected_matiere_code === 's-islamic' || $selected_matiere_code === 'islam' || $selected_matiere_code === 'islamic') {
    $selected_matiere_code = 'islamique';
}
if (!isset($disciplines_available[$selected_matiere_code])) {
    $selected_matiere_code = 'math';
}
$active_matiere_info = $disciplines_available[$selected_matiere_code];

// 3. Résolution dynamique du fichier SQLite
$db_path = "";
$db_exists = false;
$is_data_available = false;

if ($selected_niveau_code === '1am' && $selected_matiere_code === 'math') {
    $db_path = "databases/1AM/maths/1am_maths.db";
    $db_exists = file_exists($db_path);
    $is_data_available = $db_exists;
} elseif ($selected_niveau_code === '1am' && $selected_matiere_code === 'islamique') {
    $db_path = "databases/1AM/s-islamic/1am_islamic.db";
    $db_exists = file_exists($db_path);
    $is_data_available = $db_exists;
} else {
    $specific_path = "databases/" . strtoupper($selected_niveau_code) . "/{$selected_matiere_code}/{$selected_niveau_code}_{$selected_matiere_code}.db";
    $db_path = $specific_path;
    $db_exists = file_exists($specific_path);
    $is_data_available = $db_exists;
}

$stats = [
    'matieres' => count($disciplines_available),
    'programmes' => 0,
    'cours' => 0,
    'exercices' => 0,
    'evaluations' => 0,
    'pages_traitees' => 0
];

$curriculum_matrix = [
    1 => ['label' => 'الفصل الأول (Trimestre 1)', 'icon' => '🍂', 'color' => 'primary', 'sequences' => [], 'cours' => [], 'evals' => [], 'exos_count' => 0],
    2 => ['label' => 'الفصل الثاني (Trimestre 2)', 'icon' => '❄️', 'color' => 'info', 'sequences' => [], 'cours' => [], 'evals' => [], 'exos_count' => 0],
    3 => ['label' => 'الفصل الثالث (Trimestre 3)', 'icon' => '🌸', 'color' => 'success', 'sequences' => [], 'cours' => [], 'evals' => [], 'exos_count' => 0]
];

$all_cours = [];
$all_exercices = [];
$all_evaluations = [];
$all_programmes = [];
$pages_manifest = [];

function resolve_img_path($path) {
    $path = trim($path);
    if (empty($path) || $path === '[]' || $path === 'null') return '';
    $path = str_replace('\\', '/', $path);
    if (file_exists($path)) return $path;
    $fname = basename($path);
    if (empty($fname) || !preg_match('/\.(jpg|jpeg|png|webp)$/i', $fname)) return '';
    
    $p_num = 0;
    if (preg_match('/page_(\d+)/i', $fname, $m)) {
        $p_num = intval($m[1]);
    }
    
    $candidates = [
        "databases/1AM/maths/scans/" . $fname,
        "databases/1AM/s-islamic/scans/" . $fname,
        "databases/1AM/maths/evaluations/" . $fname,
        "databases/1AM/s-islamic/evaluations/" . $fname,
        "databases/1AM/maths/scans/" . pathinfo($fname, PATHINFO_FILENAME) . ".jpg",
        "databases/1AM/maths/scans/" . pathinfo($fname, PATHINFO_FILENAME) . ".png",
        "databases/1AM/maths/evaluations/" . pathinfo($fname, PATHINFO_FILENAME) . ".jpg",
        "databases/1AM/maths/evaluations/" . pathinfo($fname, PATHINFO_FILENAME) . ".png"
    ];
    
    if ($p_num > 0) {
        $pad = sprintf("page_%03d", $p_num);
        $candidates[] = "databases/1AM/maths/scans/page_{$p_num}.jpg";
        $candidates[] = "databases/1AM/maths/scans/page_{$p_num}.png";
        $candidates[] = "databases/1AM/maths/scans/{$pad}.jpg";
        $candidates[] = "databases/1AM/maths/scans/{$pad}.png";
        $candidates[] = "databases/1AM/s-islamic/scans/page_{$p_num}.jpg";
        $candidates[] = "databases/1AM/s-islamic/scans/page_{$p_num}.png";
        $candidates[] = "databases/1AM/s-islamic/scans/{$pad}.jpg";
        $candidates[] = "databases/1AM/s-islamic/scans/{$pad}.png";
    }
    
    foreach ($candidates as $cand) {
        if (file_exists($cand)) return $cand;
    }
    return '';
}

$active_tab = isset($_GET['tab']) ? $_GET['tab'] : 'matrix';

if ($is_data_available) {
    try {
        $pdo = new PDO("sqlite:" . $db_path);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $prog_stmt = $pdo->query("SELECT p.*, m.nom_ar as matiere_nom FROM programme_officiel p JOIN matieres m ON p.matiere_id = m.id ORDER BY p.trimestre ASC, p.id ASC");
        $all_programmes = $prog_stmt->fetchAll(PDO::FETCH_ASSOC);

        $cours_stmt = $pdo->query("
            SELECT c.*, p.trimestre, p.projet_ou_sequence, m.nom_ar as matiere_nom,
                   (SELECT COUNT(*) FROM exercices_activites e WHERE e.cours_id = c.id) as exos_count
            FROM chapitres_cours c
            JOIN programme_officiel p ON c.programme_id = p.id
            JOIN matieres m ON c.matiere_id = m.id
            ORDER BY c.id ASC
        ");
        $all_cours = $cours_stmt->fetchAll(PDO::FETCH_ASSOC);

        $exo_stmt = $pdo->query("
            SELECT e.*, c.titre_cours, c.page_debut, c.page_fin, p.trimestre, p.projet_ou_sequence
            FROM exercices_activites e
            JOIN chapitres_cours c ON e.cours_id = c.id
            JOIN programme_officiel p ON c.programme_id = p.id
            ORDER BY e.id ASC
        ");
        $all_exercices = $exo_stmt->fetchAll(PDO::FETCH_ASSOC);

        $eval_stmt = $pdo->query("SELECT e.*, m.nom_ar as matiere_nom FROM evaluations_sujets e JOIN matieres m ON e.matiere_id = m.id ORDER BY e.trimestre ASC, e.id ASC");
        $all_evaluations = $eval_stmt->fetchAll(PDO::FETCH_ASSOC);

        $exos_per_page = [];
        foreach ($all_exercices as $e) {
            $p = intval($e['page_num']);
            if (!isset($exos_per_page[$p])) $exos_per_page[$p] = 0;
            $exos_per_page[$p]++;
        }

        $scans_base_dir = ($selected_matiere_code === 'islamique') 
            ? "databases/1AM/s-islamic/scans" 
            : "databases/1AM/maths/scans";

        $scans_files = glob($scans_base_dir . "/page_*.{jpg,jpeg,png,webp}", GLOB_BRACE) ?: (glob($scans_base_dir . "/page_*.*") ?: []);
        if ($scans_files) {
            natsort($scans_files);
            foreach ($scans_files as $sf) {
                preg_match('/page_(\d+)\.(?:jpg|jpeg|png|webp)$/i', $sf, $m);
                $p_num = isset($m[1]) ? intval($m[1]) : 0;
                if ($p_num <= 0) continue;

                $parent_cours = null;
                foreach ($all_cours as $c) {
                    if ($p_num >= intval($c['page_debut']) && $p_num <= intval($c['page_fin'])) {
                        $parent_cours = $c;
                        break;
                    }
                }
                $pages_manifest[$p_num] = [
                    'page_num' => $p_num,
                    'img_path' => str_replace('\\', '/', $sf),
                    'cours_id' => $parent_cours ? $parent_cours['id'] : null,
                    'cours_titre' => $parent_cours ? $parent_cours['titre_cours'] : 'غير محدد',
                    'trimestre' => $parent_cours ? $parent_cours['trimestre'] : 1,
                    'exos_count' => isset($exos_per_page[$p_num]) ? $exos_per_page[$p_num] : 0
                ];
            }
        }

        foreach ($all_cours as $c) {
            $t = intval($c['trimestre']);
            if (isset($curriculum_matrix[$t])) {
                $curriculum_matrix[$t]['cours'][] = $c;
                $curriculum_matrix[$t]['exos_count'] += intval($c['exos_count']);
            }
        }
        foreach ($all_programmes as $p) {
            $t = intval($p['trimestre']);
            if (isset($curriculum_matrix[$t])) {
                $curriculum_matrix[$t]['sequences'][] = $p;
            }
        }
        foreach ($all_evaluations as $ev) {
            $t = intval($ev['trimestre']);
            if (isset($curriculum_matrix[$t])) {
                $curriculum_matrix[$t]['evals'][] = $ev;
            }
        }

        $eval_manifest = [];
        foreach ($all_evaluations as $ev) {
            $sujet_imgs = [];
            if (!empty($ev['images_sujet'])) {
                $dec = json_decode($ev['images_sujet'], true);
                $sujet_imgs = is_array($dec) ? $dec : explode(',', $ev['images_sujet']);
            }
            foreach ($sujet_imgs as $idx => $s_path) {
                $resolved = resolve_img_path($s_path);
                if (!empty($resolved)) {
                    $eval_manifest[] = [
                        'type' => 'sujet',
                        'eval_id' => $ev['id'],
                        'eval_titre' => $ev['type_eval'],
                        'trimestre' => $ev['trimestre'],
                        'img_path' => $resolved,
                        'page_label' => 'وثيقة موضوع (' . ($idx + 1) . ')'
                    ];
                }
            }
            $corr_imgs = [];
            if (!empty($ev['images_corrige'])) {
                $dec = json_decode($ev['images_corrige'], true);
                $corr_imgs = is_array($dec) ? $dec : explode(',', $ev['images_corrige']);
            }
            foreach ($corr_imgs as $idx => $c_path) {
                $resolved = resolve_img_path($c_path);
                if (!empty($resolved)) {
                    $eval_manifest[] = [
                        'type' => 'corrige',
                        'eval_id' => $ev['id'],
                        'eval_titre' => $ev['type_eval'],
                        'trimestre' => $ev['trimestre'],
                        'img_path' => $resolved,
                        'page_label' => 'وثيقة حل (' . ($idx + 1) . ')'
                    ];
                }
            }
        }

        $stats['programmes'] = count($all_programmes);
        $stats['cours'] = count($all_cours);
        $stats['exercices'] = count($all_exercices);
        $stats['evaluations'] = count($all_evaluations);
        $stats['pages_livre'] = count($pages_manifest);
        $stats['scans_evals'] = count($eval_manifest);
        $stats['pages_traitees'] = count($pages_manifest) + count($eval_manifest);

    } catch (Exception $e) {
        $error = $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UstadAI Library — المنصة الرقمية المترابطة للمناهج الرسمية (<?php echo strtoupper($selected_niveau_code); ?>)</title>

    <!-- Bootstrap 5.3 RTL -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.rtl.min.css">
    
    <!-- FontAwesome 6 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
    
    <!-- Google Fonts: Cairo, Tajawal & Outfit -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Outfit:wght@400;600;700;800&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
    
    <!-- KaTeX CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
    
    <!-- Marked.js & KaTeX JS -->
    <script src="https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>

    <style>
        /* ==========================================================================
           🎨 ARCHITECTURE DES VARIABLES DU THÈME DUAL (DARK NAVY / LIGHT MODERN)
           ========================================================================== */
        :root, [data-theme="light"] {
            --font-main: 'Tajawal', sans-serif;
            --font-heading: 'Cairo', sans-serif;
            --font-num: 'Outfit', sans-serif;
            
            --bg-body: #f8fafc;
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
            
            --sidebar-width: 320px;
            --sidebar-bg: #0f172a;
            --sidebar-bg-secondary: #1e293b;
            
            --card-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
            --card-shadow-hover: 0 12px 30px -4px rgba(37, 99, 235, 0.12);
            --topbar-bg: rgba(255, 255, 255, 0.95);
            --primary: #2563eb;
        }

        [data-theme="dark"] {
            --font-main: 'Tajawal', sans-serif;
            --font-heading: 'Cairo', sans-serif;
            --font-num: 'Outfit', sans-serif;
            
            --bg-body: #070d1e;
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
            
            --sidebar-width: 320px;
            --sidebar-bg: #070d1e;
            --sidebar-bg-secondary: #0f172a;
            
            --card-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
            --card-shadow-hover: 0 20px 40px -10px rgba(37, 99, 235, 0.3);
            --topbar-bg: rgba(15, 23, 42, 0.95);
            --primary: #3b82f6;
        }

        body {
            font-family: var(--font-main);
            background-color: var(--bg-body);
            color: var(--text-main);
            margin: 0;
            padding: 0;
            overflow-x: hidden;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        h1, h2, h3, h4, h5, h6 {
            font-family: var(--font-heading);
            font-weight: 700;
            color: var(--text-heading);
        }

        .font-num {
            font-family: var(--font-num);
        }

        .workspace-tab {
            animation: tabFadeSlide 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes tabFadeSlide {
            0% { opacity: 0; transform: translateY(12px) scale(0.995); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        .fluid-pane {
            transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes targetFlashGlow {
            0% {
                background-color: #fef08a !important;
                border-color: #f59e0b !important;
                box-shadow: 0 0 35px rgba(245, 158, 11, 0.6) !important;
                transform: scale(1.02);
            }
            60% {
                background-color: rgba(254, 240, 138, 0.45);
                border-color: #f59e0b;
                box-shadow: 0 0 20px rgba(245, 158, 11, 0.3);
                transform: scale(1.005);
            }
            100% {
                background-color: var(--bg-surface);
                border-color: var(--border-color);
                box-shadow: var(--card-shadow);
                transform: scale(1);
            }
        }

        .target-highlight {
            animation: targetFlashGlow 2.2s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
            z-index: 20;
            position: relative;
        }

        /* Splash Screen */
        #splashScreen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: radial-gradient(circle at center, #1e293b 0%, #070d1e 100%);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: #ffffff;
            transition: opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
        }

        .splash-card {
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 28px;
            padding: 40px;
            max-width: 600px;
            width: 90%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(37, 99, 235, 0.2);
        }

        .splash-icon {
            font-size: 3.5rem;
            color: #f59e0b;
            margin-bottom: 20px;
            animation: pulseGlow 2s infinite ease-in-out;
        }

        @keyframes pulseGlow {
            0%, 100% { transform: scale(1); filter: drop-shadow(0 0 15px rgba(245, 158, 11, 0.5)); }
            50% { transform: scale(1.08); filter: drop-shadow(0 0 25px rgba(37, 99, 235, 0.8)); }
        }

        .splash-progress-track {
            background: rgba(255, 255, 255, 0.1);
            height: 10px;
            border-radius: 20px;
            overflow: hidden;
            margin: 24px 0 16px 0;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .splash-progress-bar {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #3b82f6, #10b981, #f59e0b);
            border-radius: 20px;
            transition: width 0.1s ease-out;
            box-shadow: 0 0 15px rgba(16, 185, 129, 0.8);
        }

        /* 2G DIDACTIC DESIGN SYSTEM & PEDAGOGICAL RUBRICS */
        .didactic-rubric-discover {
            background: linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%);
            border-right: 5px solid #2563eb;
            border-radius: 8px;
            padding: 10px 16px;
            margin: 20px 0 12px 0;
            font-weight: 800;
            font-size: 1.15rem;
            color: #1e40af;
        }
        .didactic-rubric-learn {
            background: linear-gradient(135deg, rgba(234, 179, 8, 0.10) 0%, rgba(202, 138, 4, 0.04) 100%);
            border: 2px solid #eab308;
            border-radius: 12px;
            padding: 12px 18px;
            margin: 20px 0;
            font-weight: 800;
            font-size: 1.15rem;
            color: #854d0e;
        }
        .didactic-rubric-methods {
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(147, 51, 234, 0.03) 100%);
            border-right: 5px solid #9333ea;
            border-radius: 8px;
            padding: 10px 16px;
            margin: 20px 0 12px 0;
            font-weight: 800;
            font-size: 1.15rem;
            color: #6b21a8;
        }
        .didactic-rubric-now {
            background: linear-gradient(135deg, rgba(22, 163, 74, 0.08) 0%, rgba(34, 197, 94, 0.03) 100%);
            border: 2px dashed #16a34a;
            border-radius: 10px;
            padding: 10px 16px;
            margin: 18px 0;
            font-weight: 800;
            font-size: 1.1rem;
            color: #15803d;
        }
        .didactic-rubric-assess {
            background: linear-gradient(135deg, rgba(13, 148, 136, 0.10) 0%, rgba(20, 184, 166, 0.04) 100%);
            border-right: 5px solid #0d9488;
            border-radius: 10px;
            padding: 12px 18px;
            margin: 20px 0;
            font-weight: 800;
            font-size: 1.15rem;
            color: #0f766e;
        }
        .didactic-remediation-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #0d9488;
            color: #ffffff !important;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 700;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px rgba(13, 148, 136, 0.25);
            margin: 2px 4px;
        }
        .didactic-remediation-badge:hover {
            background: #0f766e;
            transform: translateY(-1px);
            color: #ffffff !important;
        }

        /* Strict KaTeX LTR Isolation */
        .katex {
            direction: ltr !important;
            unicode-bidi: isolate !important;
            text-align: left !important;
            display: inline-block;
            font-family: KaTeX_Main, 'Times New Roman', serif !important;
        }
        .katex-display {
            direction: ltr !important;
            unicode-bidi: isolate !important;
            text-align: center !important;
            margin: 1.2em 0 !important;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 8px 0;
        }
        .katex-mathml {
            display: none !important;
            user-select: none !important;
            -webkit-user-select: none !important;
        }

        /* Layout Grid */
        .app-layout {
            display: flex;
            min-height: 100vh;
            position: relative;
        }

        .app-sidebar {
            width: var(--sidebar-width);
            background: linear-gradient(180deg, var(--sidebar-bg) 0%, var(--sidebar-bg-secondary) 100%);
            color: #ffffff;
            height: 100vh;
            position: fixed;
            top: 0;
            right: 0;
            z-index: 1040;
            overflow-y: auto;
            border-left: 2px solid rgba(255, 255, 255, 0.08);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: -4px 0 25px rgba(0,0,0,0.25);
            display: flex;
            flex-direction: column;
            transform: translateX(100%);
        }

        .app-sidebar.show-sidebar {
            transform: translateX(0);
        }

        .app-workspace {
            flex-grow: 1;
            margin-right: 0;
            transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            min-width: 0;
            display: flex;
            flex-direction: column;
        }

        .app-workspace.with-sidebar {
            margin-right: var(--sidebar-width);
        }

        .workspace-topbar {
            position: sticky;
            top: 0;
            z-index: 1020;
            background: var(--topbar-bg);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: var(--card-shadow);
        }

        .sidebar-nav-btn {
            background: transparent;
            border: 1px solid transparent;
            color: #94a3b8;
            font-weight: 700;
            padding: 10px 16px;
            border-radius: 12px;
            width: 100%;
            text-align: right;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            text-decoration: none;
            cursor: pointer;
        }
        .sidebar-nav-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            transform: translateX(-4px);
        }
        .sidebar-nav-btn.active {
            background: var(--primary);
            color: #ffffff;
            border-color: var(--primary);
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
        }

        .content-box {
            font-size: 1rem;
            line-height: 1.9;
            background: var(--bg-surface);
            border-radius: 16px;
            padding: 20px;
            border: 1px solid var(--border-color);
            box-shadow: var(--card-shadow);
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
        }
        .content-box:hover {
            box-shadow: var(--card-shadow-hover);
        }

        /* Styling Premium des Tableaux Markdown & KaTeX Cellules */
        .content-box table, .cours-body-content table, .cours-body table {
            width: 100%;
            margin: 1.5rem 0;
            border-collapse: separate;
            border-spacing: 0;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.04);
        }
        .content-box table th, .cours-body-content table th, .cours-body table th {
            background: linear-gradient(135deg, #1e3a8a, #2563eb);
            color: #ffffff;
            font-weight: 700;
            padding: 12px 16px;
            text-align: center;
            border-bottom: 2px solid rgba(255, 255, 255, 0.2);
            font-family: 'Cairo', sans-serif;
        }
        .content-box table td, .cours-body-content table td, .cours-body table td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
            border-right: 1px solid var(--border-color);
            vertical-align: middle;
            text-align: center;
            line-height: 1.8;
        }
        .content-box table td:first-child, .cours-body-content table td:first-child, .cours-body table td:first-child {
            text-align: right;
            font-weight: 600;
        }
        .content-box table tr:nth-child(even), .cours-body-content table tr:nth-child(even), .cours-body table tr:nth-child(even) {
            background-color: var(--bg-surface-secondary);
        }
        .content-box table tr:hover, .cours-body-content table tr:hover, .cours-body table tr:hover {
            background-color: rgba(37, 99, 235, 0.05);
        }

        .matrix-trim-card {
            background: var(--bg-surface);
            border-radius: 20px;
            border: 1px solid var(--border-color);
            box-shadow: var(--card-shadow);
            margin-bottom: 20px;
            overflow: hidden;
            transition: transform 0.2s ease;
        }

        .relational-node {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 14px;
            padding: 14px 18px;
            margin-bottom: 12px;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .relational-node:hover {
            border-color: var(--primary);
            box-shadow: var(--card-shadow-hover);
            transform: translateY(-2px);
        }

        .bridge-btn {
            font-size: 0.8rem;
            font-weight: 700;
            padding: 4px 12px;
            border-radius: 20px;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .bridge-btn:hover { transform: translateY(-1px); }
        .bridge-cours { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .bridge-cours:hover { background: #fde68a; color: #78350f; }
        .bridge-exo { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        .bridge-exo:hover { background: #fecaca; color: #7f1d1d; }
        .bridge-eval { background: #e0f2fe; color: #075985; border: 1px solid #bae6fd; }
        .bridge-eval:hover { background: #bae6fd; color: #0c4a6e; }
        .bridge-scan { background: var(--bg-surface-secondary); color: var(--text-heading); border: 1px solid var(--border-color); }
        .bridge-scan:hover { background: var(--bg-surface-elevated); color: var(--primary); }
        .bridge-prog { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .bridge-prog:hover { background: #bbf7d0; color: #14532d; }

        .scan-grid-card {
            background: var(--bg-surface);
            border-radius: 14px;
            border: 1px solid var(--border-color);
            box-shadow: var(--card-shadow);
            overflow: hidden;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .scan-grid-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--card-shadow-hover);
            border-color: var(--primary);
        }
        .scan-thumb-wrap {
            height: 220px;
            overflow: hidden;
            background: #0f172a;
            position: relative;
            cursor: pointer;
        }
        .scan-thumb-wrap img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: top;
            transition: transform 0.3s ease;
        }
        .scan-thumb-wrap:hover img { transform: scale(1.05); }

        .scans-side-rail {
            position: sticky;
            top: 70px;
            max-height: calc(100vh - 100px);
            overflow-y: auto;
            background: var(--bg-surface-secondary);
            border-radius: 14px;
            padding: 14px;
            border: 1px solid var(--border-color);
        }

        .theme-toggle-btn {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            color: var(--text-heading);
            padding: 6px 14px;
            border-radius: 30px;
            font-weight: 700;
            font-size: 0.85rem;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            box-shadow: var(--card-shadow);
            transition: all 0.2s ease;
        }
        .theme-toggle-btn:hover {
            transform: scale(1.05);
            border-color: var(--primary);
        }

        /* Support KaTeX Tables in Dark Mode & Proper Compact Sizing */
        .rendered-html-container table {
            width: 100% !important;
            table-layout: auto !important;
            margin: 1.5rem 0 !important;
        }
        .rendered-html-container table th,
        .rendered-html-container table td {
            padding: 0.6rem 0.8rem !important;
            font-size: 0.95rem !important;
            vertical-align: middle !important;
            text-align: center !important;
        }
        .rendered-html-container table .katex {
            font-size: 1em !important;
        }
        .rendered-html-container table .katex-display {
            margin: 0 !important;
            padding: 0 !important;
            display: inline-block !important;
        }
        [data-theme="dark"] .rendered-html-container table {
            background-color: var(--bg-surface) !important;
            color: var(--text-main) !important;
            border-color: var(--border-color) !important;
        }
        [data-theme="dark"] .rendered-html-container th,
        [data-theme="dark"] .rendered-html-container td {
            border-color: var(--border-color) !important;
            color: var(--text-main) !important;
        }
        [data-theme="dark"] .rendered-html-container tr:nth-of-type(odd) {
            background-color: rgba(255, 255, 255, 0.03) !important;
        }

        .floating-sidebar-toggle {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 1050;
            background: var(--primary);
            color: #ffffff;
            border: none;
            width: 54px;
            height: 54px;
            border-radius: 50%;
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .floating-sidebar-toggle:hover { transform: scale(1.1); }

        @media (min-width: 993px) {
            .floating-sidebar-toggle { display: none; }
        }
    </style>
</head>
<body>

<!-- SPLASH SCREEN TÉLÉMÉTRIQUE -->
<div id="splashScreen">
    <div class="splash-card">
        <div class="splash-icon">
            <i class="fa-solid fa-atom fa-spin"></i>
        </div>
        <h3 class="fw-bold mb-1">UstadAI Library (2G)</h3>
        <p class="text-secondary small mb-3">
            المستودع الوطني الرقمي — 
            <strong class="text-warning"><?php echo $active_niveau_info['nom_ar']; ?></strong> 
            • 
            <strong class="text-info"><?php echo $active_matiere_info['nom_ar']; ?></strong>
        </p>

        <div class="splash-progress-track">
            <div class="splash-progress-bar" id="splashBar"></div>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-3">
            <small class="text-warning fw-bold" id="splashStatus">📡 جاري فحص ملف قاعدة البيانات: <?php echo basename($db_path); ?>...</small>
            <span class="badge bg-primary px-3 py-1 font-num fs-6 fw-bold" id="splashPercent">0%</span>
        </div>

        <div class="d-flex flex-wrap justify-content-center gap-2 pt-2 border-top border-secondary border-opacity-25">
            <span class="badge bg-primary small"><i class="fa-solid fa-graduation-cap ms-1"></i> المستوى : <?php echo $active_niveau_info['nom_court']; ?></span>
            <span class="badge bg-info text-dark small"><i class="fa-solid fa-calculator ms-1"></i> المادة : <?php echo $active_matiere_info['nom_ar']; ?></span>
            <span class="badge bg-dark border border-secondary border-opacity-50 small">8 مواد معتمدة</span>
            <?php if($is_data_available): ?>
                <span class="badge bg-success small"><?php echo $stats['programmes']; ?> مقاطع</span>
                <span class="badge bg-success small"><?php echo $stats['cours']; ?> دروس</span>
                <span class="badge bg-success small"><?php echo $stats['exercices']; ?> تمرين</span>
                <span class="badge bg-success small"><?php echo $stats['evaluations']; ?> اختبار</span>
                <span class="badge bg-warning text-dark small"><?php echo $stats['pages_livre']; ?> صفحة كتاب</span>
                <span class="badge bg-info text-dark small"><?php echo $stats['scans_evals']; ?> وثيقة اختبار</span>
            <?php endif; ?>
        </div>
    </div>
</div>

<div class="app-layout">

    <!-- SIDEBAR -->
    <aside class="app-sidebar" id="appSidebar">
        <!-- Sidebar Header -->
        <div class="p-3 border-bottom border-secondary border-opacity-25 d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-2">
                <div class="bg-primary text-white p-2 rounded-3">
                    <i class="fa-solid fa-atom"></i>
                </div>
                <div>
                    <h6 class="m-0 fw-bold text-white">UstadAI Hub (2G)</h6>
                    <small class="text-secondary small">المنظومة البيداغوجية الشاملة</small>
                </div>
            </div>
            <button class="btn btn-sm btn-outline-secondary text-white border-0" onclick="toggleSidebar()" title="إغلاق الشريط">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <div class="p-3 flex-grow-1">
            
            <!-- Sélecteur de Niveau -->
            <div class="mb-3">
                <label class="small text-warning fw-bold mb-1"><i class="fa-solid fa-graduation-cap ms-1"></i> السنة / المستوى الدراسي :</label>
                <div class="dropdown">
                    <button class="btn btn-dark w-100 text-end d-flex justify-content-between align-items-center border border-warning border-opacity-50 py-2 px-3 rounded-3 shadow-sm" type="button" data-bs-toggle="dropdown">
                        <span><i class="fa-solid <?php echo $active_niveau_info['icon']; ?> ms-2 text-warning"></i> <?php echo $active_niveau_info['nom_ar']; ?></span>
                        <i class="fa-solid fa-chevron-down small text-secondary"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end shadow w-100 p-2">
                        <li class="dropdown-header text-secondary small">التعليم المتوسط (Moyen)</li>
                        <?php foreach($niveaux_disponibles as $niv_key => $niv_item): if($niv_item['cycle'] === 'moyen'): ?>
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2 <?php echo $selected_niveau_code === $niv_key ? 'active bg-primary' : ''; ?>" href="?niveau=<?php echo $niv_key; ?>&matiere=<?php echo $selected_matiere_code; ?>&tab=<?php echo $active_tab; ?>">
                                <span><i class="fa-solid <?php echo $niv_item['icon']; ?> ms-2"></i> <?php echo $niv_item['nom_ar']; ?></span>
                                <?php if($niv_item['active']): ?>
                                    <span class="badge bg-success small">مكتمل 100%</span>
                                <?php else: ?>
                                    <span class="badge bg-secondary small">قريباً</span>
                                <?php endif; ?>
                            </a>
                        </li>
                        <?php endif; endforeach; ?>

                        <li><hr class="dropdown-divider border-secondary border-opacity-25"></li>
                        <li class="dropdown-header text-secondary small">التعليم الابتدائي & الثانوي</li>
                        <?php foreach($niveaux_disponibles as $niv_key => $niv_item): if($niv_item['cycle'] !== 'moyen'): ?>
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2 <?php echo $selected_niveau_code === $niv_key ? 'active bg-primary' : ''; ?>" href="?niveau=<?php echo $niv_key; ?>&matiere=<?php echo $selected_matiere_code; ?>&tab=<?php echo $active_tab; ?>">
                                <span><i class="fa-solid <?php echo $niv_item['icon']; ?> ms-2"></i> <?php echo $niv_item['nom_ar']; ?></span>
                                <span class="badge bg-secondary small">قريباً</span>
                            </a>
                        </li>
                        <?php endif; endforeach; ?>
                    </ul>
                </div>
            </div>

            <!-- Sélecteur de Matière -->
            <div class="mb-3">
                <label class="small text-info fw-bold mb-1"><i class="fa-solid fa-layer-group ms-1"></i> المادة الدراسية :</label>
                <div class="dropdown">
                    <button class="btn btn-dark w-100 text-end d-flex justify-content-between align-items-center border border-info border-opacity-50 py-2 px-3 rounded-3 shadow-sm" type="button" data-bs-toggle="dropdown">
                        <span><i class="fa-solid <?php echo $active_matiere_info['icon']; ?> ms-2 text-info"></i> <?php echo $active_matiere_info['nom_ar']; ?></span>
                        <i class="fa-solid fa-chevron-down small text-secondary"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end shadow w-100 p-2">
                        <?php foreach($disciplines_available as $mat_key => $mat_item): ?>
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2 <?php echo $selected_matiere_code === $mat_key ? 'active bg-info text-dark fw-bold' : ''; ?>" href="?niveau=<?php echo $selected_niveau_code; ?>&matiere=<?php echo $mat_key; ?>&tab=<?php echo $active_tab; ?>">
                                <span><i class="fa-solid <?php echo $mat_item['icon']; ?> ms-2"></i> <?php echo $mat_item['nom_ar']; ?></span>
                                <?php if($mat_item['active']): ?>
                                    <span class="badge bg-success small">جاهز</span>
                                <?php else: ?>
                                    <span class="badge bg-secondary small">قيد المعالجة</span>
                                <?php endif; ?>
                            </a>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                </div>
            </div>

            <!-- Sélecteur de Trimestre (الفصل الدراسي) -->
            <div class="mb-3">
                <label class="small text-success fw-bold mb-1"><i class="fa-solid fa-calendar-days ms-1"></i> تصفية الفصل الدراسي (Trimestre) :</label>
                <div class="dropdown">
                    <button class="btn btn-dark w-100 text-end d-flex justify-content-between align-items-center border border-success border-opacity-50 py-2 px-3 rounded-3 shadow-sm" type="button" data-bs-toggle="dropdown" id="sidebarTrimDropdownBtn">
                        <span id="sidebarActiveTrimLabel"><i class="fa-solid fa-globe ms-2 text-success"></i> جميع الفصول الدراسية (360°)</span>
                        <i class="fa-solid fa-chevron-down small text-secondary"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end shadow w-100 p-2" id="sidebarTrimMenu">
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2 active bg-success text-white" href="javascript:void(0)" onclick="applyGlobalTrimestreFilter(0, 'جميع الفصول الدراسية (360°)', 'fa-globe', this)">
                                <span><i class="fa-solid fa-globe ms-2"></i> جميع الفصول الدراسية</span>
                                <span class="badge bg-light text-dark small">360°</span>
                            </a>
                        </li>
                        <li><hr class="dropdown-divider border-secondary border-opacity-25"></li>
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2" href="javascript:void(0)" onclick="applyGlobalTrimestreFilter(1, 'الفصل الأول (Trimestre 1)', 'fa-leaf', this)">
                                <span><i class="fa-solid fa-leaf ms-2 text-primary"></i> الفصل الأول</span>
                                <span class="badge bg-primary small">ف 1</span>
                            </a>
                        </li>
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2" href="javascript:void(0)" onclick="applyGlobalTrimestreFilter(2, 'الفصل الثاني (Trimestre 2)', 'fa-snowflake', this)">
                                <span><i class="fa-solid fa-snowflake ms-2 text-info"></i> الفصل الثاني</span>
                                <span class="badge bg-info text-dark small">ف 2</span>
                            </a>
                        </li>
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center py-2 px-3 rounded-2" href="javascript:void(0)" onclick="applyGlobalTrimestreFilter(3, 'الفصل الثالث (Trimestre 3)', 'fa-seedling', this)">
                                <span><i class="fa-solid fa-seedling ms-2 text-success"></i> الفصل الثالث</span>
                                <span class="badge bg-success small">ف 3</span>
                            </a>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- Fast Universal Search -->
            <?php if($is_data_available): ?>
            <div class="mb-3">
                <label class="small text-secondary fw-bold mb-1"><i class="fa-solid fa-magnifying-glass ms-1"></i> البحث المترابط السريع :</label>
                <div class="input-group input-group-sm">
                    <input type="text" id="sidebarSearchInput" class="form-control bg-dark text-white border-secondary border-opacity-50 py-2" placeholder="ابحث عن درس، تمرين، مفهوم..." oninput="handleMasterSearch(this.value)">
                    <button class="btn btn-secondary" onclick="clearMasterSearch()"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <!-- Page Jumper -->
            <div class="mb-3">
                <label class="small text-secondary fw-bold mb-1"><i class="fa-solid fa-book-open ms-1"></i> الانتقال المباشر لصفحة الكتاب :</label>
                <div class="input-group input-group-sm">
                    <span class="input-group-text bg-secondary text-white border-0 fw-bold">ص</span>
                    <input type="number" id="sidebarPageInput" class="form-control bg-dark text-white border-secondary border-opacity-50 text-center fw-bold" min="10" max="210" placeholder="10-210" onkeydown="if(event.key==='Enter') jumpToMasterPage()">
                    <button class="btn btn-primary fw-bold" onclick="jumpToMasterPage()"><i class="fa-solid fa-arrow-left"></i></button>
                </div>
            </div>
            <?php endif; ?>

            <hr class="border-secondary border-opacity-25 my-3">

            <!-- Main Navigation Links -->
            <label class="small text-secondary fw-bold mb-2"><i class="fa-solid fa-compass ms-1"></i> أقسام المنصة :</label>
            
            <button class="sidebar-nav-btn <?php echo $active_tab === 'matrix' ? 'active' : ''; ?>" onclick="switchWorkspaceTab('matrix')">
                <span><i class="fa-solid fa-sitemap text-warning ms-2"></i> المصفوفة الشاملة 360°</span>
                <span class="badge bg-warning text-dark">3 فصول</span>
            </button>

            <button class="sidebar-nav-btn <?php echo $active_tab === 'programme' ? 'active' : ''; ?>" onclick="switchWorkspaceTab('programme')">
                <span><i class="fa-solid fa-graduation-cap text-success ms-2"></i> المنهاج والتدرج السنوي</span>
                <span class="badge bg-success"><?php echo $stats['programmes']; ?> مقاطع</span>
            </button>

            <button class="sidebar-nav-btn <?php echo $active_tab === 'cours' ? 'active' : ''; ?>" onclick="switchWorkspaceTab('cours')">
                <span><i class="fa-solid fa-book-open text-primary ms-2"></i> مستودع الدروس والمفاهيم</span>
                <span class="badge bg-primary"><?php echo $stats['cours']; ?> دروس</span>
            </button>

            <button class="sidebar-nav-btn <?php echo $active_tab === 'exercices' ? 'active' : ''; ?>" onclick="switchWorkspaceTab('exercices')">
                <span><i class="fa-solid fa-pen-ruler text-danger ms-2"></i> بنك التمارين والأنشطة</span>
                <span class="badge bg-danger"><?php echo $stats['exercices']; ?> تمرين</span>
            </button>

            <button class="sidebar-nav-btn <?php echo $active_tab === 'evaluations' ? 'active' : ''; ?>" onclick="switchWorkspaceTab('evaluations')">
                <span><i class="fa-solid fa-file-signature text-info ms-2"></i> الفروض والاختبارات</span>
                <span class="badge bg-info text-dark"><?php echo $stats['evaluations']; ?> موضوع</span>
            </button>

            <button class="sidebar-nav-btn <?php echo $active_tab === 'scans' ? 'active' : ''; ?>" onclick="switchWorkspaceTab('scans')">
                <span><i class="fa-solid fa-images text-warning ms-2"></i> المستودع البصري (<?php echo $stats['pages_traitees']; ?> وثيقة)</span>
                <span class="badge bg-warning text-dark"><?php echo $stats['pages_livre']; ?> ص + <?php echo $stats['scans_evals']; ?> اختبار</span>
            </button>
        </div>

        <div class="p-3 border-top border-secondary border-opacity-25 bg-black bg-opacity-25">
            <!-- Theme Toggle Button dans le Sidebar -->
            <button class="btn btn-sm btn-dark text-white border border-secondary border-opacity-50 w-100 mb-2 fw-bold d-flex justify-content-between align-items-center py-2 px-3 rounded-3 shadow-sm" onclick="toggleTheme()" id="themeToggleBtn">
                <span class="small"><i class="fa-solid fa-circle-half-stroke text-warning ms-1"></i> مظهر المنصة :</span>
                <span class="small"><i class="fa-solid fa-sun text-warning ms-1" id="themeToggleIcon"></i> <span id="themeToggleText">الوضع النهاري</span></span>
            </button>

            <a href="automation.php" class="btn btn-sm btn-outline-success text-white w-100 mb-2 fw-bold shadow-sm">
                <i class="fa-solid fa-gears ms-1"></i> الأتمتة والبناء الآلي (Auto)
            </a>

            <a href="index.php" class="btn btn-sm btn-primary text-white w-100 mb-2 fw-bold shadow-sm">
                <i class="fa-solid fa-house ms-1"></i> البوابة المركزية (index.php)
            </a>
            <div class="d-flex justify-content-between align-items-center mb-2">
                <small class="text-secondary">صفحات الكتاب المدرسي</small>
                <span class="badge bg-secondary"><?php echo $stats['pages_livre']; ?> صفحة</span>
            </div>
            <a href="viewer.php" class="btn btn-sm btn-outline-secondary text-white w-100">
                <i class="fa-solid fa-arrow-left ms-1"></i> العارض الكلاسيكي (viewer.php)
            </a>
        </div>
    </aside>

    <!-- WORKSPACE -->
    <div class="app-workspace" id="appWorkspace">
        
        <!-- Sticky Topbar (Épurée sans encombrement) -->
        <header class="workspace-topbar">
            <div class="d-flex align-items-center gap-3">
                <a href="index.php" class="btn btn-outline-primary btn-sm rounded-pill px-3 fw-bold shadow-sm" title="العودة للبوابة الرئيسية">
                    <i class="fa-solid fa-house ms-1"></i> البوابة الرئيسية
                </a>
                <a href="automation.php" class="btn btn-outline-success btn-sm rounded-pill px-3 fw-bold shadow-sm" title="لوحة التحكم بالأتمتة">
                    <i class="fa-solid fa-gears ms-1"></i> الأتمتة
                </a>
                <button class="btn btn-outline-secondary btn-sm rounded-pill px-3 fw-bold shadow-sm" onclick="toggleSidebar()">
                    <i class="fa-solid fa-bars ms-1"></i> لوحة التحكم (Sidebar)
                </button>
                <div class="d-none d-md-block">
                    <span class="badge bg-warning text-dark me-1"><i class="fa-solid fa-graduation-cap ms-1"></i> <?php echo $active_niveau_info['nom_court']; ?></span>
                    <strong class="me-1"><?php echo $active_matiere_info['nom_ar']; ?></strong>
                    <span class="text-muted mx-1">/</span>
                    <span class="text-primary fw-bold" id="workspaceBreadcrumb">المصفوفة الشاملة 360°</span>
                </div>
            </div>

            <div class="d-flex align-items-center gap-2">
                <?php if($is_data_available): ?>
                    <span class="badge bg-warning text-dark px-3 py-2 fs-6 fw-bold shadow-sm" title="<?php echo $stats['pages_livre']; ?> صفحة كتاب رسمي + <?php echo $stats['scans_evals']; ?> وثيقة اختبار">
                        <i class="fa-solid fa-book-bookmark ms-1"></i> <?php echo $stats['pages_livre']; ?> صفحة كتاب (<?php echo $stats['pages_traitees']; ?> وثيقة ممسوحة)
                    </span>
                    <span class="badge bg-success px-3 py-2 fs-6 fw-bold shadow-sm">
                        <i class="fa-solid fa-database ms-1"></i> قاعدة بيانات معتمدة
                    </span>
                <?php else: ?>
                    <span class="badge bg-secondary px-3 py-2 fs-6 fw-bold">
                        <i class="fa-solid fa-clock ms-1"></i> قاعدة البيانات غير مبنية (0 سجلات)
                    </span>
                <?php endif; ?>
            </div>
        </header>

        <main class="p-3 p-md-4 flex-grow-1">

            <?php if(!$is_data_available): ?>
                <div class="text-center py-5">
                    <div class="content-box mx-auto p-5" style="max-width: 680px;">
                        <div class="fs-1 text-warning mb-3">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <h4 class="fw-bold mb-2">مادة : <?php echo $active_matiere_info['nom_ar']; ?> — <?php echo $active_niveau_info['nom_ar']; ?></h4>
                        <p class="text-muted mb-4">
                            قاعدة البيانات الخاصة بهذه المادة (<code><?php echo basename($db_path); ?></code>) غير منشأة حالياً أو تم تفريغها للاختبار (0 سجلات).
                        </p>
                        <div class="alert alert-warning border d-flex align-items-center gap-3 text-start justify-content-center p-3 mb-4">
                            <i class="fa-solid fa-circle-info fs-3 text-warning"></i>
                            <div>
                                <h6 class="fw-bold m-0 text-dark">جاهز للبناء الآلي الفوري :</h6>
                                <small class="text-muted">يمكنك تشغيل المحرك الآلي (Auto-Builder) في ثوانٍ لبناء كامل البيانات، الدروس، والتمارين.</small>
                            </div>
                        </div>
                        <a href="automation.php" class="btn btn-success rounded-pill px-4 py-2 fw-bold shadow-sm">
                            <i class="fa-solid fa-gears ms-1"></i> الانتقال إلى لوحة الأتمتة وبناء مادة الرياضيات
                        </a>
                    </div>
                </div>

            <?php else: ?>

                <!-- TAB 1: MATRICE RELATIONNELLE 360° -->
                <div id="tab-matrix" class="workspace-tab <?php echo $active_tab === 'matrix' ? '' : 'd-none'; ?>">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h4 class="fw-bold m-0"><i class="fa-solid fa-sitemap text-warning ms-2"></i> المصفوفة البيداغوجية المترابطة — <?php echo $active_matiere_info['nom_ar']; ?> (<?php echo $active_niveau_info['nom_court']; ?>)</h4>
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="toggleAllMatrixCards(true)"><i class="fa-solid fa-angles-down ms-1"></i> فتح الفصول</button>
                            <button class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="toggleAllMatrixCards(false)"><i class="fa-solid fa-angles-up ms-1"></i> طي الكل</button>
                        </div>
                    </div>

                    <?php foreach($curriculum_matrix as $trim_num => $trim_data): ?>
                    <div class="matrix-trim-card" data-trim="<?php echo $trim_num; ?>">
                        <div class="p-3 border-bottom d-flex flex-wrap justify-content-between align-items-center gap-2" style="background: var(--bg-surface-secondary); cursor: pointer;" data-bs-toggle="collapse" data-bs-target="#matrixTrim_<?php echo $trim_num; ?>">
                            <div class="d-flex align-items-center gap-3">
                                <span class="fs-4"><?php echo $trim_data['icon']; ?></span>
                                <div>
                                    <h5 class="fw-bold m-0"><?php echo $trim_data['label']; ?></h5>
                                    <small class="text-muted"><?php echo count($trim_data['sequences']); ?> مقاطع • <?php echo count($trim_data['cours']); ?> دروس • <?php echo $trim_data['exos_count']; ?> تمارين • <?php echo count($trim_data['evals']); ?> اختبارات</small>
                                </div>
                            </div>
                            <div class="d-flex align-items-center gap-2">
                                <span class="badge bg-<?php echo $trim_data['color']; ?> px-3 py-2 fs-6"><?php echo count($trim_data['cours']); ?> دروس</span>
                                <span class="badge bg-danger px-3 py-2 fs-6"><?php echo $trim_data['exos_count']; ?> تمرين</span>
                                <span class="badge bg-info text-dark px-3 py-2 fs-6"><?php echo count($trim_data['evals']); ?> اختبار</span>
                                <i class="fa-solid fa-chevron-down ms-2 text-muted"></i>
                            </div>
                        </div>

                        <div class="collapse matrix-trim-collapse p-3 p-md-4" id="matrixTrim_<?php echo $trim_num; ?>">
                            <div class="row g-3">
                                <div class="col-12 col-lg-8">
                                    <h6 class="fw-bold text-uppercase text-secondary mb-3"><i class="fa-solid fa-book-open text-primary ms-1"></i> الوحدات التعليمية والتمارين الموثقة بصفحاتها :</h6>
                                    <?php foreach($trim_data['cours'] as $c_item): ?>
                                    <div class="relational-node" id="matrix_node_<?php echo $c_item['id']; ?>">
                                        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
                                            <div>
                                                <span class="badge bg-warning text-dark fw-bold ms-1">الدرس <?php echo $c_item['id']; ?></span>
                                                <h6 class="fw-bold d-inline-block m-0"><?php echo htmlspecialchars($c_item['titre_cours']); ?></h6>
                                            </div>
                                            <span class="badge bg-secondary border">📄 ص <?php echo $c_item['page_debut']; ?> إلى ص <?php echo $c_item['page_fin']; ?></span>
                                        </div>
                                        <p class="small text-muted mb-2"><i class="fa-solid fa-compass text-muted ms-1"></i> <?php echo htmlspecialchars($c_item['projet_ou_sequence']); ?></p>
                                        <div class="d-flex flex-wrap align-items-center gap-2 pt-2 border-top">
                                            <button class="bridge-btn bridge-cours" onclick="jumpToCours(<?php echo $c_item['id']; ?>)">
                                                <i class="fa-solid fa-book-open-reader"></i> قراءة نص الدرس
                                            </button>
                                            <button class="bridge-btn bridge-exo" onclick="filterExercicesByCours(<?php echo $c_item['id']; ?>)">
                                                <i class="fa-solid fa-pen-ruler"></i> <?php echo $c_item['exos_count']; ?> تمارين مرتبطة
                                            </button>
                                            <button class="bridge-btn bridge-prog" onclick="jumpToProgramme(<?php echo $c_item['programme_id']; ?>)">
                                                <i class="fa-solid fa-graduation-cap"></i> المقطع الوزاري
                                            </button>
                                            <button class="bridge-btn bridge-scan" onclick="jumpToScanPage(<?php echo $c_item['page_debut']; ?>)">
                                                <i class="fa-solid fa-image"></i> مسح الكتاب (ص <?php echo $c_item['page_debut']; ?>)
                                            </button>
                                        </div>
                                    </div>
                                    <?php endforeach; ?>
                                </div>

                                <div class="col-12 col-lg-4">
                                    <h6 class="fw-bold text-uppercase text-secondary mb-3"><i class="fa-solid fa-file-signature text-info ms-1"></i> بنك الفروض والاختبارات المطابقة (<?php echo count($trim_data['evals']); ?>) :</h6>
                                    <?php if(empty($trim_data['evals'])): ?>
                                        <div class="alert alert-secondary border small text-muted">لا توجد نماذج مسجلة لهذا الفصل.</div>
                                    <?php else: ?>
                                        <?php foreach($trim_data['evals'] as $ev_item): ?>
                                        <div class="p-3 mb-2 rounded-3 border" style="background: var(--bg-surface-secondary);">
                                            <div class="d-flex justify-content-between align-items-center mb-1">
                                                <span class="badge bg-primary">نموذج <?php echo $ev_item['id']; ?></span>
                                                <h6 class="fw-bold m-0 small text-truncate" style="max-width: 200px;"><?php echo htmlspecialchars($ev_item['type_eval']); ?></h6>
                                            </div>
                                            <div class="d-flex gap-1 mt-2">
                                                <button class="bridge-btn bridge-eval w-100 justify-content-center" onclick="jumpToEval(<?php echo $ev_item['id']; ?>)">
                                                    <i class="fa-solid fa-eye"></i> معاينة الموضوع والحل
                                                </button>
                                            </div>
                                        </div>
                                        <?php endforeach; ?>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </div>
                    </div>
                    <?php endforeach; ?>
                </div>

                <!-- TAB 2: PROGRAMME OFFICIEL MEN 2G -->
                <div id="tab-programme" class="workspace-tab <?php echo $active_tab === 'programme' ? '' : 'd-none'; ?>">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <h4 class="fw-bold m-0"><i class="fa-solid fa-graduation-cap text-success ms-2"></i> المنهاج والتدرج السنوي لبناء التعلمات (الجيل الثاني)</h4>
                            <small class="text-muted">المخطط الوزاري الرسمي الصادر عن وزارة التربية الوطنية — المقطع، الموارد والكفاءات المستهدفة</small>
                        </div>
                    </div>

                    <div class="row g-3">
                        <?php foreach($all_programmes as $p_row): ?>
                        <div class="col-12 col-lg-6 programme-card" data-trim="<?php echo $p_row['trimestre']; ?>" id="programme_card_<?php echo $p_row['id']; ?>">
                            <div class="content-box h-100 p-3">
                                <div class="d-flex justify-content-between align-items-start gap-2 mb-2 pb-2 border-bottom">
                                    <div>
                                        <span class="badge bg-success ms-1">مقطع #<?php echo $p_row['id']; ?></span>
                                        <span class="badge bg-info text-dark">الفصل <?php echo $p_row['trimestre']; ?></span>
                                    </div>
                                    <span class="badge bg-secondary border"><?php echo htmlspecialchars($p_row['source_officielle']); ?></span>
                                </div>

                                <h5 class="fw-bold mb-2"><?php echo htmlspecialchars($p_row['projet_ou_sequence']); ?></h5>

                                <div class="mb-3 p-3 rounded-3 border" style="background: var(--bg-surface-secondary);">
                                    <h6 class="fw-bold text-secondary small mb-2"><i class="fa-solid fa-list-check ms-1"></i> الموارد المعرفية والمفاهيم المستهدفة :</h6>
                                    <p class="small m-0 text-muted" style="line-height: 1.8;"><?php echo nl2br(htmlspecialchars($p_row['ressource_constituante'])); ?></p>
                                </div>

                                <div class="pt-2 border-top">
                                    <h6 class="fw-bold text-primary small mb-2"><i class="fa-solid fa-diagram-project ms-1"></i> الارتباطات الميدانية المباشرة :</h6>
                                    <div class="d-flex flex-wrap gap-2">
                                        <?php 
                                        foreach($all_cours as $c_sub): 
                                            if($c_sub['programme_id'] == $p_row['id']):
                                        ?>
                                            <button class="bridge-btn bridge-cours" onclick="jumpToCours(<?php echo $c_sub['id']; ?>)">
                                                <i class="fa-solid fa-book-open"></i> الدرس <?php echo $c_sub['id']; ?> (ص <?php echo $c_sub['page_debut']; ?>-<?php echo $c_sub['page_fin']; ?>)
                                            </button>
                                            <button class="bridge-btn bridge-exo" onclick="filterExercicesByCours(<?php echo $c_sub['id']; ?>)">
                                                <i class="fa-solid fa-pen-ruler"></i> <?php echo $c_sub['exos_count']; ?> تمارين المقطع
                                            </button>
                                        <?php 
                                            endif;
                                        endforeach; 
                                        ?>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>

                <!-- TAB 3: COURS & NOTIONS KATEX -->
                <div id="tab-cours" class="workspace-tab <?php echo $active_tab === 'cours' ? '' : 'd-none'; ?>">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <h4 class="fw-bold m-0"><i class="fa-solid fa-book-open text-primary ms-2"></i> مستودع الدروس والمفاهيم العلمية (KaTeX + وثائق الكتاب عند الطلب)</h4>
                            <small class="text-muted">محتوى كامل 100% بعرض الشاشة مع إمكانية استدعاء صفحات الكتاب الأصلية جنباً إلى جنب</small>
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="toggleAllCoursBodies(true)"><i class="fa-solid fa-angles-down ms-1"></i> فتح كل الدروس</button>
                            <button class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="toggleAllCoursBodies(false)"><i class="fa-solid fa-angles-up ms-1"></i> طي الكل</button>
                        </div>
                    </div>

                    <?php foreach($all_cours as $c_idx => $c_row): ?>
                    <div class="content-box mb-4 cours-item-card" data-trim="<?php echo $c_row['trimestre']; ?>" id="cours_view_<?php echo $c_row['id']; ?>">
                        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 pb-2">
                            <div class="d-flex align-items-center gap-2" data-bs-toggle="collapse" data-bs-target="#coursBody_<?php echo $c_row['id']; ?>" style="cursor: pointer; flex-grow: 1;">
                                <span class="badge bg-primary fs-6">الدرس <?php echo $c_row['id']; ?></span>
                                <h5 class="fw-bold m-0"><?php echo htmlspecialchars($c_row['titre_cours']); ?></h5>
                                <span class="badge bg-warning text-dark">الفصل <?php echo $c_row['trimestre']; ?></span>
                                <span class="badge bg-secondary">ص <?php echo $c_row['page_debut']; ?> - <?php echo $c_row['page_fin']; ?></span>
                            </div>
                            <div class="d-flex flex-wrap gap-2">
                                <button class="btn btn-sm btn-outline-warning text-dark fw-bold rounded-pill px-3" id="coursScansBtn_<?php echo $c_row['id']; ?>" onclick="toggleCoursScansSideBySide(<?php echo $c_row['id']; ?>)">
                                    <i class="fa-solid fa-file-image ms-1"></i> وثائق صفحات الكتاب (ص <?php echo $c_row['page_debut']; ?>-<?php echo $c_row['page_fin']; ?>)
                                </button>
                                <button class="bridge-btn bridge-exo" onclick="filterExercicesByCours(<?php echo $c_row['id']; ?>)">
                                    <i class="fa-solid fa-pen-ruler"></i> <?php echo $c_row['exos_count']; ?> تمارين
                                </button>
                                <button class="bridge-btn bridge-prog" onclick="jumpToProgramme(<?php echo $c_row['programme_id']; ?>)">
                                    <i class="fa-solid fa-graduation-cap"></i> المنهاج
                                </button>
                                <button class="bridge-btn bridge-scan" onclick="jumpToScanPage(<?php echo $c_row['page_debut']; ?>)">
                                    <i class="fa-solid fa-image"></i> مسح ص <?php echo $c_row['page_debut']; ?>
                                </button>
                                <button class="btn btn-sm btn-outline-secondary" data-bs-toggle="collapse" data-bs-target="#coursBody_<?php echo $c_row['id']; ?>">
                                    <i class="fa-solid fa-chevron-down"></i>
                                </button>
                            </div>
                        </div>

                        <div class="collapse cours-body-collapse pt-3 mt-2 border-top" id="coursBody_<?php echo $c_row['id']; ?>">
                            <div class="row g-4 align-items-start" id="coursRow_<?php echo $c_row['id']; ?>">
                                <div class="col-12 fluid-pane" id="coursTextCol_<?php echo $c_row['id']; ?>">
                                    <div class="p-3 rounded-3 border" style="background: var(--bg-surface);">
                                        <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                                            <span class="badge bg-primary fs-6"><i class="fa-solid fa-book-open ms-1"></i> النص البيداغوجي المرقمن (KaTeX)</span>
                                            <span class="text-muted small">الصفحات <?php echo $c_row['page_debut']; ?> إلى <?php echo $c_row['page_fin']; ?></span>
                                        </div>
                                        <textarea class="raw-markdown-content d-none"><?php echo htmlspecialchars($c_row['contenu_texte']); ?></textarea>
                                        <div class="rendered-html-container"></div>
                                    </div>
                                </div>

                                <div class="col-12 col-xl-6 d-none fluid-pane" id="coursScansCol_<?php echo $c_row['id']; ?>">
                                    <div class="scans-side-rail">
                                        <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                                            <span class="badge bg-warning text-dark fs-6"><i class="fa-solid fa-file-image ms-1"></i> وثائق ورسوم الكتاب المدرسي (<?php echo ($c_row['page_fin'] - $c_row['page_debut'] + 1); ?> صفحة)</span>
                                            <button class="btn btn-sm btn-outline-secondary border-0 py-0 px-2" onclick="toggleCoursScansSideBySide(<?php echo $c_row['id']; ?>)" title="إغلاق العرض المتوازي">
                                                <i class="fa-solid fa-xmark"></i>
                                            </button>
                                        </div>
                                        <div class="d-flex flex-column gap-3">
                                            <?php for($p_scan = $c_row['page_debut']; $p_scan <= min(210, $c_row['page_fin']); $p_scan++): 
                                                $scan_img = resolve_img_path("{$scans_base_dir}/page_{$p_scan}.jpg");
                                            ?>
                                                <div class="border rounded-3 overflow-hidden shadow-sm" style="background: var(--bg-surface);">
                                                    <div class="d-flex justify-content-between align-items-center p-2 bg-dark text-white">
                                                        <span class="fw-bold"><i class="fa-solid fa-image text-warning ms-1"></i> صفحة كتاب مدرسي رقم <?php echo $p_scan; ?></span>
                                                        <button class="btn btn-xs btn-outline-light py-0 px-2 small" onclick="openPageScanModal(<?php echo $p_scan; ?>)">
                                                             <i class="fa-solid fa-expand ms-1"></i> تكبير
                                                        </button>
                                                    </div>
                                                    <img src="<?php echo $scan_img; ?>" loading="lazy" class="img-fluid w-100" style="cursor: pointer;" onclick="openPageScanModal(<?php echo $p_scan; ?>)" alt="صفحة <?php echo $p_scan; ?>">
                                                </div>
                                            <?php endfor; ?>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <?php endforeach; ?>
                </div>

                <!-- TAB 4: EXERCICES (690) -->
                <div id="tab-exercices" class="workspace-tab <?php echo $active_tab === 'exercices' ? '' : 'd-none'; ?>">
                    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
                        <div>
                            <h4 class="fw-bold m-0"><i class="fa-solid fa-pen-ruler text-danger ms-2"></i> بنك التمارين والأنشطة المحلولة (690 تمريناً)</h4>
                            <small class="text-muted" id="exoFilterStatus">عرض كامل التمارين والأنشطة الموثقة بصفحة الكتاب المدرسي والحلول المعيارية</small>
                        </div>
                        <div class="d-flex flex-wrap gap-2">
                            <div class="btn-group btn-group-sm">
                                <button class="btn btn-outline-secondary active" onclick="filterExosByTrim(0)">الكل (690)</button>
                                <button class="btn btn-outline-primary" onclick="filterExosByTrim(1)">ف 1</button>
                                <button class="btn btn-outline-info" onclick="filterExosByTrim(2)">ف 2</button>
                                <button class="btn btn-outline-success" onclick="filterExosByTrim(3)">ف 3</button>
                            </div>
                            <button class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="toggleAllExoBodies(true)"><i class="fa-solid fa-angles-down ms-1"></i> فتح الحلول</button>
                            <button class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="toggleAllExoBodies(false)"><i class="fa-solid fa-angles-up ms-1"></i> طي الحلول</button>
                        </div>
                    </div>

                    <div class="row g-3" id="exercicesGrid">
                        <?php foreach($all_exercices as $e_idx => $e_row): ?>
                        <div class="col-12 col-xl-6 exo-grid-item" data-cours-id="<?php echo $e_row['cours_id']; ?>" data-page-num="<?php echo $e_row['page_num']; ?>" data-trim="<?php echo $e_row['trimestre']; ?>" id="exo_card_<?php echo $e_row['id']; ?>">
                            <div class="content-box h-100 p-3">
                                <div class="d-flex justify-content-between align-items-start gap-2 mb-2 pb-2 border-bottom">
                                    <div>
                                        <span class="badge bg-danger ms-1">تمرين <?php echo $e_row['id']; ?></span>
                                        <span class="badge bg-secondary border">📄 ص <?php echo $e_row['page_num']; ?></span>
                                        <span class="badge bg-info text-dark">الفصل <?php echo $e_row['trimestre']; ?></span>
                                    </div>
                                    <div class="d-flex gap-1">
                                        <button class="bridge-btn bridge-cours py-0 px-2 small" onclick="jumpToCours(<?php echo $e_row['cours_id']; ?>)">
                                            <i class="fa-solid fa-book-open"></i> الدرس <?php echo $e_row['cours_id']; ?>
                                        </button>
                                        <button class="bridge-btn bridge-scan py-0 px-2 small" onclick="jumpToScanPage(<?php echo $e_row['page_num']; ?>)">
                                            <i class="fa-solid fa-image"></i> مسح ص <?php echo $e_row['page_num']; ?>
                                        </button>
                                        <button class="btn btn-xs btn-outline-secondary py-0 px-2 small" data-bs-toggle="collapse" data-bs-target="#exoScanCollapse_<?php echo $e_row['id']; ?>" title="معاينة الصفحة الأصلية المباشرة">
                                            <i class="fa-solid fa-eye"></i>
                                        </button>
                                    </div>
                                </div>

                                <div class="collapse mb-2" id="exoScanCollapse_<?php echo $e_row['id']; ?>">
                                    <div class="p-2 bg-dark rounded-3 text-center">
                                        <div class="d-flex justify-content-between text-white small mb-1 px-1">
                                            <span>📖 صفحة الكتاب المدرسي رقم <?php echo $e_row['page_num']; ?></span>
                                            <span class="text-warning" style="cursor: pointer;" onclick="openPageScanModal(<?php echo $e_row['page_num']; ?>)">تكبير كامل الشاشة <i class="fa-solid fa-up-right-and-down-left-from-center ms-1"></i></span>
                                        </div>
                                        <?php $exo_scan_img = resolve_img_path("{$scans_base_dir}/page_{$e_row['page_num']}.jpg"); ?>
                                        <img src="<?php echo $exo_scan_img; ?>" loading="lazy" class="img-fluid rounded border" style="max-height: 280px;" alt="صفحة <?php echo $e_row['page_num']; ?>">
                                    </div>
                                </div>

                                <div class="mb-2">
                                    <h6 class="fw-bold text-secondary small mb-1"><i class="fa-solid fa-question-circle ms-1"></i> نص التمرين / النشاط :</h6>
                                    <textarea class="raw-markdown-content d-none"><?php echo htmlspecialchars($e_row['enonce']); ?></textarea>
                                    <div class="rendered-html-container small p-3 rounded-3 border" style="background: var(--bg-surface-secondary);"></div>
                                </div>

                                <?php if(!empty($e_row['correction'])): ?>
                                <div>
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <h6 class="fw-bold text-success small m-0"><i class="fa-solid fa-check-circle ms-1"></i> الحل النموذجي :</h6>
                                        <button class="btn btn-xs btn-outline-success py-0 px-2 small" data-bs-toggle="collapse" data-bs-target="#corrigeCollapse_<?php echo $e_row['id']; ?>">إظهار الحل</button>
                                    </div>
                                    <div class="collapse" id="corrigeCollapse_<?php echo $e_row['id']; ?>">
                                        <textarea class="raw-markdown-content d-none"><?php echo htmlspecialchars($e_row['correction']); ?></textarea>
                                        <div class="rendered-html-container small p-3 rounded-3 border" style="background: rgba(16, 185, 129, 0.08);"></div>
                                    </div>
                                </div>
                                <?php endif; ?>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>

                <!-- TAB 5: EVALUATIONS (27) -->
                <div id="tab-evaluations" class="workspace-tab <?php echo $active_tab === 'evaluations' ? '' : 'd-none'; ?>">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <h4 class="fw-bold m-0"><i class="fa-solid fa-file-signature text-info ms-2"></i> بنك الفروض والامتحانات الرسمية الشاملة (27 نموذجاً)</h4>
                            <small class="text-muted">مواضيع كاملة بعرض 100% مع ميزة المعاينة المتوازية للحل والسلّم عند الطلب</small>
                        </div>
                    </div>

                    <?php foreach($all_evaluations as $ev_idx => $ev_row): ?>
                    <div class="content-box mb-4 eval-item-card" data-trim="<?php echo $ev_row['trimestre']; ?>" id="eval_view_<?php echo $ev_row['id']; ?>">
                        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 pb-3 mb-3 border-bottom">
                            <div class="d-flex align-items-center gap-2">
                                <span class="badge bg-primary fs-6">نموذج <?php echo $ev_row['id']; ?></span>
                                <h5 class="fw-bold m-0"><?php echo htmlspecialchars($ev_row['type_eval']); ?></h5>
                                <span class="badge bg-info text-dark">الفصل <?php echo $ev_row['trimestre']; ?></span>
                            </div>
                            <div class="d-flex flex-wrap gap-2">
                                <button class="btn btn-sm btn-outline-success rounded-pill px-3 fw-bold" id="evalToggleBtn_<?php echo $ev_row['id']; ?>" onclick="toggleEvalSideBySide(<?php echo $ev_row['id']; ?>)">
                                    <i class="fa-solid fa-table-columns ms-1"></i> معاينة متوازية (موضوع + تصحيح)
                                </button>

                                <?php 
                                $sujet_imgs = [];
                                if (!empty($ev_row['images_sujet'])) {
                                    $dec = json_decode($ev_row['images_sujet'], true);
                                    $sujet_imgs = is_array($dec) ? $dec : explode(',', $ev_row['images_sujet']);
                                }
                                foreach($sujet_imgs as $s_idx => $s_path):
                                    $resolved_s = resolve_img_path($s_path);
                                    if (empty($resolved_s)) continue;
                                ?>
                                    <button class="bridge-btn bridge-eval" onclick="openCustomImageModal('<?php echo $resolved_s; ?>', 'وثيقة موضوع: <?php echo htmlspecialchars($ev_row['type_eval']); ?>')">
                                        <i class="fa-solid fa-file-lines"></i> وثيقة الموضوع (<?php echo $s_idx + 1; ?>)
                                    </button>
                                <?php endforeach; ?>

                                <?php 
                                $corr_imgs = [];
                                if (!empty($ev_row['images_corrige'])) {
                                    $dec = json_decode($ev_row['images_corrige'], true);
                                    $corr_imgs = is_array($dec) ? $dec : explode(',', $ev_row['images_corrige']);
                                }
                                foreach($corr_imgs as $c_idx => $c_path):
                                    $resolved_c = resolve_img_path($c_path);
                                    if (empty($resolved_c)) continue;
                                ?>
                                    <button class="bridge-btn bridge-cours" onclick="openCustomImageModal('<?php echo $resolved_c; ?>', 'وثيقة حل: <?php echo htmlspecialchars($ev_row['type_eval']); ?>')">
                                        <i class="fa-solid fa-circle-check"></i> وثيقة الحل (<?php echo $c_idx + 1; ?>)
                                    </button>
                                <?php endforeach; ?>
                            </div>
                        </div>

                        <div class="row g-3 align-items-start" id="evalRow_<?php echo $ev_row['id']; ?>">
                            <div class="col-12 fluid-pane" id="evalSujetCol_<?php echo $ev_row['id']; ?>">
                                <div class="p-3 rounded-3 border h-100" style="background: var(--bg-surface);">
                                    <h6 class="fw-bold text-primary mb-2 border-bottom pb-2"><i class="fa-solid fa-file-lines ms-1"></i> نص موضوع الاختبار الرسمي :</h6>
                                    <textarea class="raw-markdown-content d-none"><?php echo htmlspecialchars($ev_row['enonce_sujet']); ?></textarea>
                                    <div class="rendered-html-container"></div>
                                </div>
                            </div>

                            <div class="col-12 col-xl-6 d-none fluid-pane" id="evalCorrigeCol_<?php echo $ev_row['id']; ?>">
                                <div class="p-3 rounded-3 border h-100" style="background: rgba(16, 185, 129, 0.08);">
                                    <div class="d-flex justify-content-between align-items-center mb-2 border-bottom pb-2">
                                        <h6 class="fw-bold text-success m-0"><i class="fa-solid fa-check-double ms-1"></i> عناصر الإجابة النموذجية وسلّم التنقيط :</h6>
                                        <button class="btn btn-sm btn-outline-secondary border-0 py-0 px-2" onclick="toggleEvalSideBySide(<?php echo $ev_row['id']; ?>)" title="إغلاق العرض المتوازي">
                                            <i class="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <textarea class="raw-markdown-content d-none"><?php echo htmlspecialchars($ev_row['corrige_sujet']); ?></textarea>
                                    <div class="rendered-html-container"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <?php endforeach; ?>
                </div>

                <!-- TAB 6: GALERIE RELATIONNELLE COMPLÈTE (201 PAGES LIVRE + 71 SCANS EXAMS) -->
                <div id="tab-scans" class="workspace-tab <?php echo $active_tab === 'scans' ? '' : 'd-none'; ?>">
                    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
                        <div>
                            <h4 class="fw-bold m-0"><i class="fa-solid fa-images text-warning ms-2"></i> المستودع البصري الشامل للوثائق والمسوح الرسمية (<?php echo count($pages_manifest) + count($eval_manifest); ?> وثيقة)</h4>
                            <small class="text-muted">معاينة صفحات الكتاب المدرسي (201 ص) + مسوح ووثائق الفروض والامتحانات الرسمية (<?php echo count($eval_manifest); ?> وثيقة)</small>
                        </div>
                        <div class="d-flex flex-wrap gap-2">
                            <button class="btn btn-sm btn-outline-secondary rounded-pill px-3 active" id="filterScanBtn_all" onclick="filterScansCategory('all')">الكل (<?php echo count($pages_manifest) + count($eval_manifest); ?>)</button>
                            <button class="btn btn-sm btn-outline-warning text-dark fw-bold rounded-pill px-3" id="filterScanBtn_textbook" onclick="filterScansCategory('textbook')">📚 صفحات الكتاب (<?php echo count($pages_manifest); ?>)</button>
                            <button class="btn btn-sm btn-outline-info text-dark fw-bold rounded-pill px-3" id="filterScanBtn_eval" onclick="filterScansCategory('eval')">📑 وثائق الاختبارات (<?php echo count($eval_manifest); ?>)</button>
                            <div class="vr mx-1"></div>
                            <button class="btn btn-sm btn-outline-primary rounded-pill px-2" onclick="filterScansByTrim(1)">ف 1</button>
                            <button class="btn btn-sm btn-outline-info rounded-pill px-2" onclick="filterScansByTrim(2)">ف 2</button>
                            <button class="btn btn-sm btn-outline-success rounded-pill px-2" onclick="filterScansByTrim(3)">ف 3</button>
                        </div>
                    </div>

                    <div class="row g-3" id="scansGalleryGrid">
                        <!-- 1. PAGES DU LIVRE OFFICIEL (201) -->
                        <?php foreach($pages_manifest as $p_item): ?>
                        <div class="col-6 col-md-4 col-lg-3 col-xl-2 scan-page-item" data-category="textbook" data-trim="<?php echo $p_item['trimestre']; ?>" id="scan_card_<?php echo $p_item['page_num']; ?>">
                            <div class="scan-grid-card h-100 d-flex flex-column">
                                <div class="scan-thumb-wrap" onclick="openPageScanModal(<?php echo $p_item['page_num']; ?>)">
                                    <img src="<?php echo $p_item['img_path']; ?>" loading="lazy" alt="الصفحة <?php echo $p_item['page_num']; ?>">
                                    <span class="badge bg-primary position-absolute top-0 start-0 m-2 font-num shadow-sm" style="cursor: pointer;" onclick="event.stopPropagation(); openPageScanModal(<?php echo $p_item['page_num']; ?>)" title="انقر لتكبير الوثيقة">ص <?php echo $p_item['page_num']; ?></span>
                                    <span class="badge bg-dark bg-opacity-75 position-absolute bottom-0 end-0 m-2 small shadow-sm" style="cursor: pointer;" onclick="event.stopPropagation(); filterScansByTrim(<?php echo $p_item['trimestre']; ?>)" title="انقر لتصفية الفصل <?php echo $p_item['trimestre']; ?>">كتاب • ف <?php echo $p_item['trimestre']; ?></span>
                                </div>
                                <div class="p-2 d-flex flex-column justify-content-between flex-grow-1 border-top" style="background: var(--bg-surface);">
                                    <div class="mb-2">
                                        <small class="text-muted d-block text-truncate" title="<?php echo htmlspecialchars($p_item['cours_titre']); ?>">
                                            <i class="fa-solid fa-book-bookmark text-primary ms-1"></i> <?php echo htmlspecialchars($p_item['cours_titre']); ?>
                                        </small>
                                        <span class="badge bg-danger-subtle text-danger border mt-1 small" style="cursor: pointer;" onclick="filterExercicesByPage(<?php echo $p_item['page_num']; ?>)" title="عرض تمارين هذه الصفحة في بنك التمارين">
                                            <i class="fa-solid fa-pen-ruler ms-1"></i> <?php echo $p_item['exos_count']; ?> تمارين
                                        </span>
                                    </div>
                                    <div class="d-flex gap-1 pt-1 border-top">
                                        <?php if($p_item['cours_id']): ?>
                                        <button class="bridge-btn bridge-cours py-0 px-2 w-50 justify-content-center small" onclick="jumpToCours(<?php echo $p_item['cours_id']; ?>)" title="قراءة الدرس">
                                            الدرس
                                        </button>
                                        <?php endif; ?>
                                        <button class="bridge-btn bridge-scan py-0 px-2 w-50 justify-content-center small" onclick="openPageScanModal(<?php echo $p_item['page_num']; ?>)" title="تكبير الوثيقة">
                                            <i class="fa-solid fa-expand"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <?php endforeach; ?>

                        <!-- 2. SCANS DES DEVOIRS ET EXAMENS (71) -->
                        <?php foreach($eval_manifest as $ev_scan): ?>
                        <div class="col-6 col-md-4 col-lg-3 col-xl-2 scan-page-item" data-category="eval" data-trim="<?php echo $ev_scan['trimestre']; ?>">
                            <div class="scan-grid-card h-100 d-flex flex-column border-info">
                                <div class="scan-thumb-wrap" onclick="openCustomImageModal('<?php echo $ev_scan['img_path']; ?>', '<?php echo htmlspecialchars($ev_scan['eval_titre'] . ' — ' . $ev_scan['page_label']); ?>')">
                                    <img src="<?php echo $ev_scan['img_path']; ?>" loading="lazy" alt="<?php echo htmlspecialchars($ev_scan['eval_titre']); ?>">
                                    <span class="badge bg-<?php echo $ev_scan['type'] === 'sujet' ? 'info text-dark' : 'success'; ?> position-absolute top-0 start-0 m-2 font-num shadow-sm" style="cursor: pointer;" onclick="event.stopPropagation(); jumpToEval(<?php echo $ev_scan['eval_id']; ?>)" title="انقر للانتقال المباشر للنموذج">
                                        <?php echo $ev_scan['page_label']; ?>
                                    </span>
                                    <span class="badge bg-dark bg-opacity-75 position-absolute bottom-0 end-0 m-2 small shadow-sm" style="cursor: pointer;" onclick="event.stopPropagation(); filterScansByTrim(<?php echo $ev_scan['trimestre']; ?>)" title="انقر لتصفية الفصل <?php echo $ev_scan['trimestre']; ?>">ف <?php echo $ev_scan['trimestre']; ?></span>
                                </div>
                                <div class="p-2 d-flex flex-column justify-content-between flex-grow-1 border-top" style="background: var(--bg-surface);">
                                    <div class="mb-2">
                                        <small class="text-muted d-block text-truncate fw-bold" title="<?php echo htmlspecialchars($ev_scan['eval_titre']); ?>">
                                            <i class="fa-solid fa-file-signature text-info ms-1"></i> <?php echo htmlspecialchars($ev_scan['eval_titre']); ?>
                                        </small>
                                        <span class="badge bg-<?php echo $ev_scan['type'] === 'sujet' ? 'info-subtle text-info' : 'success-subtle text-success'; ?> border mt-1 small" style="cursor: pointer;" onclick="jumpToEval(<?php echo $ev_scan['eval_id']; ?>)" title="عرض في بنك الاختبارات">
                                            <?php echo $ev_scan['type'] === 'sujet' ? 'موضوع امتحان' : 'حل وسلّم تنقيط'; ?>
                                        </span>
                                    </div>
                                    <div class="d-flex gap-1 pt-1 border-top">
                                        <button class="bridge-btn bridge-eval py-0 px-2 w-50 justify-content-center small" onclick="jumpToEval(<?php echo $ev_scan['eval_id']; ?>)" title="معاينة في بنك الاختبارات">
                                            النموذج
                                        </button>
                                        <button class="bridge-btn bridge-scan py-0 px-2 w-50 justify-content-center small" onclick="openCustomImageModal('<?php echo $ev_scan['img_path']; ?>', '<?php echo htmlspecialchars($ev_scan['eval_titre'] . ' — ' . $ev_scan['page_label']); ?>')" title="تكبير الوثيقة">
                                            <i class="fa-solid fa-expand"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>

            <?php endif; ?>

        </main>
    </div>

</div>

<!-- Floating Action Button for Mobile -->
<button class="floating-sidebar-toggle" onclick="toggleSidebar()">
    <i class="fa-solid fa-bars"></i>
</button>

<!-- Universal Image Scan Modal -->
<div class="modal fade" id="masterImageModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
            <div class="modal-header bg-dark text-white">
                <h6 class="modal-title m-0 fw-bold" id="masterModalTitle"><i class="fa-solid fa-image ms-1"></i> معاينة الوثيقة الرسمية</h6>
                <button type="button" class="btn-close btn-close-white ms-0 me-auto" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body text-center p-3 bg-dark" style="max-height: 85vh; overflow-y: auto;">
                <img id="masterModalImg" src="" class="img-fluid rounded border shadow" alt="Scan Page" style="max-width: 900px; width: 100%;">
            </div>
        </div>
    </div>
</div>

<!-- Bootstrap 5.3 JS -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>

<script>
    // 0. Dual Theme Engine (Dark Navy <-> Light Modern)
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

    // 1. Toggle Sidebar & Keyboard Shortcut
    function toggleSidebar() {
        let sidebar = document.getElementById('appSidebar');
        let workspace = document.getElementById('appWorkspace');
        if (sidebar) {
            sidebar.classList.toggle('show-sidebar');
        }
        if (workspace && window.innerWidth > 992) {
            workspace.classList.toggle('with-sidebar');
        }
    }

    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
    });

    // 2. Moteur Universel d'Animation et de Halo Radiant (Target Highlight & Scroll)
    function highlightAndFocusElement(targetEl, tabKey) {
        if (!targetEl) return;
        if (tabKey) switchWorkspaceTab(tabKey);

        let parentCollapse = targetEl.closest('.collapse');
        if (parentCollapse && !parentCollapse.classList.contains('show')) {
            bootstrap.Collapse.getOrCreateInstance(parentCollapse, { toggle: false }).show();
        }

        setTimeout(function() {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.remove('target-highlight');
            void targetEl.offsetWidth;
            targetEl.classList.add('target-highlight');
            setTimeout(() => targetEl.classList.remove('target-highlight'), 2300);
        }, 120);
    }

    // 3. Toggle Side-by-Side Dynamique dans les Cours (100% -> 50/50)
    function toggleCoursScansSideBySide(coursId) {
        let textCol = document.getElementById('coursTextCol_' + coursId);
        let scansCol = document.getElementById('coursScansCol_' + coursId);
        let btn = document.getElementById('coursScansBtn_' + coursId);
        if (!textCol || !scansCol) return;

        let isHidden = scansCol.classList.contains('d-none');
        if (isHidden) {
            scansCol.classList.remove('d-none');
            textCol.classList.remove('col-12');
            textCol.classList.add('col-xl-6');
            if (btn) btn.classList.replace('btn-outline-warning', 'btn-warning');
            highlightAndFocusElement(scansCol);
        } else {
            scansCol.classList.add('d-none');
            textCol.classList.remove('col-xl-6');
            textCol.classList.add('col-12');
            if (btn) btn.classList.replace('btn-warning', 'btn-outline-warning');
        }
    }

    // 4. Toggle Side-by-Side Dynamique dans les Évaluations (100% -> 50/50)
    function toggleEvalSideBySide(evalId) {
        let sujetCol = document.getElementById('evalSujetCol_' + evalId);
        let corrigeCol = document.getElementById('evalCorrigeCol_' + evalId);
        let btn = document.getElementById('evalToggleBtn_' + evalId);
        if (!sujetCol || !corrigeCol) return;

        let isHidden = corrigeCol.classList.contains('d-none');
        if (isHidden) {
            corrigeCol.classList.remove('d-none');
            sujetCol.classList.remove('col-12');
            sujetCol.classList.add('col-xl-6');
            if (btn) {
                btn.classList.replace('btn-outline-success', 'btn-success');
                btn.classList.add('text-white');
            }
            let target = corrigeCol.querySelector('.rendered-html-container');
            let raw = corrigeCol.querySelector('.raw-markdown-content');
            if (target && raw && !target.dataset.rendered) {
                renderMarkdownWithKaTeX(raw.value || raw.textContent || '', target);
            }
            highlightAndFocusElement(corrigeCol);
        } else {
            corrigeCol.classList.add('d-none');
            sujetCol.classList.remove('col-xl-6');
            sujetCol.classList.add('col-12');
            if (btn) {
                btn.classList.replace('btn-success', 'btn-outline-success');
                btn.classList.remove('text-white');
            }
        }
    }

    // 5. Gestion des Onglets du Workspace avec Animation de Transition
    const tabLabels = {
        'matrix': 'المصفوفة الشاملة 360°',
        'programme': 'المنهاج والتدرج السنوي (2G)',
        'cours': 'مستودع الدروس والمفاهيم',
        'exercices': 'بنك التمارين والأنشطة',
        'evaluations': 'بنك الفروض والاختبارات',
        'scans': 'المستودع البصري (كتاب + اختبارات)'
    };

    function switchWorkspaceTab(tabKey) {
        document.querySelectorAll('.workspace-tab').forEach(el => el.classList.add('d-none'));
        let target = document.getElementById('tab-' + tabKey);
        if (target) {
            target.classList.remove('d-none');
            target.style.animation = 'none';
            target.offsetHeight;
            target.style.animation = null;
        }

        document.querySelectorAll('.sidebar-nav-btn').forEach(pill => pill.classList.remove('active'));
        let activePill = document.querySelector(`.sidebar-nav-btn[onclick*="'${tabKey}'"]`);
        if (activePill) activePill.classList.add('active');

        let breadcrumbEl = document.getElementById('workspaceBreadcrumb');
        if (breadcrumbEl && tabLabels[tabKey]) breadcrumbEl.innerText = tabLabels[tabKey];

        const url = new URL(window.location);
        url.searchParams.set('tab', tabKey);
        window.history.replaceState({}, '', url);

        if (window.innerWidth <= 992) {
            document.getElementById('appSidebar').classList.remove('show-sidebar');
        }
    }

    // 6. Filtres Galerie des Scans (Catégorie & Trimestre)
    function filterScansCategory(cat) {
        document.querySelectorAll('#filterScanBtn_all, #filterScanBtn_textbook, #filterScanBtn_eval').forEach(btn => btn.classList.remove('active'));
        let btn = document.getElementById('filterScanBtn_' + cat);
        if (btn) btn.classList.add('active');

        document.querySelectorAll('.scan-page-item').forEach(item => {
            if (cat === 'all' || item.dataset.category === cat) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }

    function filterScansByTrim(trimNum) {
        document.querySelectorAll('.scan-page-item').forEach(item => {
            if (trimNum === 0 || item.dataset.trim == trimNum) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // 6.b Filtre Global de Trimestre Orchestré depuis le Sidebar
    function applyGlobalTrimestreFilter(trimNum, trimLabel, iconName, clickedBtn) {
        // 1. Mise à jour de l'étiquette du Sidebar
        let labelEl = document.getElementById('sidebarActiveTrimLabel');
        if (labelEl) {
            labelEl.innerHTML = `<i class="fa-solid ${iconName} ms-2 text-success"></i> ${trimLabel}`;
        }
        document.querySelectorAll('#sidebarTrimMenu .dropdown-item').forEach(item => {
            item.classList.remove('active', 'bg-success', 'text-white');
        });
        if (clickedBtn) {
            clickedBtn.classList.add('active', 'bg-success', 'text-white');
        }

        // 2. Filtrer la matrice
        document.querySelectorAll('.matrix-trim-card').forEach(card => {
            let trim = card.dataset.trim;
            if (trimNum === 0 || trim == trimNum) {
                card.style.display = '';
                let coll = card.querySelector('.matrix-trim-collapse');
                if (coll && trimNum !== 0) {
                    bootstrap.Collapse.getOrCreateInstance(coll, { toggle: false }).show();
                }
            } else {
                card.style.display = 'none';
            }
        });

        // 3. Filtrer les programmes
        document.querySelectorAll('.programme-card').forEach(card => {
            let trim = card.dataset.trim;
            if (trimNum === 0 || trim == trimNum) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });

        // 4. Filtrer les cours
        document.querySelectorAll('.cours-item-card').forEach(card => {
            let trim = card.dataset.trim;
            if (trimNum === 0 || trim == trimNum) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });

        // 5. Filtrer les exercices
        filterExosByTrim(trimNum);

        // 6. Filtrer les évaluations
        document.querySelectorAll('.eval-item-card').forEach(card => {
            let trim = card.dataset.trim;
            if (trimNum === 0 || trim == trimNum) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });

        // 7. Filtrer les scans
        filterScansByTrim(trimNum);
    }

    // 7. Filtres Exercices par Trimestre, Cours et Page
    function filterExosByTrim(trimNum) {
        let items = document.querySelectorAll('.exo-grid-item');
        let count = 0;
        items.forEach(item => {
            if (trimNum === 0 || item.dataset.trim == trimNum) {
                item.style.display = '';
                count++;
            } else {
                item.style.display = 'none';
            }
        });
        document.getElementById('exoFilterStatus').innerHTML = trimNum === 0 
            ? "عرض كامل التمارين والأنشطة الموثقة بصفحة الكتاب المدرسي والحلول المعيارية"
            : `🔍 تم تصفية <strong>${count}</strong> تمارين خاصة بالفصل ${trimNum}`;
    }

    function filterExercicesByCours(coursId) {
        switchWorkspaceTab('exercices');
        let items = document.querySelectorAll('.exo-grid-item');
        let count = 0;
        items.forEach(item => {
            let itemCoursId = item.getAttribute('data-cours-id') || item.dataset.coursId;
            if (coursId === 0 || itemCoursId == coursId) {
                item.style.display = '';
                count++;
            } else {
                item.style.display = 'none';
            }
        });
        document.getElementById('exoFilterStatus').innerHTML = `🔍 تم تصفية <strong>${count}</strong> تمارين خاصة بالدرس #${coursId}`;
    }

    function filterExercicesByPage(pageNum) {
        switchWorkspaceTab('exercices');
        let items = document.querySelectorAll('.exo-grid-item');
        let count = 0;
        items.forEach(item => {
            let itemPageNum = item.getAttribute('data-page-num') || item.dataset.pageNum;
            if (pageNum === 0 || itemPageNum == pageNum) {
                item.style.display = '';
                count++;
            } else {
                item.style.display = 'none';
            }
        });
        document.getElementById('exoFilterStatus').innerHTML = `🔍 تم تصفية <strong>${count}</strong> تمارين خاصة بالصفحة رقم <strong>${pageNum}</strong>`;
    }

    // 8. Ponts Relationnels Omnidirectionnels 360° avec Halo Flash Doré
    function jumpToProgramme(progId) {
        let card = document.getElementById('programme_card_' + progId);
        highlightAndFocusElement(card, 'programme');
    }

    function jumpToCours(coursId) {
        let card = document.getElementById('cours_view_' + coursId);
        if (card) {
            let collapseEl = document.getElementById('coursBody_' + coursId);
            if (collapseEl) {
                bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false }).show();
            }
            highlightAndFocusElement(card, 'cours');
        }
    }

    function jumpToExo(exoId) {
        let card = document.getElementById('exo_card_' + exoId);
        highlightAndFocusElement(card, 'exercices');
    }

    function jumpToEval(evalId) {
        let card = document.getElementById('eval_view_' + evalId);
        highlightAndFocusElement(card, 'evaluations');
    }

    function jumpToScanPage(pageNum) {
        let card = document.getElementById('scan_card_' + pageNum);
        highlightAndFocusElement(card, 'scans');
    }


    function resetExoFilter() {
        document.querySelectorAll('.exo-grid-item').forEach(item => item.style.display = '');
        document.getElementById('exoFilterStatus').innerText = "عرض كامل التمارين والأنشطة الموثقة بصفحة الكتاب المدرسي";
    }

    // 9. Modales d'Images
    function openPageScanModal(pageNum) {
        let currentMatiere = '<?php echo $selected_matiere_code === "islamique" ? "s-islamic" : "maths"; ?>';
        let imgPath = `databases/1AM/${currentMatiere}/scans/page_${pageNum}.jpg`;
        openCustomImageModal(imgPath, `📖 وثيقة ورسوم الصفحة ${pageNum} من الكتاب المدرسي الرسمي`);
    }

    function openCustomImageModal(imgPath, titleText) {
        let titleEl = document.getElementById('masterModalTitle');
        let imgEl = document.getElementById('masterModalImg');
        if (titleEl && imgEl) {
            titleEl.innerHTML = `<i class="fa-solid fa-image ms-1"></i> ${titleText}`;
            imgEl.onerror = function() {
                // Fallbacks automatiques : tester page_00X.jpg, page_X.png, page_00X.png
                let currentSrc = this.src;
                if (currentSrc.includes('page_')) {
                    let m = currentSrc.match(/page_(\d+)\.(jpg|jpeg|png)/i);
                    if (m) {
                        let num = parseInt(m[1]);
                        let pad3 = String(num).padStart(3, '0');
                        if (!currentSrc.includes(`page_${pad3}`)) {
                            this.src = currentSrc.replace(`page_${num}`, `page_${pad3}`);
                            return;
                        }
                    }
                }
                if (currentSrc.endsWith('.jpg') || currentSrc.endsWith('.jpeg')) {
                    this.src = currentSrc.replace(/\.jpe?g$/i, '.png');
                }
            };
            imgEl.src = imgPath;
            let modalEl = document.getElementById('masterImageModal');
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }
    }

    // 10. Page Jumper Rapide
    const courseRanges = <?php 
        $ranges = [];
        foreach($all_cours as $c) {
            $ranges[] = ['id' => $c['id'], 'deb' => intval($c['page_debut']), 'fin' => intval($c['page_fin'])];
        }
        echo json_encode($ranges);
    ?>;

    function jumpToMasterPage() {
        let pNum = parseInt(document.getElementById('sidebarPageInput').value);
        if (isNaN(pNum) || pNum < 10 || pNum > 210) {
            alert("يرجى إدخال رقم صفحة بين 10 و 210.");
            return;
        }
        let match = courseRanges.find(r => pNum >= r.deb && pNum <= r.fin);
        if (match) {
            jumpToCours(match.id);
        }
    }

    // 11. Recherche Live Multidimensionnelle
    let masterDebounce = null;
    function handleMasterSearch(query) {
        clearTimeout(masterDebounce);
        masterDebounce = setTimeout(function() {
            let q = query.trim().toLowerCase();
            let cards = document.querySelectorAll('.relational-node, .cours-item-card, .exo-grid-item, .eval-item-card, .programme-card, .scan-page-item');
            if (!q) {
                cards.forEach(c => c.style.display = '');
                return;
            }
            cards.forEach(card => {
                let text = card.textContent.toLowerCase();
                let raw = card.querySelector('.raw-markdown-content');
                if (raw) text += " " + raw.value.toLowerCase();
                card.style.display = text.includes(q) ? '' : 'none';
            });
        }, 150);
    }

    function clearMasterSearch() {
        let input = document.getElementById('sidebarSearchInput');
        if (input) {
            input.value = '';
            handleMasterSearch('');
        }
    }

    // 12. Toggles de Groupes
    function toggleAllMatrixCards(expand) {
        document.querySelectorAll('.matrix-trim-collapse').forEach(el => {
            let bs = bootstrap.Collapse.getOrCreateInstance(el, { toggle: false });
            expand ? bs.show() : bs.hide();
        });
    }

    function toggleAllCoursBodies(expand) {
        document.querySelectorAll('.cours-body-collapse').forEach(el => {
            let bs = bootstrap.Collapse.getOrCreateInstance(el, { toggle: false });
            expand ? bs.show() : bs.hide();
        });
    }

    function toggleAllExoBodies(expand) {
        document.querySelectorAll('#tab-exercices .collapse').forEach(el => {
            let bs = bootstrap.Collapse.getOrCreateInstance(el, { toggle: false });
            expand ? bs.show() : bs.hide();
        });
    }

    // 13. Moteur KaTeX Monopasse 100% Silencieux (Option B Déterministe)
    function cleanMathEquation(eq) {
        if (!eq) return "";
        // 1. Remplacer les séparateurs arabes internes aux formules par des séparateurs mathématiques standards
        eq = eq.replace(/،/g, ',');
        eq = eq.replace(/؛/g, ';');

        // 2. Restaurer d'éventuels tokens corrompus
        eq = eq.replace(/\\d\s*\\frac/g, '\\dfrac')
               .replace(/\\d\s*\\dfrac/g, '\\dfrac')
               .replace(/\\\$frac/g, '\\frac')
               .replace(/\$frac/g, '\\frac')
               .replace(/(?<![a-zA-Z\\])rac\{/g, '\\frac{')
               .replace(/(?<![a-zA-Z\\])ext\{/g, '\\text{')
               .replace(/(?<![a-zA-Z\\])ight\)/g, '\\right)')
               .replace(/(?<![a-zA-Z\\])eft\(/g, '\\left(')
               .replace(/\\text\{\s*\\text\{([^{}]+)\}\s*\}/g, '\\text{$1}')
               .replace(/\\text\{\s*([,;])\s*\}/g, ' $1 ');

        // 3. Supprimer les dollars imbriqués accidentels
        eq = eq.replace(/\$/g, '');

        // 4. Encapsuler les éventuels mots arabes isolés dans \text{} sans écraser les blocs existants
        eq = eq.replace(/(?<!\\text\{)([\u0600-\u060B\u060D-\u06FF]+)(?!\})/g, '\\text{$1}');
        return eq.trim();
    }

    function renderMarkdownWithKaTeX(rawText, container) {
        if (!rawText || container.dataset.rendered) return;

        // Auto-guérison client-side immédiate
        // 0. Auto-guérison ciblée côté client des tokens LaTeX basiques
        rawText = rawText.replace(/(?<![a-zA-Z\\])rac\{/g, '\\frac{')
                         .replace(/(?<![a-zA-Z\\])ext\{/g, '\\text{')
                         .replace(/(?<![a-zA-Z\\])ight\)/g, '\\right)')
                         .replace(/(?<![a-zA-Z\\])eft\(/g, '\\left(')
                         .replace(/_{5,}/g, ' $\\dots$ ')
                         .replace(/\\\$frac/g, '\\frac')
                         .replace(/\$frac/g, '\\frac')
                         .replace(/\\fra\$c\$/g, '\\frac')
                         .replace(/\\fr\$a\$c\$/g, '\\frac')
                         .replace(/\\frac\s*([0-9]+)\s*\{([0-9]+)\}/g, '\\frac{$1}{$2}')
                         .replace(/\\frac\s*\$?\{([0-9]+)\}\s*\$?\{([0-9]+)\}/g, '\\frac{$1}{$2}')
                         .replace(/\\frac\{([0-9]+)\}\s*\$?\{([0-9]+)\}/g, '\\frac{$1}{$2}')
                         .replace(/\\frac\{([0-9]+)\}\s*([0-9]+)/g, '\\frac{$1}{$2}')
                         .replace(/\{\{([^{}]+)\}\}\{\{([^{}]+)\}\}/g, '{$1}{$2}')
                         .replace(/\\underbrace\{([\s\S]+?)\}\s*\{(\s*\\text\{[^{}]+\}\s*)\}/g, '\\underbrace{$1}_{$2}')
                         .replace(/\\underbrace\{([^{}]+)\}\s*\{([^{}]+)\}/g, '\\underbrace{$1}_{$2}')
                         .replace(/(?<!\$)\\begin\{(aligned|matrix|pmatrix|bmatrix|vmatrix|array|cases)\}[\s\S]*?\\end\{\1\}(?!\$)/g, '$$\n$&\n$$');

        let mathBlocks = [];
        let placeholderPrefix = "%%%MATHBLOCK_";

        let protectedText = rawText.replace(/\$\$((?:(?!###|---|```)[\s\S])*?)\$\$/g, function(match, math) {
            let id = mathBlocks.length;
            mathBlocks.push({ type: 'display', math: cleanMathEquation(math.trim()) });
            return "\n\n" + placeholderPrefix + id + "%%%\n\n";
        });

        // Protéger les équations en mode Inline $...$ (strictement isolées sans franchir les pipes de tableaux ni les retours à la ligne)
        protectedText = protectedText.replace(/\$([^$\n|]+?)\$/g, function(match, math) {
            let id = mathBlocks.length;
            mathBlocks.push({ type: 'inline', math: cleanMathEquation(math.trim()) });
            return placeholderPrefix + id + "%%%";
        });

        protectedText = protectedText.replace(/###\s*📄\s*الصفحة\s*(\d+)\s*من\s*الكتاب\s*المدرسي\s*:/g, function(match, pNum) {
            return `<div class="page-banner mb-3 p-3 rounded-3 shadow-sm d-flex justify-content-between align-items-center" style="background: linear-gradient(135deg, #1e3a8a, #2563eb); color: white;">
                <div>
                    <h6 class="fw-bold m-0"><i class="fa-solid fa-file-lines ms-1 text-warning"></i> 📄 الصفحة ${pNum} من الكتاب المدرسي الرسمي</h6>
                    <small class="opacity-75">المفاهيم والرسوم الهندسية والمخططات التوضيحية</small>
                </div>
                <button class="btn btn-sm btn-warning text-dark fw-bold py-1 px-3 shadow-sm rounded-pill" onclick="openPageScanModal(${pNum})">
                    <i class="fa-solid fa-expand ms-1"></i> 🖼️ معاينة الرسوم والمخططات الأصلية (ص ${pNum})
                </button>
            </div>`;
        });

        // Transformation des encadrés de schémas géométriques en composants visuels premium
        protectedText = protectedText.replace(/####\s*📐\s*(الرسم والشكل الهندسي التوضيحي|رسم وتوضيح هندسي)\s*:\s*([\s\S]*?)(?=\n###|\n---|<!--|\n<div|$)/g, function(match, title, content) {
            return `<div class="card border-info my-3 shadow-sm visual-math-card">
                <div class="card-header bg-info text-dark py-1 px-3 fw-bold small d-flex justify-content-between align-items-center">
                    <span><i class="fa-solid fa-shapes ms-1"></i> 📐 رسم ومخطط هندسي توضيحي معتمد</span>
                    <span class="badge bg-dark text-white">شكل توضيحي</span>
                </div>
                <div class="card-body p-3 bg-white text-dark">
                    <div class="d-flex align-items-center gap-3">
                        <div class="fs-1 text-info opacity-75"><i class="fa-solid fa-drafting-compass"></i></div>
                        <div class="flex-grow-1">${content.trim()}</div>
                    </div>
                </div>
            </div>`;
        });

        // Transformation des images Markdown réelles et des balises visuelles / asset://
        protectedText = protectedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, src) {
            let actualSrc = src;
            if (src.startsWith('asset://figures/')) {
                let figFile = src.replace('asset://figures/', '');
                let niv = '<?php echo strtoupper($selected_niveau_code); ?>';
                let mat = '<?php echo $selected_matiere_code === "math" ? "maths" : $selected_matiere_code; ?>';
                actualSrc = `databases/${niv}/${mat}/assets/figures/${figFile}`;
                return `<div class="text-center my-4 svg-figure-wrapper" data-figure="${alt}">
                    <div class="d-inline-block p-2 bg-white rounded-3 shadow-sm border border-2 border-primary-subtle">
                        <img src="${actualSrc}" alt="${alt}" class="img-fluid" style="max-height: 420px;" onerror="this.parentElement.style.display='none'">
                    </div>
                    <div class="mt-1"><small class="text-muted fw-bold">📐 ${alt}</small></div>
                </div>`;
            }
            return `<div class="text-center my-3"><img src="${actualSrc}" alt="${alt}" class="img-fluid rounded-3 border shadow-sm" style="max-height: 380px;"><br><small class="text-muted fw-bold mt-1 d-inline-block">🖼️ ${alt}</small></div>`;
        });
        protectedText = protectedText.replace(/\[VISUAL_TAG:\s*([^\]]+)\]/g, '<span class="badge bg-light text-primary border border-primary p-2 my-1 d-inline-block"><i class="fa-solid fa-shapes ms-1"></i> 📐 $1</span>');

        // Transformation interactive des rubriques didactiques 2G et liens de remédiation
        protectedText = protectedText.replace(/(?:####\s*|\*\*)\s*(أكتشف)\s*(?:\*\*|)/g, '<div class="didactic-rubric-discover"><i class="fa-solid fa-compass ms-2 text-primary"></i> 🧭 أكتشف (أنشطة وبناء المفاهيم)</div>')
                                     .replace(/(?:####\s*|\*\*)\s*(أتعلم|معارف)\s*(?:\*\*|)/g, '<div class="didactic-rubric-learn"><i class="fa-solid fa-book-bookmark ms-2 text-warning"></i> 📖 أتعلم (المعارف والخواص المعتمدة)</div>')
                                     .replace(/(?:####\s*|\*\*)\s*(أكتسب طرائق)\s*(?:\*\*|)/g, '<div class="didactic-rubric-methods"><i class="fa-solid fa-lightbulb ms-2 text-purple"></i> 💡 أكتسب طرائق (طرائق ونماذج الحل)</div>')
                                     .replace(/(?:####\s*|\*\*)\s*(دوري الآن)\s*(?:\*\*|)/g, '<div class="didactic-rubric-now"><i class="fa-solid fa-pen-ruler ms-2 text-success"></i> ✍️ دوري الآن (تطبيق مباشر)</div>')
                                     .replace(/(?:####\s*|\*\*)\s*(أقوم تعلماتي)\s*(?:\*\*|)/g, '<div class="didactic-rubric-assess"><i class="fa-solid fa-list-check ms-2 text-teal"></i> 🎯 أقوم تعلماتي (تقييم وبناء العلاج)</div>')
                                     .replace(/أعود\s*إلى\s*الصفحة\s*(\d+)/g, '<a href="#page-$1" class="didactic-remediation-badge" onclick="openPageScanModal($1)"><i class="fa-solid fa-arrow-turn-right ms-1"></i> أعود إلى الصفحة $1</a>');

        // Garantie de saut de ligne avant et après les tableaux Markdown pour un parsing GFM optimal sans casser les lignes internes
        protectedText = protectedText.replace(/([^\n|])\n(\|)/g, '$1\n\n$2')
                                     .replace(/(\|\n)([^\n|])/g, '$1\n\n$2');

        marked.setOptions({ gfm: true, breaks: false, tables: true });
        let parsedHtml = marked.parse(protectedText);

        mathBlocks.forEach(function(item, idx) {
            let placeholder = placeholderPrefix + idx + "%%%";
            try {
                let renderedMath = katex.renderToString(item.math, {
                    displayMode: (item.type === 'display'),
                    throwOnError: false,
                    strict: "ignore",
                    output: "html"
                });
                parsedHtml = parsedHtml.split(placeholder).join(renderedMath);
            } catch(e) {
                parsedHtml = parsedHtml.split(placeholder).join('<span class="text-danger">' + item.math + '</span>');
            }
        });

        container.innerHTML = parsedHtml;
        container.dataset.rendered = "true";
        container.querySelectorAll('table').forEach(tbl => {
            tbl.classList.add('table', 'table-bordered', 'table-striped', 'table-hover', 'my-3', 'align-middle', 'text-center');
        });
    }

    // 14. Moteur Asynchrone de Preload en Chunks
    function runPreloadPipeline() {
        const allElements = Array.from(document.querySelectorAll('.raw-markdown-content'));
        const total = allElements.length;
        const bar = document.getElementById('splashBar');
        const percentEl = document.getElementById('splashPercent');
        const statusEl = document.getElementById('splashStatus');
        const splash = document.getElementById('splashScreen');

        if (total === 0) {
            bar.style.width = '100%';
            percentEl.innerText = '100%';
            statusEl.innerText = '✅ اكتملت التهيئة!';
            setTimeout(function() {
                splash.style.opacity = '0';
                setTimeout(() => splash.style.display = 'none', 500);
            }, 300);
            return;
        }

        let index = 0;
        const chunkSize = 35;

        function step() {
            let limit = Math.min(index + chunkSize, total);
            for (; index < limit; index++) {
                let el = allElements[index];
                let target = el.parentElement.querySelector('.rendered-html-container');
                if (target && !target.dataset.rendered) {
                    renderMarkdownWithKaTeX(el.value || el.textContent || '', target);
                }
            }

            let progress = Math.min(100, Math.round((index / total) * 100));
            bar.style.width = progress + '%';
            percentEl.innerText = progress + '%';

            if (progress < 25) {
                statusEl.innerText = "📋 جاري تهيئة المنهاج والتدرج السنوي الرسمي...";
            } else if (progress < 50) {
                statusEl.innerText = "📘 جاري تجميع الدروس والمخططات الهندسية (14 فصلاً)...";
            } else if (progress < 85) {
                statusEl.innerText = `📝 جاري معالجة وفهرسة التمارين والحلول (${index} / ${total})...`;
            } else if (progress < 100) {
                statusEl.innerText = "📑 جاري مطابقة الفروض والامتحانات الرسمية وسلالم التنقيط...";
            } else {
                statusEl.innerText = "✅ اكتملت التهيئة بنجاح! جاري فتح المستودع...";
            }

            if (index < total) {
                requestAnimationFrame(step);
            } else {
                setTimeout(function() {
                    splash.style.opacity = '0';
                    setTimeout(function() {
                        splash.style.display = 'none';
                    }, 600);
                }, 300);
            }
        }

        requestAnimationFrame(step);
    }

    document.addEventListener("DOMContentLoaded", function() {
        runPreloadPipeline();
    });
</script>
</body>
</html>

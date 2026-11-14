// Additional anatomy layers: organs, arteries, veins, nerves, ligaments, lymphatics, surface landmarks.
//
// These are textbook positions for an average adult, scaled to the tracked shoulders and hips.
// Real organ and vessel positions vary with breathing, posture and body build. The layers show
// roughly where structures lie; they are not a picture of the person in view.
import type { LandmarkName } from '../pose/landmarks';
import type { AnatomyView, P, Rig, SegName } from './anatomy';

export type SystemId = 'organs' | 'arteries' | 'veins' | 'nerves' | 'ligaments' | 'lymph' | 'landmarks';

export const SYSTEMS: { id: SystemId; label: string; color: string }[] = [
  { id: 'organs', label: 'Internal organs', color: '#f472b6' },
  { id: 'arteries', label: 'Arteries', color: '#ef4444' },
  { id: 'veins', label: 'Veins', color: '#3b82f6' },
  { id: 'nerves', label: 'Nerves', color: '#fde047' },
  { id: 'ligaments', label: 'Joints and ligaments', color: '#e2e8f0' },
  { id: 'lymph', label: 'Lymphatic system', color: '#86efac' },
  { id: 'landmarks', label: 'Surface landmarks', color: '#22d3ee' },
];

/** A point resolver, tagged with the body region it depends on. */
export interface PtFn {
  (rig: Rig, side: 'l' | 'r'): P;
  region: SegName | 'head';
}
const tag = (f: (rig: Rig, side: 'l' | 'r') => P, region: PtFn['region']): PtFn => Object.assign(f, { region });
/** Trunk point; for bilateral structures `left` is mirrored on the right side. */
export const T = (s: number, left: number, ant: number): PtFn => tag((r, side) => r.trunk(s, side === 'r' ? -left : left, ant), 'trunk');
/** Midline or one-sided trunk point (never mirrored). */
export const M = (s: number, left: number, ant: number): PtFn => tag((r) => r.trunk(s, left, ant), 'trunk');
export const H = (up: number, left: number, ant: number): PtFn => tag((r, side) => r.head(up, side === 'r' ? -left : left, ant), 'head');
/** Limb point: fraction along the segment, offset in front/back views (+ lateral), offset in side views (+ anterior). */
export const A = (seg: SegName, s: number, offFrontal: number, offLateral: number): PtFn => tag((r, side) => r.at([seg, s, r.info.view === 'lateral' ? offLateral : offFrontal], side), seg);

/** Characteristic organ outlines. Without one, a structure is drawn as a shaded ellipse. */
export type FormId = 'lung' | 'heart' | 'liver' | 'stomach' | 'bean' | 'brain' | 'pancreas' | 'coils';

type Shape =
  | { kind: 'ellipse'; c: PtFn; rx: number; ry: number; rz: number; form?: FormId }
  | { kind: 'path'; pts: PtFn[]; width: number; lateralPts?: PtFn[] }
  | { kind: 'dots'; pts: PtFn[]; r: number };

export interface SystemStructure {
  id: string;
  name: string;
  aliases: string[];
  system: SystemId;
  bilateral: boolean;
  views?: AnatomyView[];
  color?: string;
  shapes: Shape[];
}

const E = (c: PtFn, rx: number, ry: number, rz = rx, form?: FormId): Shape => ({ kind: 'ellipse', c, rx, ry, rz, form });
const Pth = (width: number, ...pts: PtFn[]): Shape => ({ kind: 'path', pts, width });
const D = (r: number, ...pts: PtFn[]): Shape => ({ kind: 'dots', pts, r });
const def = (system: SystemId, id: string, name: string, aliases: string[], bilateral: boolean, shapes: Shape[], extra: Partial<SystemStructure> = {}): SystemStructure => ({ id, name, aliases, system, bilateral, shapes, ...extra });

const FRONTAL: AnatomyView[] = ['anterior', 'posterior'];

export const STRUCTURES: SystemStructure[] = [
  // ---- Organs (drawn back to front) ----
  def('organs', 'brain', 'Brain', ['cerebrum', 'cerebellum'], false, [E(H(0.3, 0, -0.05), 0.82, 0.68, 0.9, 'brain')], { color: '#f9a8d4' }),
  def('organs', 'kidneys', 'Kidneys', ['kidney', 'renal'], true, [E(T(0.68, 0.1, -0.1), 0.04, 0.07, 0.04, 'bean')], { color: '#9f1239' }),
  def('organs', 'trachea', 'Trachea', ['windpipe', 'airway'], false, [Pth(0.035, M(-0.14, 0, 0.04), M(0.14, 0, 0.03))], { color: '#bae6fd' }),
  def('organs', 'lungs', 'Lungs', ['lung', 'pulmonary'], true, [E(T(0.27, 0.13, 0), 0.1, 0.2, 0.13, 'lung')], { color: '#f9a8d4' }),
  def('organs', 'heart', 'Heart', ['cardiac', 'myocardium'], false, [E(M(0.3, 0.04, 0.08), 0.085, 0.095, 0.08, 'heart')], { color: '#b91c1c' }),
  def('organs', 'diaphragm', 'Diaphragm', [], false, [{ kind: 'path', width: 0.02, pts: [M(0.52, -0.26, 0), M(0.45, -0.1, 0), M(0.47, 0, 0), M(0.45, 0.1, 0), M(0.52, 0.26, 0)], lateralPts: [M(0.54, 0, -0.14), M(0.45, 0, 0), M(0.5, 0, 0.16)] }], { color: '#fb923c' }),
  def('organs', 'pancreas', 'Pancreas', [], false, [E(M(0.64, 0.03, -0.02), 0.1, 0.025, 0.03, 'pancreas')], { color: '#fcd34d' }),
  def('organs', 'spleen', 'Spleen', [], false, [E(M(0.58, 0.23, -0.06), 0.035, 0.06, 0.05, 'bean')], { color: '#7e22ce' }),
  def('organs', 'liver', 'Liver', ['hepatic'], false, [E(M(0.56, -0.1, 0.05), 0.16, 0.08, 0.12, 'liver')], { color: '#7c2d12' }),
  def('organs', 'stomach', 'Stomach', ['gastric'], false, [E(M(0.6, 0.12, 0.06), 0.09, 0.075, 0.08, 'stomach')], { color: '#fda4af' }),
  def('organs', 'large_intestine', 'Large intestine', ['colon', 'bowel'], false, [Pth(0.055, M(0.92, -0.2, 0.05), M(0.7, -0.21, 0.05), M(0.66, 0, 0.08), M(0.7, 0.21, 0.05), M(0.92, 0.2, 0.03), M(1.0, 0.02, -0.03))], { color: '#d6a56f' }),
  def('organs', 'small_intestine', 'Small intestine', ['ileum', 'jejunum', 'duodenum', 'bowel'], false, [E(M(0.82, 0, 0.07), 0.13, 0.09, 0.08, 'coils')], { color: '#fbbf7c' }),
  def('organs', 'bladder', 'Urinary bladder', ['bladder'], false, [E(M(1.0, 0, 0.08), 0.05, 0.04, 0.04)], { color: '#fde68a' }),

  // ---- Arteries (each path runs away from the heart) ----
  def('arteries', 'aorta', 'Aorta', ['aortic arch', 'descending aorta', 'abdominal aorta'], false, [Pth(0.035, M(0.26, 0.03, 0.06), M(0.13, 0.02, 0.04), M(0.17, 0.04, -0.05), M(0.5, 0.02, -0.08), M(0.84, 0.01, -0.06))]),
  def('arteries', 'carotid_artery', 'Carotid artery', ['carotid'], true, [Pth(0.015, T(0.13, 0.03, 0.03), T(-0.1, 0.06, 0.02), H(-0.5, 0.45, 0.15))]),
  def('arteries', 'subclavian_artery', 'Subclavian and axillary artery', ['subclavian', 'axillary artery'], true, [Pth(0.018, T(0.13, 0.03, 0.03), T(0.04, 0.2, 0.02), A('upperarm', 0.05, -0.03, 0.02))]),
  def('arteries', 'brachial_artery', 'Brachial artery', ['brachial'], true, [Pth(0.014, A('upperarm', 0.05, -0.03, 0.02), A('upperarm', 1, -0.01, 0.03))]),
  def('arteries', 'radial_artery', 'Radial artery', ['radial pulse'], true, [Pth(0.01, A('forearm', 0, -0.01, 0.03), A('forearm', 1, 0.03, 0.02))]),
  def('arteries', 'ulnar_artery', 'Ulnar artery', [], true, [Pth(0.01, A('forearm', 0, -0.01, 0.03), A('forearm', 1, -0.03, -0.01))]),
  def('arteries', 'iliac_artery', 'Common iliac artery', ['iliac'], true, [Pth(0.02, T(0.84, 0.01, -0.06), T(0.97, 0.1, 0.02))]),
  def('arteries', 'femoral_artery', 'Femoral artery', ['femoral'], true, [Pth(0.018, T(0.97, 0.1, 0.02), A('thigh', 0.1, -0.04, 0.05), A('thigh', 0.7, -0.05, 0))]),
  def('arteries', 'popliteal_artery', 'Popliteal artery', ['popliteal'], true, [Pth(0.015, A('thigh', 0.7, -0.05, 0), A('thigh', 1, 0, -0.05), A('shank', 0.1, 0, -0.05))]),
  def('arteries', 'posterior_tibial_artery', 'Posterior tibial artery', ['tibial artery'], true, [Pth(0.011, A('shank', 0.1, 0, -0.05), A('shank', 1, -0.03, -0.04))]),
  def('arteries', 'anterior_tibial_artery', 'Anterior tibial artery', ['dorsalis pedis'], true, [Pth(0.01, A('shank', 0.1, 0, -0.05), A('shank', 0.18, 0.02, 0.04), A('shank', 1, 0, 0.05), A('foot', 0.6, 0, 0.09))]),

  // ---- Veins (drawn in the same order; flow is animated toward the heart) ----
  def('veins', 'superior_vena_cava', 'Superior vena cava', ['svc', 'vena cava'], false, [Pth(0.03, M(0.26, -0.04, 0.06), M(0.07, -0.04, 0.04))]),
  def('veins', 'inferior_vena_cava', 'Inferior vena cava', ['ivc', 'vena cava'], false, [Pth(0.032, M(0.32, -0.04, 0.02), M(0.84, -0.03, -0.05))]),
  def('veins', 'jugular_vein', 'Internal jugular vein', ['jugular'], true, [Pth(0.016, T(0.07, 0.05, 0.04), T(-0.08, 0.08, 0.03), H(-0.5, 0.6, 0.05))]),
  def('veins', 'subclavian_vein', 'Subclavian and axillary vein', ['axillary vein'], true, [Pth(0.018, T(0.07, 0.05, 0.04), T(0.03, 0.22, 0.03), A('upperarm', 0.05, -0.05, 0.0))]),
  def('veins', 'basilic_vein', 'Basilic vein', ['basilic'], true, [Pth(0.011, A('upperarm', 0.05, -0.05, 0.0), A('upperarm', 1, -0.04, -0.01), A('forearm', 1, -0.04, -0.02))]),
  def('veins', 'cephalic_vein', 'Cephalic vein', ['cephalic'], true, [Pth(0.011, A('upperarm', 0, 0.05, 0.05), A('upperarm', 1, 0.04, 0.05), A('forearm', 1, 0.04, 0.04))]),
  def('veins', 'iliac_vein', 'Common iliac vein', [], true, [Pth(0.02, T(0.84, -0.03, -0.05), T(0.98, 0.12, 0.01))]),
  def('veins', 'femoral_vein', 'Femoral and popliteal vein', ['femoral vein', 'deep vein'], true, [Pth(0.018, T(0.98, 0.12, 0.01), A('thigh', 0.1, -0.06, 0.03), A('thigh', 1, -0.01, -0.06), A('shank', 1, -0.04, -0.05))]),
  def('veins', 'saphenous_vein', 'Great saphenous vein', ['saphenous'], true, [Pth(0.01, A('thigh', 0.08, -0.07, 0.04), A('thigh', 1, -0.06, -0.01), A('shank', 1, -0.04, 0.02))]),

  // ---- Nerves ----
  def('nerves', 'spinal_cord', 'Spinal cord', ['cord'], false, [Pth(0.022, tag((r) => r.head(-0.5, 0, -0.35), 'head'), M(0, 0, -0.11), M(0.62, 0, -0.1))]),
  def('nerves', 'brachial_plexus', 'Brachial plexus', [], true, [Pth(0.014, T(-0.05, 0.03, -0.07), T(0.04, 0.2, 0), A('upperarm', 0.05, -0.02, 0.0))]),
  def('nerves', 'median_nerve', 'Median nerve', ['median', 'carpal tunnel'], true, [Pth(0.009, A('upperarm', 0.05, -0.02, 0.02), A('upperarm', 1, 0, 0.03), A('forearm', 1, 0, 0.01))]),
  def('nerves', 'ulnar_nerve', 'Ulnar nerve', ['funny bone'], true, [Pth(0.009, A('upperarm', 0.1, -0.04, -0.01), A('upperarm', 1, -0.04, -0.04), A('forearm', 1, -0.035, -0.02))]),
  def('nerves', 'radial_nerve', 'Radial nerve', [], true, [Pth(0.009, A('upperarm', 0.1, 0, -0.03), A('upperarm', 0.6, 0.04, -0.04), A('forearm', 0.1, 0.04, 0.02), A('forearm', 1, 0.035, 0.03))]),
  def('nerves', 'femoral_nerve', 'Femoral nerve', [], true, [Pth(0.011, T(0.75, 0.05, -0.02), T(1.0, 0.13, 0.05), A('thigh', 0.3, 0, 0.07))]),
  def('nerves', 'sciatic_nerve', 'Sciatic nerve', ['sciatic', 'sciatica', 'lumbosacral plexus'], true, [Pth(0.016, T(0.8, 0.03, -0.1), T(1.0, 0.12, -0.1), A('thigh', 0.15, 0, -0.06), A('thigh', 0.85, 0, -0.05))]),
  def('nerves', 'tibial_nerve', 'Tibial nerve', [], true, [Pth(0.01, A('thigh', 0.85, 0, -0.05), A('shank', 0.5, 0, -0.05), A('shank', 1, -0.03, -0.04))]),
  def('nerves', 'fibular_nerve', 'Common fibular nerve', ['peroneal nerve', 'peroneal'], true, [Pth(0.009, A('thigh', 0.85, 0, -0.05), A('shank', 0.08, 0.05, -0.02), A('shank', 0.9, 0.04, 0.03))]),

  // ---- Joints and ligaments ----
  def('ligaments', 'rotator_cuff', 'Rotator cuff region', ['supraspinatus', 'infraspinatus', 'shoulder joint', 'glenohumeral'], true, [E(A('upperarm', 0.02, -0.01, 0), 0.055, 0.045, 0.055)]),
  def('ligaments', 'elbow_ucl', 'Ulnar collateral ligament (elbow)', ['ucl', 'elbow ligament'], true, [Pth(0.014, A('upperarm', 0.95, -0.035, -0.02), A('forearm', 0.07, -0.03, -0.02))], { views: FRONTAL }),
  def('ligaments', 'hip_capsule', 'Hip joint capsule', ['hip joint', 'acetabulum', 'labrum'], true, [E(A('thigh', 0, 0, 0), 0.06, 0.06, 0.06)]),
  def('ligaments', 'it_band', 'Iliotibial band', ['it band', 'itb', 'iliotibial tract'], true, [Pth(0.016, T(0.84, 0.3, 0), A('thigh', 0.05, 0.1, 0), A('thigh', 1, 0.06, 0.01), A('shank', 0.06, 0.05, 0.03))]),
  def('ligaments', 'patellar_tendon', 'Patellar tendon', ['patellar ligament', 'quadriceps tendon'], true, [Pth(0.02, A('thigh', 0.99, 0, 0.065), A('shank', 0.13, 0, 0.055))], { views: ['anterior', 'lateral'] }),
  def('ligaments', 'acl', 'Anterior cruciate ligament', ['acl', 'cruciate'], true, [Pth(0.014, A('thigh', 0.96, 0.015, -0.02), A('shank', 0.035, -0.01, 0.025))]),
  def('ligaments', 'pcl', 'Posterior cruciate ligament', ['pcl', 'cruciate'], true, [Pth(0.014, A('thigh', 0.96, -0.015, 0.02), A('shank', 0.04, 0.01, -0.03))]),
  def('ligaments', 'mcl', 'Medial collateral ligament (knee)', ['mcl'], true, [Pth(0.014, A('thigh', 0.93, -0.045, 0), A('shank', 0.1, -0.04, 0))], { views: FRONTAL }),
  def('ligaments', 'lcl', 'Lateral collateral ligament (knee)', ['lcl'], true, [Pth(0.012, A('thigh', 0.93, 0.045, 0), A('shank', 0.08, 0.05, -0.02))]),
  def('ligaments', 'achilles', 'Achilles tendon', ['calcaneal tendon', 'achilles'], true, [Pth(0.02, A('shank', 0.6, 0, -0.05), A('shank', 0.95, 0, -0.045), A('foot', 0, 0, 0))], { views: ['lateral', 'posterior'] }),
  def('ligaments', 'ankle_ligaments', 'Lateral ankle ligaments', ['atfl', 'ankle sprain', 'talofibular'], true, [Pth(0.012, A('shank', 0.97, 0.04, 0), A('shank', 1.06, 0.05, 0.035))]),
  def('ligaments', 'plantar_fascia', 'Plantar fascia', ['plantar aponeurosis'], true, [Pth(0.012, A('foot', 0.04, 0, -0.012), A('foot', 0.9, 0, -0.012))], { views: ['lateral'] }),

  // ---- Lymphatic system ----
  def('lymph', 'cervical_nodes', 'Cervical lymph nodes', ['neck nodes'], true, [D(0.014, T(-0.14, 0.07, 0.02), T(-0.09, 0.08, 0.0), T(-0.04, 0.09, 0.02))]),
  def('lymph', 'axillary_nodes', 'Axillary lymph nodes', ['armpit nodes', 'axilla'], true, [D(0.015, T(0.1, 0.3, 0), T(0.14, 0.27, 0.02), T(0.17, 0.3, -0.02))]),
  def('lymph', 'thymus', 'Thymus', [], false, [E(M(0.17, 0, 0.1), 0.04, 0.05, 0.03)]),
  def('lymph', 'thoracic_duct', 'Thoracic duct', ['cisterna chyli'], false, [Pth(0.012, M(0.75, 0.01, -0.07), M(0.2, 0.02, -0.08), M(0.03, 0.08, 0))]),
  def('lymph', 'inguinal_nodes', 'Inguinal lymph nodes', ['groin nodes'], true, [D(0.015, T(0.96, 0.13, 0.07), T(0.99, 0.17, 0.07), T(1.02, 0.13, 0.06))]),
  def('lymph', 'popliteal_nodes', 'Popliteal lymph nodes', [], true, [D(0.012, A('thigh', 1, 0, -0.04))], { views: ['posterior', 'lateral'] }),

  // ---- Surface landmarks ----
  def('landmarks', 'c7', 'C7 spinous process', ['vertebra prominens', 'cervicale'], false, [D(0.014, M(-0.05, 0, -0.14))], { views: ['posterior', 'lateral'] }),
  def('landmarks', 'sternal_notch', 'Jugular (sternal) notch', ['suprasternale', 'sternal notch'], false, [D(0.014, M(0.03, 0, 0.1))], { views: ['anterior', 'lateral'] }),
  def('landmarks', 'xiphoid', 'Xiphoid process', ['xiphion'], false, [D(0.014, M(0.42, 0, 0.14))], { views: ['anterior', 'lateral'] }),
  def('landmarks', 'acromion', 'Acromion', ['shoulder tip'], true, [D(0.014, A('upperarm', -0.04, 0.03, 0))]),
  def('landmarks', 'lat_humeral_epicondyle', 'Lateral humeral epicondyle', ['lateral epicondyle of the humerus', 'tennis elbow'], true, [D(0.013, A('upperarm', 0.97, 0.04, -0.01))]),
  def('landmarks', 'med_humeral_epicondyle', 'Medial humeral epicondyle', ['medial epicondyle of the humerus', 'golfer elbow'], true, [D(0.013, A('upperarm', 0.97, -0.04, 0))], { views: FRONTAL }),
  def('landmarks', 'olecranon', 'Olecranon', ['elbow tip'], true, [D(0.013, A('upperarm', 1.03, 0, -0.04))], { views: ['posterior', 'lateral'] }),
  def('landmarks', 'radial_styloid', 'Radial styloid', [], true, [D(0.012, A('forearm', 1, 0.03, 0.02))]),
  def('landmarks', 'ulnar_styloid', 'Ulnar styloid', [], true, [D(0.012, A('forearm', 1, -0.03, -0.02))]),
  def('landmarks', 'iliac_crest', 'Iliac crest', [], true, [D(0.014, T(0.74, 0.3, 0))]),
  def('landmarks', 'asis', 'Anterior superior iliac spine (ASIS)', ['asis', 'hip bone point'], true, [D(0.014, T(0.83, 0.27, 0.12))], { views: ['anterior', 'lateral'] }),
  def('landmarks', 'psis', 'Posterior superior iliac spine (PSIS)', ['psis', 'dimples'], true, [D(0.014, T(0.84, 0.09, -0.16))], { views: ['posterior', 'lateral'] }),
  def('landmarks', 'greater_trochanter', 'Greater trochanter', ['trochanter'], true, [D(0.014, A('thigh', 0.03, 0.15, -0.01))]),
  def('landmarks', 'lat_femoral_epicondyle', 'Lateral femoral epicondyle', ['lateral knee'], true, [D(0.013, A('thigh', 0.97, 0.05, 0))]),
  def('landmarks', 'med_femoral_epicondyle', 'Medial femoral epicondyle', ['medial knee'], true, [D(0.013, A('thigh', 0.97, -0.05, 0))], { views: FRONTAL }),
  def('landmarks', 'tibial_tuberosity', 'Tibial tuberosity', [], true, [D(0.013, A('shank', 0.1, 0, 0.05))], { views: ['anterior', 'lateral'] }),
  def('landmarks', 'lat_malleolus', 'Lateral malleolus', ['outer ankle bone'], true, [D(0.013, A('shank', 1, 0.035, -0.01))]),
  def('landmarks', 'med_malleolus', 'Medial malleolus', ['inner ankle bone'], true, [D(0.013, A('shank', 0.98, -0.035, 0))], { views: FRONTAL }),
];

/** Keypoints each body region is positioned from. */
export const REGION_KEYPOINTS: Record<PtFn['region'], (side: 'l' | 'r') => LandmarkName[]> = {
  trunk: () => ['l_shoulder', 'r_shoulder', 'l_hip', 'r_hip'],
  head: () => ['l_ear', 'r_ear'],
  thigh: (s) => [`${s}_hip`, `${s}_knee`],
  shank: (s) => [`${s}_knee`, `${s}_ankle`],
  foot: (s) => [`${s}_heel`, `${s}_toe`],
  upperarm: (s) => [`${s}_shoulder`, `${s}_elbow`],
  forearm: (s) => [`${s}_elbow`, `${s}_wrist`],
};

const shapePts = (sh: Shape, lateral: boolean): PtFn[] => (sh.kind === 'ellipse' ? [sh.c] : sh.kind === 'path' && lateral && sh.lateralPts ? sh.lateralPts : sh.pts);

export const inView = (st: SystemStructure, view: AnatomyView) => !st.views || st.views.includes(view);
export const regionsOf = (st: SystemStructure): PtFn['region'][] => [...new Set(st.shapes.flatMap((sh) => shapePts(sh, false).map((p) => p.region)))];

/** Sides a structure is drawn on in this view (side views show only the near side of paired structures). */
export function sidesOf(st: SystemStructure, rig: Rig): ('l' | 'r')[] {
  if (!st.bilateral) return [rig.info.nearSide];
  return rig.info.view === 'lateral' ? [rig.info.nearSide] : ['l', 'r'];
}

/** Representative point of a structure (centre of its first shape). */
export function anchorOf(st: SystemStructure, rig: Rig, side: 'l' | 'r'): P {
  const pts = shapePts(st.shapes[0], rig.info.view === 'lateral').map((f) => f(rig, side));
  const mid = pts[Math.floor((pts.length - 1) / 2)], mid2 = pts[Math.ceil((pts.length - 1) / 2)];
  return { x: (mid.x + mid2.x) / 2, y: (mid.y + mid2.y) / 2 };
}

type Cmd = (string | number)[];
/**
 * Organ outlines in unit coordinates, scaled to the structure's half-widths. +x points toward the
 * subject's left in front and back views (so shapes are drawn as seen) and toward the front in side
 * views; +y points down the trunk. Commands: M x y | L x y | Q cx cy x y | C c1 c2 end | Z.
 */
const FORMS: Record<Exclude<FormId, 'coils'>, (o: { side: 'l' | 'r'; lateral: boolean }) => { outline: Cmd; lines: Cmd[] }> = {
  // Drawn for the left lung (medial border at -x): the cardiac notch is on the left only, and the
  // right lung has the extra horizontal fissure. The right lung is mirrored by the caller.
  lung: ({ side, lateral }) => ({
    outline: ['M', -0.35, -1, 'C', 0.5, -1, 0.95, -0.3, 1, 0.55, 'Q', 1, 0.95, 0.75, 1, 'Q', 0.1, 0.68, -0.55, 0.92, 'L', -0.72, 0.75,
      ...(side === 'l' && !lateral ? ['Q', -0.2, 0.62, -0.25, 0.22, 'Q', -0.3, -0.1, -0.74, -0.2] : ['L', -0.78, -0.2]), 'C', -0.82, -0.6, -0.7, -0.95, -0.35, -1, 'Z'],
    lines: [['M', -0.55, -0.35, 'Q', 0.3, 0.05, 0.86, 0.72], ...(side === 'r' || lateral ? [['M', -0.6, 0.02, 'Q', 0, -0.02, 0.55, -0.1] as Cmd] : [])],
  }),
  heart: () => ({
    outline: ['M', -0.3, -0.75, 'C', 0.2, -1, 0.95, -0.6, 0.95, 0.05, 'C', 0.95, 0.5, 0.85, 0.8, 0.7, 0.95, 'C', 0.2, 0.85, -0.6, 0.75, -0.85, 0.3, 'C', -1, -0.1, -0.8, -0.6, -0.3, -0.75, 'Z'],
    lines: [['M', -0.55, -0.35, 'Q', 0.15, -0.1, 0.55, 0.75], ['M', -0.85, 0.05, 'Q', 0, -0.05, 0.92, -0.25]],
  }),
  liver: () => ({
    outline: ['M', -1, -0.3, 'C', -0.9, -1, 0.3, -1, 1, -0.55, 'Q', 0.9, -0.1, 0.4, 0.2, 'Q', -0.3, 0.6, -0.8, 1, 'Q', -1.05, 0.6, -1, -0.3, 'Z'],
    lines: [['M', 0.25, -0.85, 'Q', 0.12, -0.3, 0.2, 0.28]],
  }),
  stomach: () => ({
    outline: ['M', -0.1, -0.95, 'C', 0.3, -1.1, 1, -0.8, 0.95, 0, 'C', 0.9, 0.7, 0.2, 1, -0.5, 0.8, 'Q', -0.95, 0.7, -0.95, 0.4, 'Q', -0.6, 0.55, -0.2, 0.35, 'C', 0.2, 0.1, 0, -0.4, -0.1, -0.95, 'Z'],
    lines: [['M', 0.1, -0.7, 'Q', 0.55, -0.2, 0.4, 0.45], ['M', 0.5, -0.75, 'Q', 0.85, -0.2, 0.6, 0.6]],
  }),
  bean: () => ({
    outline: ['M', 0, -1, 'C', 0.9, -1, 1, 1, 0, 1, 'C', -0.6, 1, -0.75, 0.5, -0.35, 0.2, 'Q', -0.15, 0, -0.35, -0.2, 'C', -0.75, -0.5, -0.6, -1, 0, -1, 'Z'],
    lines: [],
  }),
  pancreas: () => ({
    outline: ['M', -1, -0.4, 'Q', -1.1, 0.7, -0.7, 0.95, 'Q', 0, 0.35, 1, -0.2, 'Q', 1.06, -0.7, 0.8, -0.7, 'Q', 0, -0.3, -0.5, -0.9, 'Q', -0.9, -1, -1, -0.4, 'Z'],
    lines: [],
  }),
  brain: ({ lateral }) => lateral ? {
    outline: ['M', -0.95, 0.1, 'C', -1.05, -0.9, 0.3, -1.2, 0.9, -0.45, 'C', 1.1, -0.1, 0.9, 0.3, 0.5, 0.3, 'Q', 0.2, 0.62, -0.15, 0.42, 'Q', -0.6, 0.5, -0.95, 0.1, 'Z'],
    lines: [['M', 0.05, -0.95, 'Q', -0.1, -0.4, 0.1, 0.05], ['M', -0.5, -0.9, 'Q', -0.35, -0.5, -0.6, -0.1], ['M', 0.45, -0.75, 'Q', 0.4, -0.35, 0.6, -0.05], ['M', 0.55, 0.2, 'Q', 0.1, 0.0, -0.45, 0.1], ['M', -0.85, -0.35, 'Q', -0.6, -0.3, -0.75, 0.05]],
  } : {
    outline: ['M', 0, -0.92, 'C', 0.5, -1.15, 1, -0.5, 0.98, 0.1, 'C', 0.95, 0.75, 0.4, 1, 0, 0.85, 'C', -0.4, 1, -0.95, 0.75, -0.98, 0.1, 'C', -1, -0.5, -0.5, -1.15, 0, -0.92, 'Z'],
    lines: [['M', 0, -0.92, 'L', 0, 0.85], ['M', 0.2, -0.8, 'Q', 0.5, -0.4, 0.25, -0.1, 'Q', 0.55, 0.2, 0.3, 0.6], ['M', 0.6, -0.65, 'Q', 0.85, -0.2, 0.65, 0.15, 'Q', 0.85, 0.4, 0.6, 0.7],
      ['M', -0.2, -0.8, 'Q', -0.5, -0.4, -0.25, -0.1, 'Q', -0.55, 0.2, -0.3, 0.6], ['M', -0.6, -0.65, 'Q', -0.85, -0.2, -0.65, 0.15, 'Q', -0.85, 0.4, -0.6, 0.7]],
  },
};

/** Lightens (f > 0) or darkens (f < 0) a #rrggbb colour. */
function tint(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16), ch = (v: number) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** Builds a path from unit-space commands under the affine map (u, v) -> c + u * ex + v * ey. */
function mapped(cmd: Cmd, c: P, ex: P, ey: P): Path2D {
  const q = new Path2D();
  const X = (u: number, v: number) => c.x + u * ex.x + v * ey.x, Y = (u: number, v: number) => c.y + u * ex.y + v * ey.y;
  for (let i = 0; i < cmd.length;) {
    const k = cmd[i++] as string, n = (j: number) => cmd[i + j] as number;
    if (k === 'M') { q.moveTo(X(n(0), n(1)), Y(n(0), n(1))); i += 2; }
    else if (k === 'L') { q.lineTo(X(n(0), n(1)), Y(n(0), n(1))); i += 2; }
    else if (k === 'Q') { q.quadraticCurveTo(X(n(0), n(1)), Y(n(0), n(1)), X(n(2), n(3)), Y(n(2), n(3))); i += 4; }
    else if (k === 'C') { q.bezierCurveTo(X(n(0), n(1)), Y(n(0), n(1)), X(n(2), n(3)), Y(n(2), n(3)), X(n(4), n(5)), Y(n(4), n(5))); i += 6; }
    else q.closePath();
  }
  return q;
}

function smoothPath(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) ctx.lineTo(pts[1].x, pts[1].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const last = i === pts.length - 2;
    const ex = last ? pts[i + 1].x : (pts[i].x + pts[i + 1].x) / 2, ey = last ? pts[i + 1].y : (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, ex, ey);
  }
}

export interface SystemDrawOptions {
  alpha: number;
  /** Seconds, for the blood-flow animation; null disables animation (reduced motion). */
  time: number | null;
  /** Draw small text labels (used for the surface-landmark layer). */
  labels: boolean;
}

export function drawStructure(ctx: CanvasRenderingContext2D, st: SystemStructure, rig: Rig, o: SystemDrawOptions): void {
  if (!inView(st, rig.info.view)) return;
  const S = rig.S, lateral = rig.info.view === 'lateral';
  const color = st.color ?? SYSTEMS.find((x) => x.id === st.system)!.color;
  const trunkAxis = rig.seg('trunk', rig.info.nearSide).u;
  const rot = Math.atan2(trunkAxis.y, trunkAxis.x) - Math.PI / 2;
  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const side of sidesOf(st, rig)) {
    for (const sh of st.shapes) {
      if (sh.kind === 'ellipse') {
        const c = sh.c(rig, side), unit = sh.c.region === 'head' ? rig.headRadius : S;
        const rx = Math.max(1, (lateral ? sh.rz : sh.rx) * unit), ry = Math.max(1, sh.ry * unit), big = Math.max(rx, ry);
        // Rounded shading: lit from the upper left.
        const g = ctx.createRadialGradient(c.x - big * 0.3, c.y - big * 0.35, big * 0.05, c.x, c.y, big * 1.1);
        g.addColorStop(0, tint(color, 0.45)); g.addColorStop(0.5, color); g.addColorStop(1, tint(color, -0.4));
        ctx.fillStyle = g;
        ctx.strokeStyle = 'rgba(15,23,42,0.8)';
        ctx.lineWidth = Math.max(1, S * 0.007);
        const inTrunkOrHead = sh.c.region === 'trunk' || sh.c.region === 'head';
        if (sh.form && inTrunkOrHead) {
          // Local axes: +x toward the subject's left (front/back views) or the front (side view); +y down the trunk.
          const at = (l: number, a: number) => (sh.c.region === 'head' ? rig.head(0, l, a) : rig.trunk(0.5, l, a));
          const o = at(0, 0), e = at(1, 1), d = Math.hypot(e.x - o.x, e.y - o.y) || 1;
          const mirror = !lateral && side === 'r' && st.bilateral ? -1 : 1;
          const ex = { x: ((e.x - o.x) / d) * rx * mirror, y: ((e.y - o.y) / d) * rx * mirror }, ey = { x: trunkAxis.x * ry, y: trunkAxis.y * ry };
          if (sh.form === 'coils') {
            // Small intestine: one tube folded back and forth inside the region.
            const cmd: Cmd = ['M', -0.55, -0.8];
            const rows = [-0.8, -0.48, -0.16, 0.16, 0.48, 0.8];
            rows.forEach((v, i) => {
              const half = 0.95 * Math.sqrt(Math.max(0.1, 1 - v * v * 0.8)), dir = i % 2 ? -1 : 1, next = rows[i + 1];
              cmd.push('L', dir * half * 0.7, v);
              if (next !== undefined) cmd.push('C', dir * half * 1.25, v, dir * half * 1.25, next, dir * half * 0.7, next);
            });
            const tube = mapped(cmd, c, ex, ey), w = Math.max(2, ry * 0.26);
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.lineWidth = w + Math.max(1.5, S * 0.008); ctx.stroke(tube);
            ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(tube);
            ctx.strokeStyle = tint(color, 0.5); ctx.lineWidth = w * 0.3; ctx.stroke(tube);
          } else {
            const f = FORMS[sh.form]({ side, lateral });
            const outline = mapped(f.outline, c, ex, ey);
            ctx.fill(outline);
            ctx.stroke(outline);
            ctx.strokeStyle = tint(color, -0.5);
            ctx.lineWidth = Math.max(0.8, S * 0.005);
            for (const l of f.lines) ctx.stroke(mapped(l, c, ex, ey));
            if (sh.form === 'brain' && lateral) {
              // Cerebellum and brainstem, below and behind the cerebrum.
              const cb = new Path2D();
              cb.ellipse(c.x - ex.x * 0.55 + ey.x * 0.62, c.y - ex.y * 0.55 + ey.y * 0.62, rx * 0.4, ry * 0.3, rot, 0, Math.PI * 2);
              ctx.fillStyle = tint(color, -0.15); ctx.strokeStyle = 'rgba(15,23,42,0.8)'; ctx.lineWidth = Math.max(1, S * 0.007);
              ctx.fill(cb); ctx.stroke(cb);
              const stem = mapped(['M', -0.12, 0.4, 'Q', -0.2, 0.75, -0.3, 1.1], c, ex, ey);
              ctx.lineCap = 'round'; ctx.lineWidth = rx * 0.2 + 2; ctx.stroke(stem);
              ctx.strokeStyle = tint(color, 0.1); ctx.lineWidth = rx * 0.2; ctx.stroke(stem);
            }
          }
        } else {
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, rx, ry, rot, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (sh.kind === 'path') {
        const pts = shapePts(sh, lateral).map((f) => f(rig, side));
        const w = Math.max(1.5, sh.width * S);
        ctx.strokeStyle = 'rgba(15,23,42,0.6)';
        ctx.lineWidth = w + Math.max(1, S * 0.006);
        ctx.setLineDash([]);
        smoothPath(ctx, pts);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        smoothPath(ctx, pts);
        ctx.stroke();
        if (st.system === 'organs' && (st.id === 'large_intestine' || st.id === 'trachea')) {
          // Haustra of the colon and the cartilage rings of the trachea: regular bands across the tube.
          ctx.lineCap = 'butt';
          ctx.strokeStyle = tint(color, -0.45);
          ctx.setLineDash([Math.max(1, w * 0.12), Math.max(3, w * (st.id === 'trachea' ? 0.45 : 0.85))]);
          smoothPath(ctx, pts);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineCap = 'round';
        }
        // A highlight along the middle makes vessels, nerves and tubes read as round.
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = Math.max(0.6, w * 0.3);
        smoothPath(ctx, pts);
        ctx.stroke();
        if (o.time !== null && (st.system === 'arteries' || st.system === 'veins')) {
          // Moving highlights show the direction of flow only. The rate is nominal, not measured.
          const dash = Math.max(6, S * 0.05);
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = Math.max(1, w * 0.4);
          ctx.setLineDash([dash * 0.35, dash * 1.65]);
          const speed = st.system === 'arteries' ? 1.6 + 0.9 * Math.max(0, Math.sin(o.time * 2 * Math.PI * 1.1)) ** 3 : 0.9;
          ctx.lineDashOffset = (st.system === 'arteries' ? -1 : 1) * ((o.time * dash * 2 * speed) % (dash * 2));
          smoothPath(ctx, pts);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        }
      } else {
        for (const f of sh.pts) {
          const c = f(rig, side), r = Math.max(2.5, sh.r * S);
          ctx.fillStyle = color;
          ctx.strokeStyle = 'rgba(15,23,42,0.85)';
          ctx.lineWidth = Math.max(1, S * 0.006);
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    if (o.labels) {
      // Labels go outward from the body midline; medial landmarks are nudged down to reduce overlap.
      const a = anchorOf(st, rig, side);
      const midX = (rig.pt('l_shoulder').x + rig.pt('r_shoulder').x + rig.pt('l_hip').x + rig.pt('r_hip').x) / 4;
      const right = a.x >= midX;
      const short = st.name.replace(/ \(.*\)$/, '').replace(/^(Lateral|Medial|Anterior|Posterior) /, (m) => `${m[0]}. `);
      const y = a.y + (/^med_|ulnar_/.test(st.id) ? S * 0.05 : 0);
      ctx.font = `600 ${Math.max(9, S * 0.042)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = right ? 'left' : 'right';
      ctx.lineWidth = Math.max(2, S * 0.012);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(short, a.x + (right ? 1 : -1) * S * 0.035, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(short, a.x + (right ? 1 : -1) * S * 0.035, y);
    }
  }
  ctx.restore();
}

export function drawSystem(ctx: CanvasRenderingContext2D, system: SystemId, rig: Rig, o: SystemDrawOptions): void {
  for (const st of STRUCTURES) if (st.system === system) drawStructure(ctx, st, rig, o);
}

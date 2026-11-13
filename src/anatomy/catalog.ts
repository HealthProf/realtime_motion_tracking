// One searchable list of every named structure the app can draw, across all layers.
import { MUSCLES, type AnatomyView, type P, type Rig } from './anatomy';
import { A, anchorOf, H, M, regionsOf, STRUCTURES, T, type PtFn, type SystemId } from './systems';

export type LayerId = 'bones' | 'muscles' | SystemId;

export const LAYER_LABELS: Record<LayerId, string> = {
  bones: 'Bones', muscles: 'Muscles', organs: 'Internal organs', arteries: 'Arteries', veins: 'Veins',
  nerves: 'Nerves', ligaments: 'Joints and ligaments', lymph: 'Lymphatic system', landmarks: 'Surface landmarks',
};

export interface CatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  layer: LayerId;
  /** Views in which the structure is drawn; undefined = all. */
  views?: AnatomyView[];
  bilateral: boolean;
  regions: PtFn['region'][];
  anchor: (rig: Rig, side: 'l' | 'r') => P;
}

const FRONTAL: AnatomyView[] = ['anterior', 'posterior'];
const bone = (id: string, name: string, aliases: string[], at: PtFn, bilateral: boolean, views?: AnatomyView[]): CatalogEntry => ({ id, name, aliases, layer: 'bones', views, bilateral, regions: [at.region], anchor: at });

const BONES: CatalogEntry[] = [
  bone('skull', 'Skull', ['cranium', 'head'], H(0.3, 0, 0), false),
  bone('mandible', 'Mandible', ['jaw', 'jawbone'], H(-0.75, 0, 0.42), false),
  bone('cervical_spine', 'Cervical vertebrae', ['neck', 'cervical spine', 'spine'], M(-0.12, 0, -0.08), false),
  bone('thoracic_spine', 'Thoracic vertebrae', ['thoracic spine', 'spine', 'backbone'], M(0.3, 0, -0.13), false),
  bone('lumbar_spine', 'Lumbar vertebrae', ['lumbar spine', 'lower back', 'spine'], M(0.72, 0, -0.11), false),
  bone('sacrum', 'Sacrum', ['coccyx', 'tailbone'], M(0.9, 0, -0.1), false),
  bone('pelvis', 'Pelvis', ['ilium', 'hip bone', 'innominate', 'ischium', 'pubis'], T(0.88, 0.15, -0.03), true),
  bone('ribs', 'Ribs', ['rib cage', 'thorax', 'rib'], T(0.3, 0.18, 0.02), true),
  bone('sternum', 'Sternum', ['breastbone'], M(0.28, 0, 0.14), false, ['anterior']),
  bone('clavicle', 'Clavicle', ['collarbone', 'collar bone'], T(0.03, 0.19, 0.05), true, FRONTAL),
  bone('scapula', 'Scapula', ['shoulder blade'], T(0.18, 0.26, -0.1), true, ['posterior']),
  bone('humerus', 'Humerus', ['upper arm bone'], A('upperarm', 0.5, 0, 0), true),
  bone('radius', 'Radius', [], A('forearm', 0.5, 0.02, 0.02), true),
  bone('ulna', 'Ulna', [], A('forearm', 0.5, -0.02, -0.02), true),
  bone('hand_bones', 'Hand bones', ['carpals', 'metacarpals', 'phalanges', 'wrist bones', 'fingers'], A('forearm', 1.12, 0, 0), true),
  bone('femur', 'Femur', ['thigh bone', 'thighbone'], A('thigh', 0.5, 0, 0), true),
  bone('patella', 'Patella', ['kneecap', 'knee cap'], A('thigh', 1.0, 0, 0.06), true, ['anterior', 'lateral']),
  bone('tibia', 'Tibia', ['shin', 'shin bone', 'shinbone'], A('shank', 0.5, 0, 0), true),
  bone('fibula', 'Fibula', ['calf bone'], A('shank', 0.5, 0.05, -0.05), true),
  bone('calcaneus', 'Calcaneus', ['heel bone', 'heel'], A('foot', 0.08, 0, 0.02), true),
  bone('foot_bones', 'Foot bones', ['tarsals', 'metatarsals', 'talus', 'toes'], A('foot', 0.6, 0, 0.03), true),
];

const MUSCLE_ALIASES: Record<string, string[]> = {
  quadriceps: ['quads', 'rectus femoris', 'vastus lateralis', 'vastus medialis', 'vastus intermedius'],
  hamstrings: ['hamstring', 'biceps femoris', 'semitendinosus', 'semimembranosus'],
  gluteus_maximus: ['glutes', 'glute max', 'buttock'], gluteus_medius: ['glute med', 'tensor fasciae latae', 'tfl', 'abductors'],
  iliopsoas: ['psoas', 'iliacus', 'hip flexor'], adductors: ['adductor', 'gracilis', 'groin'],
  triceps_surae: ['calf', 'calves', 'gastrocnemius', 'soleus'], tibialis_anterior: ['shin muscle', 'tib ant'],
  rectus_abdominis: ['abs', 'abdominals', 'six pack'], obliques: ['oblique'], erector_spinae: ['back extensors', 'spinal erectors'],
  trapezius: ['traps'], latissimus_dorsi: ['lats', 'lat'], pectoralis_major: ['pecs', 'pec', 'chest muscle'], deltoid: ['delts', 'shoulder muscle'],
  biceps: ['biceps', 'brachialis'], triceps: ['triceps'], forearm_flexors: ['wrist flexors'], forearm_extensors: ['wrist extensors', 'brachioradialis'],
};

const MUSCLE_ENTRIES: CatalogEntry[] = MUSCLES.map((m) => ({
  id: m.id, name: m.label, aliases: MUSCLE_ALIASES[m.id] ?? [], layer: 'muscles', views: Object.keys(m.shapes) as AnatomyView[], bilateral: true,
  regions: [...new Set(Object.values(m.shapes).flatMap((sh) => sh.flatMap((x) => [x.from[0], x.to[0]])))],
  anchor: (rig, side) => {
    const sh = (m.shapes[rig.info.view] ?? Object.values(m.shapes)[0])[0];
    const a = rig.at(sh.from, side), b = rig.at(sh.to, side);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  },
}));

export const CATALOG: CatalogEntry[] = [
  ...BONES,
  ...MUSCLE_ENTRIES,
  ...STRUCTURES.map((st): CatalogEntry => ({ id: st.id, name: st.name, aliases: st.aliases, layer: st.system, views: st.views, bilateral: st.bilateral, regions: regionsOf(st), anchor: (rig, side) => anchorOf(st, rig, side) })),
];

export const CATALOG_BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

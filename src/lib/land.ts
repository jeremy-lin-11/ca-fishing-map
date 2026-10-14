import { pick, type Attrs } from './arcgis';
import { AGENCIES, type AgencyKey } from '../regs';

export function agencyKey(text: string): AgencyKey | null {
  const t = text.toLowerCase();
  if (/blm|bureau of land/.test(t)) return 'BLM';
  if (/forest service|usfs|\bfs\b|national forest/.test(t)) return 'USFS';
  if (/park service|\bnps\b|national park|national monument|recreation area/.test(t)) return 'NPS';
  if (/fish (and|&) wildlife|\bfws\b|refuge/.test(t)) return 'FWS';
  if (/reclamation|usbr|\bbor\b/.test(t)) return 'BOR';
  if (/defense|army|navy|air force|marine corps|\bdod\b|usaf|usn/.test(t)) return 'DOD';
  if (/tribal|indian|\bbia\b/.test(t)) return 'TRIBAL';
  if (/state|cdfw|dpr|california|\bcdpr\b/.test(t)) return 'STATE';
  if (/local|county|city|regional|district|municipal/.test(t)) return 'LOCAL';
  return null;
}

// Agency for map styling (works on either the federal or the parks layer).
export const styleAgency = (a: Attrs): AgencyKey =>
  agencyKey(pick(a, ['Agency', 'AGBUR', 'Mang_Name', 'MANAGER', 'FEATTYPE', 'TYPE', 'Own_Name'])) || 'OTHER_FED';

export interface LandUnit { name: string; key: AgencyKey; type: string }

// Classify land units at a point, most restrictive first (it decides the fishing verdict).
export function classifyLands(features: Attrs[]): LandUnit[] {
  const order = { no: 3, warn: 2, ok: 1 };
  return features.map(a => {
    const type = pick(a, ['FEATTYPE', 'TYPE', 'Des_Tp', 'Category']);
    const raw = pick(a, ['Agency', 'AGBUR', 'Mang_Name', 'MANAGER', 'Own_Name']) + ' ' + type;
    return { name: pick(a, ['NAME', 'Unit_Nm', 'Loc_Nm', 'Unit_Name']) || 'Unnamed unit', key: agencyKey(raw) || 'OTHER_FED', type };
  }).sort((x, y) => order[AGENCIES[y.key].status] - order[AGENCIES[x.key].status]);
}

// CAL FIRE ownership record -> agency key.
export function ownershipKey(a: Attrs): AgencyKey {
  const level = String(a.Own_Level || ''), group = String(a.Own_Group || ''), agency = String(a.Own_Agency || '');
  switch (level) {
    case 'Federal': return agencyKey(group) ?? 'OTHER_FED';
    case 'State': return /fish and wildlife/i.test(group) ? 'CDFW' : 'STATE';
    case 'Tribal': return 'TRIBAL';
    case 'Non Profit': return 'NONPROFIT';
    case 'Special District': return 'DISTRICT';
    case 'City': case 'County': return /water and power/i.test(agency) ? 'LADWP' : 'LOCAL';
    default: return 'LOCAL';
  }
}

// "Inyo, County of" -> "Inyo County"; "Adelanto, City of" -> "City of Adelanto";
// "Los Angeles - Department of Water and Power, City of" -> "Los Angeles Department of Water and Power".
export function ownerName(agency: string): string {
  const a = agency.trim();
  let m: RegExpMatchArray | null;
  if ((m = a.match(/^(.*) - (.*), City of$/))) return `${m[1]} ${m[2]}`;
  if ((m = a.match(/^(.*), County of$/))) return `${m[1]} County`;
  if ((m = a.match(/^(.*), City of$/))) return `City of ${m[1]}`;
  return a;
}

export const classifyOwnership = (features: Attrs[]): LandUnit[] => {
  const order = { no: 3, warn: 2, ok: 1 };
  return features.map(a => ({ name: ownerName(String(a.Own_Agency || 'Unknown owner')), key: ownershipKey(a), type: String(a.Own_Group || '') }))
    .sort((x, y) => order[AGENCIES[y.key].status] - order[AGENCIES[x.key].status]);
};

// SQL for the ownership layer matching exactly the records ownershipKey() maps to the given keys,
// so unchecked land types are never downloaded.
const OWN_WHERE: Record<AgencyKey, string> = {
  BLM: "Own_Group = 'US Bureau of Land Management'",
  USFS: "Own_Group = 'US Forest Service'",
  NPS: "Own_Group = 'US National Park Service'",
  FWS: "Own_Group = 'US Fish and Wildlife Service'",
  BOR: "Own_Group = 'US Bureau of Reclamation'",
  DOD: "Own_Group = 'US Department of Defense'",
  OTHER_FED: "(Own_Level = 'Federal' AND Own_Group NOT IN ('US Bureau of Land Management','US Forest Service','US National Park Service','US Fish and Wildlife Service','US Bureau of Reclamation','US Department of Defense'))",
  STATE: "(Own_Level = 'State' AND Own_Group <> 'CA Dept. of Fish and Wildlife')",
  CDFW: "Own_Group = 'CA Dept. of Fish and Wildlife'",
  LOCAL: "(Own_Level IN ('City','County') AND Own_Agency NOT LIKE '%Water and Power%')",
  LADWP: "(Own_Level IN ('City','County') AND Own_Agency LIKE '%Water and Power%')",
  DISTRICT: "Own_Level = 'Special District'",
  NONPROFIT: "Own_Level = 'Non Profit'",
  TRIBAL: "Own_Level = 'Tribal'"
};
export function ownershipWhere(keys: AgencyKey[]): string {
  if (!keys.length) return '1=0';
  if (keys.length === Object.keys(OWN_WHERE).length) return '1=1';
  return keys.map(k => OWN_WHERE[k]).join(' OR ');
}

export const LAND_GROUPS: { label: string; keys: AgencyKey[] }[] = [
  { label: 'Federal', keys: ['USFS', 'BLM', 'NPS', 'FWS', 'BOR', 'OTHER_FED', 'DOD'] },
  { label: 'State', keys: ['STATE', 'CDFW'] },
  { label: 'Local', keys: ['LOCAL', 'LADWP', 'DISTRICT'] },
  { label: 'Other', keys: ['TRIBAL', 'NONPROFIT'] }
];
export const ALL_LAND: AgencyKey[] = LAND_GROUPS.flatMap(g => g.keys);
// Default: land the public can generally use (not military, tribal or private conservation land).
export const PUBLIC_LAND: AgencyKey[] = ALL_LAND.filter(k => AGENCIES[k].public && k !== 'DOD' && k !== 'TRIBAL');

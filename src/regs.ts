// Curated summary of California fishing rules (CDFW). Keep in sync with the
// current regulation booklets; every entry is a *summary*, not legal text.
import type { Status, WaterType } from './types';

export type AgencyKey = 'BLM' | 'USFS' | 'BOR' | 'NPS' | 'FWS' | 'STATE' | 'CDFW' | 'LOCAL' | 'LADWP' | 'DISTRICT' | 'NONPROFIT' | 'DOD' | 'TRIBAL' | 'OTHER_FED';
export interface Agency { name: string; public: boolean; status: Status; fishing: string }

export const LINKS = {
  inland: 'https://wildlife.ca.gov/Fishing/Inland/Regulations',
  ocean: 'https://wildlife.ca.gov/Fishing/Ocean/Regulations',
  mpa: 'https://wildlife.ca.gov/Conservation/Marine/MPAs',
  license: 'https://wildlife.ca.gov/Licensing/Fishing'
};

// Agency key -> access + fishing rule for land managed by that agency.
export const AGENCIES: Record<AgencyKey, Agency> = {
  BLM:    { name: 'Bureau of Land Management', public: true,  status: 'ok',   fishing: 'Open to public fishing with a CA license; CDFW rules apply. Some areas have seasonal or road closures.' },
  USFS:   { name: 'U.S. Forest Service',       public: true,  status: 'ok',   fishing: 'Open to public fishing with a CA license; CDFW rules apply. Check for fire closures and wilderness permits.' },
  BOR:    { name: 'Bureau of Reclamation',     public: true,  status: 'ok',   fishing: 'Reservoirs generally open; check for restricted areas near dams and facilities.' },
  NPS:    { name: 'National Park Service',     public: true,  status: 'warn', fishing: 'Allowed in most parks with a CA license, but each park sets its own seasons, gear and catch-and-release rules.' },
  FWS:    { name: 'U.S. Fish & Wildlife Service', public: true, status: 'warn', fishing: 'National Wildlife Refuges only allow fishing in designated areas and seasons.' },
  STATE:  { name: 'State land',                public: true,  status: 'warn', fishing: 'Often allowed with a CA license, but State Parks and other state lands can restrict or ban fishing.' },
  CDFW:   { name: 'CA Dept. of Fish and Wildlife', public: true, status: 'warn', fishing: 'Wildlife Areas and Ecological Reserves usually allow fishing, but some areas and seasons are restricted (Title 14 §550, §630).' },
  LOCAL:  { name: 'City / county land',        public: true,  status: 'warn', fishing: 'Rules set by the local agency (permits, hours, gear). CA license usually still required.' },
  LADWP:  { name: 'LA Dept. of Water and Power', public: true, status: 'warn', fishing: 'LADWP lands, mostly in the Eastern Sierra, are generally open to public recreation including fishing unless posted closed; some areas are fenced or restricted.' },
  DISTRICT: { name: 'Special district',        public: true,  status: 'warn', fishing: 'Water, park and other districts set their own access rules. Many reservoirs allow fishing (often with a district permit); utility and school land usually does not.' },
  NONPROFIT: { name: 'Nonprofit conservation land', public: false, status: 'warn', fishing: 'Privately owned conservation land. Public access only where the owner allows it.' },
  DOD:    { name: 'Dept. of Defense',          public: false, status: 'no',   fishing: 'Restricted military land. Fishing is prohibited unless the installation has a permit program.' },
  TRIBAL: { name: 'Tribal land',               public: false, status: 'no',   fishing: 'Sovereign tribal land. A tribal permit is required; state rules may not apply.' },
  OTHER_FED: { name: 'Other federal land',     public: true,  status: 'warn', fishing: 'Access and fishing rules vary. Verify with the managing agency.' }
};

export const AGENCY_COLORS: Record<AgencyKey, string> = { BLM: '#d9a441', USFS: '#2e8b57', NPS: '#6a4c93', FWS: '#2a9d8f', BOR: '#3a86c8',
  STATE: '#8ab17d', CDFW: '#4d908e', LOCAL: '#b5e48c', LADWP: '#4ea8de', DISTRICT: '#90be6d', NONPROFIT: '#f9c74f',
  DOD: '#c1121f', TRIBAL: '#e07a5f', OTHER_FED: '#999999' };
export const AGENCY_LABELS: Record<AgencyKey, string> = { BLM: 'BLM', USFS: 'Forest Service', NPS: 'Natl Park', FWS: 'Wildlife Refuge', BOR: 'Reclamation',
  STATE: 'State', CDFW: 'CDFW', LOCAL: 'City/County', LADWP: 'LADWP', DISTRICT: 'District', NONPROFIT: 'Nonprofit',
  DOD: 'Military', TRIBAL: 'Tribal', OTHER_FED: 'Other federal' };

export const STATEWIDE = [
  'Fishing license required for anyone 16+ (inland and ocean, except from public piers/jetties in ocean waters).',
  'Second-rod stamp needed to use two rods in most inland waters.',
  'Report card required for steelhead (Steelhead Report Restoration Card) and salmon in applicable waters.',
  'Check the "Special Regulations" tables: many waters override statewide limits (gear, size, season, bait bans).'
];

export const WATER: Record<WaterType, { title: string; rules: string[] }> = {
  stream: {
    title: 'Inland stream / river',
    rules: [
      'General trout season on most streams: last Saturday in April through November 15. Streams are often closed the rest of the year (many have special year-round exceptions).',
      'Statewide trout limit: 5 per day, 10 in possession (lower on many special-regulation waters).',
      'Wild steelhead and many native trout: catch-and-release / barbless artificial lures only in many waters.',
      'Chinook salmon and steelhead are closed or heavily restricted on many Central Valley and coastal rivers. Check river-specific tables.',
      'Bait/gear restrictions are common on Sierra and coastal streams. Check by water name.'
    ]
  },
  lake: {
    title: 'Lake / reservoir',
    rules: [
      'Most lakes and reservoirs are open year-round (some high-elevation lakes follow the stream season).',
      'Trout: 5 per day, 10 in possession. Black bass: 5 per day, 12" minimum in most waters; many lakes have special bass limits.',
      'Striped bass, catfish, sunfish and crappie have separate limits and sizes per water body.',
      'Quagga/zebra mussel inspections are required at many boat launches. Clean, drain and dry gear.'
    ]
  },
  ocean: {
    title: 'Ocean / bay / tidal',
    rules: [
      'Ocean species have size, bag and season limits by species and region (rockfish, lingcod, halibut, salmon, Dungeness crab, etc.).',
      'Rockfish depth limits and Rockfish Conservation Areas apply by management area.',
      'Abalone recreational take has been closed statewide in recent years. Verify current status.',
      'California Ocean Salmon seasons are set annually. Check the current-season page.',
      'Marine Protected Areas (see above) may prohibit or limit take.'
    ]
  }
};

// Matched against the MPA `type` code (SMR, SMCA, SMCA (No-Take), SMRMA, SMP, FMR, FMCA, Special Closure).
export const MPA_TYPES: { match: RegExp; status: Status; verdict: string; text: string }[] = [
  { match: /^(SMR|FMR)$|no.?take|special closure/i, status: 'no', verdict: 'Fishing prohibited (no-take MPA)', text: 'No-take: all recreational take is prohibited.' },
  { match: /.*/, status: 'warn', verdict: 'Fishing restricted (MPA)', text: 'Limited take only. Allowed take:' }
];

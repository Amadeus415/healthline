// Shapes returned by the HEALTHLINE.GOLD tools and routes.

export type FunnelStep = { label: string; count: number };

export type Reason = { text: string; strength: "strong" | "match" };

export type Candidate = {
  patient_id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  age: number;
  gender: string;
  height_cm: number | null;
  weight_kg: number | null;
  city: string;
  zip: number;
  probability: number;
  identifying_marks: string[];
  notable_medications: string[];
  last_visit: string | null;
  reasons?: Reason[];
};

/** A clue the tool thinks would narrow the field most, with the expected number left after it. */
export type NextQuestion = { clue: "medication" | "first_initial" | "zip" | "height" | "care_site"; question: string; expected_left: number; why: string };

export type IdentifyResult = {
  funnel: FunnelStep[];
  total_matches: number;
  candidates: Candidate[];
  leader: { patient_id: number; name: string } | null;
  bedside_checks: { mark: string; present_in: string[] }[];
  next_questions?: NextQuestion[];
  as_of?: string;
};

/** IDENTIFY_PATIENT arguments. Empty string or 0 means unknown. */
export type IdentifyArgs = {
  city: string;
  gender: string;
  age_min: number;
  age_max: number;
  height_min: number;
  height_max: number;
  zip: string;
  medications: string;
  care_site: string;
  name: string;
  first_initial: string;
  has_marks: string;
  ruled_out_marks: string;
};

/** PARSE_CLUES output: identify arguments plus the presenting complaint. */
export type ParsedClues = Partial<IdentifyArgs> & { complaint?: string; marks?: string };

export type Source = { site: string; kind: string; date: string | null };

export type BriefSite = {
  site_id: number;
  name: string;
  city: string | null;
  visits: number;
  first_visit: string;
  last_visit: string;
  organization_ids: number[];
  merged: boolean;
  here: boolean;
  highlight: string;
  key: "bleeding" | null;
};

export type Brief = {
  patient: { patient_id: number; name: string; first_name: string; last_name: string; age: number; gender: string; city: string; zip: number; height_cm: number | null };
  complaint: string;
  as_of: string;
  er_site: string;
  visits_total: number;
  organization_ids: number;
  sites: BriefSite[];
  cleanup: { name: string; organization_ids: number[]; text: string }[];
  here: { visits: number; has_blood_thinner_on_file: boolean; summary: string | null };
  alerts: { level: "high" | "medium"; title: string; detail: string }[];
  facts: { topic: string; text: string; sources: Source[] }[];
  missed: { text: string; source: Source }[];
  actions: string[];
  allergies: { substance: string; severity: string | null }[];
  imaging: { studies: number; head: number; latest: string | null };
  active_medications: string[];
  error?: string;
};

export type PatientEvent = {
  kind: string;
  date: string;
  description: string;
  value: string | null;
  reason: string | null;
  active: boolean;
  site: string | null;
  this_er: boolean;
};

export type EventsResult = {
  total: number;
  counts: Record<string, number>;
  care_sites_searched: string[];
  care_sites_with_matches?: string[];
  events: PatientEvent[];
  truncated: boolean;
};

export type Stats = {
  patients: number;
  distinct_ssns: number;
  organization_ids: number;
  care_sites: number;
  er_visits_since_2023: number;
  er_visits_on_blood_thinner_since_2023: number;
  as_of: string;
  er_site_name: string;
  metro: string;
};

export type Chart = {
  patient_id: number;
  patient_hk: string;
  name: string;
  first_name: string;
  last_name: string;
  age: number;
  gender: string;
  birthdate: string;
  city: string;
  state: string;
  zip: number;
  alerts: { level: "high" | "medium"; title: string; detail: string }[];
  vitals: {
    height_cm: number | null;
    weight_kg: number | null;
    heart_rate: number | null;
    bp: string | null;
    bmi: number | null;
    recorded_on: string | null;
  };
  medications: { name: string; full: string; flag: "bleeding" | "hypoglycemia" | null }[];
  conditions: string[];
  allergies: { substance: string; category: string; reaction: string | null; severity: string | null }[];
  identifying_marks: string[];
  care_sites: { name: string; visits: number; last_visit: string }[];
  visits: { total: number; er: number; inpatient: number; last_visit: string | null; last_er_visit: string | null };
  sensitive_record_count: number;
};

export type Bay = {
  bay: number;
  patient_id: number | null;
  patient: string;
  age: number | null;
  gender: string | null;
  chief_complaint: string;
  acuity: number;
  status: string;
  minutes_ago: number;
  on_blood_thinner: boolean | null;
  has_severe_allergy: boolean | null;
};

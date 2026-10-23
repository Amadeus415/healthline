// Shapes returned by the HEALTHLINE.GOLD tools and routes.

export type FunnelStep = { label: string; count: number };

export type Candidate = {
  patient_id: number;
  name: string;
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
};

export type IdentifyResult = {
  funnel: FunnelStep[];
  total_matches: number;
  candidates: Candidate[];
  leader: { patient_id: number; name: string } | null;
  bedside_checks: { mark: string; present_in: string[] }[];
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

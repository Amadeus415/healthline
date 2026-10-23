-- Healthline gold mart: one cleaned event history per patient, and one wide row per patient built
-- from it, for fast identification, unification and briefing.
--
-- Sources
--   CLINICAL_CLAIMS_DV (the team's Data Vault): PATIENT_HK hash keys and organizations.
--   SILVER: patient-grain clinical facts. The vault's staging views sample each table
--   independently (LIMIT 100000), so most vault patients have no linked records yet. Once the
--   vault loads full patient histories, PATIENT_EVENTS can read from its satellites instead.
--
-- The demo runs on one morning: Monday 23 September 2024, 06:21, in the emergency department at
-- Westpark Healthcare Campus in Cleveland, eight minutes before Medic 14 arrives. Everything is
-- computed as of that moment, so nothing recorded later (including the arriving patient's own ER
-- visit) leaks into a brief. A fact counts as "before" when its visit started before the clock.
--
-- Build on a large warehouse (it scans 763M observations and 148M procedures).

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE HEALTHLINE_WH;

SET AS_OF = '2024-09-23 06:21:14';

CREATE OR REPLACE TABLE HEALTHLINE.GOLD.CLOCK
  COMMENT = 'The moment the demo runs at, and the ER it runs in. Every gold table is as of this time.'
AS
SELECT $AS_OF::TIMESTAMP_NTZ AS as_of, 1000384 AS er_site_id, 'Westpark Healthcare Campus' AS er_site_name,
  'Cleveland' AS metro;

-- Organization cleanup. The vault holds 4,034 organization IDs, but some are the same place twice:
-- "LUTHERAN HOSPITAL" at 1730 W 25th St has IDs 1000297 and 1000529. IDs that share a name and
-- street address become one care site, keyed by the lowest ID.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.CARE_SITES
  COMMENT = 'Every Data Vault organization ID mapped to a cleaned care site. IDs with the same name and street address are one site (site_id = lowest ID).'
AS
WITH orgs AS (
  SELECT h.organization_id, s.name, s.address, s.city, s.state, s.zip, s.lat, s.lon, s.synthea_city
  FROM CLINICAL_CLAIMS_DV.RAW_VAULT.HUB_ORGANIZATION h
  JOIN CLINICAL_CLAIMS_DV.RAW_VAULT.SAT_ORGANIZATION_DETAILS s USING (organization_hk)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY h.organization_hk ORDER BY s.load_datetime DESC) = 1
),
keyed AS (
  SELECT *,
    UPPER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ')) AS name_key,
    UPPER(REGEXP_REPLACE(TRIM(address), '\\s+', ' ')) AS address_key
  FROM orgs
)
SELECT
  organization_id,
  MIN(organization_id) OVER (PARTITION BY name_key, address_key) AS site_id,
  INITCAP(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '\\s+', ' '), '[ ,]+(LLC|INC\\.?|CORP\\.?|L\\.L\\.C\\.)$', '', 1, 0, 'i'), ' ') AS site_name,
  INITCAP(city, ' ') AS city,
  state,
  zip,
  lat,
  lon,
  synthea_city,
  COUNT(*) OVER (PARTITION BY name_key, address_key) AS ids_at_site
FROM keyed;

-- Every clinical fact recorded before the clock, one row each, with the care site that recorded it.
-- Stop dates after the clock are cleared: at 06:21 those records were still active.
-- Mental health, substance use and similar records are left out (see PATIENT_SENSITIVE).
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.PATIENT_EVENTS
  CLUSTER BY (patient_id)
  COMMENT = 'Every visit, medication, diagnosis, allergy, procedure, imaging study, device, vital and key lab before the clock, with the care site that recorded it (organization_id is the raw vault ID, site_id the cleaned site). stop_at is NULL while a record was still active.'
AS
WITH enc AS (
  SELECT e.encounter_id, e.patient_id, e.encounter_start, e.encounter_stop, e.encounterclass, e.description,
    e.reasondescription, e.organization_id, c.site_id
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ENCOUNTERS e
  LEFT JOIN HEALTHLINE.GOLD.CARE_SITES c USING (organization_id)
  WHERE e.encounter_start < $AS_OF::TIMESTAMP_NTZ
),
facts AS (
  SELECT patient_id, encounter_id, encounter_start AS event_at, encounter_stop AS stop_at, 'visit' AS kind,
    NULL::VARCHAR AS code, description, NULL::FLOAT AS value, NULL::VARCHAR AS units,
    reasondescription AS reason, NULL::VARCHAR AS severity, NULL::VARCHAR AS category
  FROM enc
  UNION ALL
  SELECT patient_id, encounter_id, med_start, med_stop, 'medication', code::VARCHAR, description, NULL, NULL,
    reasondescription, NULL, NULL
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.MEDICATIONS
  UNION ALL
  SELECT patient_id, encounter_id, condition_start::TIMESTAMP_NTZ, condition_stop::TIMESTAMP_NTZ, 'condition',
    code::VARCHAR, description, NULL, NULL, NULL, NULL, NULL
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS
  WHERE NOT (description ILIKE ANY ('%drug%', '%substance%', '%alcohol%', '%abuse%', '%depress%', '%anxiety%',
    '%suicid%', '%hiv%', '%criminal%', '%intimate partner%', '%opioid%', '%psych%'))
  UNION ALL
  SELECT patient_id, encounter_id, allergy_start::TIMESTAMP_NTZ, allergy_stop::TIMESTAMP_NTZ, 'allergy',
    code::VARCHAR, description, NULL, NULL, description1,
    IFF(severity1 = 'SEVERE' OR severity2 = 'SEVERE', 'SEVERE', severity1), category
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ALLERGIES
  UNION ALL
  SELECT patient_id, encounter_id, proc_start, proc_stop, 'procedure', code::VARCHAR, description, NULL, NULL,
    reasondescription, NULL, NULL
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PROCEDURES
  WHERE NOT (description ILIKE ANY ('%substance use%', '%drug abuse%', '%depression screening%', '%alcohol%',
    '%anxiety%', '%psych%'))
  UNION ALL
  -- One row per study (body site and modality in a visit), not per image.
  SELECT patient_id, encounter_id, MIN(image_date), NULL, 'imaging', ANY_VALUE(modality_code),
    modality_description || ' · ' || REGEXP_REPLACE(bodysite_description, ' \\(body structure\\)$', ''),
    COUNT(*), 'images', NULL, NULL, modality_code
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.IMAGING_STUDIES
  GROUP BY patient_id, encounter_id, modality_description, bodysite_description, modality_code
  UNION ALL
  SELECT patient_id, encounter_id, device_start, device_stop, 'device', code::VARCHAR, description, NULL, NULL,
    NULL, NULL, NULL
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.DEVICES
  UNION ALL
  SELECT patient_id, encounter_id, observation_date, NULL,
    IFF(code IN ('8302-2', '29463-7', '8867-4', '8480-6', '8462-4', '39156-5'), 'vital', 'lab'),
    code, description, TRY_TO_DOUBLE(value), units, NULL, NULL, category
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.OBSERVATIONS
  WHERE code IN ('8302-2', '29463-7', '8867-4', '8480-6', '8462-4', '39156-5',  -- vitals
    '2339-0', '2345-7', '4548-4', '718-7', '777-3', '2160-0', '38483-4', '6301-6', '6298-4')  -- key labs
)
SELECT
  f.patient_id,
  f.event_at,
  IFF(f.stop_at > $AS_OF::TIMESTAMP_NTZ, NULL, f.stop_at) AS stop_at,
  f.kind,
  f.code,
  f.description,
  f.value,
  f.units,
  f.reason,
  f.severity,
  f.category,
  f.encounter_id,
  enc.encounterclass AS encounter_class,
  enc.organization_id,
  enc.site_id
FROM facts f
LEFT JOIN enc ON enc.encounter_id = f.encounter_id
-- A fact counts when it and its visit started before the clock; the few observations without a
-- visit go by their own time.
WHERE f.event_at < $AS_OF::TIMESTAMP_NTZ AND (enc.encounter_id IS NOT NULL OR f.encounter_id IS NULL)
ORDER BY f.patient_id;

-- Identifying marks a clinician can check at the bedside, from procedures, devices and meds.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.PATIENT_MARKS AS
WITH procs AS (
  SELECT DISTINCT patient_id,
    CASE
      WHEN description ILIKE '%appendectomy%' THEN 'Appendectomy scar'
      WHEN description ILIKE ANY ('%sternotomy%', '%coronary artery bypass%') THEN 'Sternotomy scar (chest)'
      WHEN description ILIKE '%cesarean%' THEN 'C-section scar'
      WHEN description ILIKE '%cholecystectomy%' THEN 'Gallbladder surgery scar'
      WHEN description ILIKE ANY ('%lumpectomy%', '%mastectomy%') THEN 'Breast surgery scar'
      WHEN description ILIKE '%knee replacement%' THEN 'Knee replacement scar'
      WHEN description ILIKE '%replacement of hip%' THEN 'Hip replacement scar'
      WHEN description ILIKE '%colostomy%' THEN 'Colostomy'
      WHEN description ILIKE '%amputation of%' OR description ILIKE '%amputation above%' THEN 'Amputation'
    END AS mark
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'procedure'
    AND description ILIKE ANY ('%appendectomy%', '%sternotomy%', '%coronary artery bypass%', '%cesarean%',
      '%cholecystectomy%', '%lumpectomy%', '%mastectomy%', '%knee replacement%', '%replacement of hip%',
      '%colostomy%', '%amputation of%', '%amputation above%')
),
devices AS (
  SELECT DISTINCT patient_id,
    CASE
      WHEN description ILIKE '%pacemaker%' THEN 'Pacemaker'
      WHEN description ILIKE '%ventricular assist%' THEN 'Ventricular assist device'
      WHEN description ILIKE '%wheelchair%' THEN 'Uses a wheelchair'
      WHEN description ILIKE ANY ('%walker%', '%crutch%') THEN 'Uses a walker or crutches'
      WHEN description ILIKE '%oxygen%' THEN 'Home oxygen'
      WHEN description ILIKE '%hemodialysis%' THEN 'Dialysis access'
      WHEN description ILIKE '%denture%' THEN 'Wears dentures'
    END AS mark
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'device' AND stop_at IS NULL
    AND description ILIKE ANY ('%pacemaker%', '%ventricular assist%', '%wheelchair%', '%walker%', '%crutch%',
      '%oxygen%', '%hemodialysis%', '%denture%')
),
history AS (
  SELECT DISTINCT patient_id,
    CASE
      WHEN description ILIKE 'history of appendectomy%' THEN 'Appendectomy scar'
      WHEN description ILIKE ANY ('history of coronary artery bypass%', 'history of aortic valve%')
        THEN 'Sternotomy scar (chest)'
      WHEN description ILIKE 'history of renal transplant%' THEN 'Kidney transplant scar'
      WHEN description ILIKE 'history of artificial joint%' THEN 'Joint replacement scar'
      WHEN description ILIKE ANY ('history of%amputation%', 'history of disarticulation%') THEN 'Amputation'
      WHEN description ILIKE 'blindness%' THEN 'Blindness'
    END AS mark
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'condition'
    AND description ILIKE ANY ('history of appendectomy%', 'history of coronary artery bypass%',
      'history of aortic valve%', 'history of renal transplant%', 'history of artificial joint%',
      'history of%amputation%', 'history of disarticulation%', 'blindness%')
),
meds AS (
  SELECT DISTINCT patient_id, 'Insulin injection sites' AS mark
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'medication' AND stop_at IS NULL AND description ILIKE '%insulin%'
)
SELECT * FROM procs UNION SELECT * FROM devices UNION SELECT * FROM history UNION SELECT * FROM meds;

-- Mental health, substance use and similar records. Kept apart and never granted to the app:
-- they are only readable through BREAK_GLASS, which logs every access.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.PATIENT_SENSITIVE AS
WITH hits AS (
  SELECT patient_id, description, condition_start AS recorded_on, 'condition' AS kind
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS
  WHERE description ILIKE ANY ('%drug%', '%substance%', '%alcohol%', '%abuse%', '%depress%', '%anxiety%',
    '%suicid%', '%hiv%', '%criminal%', '%intimate partner%', '%opioid%', '%psych%')
    AND condition_start < $AS_OF::DATE
  UNION ALL
  SELECT patient_id, description, proc_start::DATE, 'screening'
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PROCEDURES
  WHERE description ILIKE ANY ('%substance use%', '%drug abuse%', '%depression screening%', '%alcohol%',
    '%anxiety%', '%psych%')
    AND proc_start < $AS_OF::TIMESTAMP_NTZ
)
SELECT patient_id,
  ARRAY_AGG(DISTINCT OBJECT_CONSTRUCT('description', description, 'kind', kind)) AS records,
  MAX(recorded_on) AS last_recorded
FROM hits
GROUP BY patient_id;

CREATE OR REPLACE TABLE HEALTHLINE.GOLD.PATIENT_PROFILE
  CLUSTER BY (synthea_city, gender)
  COMMENT = 'One row per patient: demographics, latest vitals, active meds and conditions, allergies, care sites and identifying marks, as of the clock.'
AS
WITH sites AS (
  SELECT site_id, site_name FROM HEALTHLINE.GOLD.CARE_SITES WHERE organization_id = site_id
),
vitals AS (
  SELECT patient_id,
    MAX(IFF(code = '8302-2', value, NULL)) AS height_cm,
    MAX(IFF(code = '29463-7', value, NULL)) AS weight_kg,
    MAX(IFF(code = '8867-4', value, NULL)) AS heart_rate,
    MAX(IFF(code = '8480-6', value, NULL)) AS bp_systolic,
    MAX(IFF(code = '8462-4', value, NULL)) AS bp_diastolic,
    MAX(IFF(code = '39156-5', value, NULL)) AS bmi,
    MAX(event_at)::DATE AS vitals_date
  FROM (
    SELECT patient_id, code, value, event_at
    FROM HEALTHLINE.GOLD.PATIENT_EVENTS
    WHERE kind = 'vital'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, code ORDER BY event_at DESC) = 1
  )
  GROUP BY patient_id
),
meds AS (
  SELECT patient_id,
    ARRAY_AGG(DISTINCT description) WITHIN GROUP (ORDER BY description) AS active_medications,
    BOOLOR_AGG(description ILIKE ANY ('%clopidogrel%', '%warfarin%', '%apixaban%', '%rivaroxaban%',
      '%dabigatran%', '%heparin%', '%enoxaparin%', '%prasugrel%', '%ticagrelor%')) AS on_blood_thinner,
    BOOLOR_AGG(description ILIKE '%insulin%') AS on_insulin,
    BOOLOR_AGG(description ILIKE ANY ('%metoprolol%', '%atenolol%', '%propranolol%', '%carvedilol%',
      '%bisoprolol%')) AS on_beta_blocker,
    BOOLOR_AGG(description ILIKE ANY ('%oxycodone%', '%hydrocodone%', '%fentanyl%', '%morphine%',
      '%tramadol%', '%methadone%', '%buprenorphine%')) AS on_opioid
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'medication' AND stop_at IS NULL
  GROUP BY patient_id
),
conds AS (
  SELECT patient_id,
    ARRAY_AGG(DISTINCT REGEXP_REPLACE(description, ' \\((disorder|finding)\\)$', ''))
      WITHIN GROUP (ORDER BY REGEXP_REPLACE(description, ' \\((disorder|finding)\\)$', '')) AS active_conditions
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'condition' AND stop_at IS NULL
    AND description NOT ILIKE '%(situation)%'
    AND NOT (description ILIKE '%(finding)%' AND NOT (description ILIKE ANY ('%obesity%', '%body mass index%')))
  GROUP BY patient_id
),
allergies AS (
  SELECT patient_id,
    ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
      'substance', REGEXP_REPLACE(description, ' \\((substance|product|organism|finding)\\)$', ''),
      'category', category,
      'reaction', REGEXP_REPLACE(reason, ' \\((disorder|finding)\\)$', ''),
      'severity', severity))
      WITHIN GROUP (ORDER BY DECODE(severity, 'SEVERE', 0, 'MODERATE', 1, 'MILD', 2, 3), description) AS allergies,
    BOOLOR_AGG(severity = 'SEVERE') AS has_severe_allergy
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'allergy' AND stop_at IS NULL AND description NOT ILIKE 'allergy to substance%'
  GROUP BY patient_id
),
site_visits AS (
  SELECT v.patient_id, v.site_id, s.site_name, COUNT(*) AS visits, MAX(v.event_at) AS last_visit
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS v
  JOIN sites s USING (site_id)
  WHERE v.kind = 'visit'
  GROUP BY 1, 2, 3
),
care_sites AS (
  SELECT patient_id,
    ARRAY_AGG(OBJECT_CONSTRUCT('site_id', site_id, 'name', site_name, 'visits', visits, 'last_visit', last_visit::DATE))
      WITHIN GROUP (ORDER BY visits DESC) AS care_sites,
    ARRAY_AGG(IFF(last_visit >= '2023-01-01', site_name, NULL)) AS recent_care_sites
  FROM site_visits
  GROUP BY patient_id
),
encounters AS (
  SELECT patient_id,
    COUNT(*) AS total_visits,
    COUNT_IF(encounter_class = 'emergency') AS er_visits,
    COUNT_IF(encounter_class = 'inpatient') AS inpatient_stays,
    MAX(event_at)::DATE AS last_visit,
    MAX(IFF(encounter_class = 'emergency', event_at, NULL))::DATE AS last_er_visit
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'visit'
  GROUP BY patient_id
),
marks AS (
  SELECT patient_id, ARRAY_AGG(DISTINCT mark) WITHIN GROUP (ORDER BY mark) AS identifying_marks
  FROM HEALTHLINE.GOLD.PATIENT_MARKS
  WHERE mark IS NOT NULL
  GROUP BY patient_id
)
SELECT
  CAST(MD5_BINARY(NULLIF(UPPER(TRIM(CAST(p.patient_id AS VARCHAR))), '')) AS BINARY(16)) AS patient_hk,
  p.patient_id,
  p.first AS first_name,
  p.last AS last_name,
  p.first || ' ' || p.last AS full_name,
  p.gender,
  p.birthdate,
  IFF(p.deathdate < $AS_OF::DATE, p.deathdate, NULL) AS deathdate,
  p.birthdate <= $AS_OF::DATE AND (p.deathdate IS NULL OR p.deathdate >= $AS_OF::DATE) AS is_alive,
  FLOOR(MONTHS_BETWEEN(LEAST(COALESCE(p.deathdate, $AS_OF::DATE), $AS_OF::DATE), p.birthdate) / 12) AS age,
  p.race,
  p.ethnicity,
  p.city,
  p.state,
  p.zip,
  p.synthea_city,
  ROUND(v.height_cm, 1) AS height_cm,
  ROUND(v.weight_kg, 1) AS weight_kg,
  v.heart_rate,
  v.bp_systolic,
  v.bp_diastolic,
  ROUND(v.bmi, 1) AS bmi,
  v.vitals_date,
  COALESCE(m.active_medications, []) AS active_medications,
  COALESCE(m.on_blood_thinner, FALSE) AS on_blood_thinner,
  COALESCE(m.on_insulin, FALSE) AS on_insulin,
  COALESCE(m.on_beta_blocker, FALSE) AS on_beta_blocker,
  COALESCE(m.on_opioid, FALSE) AS on_opioid,
  COALESCE(c.active_conditions, []) AS active_conditions,
  COALESCE(a.allergies, []) AS allergies,
  COALESCE(a.has_severe_allergy, FALSE) AS has_severe_allergy,
  COALESCE(k.identifying_marks, []) AS identifying_marks,
  COALESCE(s.care_sites, []) AS care_sites,
  COALESCE(s.recent_care_sites, []) AS recent_care_sites,
  COALESCE(e.total_visits, 0) AS total_visits,
  COALESCE(e.er_visits, 0) AS er_visits,
  COALESCE(e.inpatient_stays, 0) AS inpatient_stays,
  e.last_visit,
  e.last_er_visit,
  COALESCE(ARRAY_SIZE(x.records), 0) AS sensitive_record_count
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PATIENTS p
LEFT JOIN vitals v USING (patient_id)
LEFT JOIN meds m USING (patient_id)
LEFT JOIN conds c USING (patient_id)
LEFT JOIN allergies a USING (patient_id)
LEFT JOIN care_sites s USING (patient_id)
LEFT JOIN encounters e USING (patient_id)
LEFT JOIN marks k USING (patient_id)
LEFT JOIN HEALTHLINE.GOLD.PATIENT_SENSITIVE x USING (patient_id);

-- Thin views for Cortex Analyst population questions, cut at the clock like everything else.
CREATE OR REPLACE VIEW HEALTHLINE.GOLD.ENCOUNTERS
  COMMENT = 'Every visit before the clock, with its cleaned care site name.'
AS
SELECT e.encounter_id, e.patient_id, e.encounter_start, e.encounter_stop, e.encounterclass AS encounter_class,
  e.description, e.reasondescription AS reason, s.site_name AS care_site, e.total_claim_cost, e.synthea_city
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ENCOUNTERS e
LEFT JOIN HEALTHLINE.GOLD.CARE_SITES s USING (organization_id)
JOIN HEALTHLINE.GOLD.CLOCK k ON e.encounter_start < k.as_of;

CREATE OR REPLACE VIEW HEALTHLINE.GOLD.MEDICATIONS
  COMMENT = 'Medication orders started before the clock. Active means not stopped by then.'
AS
SELECT m.medication_id, m.patient_id, m.med_start, IFF(m.med_stop > k.as_of, NULL, m.med_stop) AS med_stop,
  m.description AS medication, m.reasondescription AS reason, (m.med_stop IS NULL OR m.med_stop > k.as_of) AS is_active,
  m.synthea_city
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.MEDICATIONS m
JOIN HEALTHLINE.GOLD.CLOCK k ON m.med_start < k.as_of;

CREATE OR REPLACE VIEW HEALTHLINE.GOLD.CONDITIONS
  COMMENT = 'Diagnoses recorded before the clock. Active means not resolved by then.'
AS
SELECT c.condition_id, c.patient_id, c.condition_start, IFF(c.condition_stop > k.as_of, NULL, c.condition_stop) AS condition_stop,
  c.description AS condition, (c.condition_stop IS NULL OR c.condition_stop > k.as_of) AS is_active, c.synthea_city
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS c
JOIN HEALTHLINE.GOLD.CLOCK k ON c.condition_start < k.as_of::DATE
WHERE NOT (c.description ILIKE ANY ('%drug%', '%substance%', '%alcohol%', '%abuse%', '%depress%', '%anxiety%',
  '%suicid%', '%hiv%', '%criminal%', '%intimate partner%', '%opioid%', '%psych%'));

-- Every break-the-glass access, written by BREAK_GLASS.
CREATE TABLE IF NOT EXISTS HEALTHLINE.GOLD.ACCESS_LOG (
  accessed_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  patient_id NUMBER,
  reason VARCHAR,
  clinician VARCHAR,
  records_shown NUMBER
);

-- Every identity a clinician confirmed, written by CONFIRM_IDENTITY. The AI suggests; a person decides.
CREATE TABLE IF NOT EXISTS HEALTHLINE.GOLD.IDENTITY_LOG (
  confirmed_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  patient_id NUMBER,
  probability FLOAT,
  clues VARIANT,
  clinician VARCHAR,
  role VARCHAR
);

-- Demo ER census. Bays point at real synthetic patients, except bay 4 (an unidentified man the
-- assistant has to find) and bay 6 (Medic 14, still on the way in). Arrival times are relative
-- to now, so the board stays live; a negative minutes_ago is an ambulance's ETA.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.ER_BAYS (
  bay NUMBER, patient_id NUMBER, label VARCHAR, chief_complaint VARCHAR, acuity NUMBER,
  status VARCHAR, minutes_ago NUMBER
) AS SELECT * FROM VALUES
  (1, 1633078, NULL, 'Confused and sweating', 2, 'In treatment', 34),
  (2, 1633370, NULL, 'Chest pain', 2, 'In treatment', 21),
  (3, 2173923, NULL, 'Wheezing', 3, 'In treatment', 48),
  (4, NULL, 'Unknown male, early 40s', 'Unresponsive, found outside', 1, 'Unidentified', 6),
  (5, 2255404, NULL, 'Laceration, left hand', 4, 'Waiting', 72),
  (6, NULL, 'Medic 14 · female, mid-50s', 'Fall with head strike, confused', 2, 'Inbound', -8),
  (7, 1633316, NULL, 'Fall at home', 3, 'Waiting', 55);

CREATE OR REPLACE VIEW HEALTHLINE.GOLD.ER_BOARD
  COMMENT = 'Who is in the emergency department now: bay, complaint, acuity (ESI 1 most urgent), status (Inbound means the ambulance is still on the way) and patient.'
AS
SELECT b.bay, b.patient_id, COALESCE(p.full_name, b.label) AS patient, p.age, p.gender,
  b.chief_complaint, b.acuity, b.status,
  DATEADD(minute, -b.minutes_ago, CURRENT_TIMESTAMP()) AS arrived_at,
  p.on_blood_thinner, p.has_severe_allergy
FROM HEALTHLINE.GOLD.ER_BAYS b
LEFT JOIN HEALTHLINE.GOLD.PATIENT_PROFILE p USING (patient_id);

-- Headline numbers for the demo's closing screen, computed rather than typed.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.STATS
  COMMENT = 'Headline numbers: patients, shared SSNs, organization cleanup, and ER visits by patients on a blood thinner.'
AS
WITH er AS (
  SELECT patient_id, encounter_id, event_at
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'visit' AND encounter_class = 'emergency' AND event_at >= '2023-01-01'
),
thinners AS (
  SELECT patient_id, event_at, stop_at
  FROM HEALTHLINE.GOLD.PATIENT_EVENTS
  WHERE kind = 'medication' AND description ILIKE ANY ('%clopidogrel%', '%warfarin%', '%apixaban%',
    '%rivaroxaban%', '%dabigatran%', '%heparin%', '%enoxaparin%', '%prasugrel%', '%ticagrelor%')
)
SELECT
  (SELECT COUNT(*) FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PATIENTS) AS patients,
  (SELECT COUNT(DISTINCT ssn) FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PATIENTS) AS distinct_ssns,
  (SELECT COUNT(*) FROM HEALTHLINE.GOLD.CARE_SITES) AS organization_ids,
  (SELECT COUNT(DISTINCT site_id) FROM HEALTHLINE.GOLD.CARE_SITES) AS care_sites,
  (SELECT COUNT(*) FROM er) AS er_visits_since_2023,
  (SELECT COUNT(DISTINCT er.encounter_id) FROM er JOIN thinners t
     ON t.patient_id = er.patient_id AND t.event_at < er.event_at AND (t.stop_at IS NULL OR t.stop_at > er.event_at)
  ) AS er_visits_on_blood_thinner_since_2023;

REVOKE SELECT ON TABLE HEALTHLINE.GOLD.PATIENT_SENSITIVE FROM ROLE HEALTHLINE_APP_ROLE;

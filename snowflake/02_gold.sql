-- HealthForce gold mart: one wide row per patient, built for fast identification and charting.
--
-- Sources
--   CLINICAL_CLAIMS_DV (the team's Data Vault): PATIENT_HK hash keys and organization names.
--   SILVER: patient-grain clinical facts. The vault's staging views sample each table
--   independently (LIMIT 100000), so most vault patients have no linked records yet. Once the
--   vault loads full patient histories, these CTEs can read from its satellites instead.
--
-- Synthea data ends in November 2024, so ages and "active" are computed as of 2024-11-01,
-- not today.
--
-- Build on a large warehouse (it scans 763M observations); it takes a few minutes.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE HEALTHLINE_WH;

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
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PROCEDURES
  WHERE description ILIKE ANY ('%appendectomy%', '%sternotomy%', '%coronary artery bypass%', '%cesarean%',
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
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.DEVICES
  WHERE description ILIKE ANY ('%pacemaker%', '%ventricular assist%', '%wheelchair%', '%walker%', '%crutch%',
    '%oxygen%', '%hemodialysis%', '%denture%')
    AND (device_stop IS NULL OR device_stop >= '2024-11-01')
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
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS
  WHERE description ILIKE ANY ('history of appendectomy%', 'history of coronary artery bypass%',
    'history of aortic valve%', 'history of renal transplant%', 'history of artificial joint%',
    'history of%amputation%', 'history of disarticulation%', 'blindness%')
),
meds AS (
  SELECT DISTINCT patient_id, 'Insulin injection sites' AS mark
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.MEDICATIONS
  WHERE description ILIKE '%insulin%' AND (med_stop IS NULL OR med_stop >= '2024-10-01')
)
SELECT * FROM procs UNION SELECT * FROM devices UNION SELECT * FROM history UNION SELECT * FROM meds;

-- Mental health, substance use and similar records. Kept apart and never granted to the app:
-- they are only readable through BREAK_GLASS, which logs every access.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.PATIENT_SENSITIVE AS
WITH hits AS (
  SELECT patient_id, description, condition_start::DATE AS recorded_on, 'condition' AS kind
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS
  WHERE description ILIKE ANY ('%drug%', '%substance%', '%alcohol%', '%abuse%', '%depress%', '%anxiety%',
    '%suicid%', '%hiv%', '%criminal%', '%intimate partner%', '%opioid%', '%psych%')
  UNION ALL
  SELECT patient_id, description, proc_start::DATE, 'screening'
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.PROCEDURES
  WHERE description ILIKE ANY ('%substance use%', '%drug abuse%', '%depression screening%', '%alcohol%',
    '%anxiety%', '%psych%')
)
SELECT patient_id,
  ARRAY_AGG(DISTINCT OBJECT_CONSTRUCT('description', description, 'kind', kind)) AS records,
  MAX(recorded_on) AS last_recorded
FROM hits
GROUP BY patient_id;

CREATE OR REPLACE TABLE HEALTHLINE.GOLD.PATIENT_PROFILE
  CLUSTER BY (synthea_city, gender)
  COMMENT = 'One row per patient: demographics, latest vitals, active meds and conditions, allergies, visits and identifying marks, as of 2024-11-01.'
AS
WITH vit AS (
  SELECT patient_id, description, TRY_TO_DOUBLE(value) AS v, observation_date
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.OBSERVATIONS
  WHERE description IN ('Body Height', 'Body Weight', 'Heart rate', 'Systolic Blood Pressure',
    'Diastolic Blood Pressure', 'Body mass index (BMI) [Ratio]')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, description ORDER BY observation_date DESC) = 1
),
vitals AS (
  SELECT patient_id,
    MAX(IFF(description = 'Body Height', v, NULL)) AS height_cm,
    MAX(IFF(description = 'Body Weight', v, NULL)) AS weight_kg,
    MAX(IFF(description = 'Heart rate', v, NULL)) AS heart_rate,
    MAX(IFF(description = 'Systolic Blood Pressure', v, NULL)) AS bp_systolic,
    MAX(IFF(description = 'Diastolic Blood Pressure', v, NULL)) AS bp_diastolic,
    MAX(IFF(description = 'Body mass index (BMI) [Ratio]', v, NULL)) AS bmi,
    MAX(observation_date)::DATE AS vitals_date
  FROM vit
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
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.MEDICATIONS
  WHERE med_stop IS NULL OR med_stop >= '2024-10-01'
  GROUP BY patient_id
),
conds AS (
  SELECT patient_id,
    ARRAY_AGG(DISTINCT REGEXP_REPLACE(description, ' \\((disorder|finding)\\)$', ''))
      WITHIN GROUP (ORDER BY REGEXP_REPLACE(description, ' \\((disorder|finding)\\)$', '')) AS active_conditions
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS
  WHERE condition_stop IS NULL
    AND description NOT ILIKE '%(situation)%'
    AND NOT (description ILIKE '%(finding)%' AND NOT (description ILIKE ANY ('%obesity%', '%body mass index%')))
    AND NOT (description ILIKE ANY ('%drug%', '%substance%', '%alcohol%', '%abuse%', '%depress%', '%anxiety%',
      '%suicid%', '%hiv%', '%criminal%', '%intimate partner%', '%opioid%', '%psych%'))
  GROUP BY patient_id
),
allergies AS (
  SELECT patient_id,
    ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
      'substance', REGEXP_REPLACE(description, ' \\((substance|product|organism|finding)\\)$', ''),
      'category', category,
      'reaction', REGEXP_REPLACE(description1, ' \\((disorder|finding)\\)$', ''),
      'severity', severity1))
      WITHIN GROUP (ORDER BY DECODE(severity1, 'SEVERE', 0, 'MODERATE', 1, 'MILD', 2, 3), description) AS allergies,
    BOOLOR_AGG(severity1 = 'SEVERE' OR severity2 = 'SEVERE') AS has_severe_allergy
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ALLERGIES
  WHERE allergy_stop IS NULL
    AND description NOT ILIKE 'allergy to substance%'
  GROUP BY patient_id
),
orgs AS (
  SELECT h.organization_id, s.name
  FROM CLINICAL_CLAIMS_DV.RAW_VAULT.HUB_ORGANIZATION h
  JOIN CLINICAL_CLAIMS_DV.RAW_VAULT.SAT_ORGANIZATION_DETAILS s USING (organization_hk)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY h.organization_hk ORDER BY s.load_datetime DESC) = 1
),
org_visits AS (
  SELECT e.patient_id, o.name, COUNT(*) AS visits, MAX(e.encounter_start) AS last_visit
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ENCOUNTERS e
  JOIN orgs o USING (organization_id)
  GROUP BY 1, 2
),
visits AS (
  SELECT patient_id,
    ARRAY_AGG(OBJECT_CONSTRUCT('name', name, 'visits', visits, 'last_visit', last_visit::DATE))
      WITHIN GROUP (ORDER BY visits DESC) AS care_sites,
    ARRAY_AGG(IFF(last_visit >= '2023-01-01', name, NULL)) AS recent_care_sites
  FROM org_visits
  GROUP BY patient_id
),
encounters AS (
  SELECT patient_id,
    COUNT(*) AS total_visits,
    COUNT_IF(encounterclass = 'emergency') AS er_visits,
    COUNT_IF(encounterclass = 'inpatient') AS inpatient_stays,
    MAX(encounter_start)::DATE AS last_visit,
    MAX(IFF(encounterclass = 'emergency', encounter_start, NULL))::DATE AS last_er_visit
  FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ENCOUNTERS
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
  p.deathdate,
  p.deathdate IS NULL AS is_alive,
  FLOOR(MONTHS_BETWEEN(COALESCE(p.deathdate, '2024-11-01'::DATE), p.birthdate) / 12) AS age,
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
LEFT JOIN visits s USING (patient_id)
LEFT JOIN encounters e USING (patient_id)
LEFT JOIN marks k USING (patient_id)
LEFT JOIN HEALTHLINE.GOLD.PATIENT_SENSITIVE x USING (patient_id);

-- Thin views for Cortex Analyst population questions.
CREATE OR REPLACE VIEW HEALTHLINE.GOLD.ENCOUNTERS
  COMMENT = 'Every visit with its care site name (from the Data Vault organization satellite).'
AS
SELECT e.encounter_id, e.patient_id, e.encounter_start, e.encounter_stop, e.encounterclass AS encounter_class,
  e.description, e.reasondescription AS reason, o.name AS care_site, e.total_claim_cost, e.synthea_city
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.ENCOUNTERS e
LEFT JOIN (
  SELECT h.organization_id, s.name
  FROM CLINICAL_CLAIMS_DV.RAW_VAULT.HUB_ORGANIZATION h
  JOIN CLINICAL_CLAIMS_DV.RAW_VAULT.SAT_ORGANIZATION_DETAILS s USING (organization_hk)
) o USING (organization_id);

CREATE OR REPLACE VIEW HEALTHLINE.GOLD.MEDICATIONS
  COMMENT = 'Medication orders. Active means no stop date or stopped on or after 2024-10-01.'
AS
SELECT medication_id, patient_id, med_start, med_stop, description AS medication, reasondescription AS reason,
  (med_stop IS NULL OR med_stop >= '2024-10-01') AS is_active, synthea_city
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.MEDICATIONS;

CREATE OR REPLACE VIEW HEALTHLINE.GOLD.CONDITIONS
  COMMENT = 'Diagnoses. Active means no stop date.'
AS
SELECT condition_id, patient_id, condition_start, condition_stop, description AS condition,
  condition_stop IS NULL AS is_active, synthea_city
FROM SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER.CONDITIONS
WHERE NOT (description ILIKE ANY ('%drug%', '%substance%', '%alcohol%', '%abuse%', '%depress%', '%anxiety%',
  '%suicid%', '%hiv%', '%criminal%', '%intimate partner%', '%opioid%', '%psych%'));

-- Every break-the-glass access, written by BREAK_GLASS.
CREATE TABLE IF NOT EXISTS HEALTHLINE.GOLD.ACCESS_LOG (
  accessed_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  patient_id NUMBER,
  reason VARCHAR,
  clinician VARCHAR,
  records_shown NUMBER
);

-- Demo ER census. Bays point at real synthetic patients, except bay 4: the unidentified
-- patient the assistant has to find. Arrival times are relative to now, so the board stays live.
CREATE OR REPLACE TABLE HEALTHLINE.GOLD.ER_BAYS (
  bay NUMBER, patient_id NUMBER, label VARCHAR, chief_complaint VARCHAR, acuity NUMBER,
  status VARCHAR, minutes_ago NUMBER
) AS SELECT * FROM VALUES
  (1, 1633078, NULL, 'Confused and sweating', 2, 'In treatment', 34),
  (2, 1633370, NULL, 'Chest pain', 2, 'In treatment', 21),
  (3, 2173923, NULL, 'Wheezing', 3, 'In treatment', 48),
  (4, NULL, 'Unknown male, early 40s', 'Unresponsive, found outside', 1, 'Unidentified', 6),
  (5, 2255404, NULL, 'Laceration, left hand', 4, 'Waiting', 72),
  (7, 1633316, NULL, 'Fall at home', 3, 'Waiting', 55);

CREATE OR REPLACE VIEW HEALTHLINE.GOLD.ER_BOARD
  COMMENT = 'Who is in the emergency department now: bay, complaint, acuity (ESI 1 most urgent) and patient.'
AS
SELECT b.bay, b.patient_id, COALESCE(p.full_name, b.label) AS patient, p.age, p.gender,
  b.chief_complaint, b.acuity, b.status,
  DATEADD(minute, -b.minutes_ago, CURRENT_TIMESTAMP()) AS arrived_at,
  p.on_blood_thinner, p.has_severe_allergy
FROM HEALTHLINE.GOLD.ER_BAYS b
LEFT JOIN HEALTHLINE.GOLD.PATIENT_PROFILE p USING (patient_id);

REVOKE SELECT ON TABLE HEALTHLINE.GOLD.PATIENT_SENSITIVE FROM ROLE HEALTHLINE_APP_ROLE;

-- Synthetic blood groups for HealthForce: Synthea has no ABO/Rh results. Run as ATTENDEE_ROLE (owns
-- HEALTHFORCE); the app role gets read access. The two SELECTs at the end check the spread and the demo patient.

USE ROLE ATTENDEE_ROLE;
USE WAREHOUSE HEALTHLINE_WH;
CREATE DATABASE IF NOT EXISTS HEALTHFORCE COMMENT = 'HealthForce additions that live outside the HEALTHLINE gold layer.';
CREATE SCHEMA IF NOT EXISTS HEALTHFORCE.CLINICAL COMMENT = 'Synthetic clinical facts Synthea does not model.';
CREATE OR REPLACE TABLE HEALTHFORCE.CLINICAL.PATIENT_BLOOD_TYPE
  COMMENT = 'SYNTHETIC. Synthea has no ABO/Rh results, so each patient gets a fixed group drawn from US frequencies (per 1000: O+ 374, A+ 357, B+ 85, O- 66, A- 63, AB+ 34, B- 15, AB- 6), stamped on their latest clinical visit.'
AS
WITH visits AS (
  SELECT patient_id, care_site, encounter_start::date AS visit_date,
         ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY (encounter_class <> 'wellness') DESC, encounter_start DESC) AS rn
  FROM HEALTHLINE.GOLD.ENCOUNTERS
  WHERE care_site IS NOT NULL
),
drawn AS (
  SELECT patient_id, MOD(ABS(HASH(patient_id, 'healthforce-abo')), 1000) AS bucket
  FROM HEALTHLINE.GOLD.PATIENT_PROFILE
)
SELECT d.patient_id,
       CASE
         WHEN bucket < 374 THEN 'O+'
         WHEN bucket < 731 THEN 'A+'
         WHEN bucket < 816 THEN 'B+'
         WHEN bucket < 882 THEN 'O-'
         WHEN bucket < 945 THEN 'A-'
         WHEN bucket < 979 THEN 'AB+'
         WHEN bucket < 994 THEN 'B-'
         ELSE 'AB-'
       END AS abo_rh,
       v.visit_date AS tested_on,
       v.care_site,
       TRUE AS synthetic
FROM drawn d
LEFT JOIN visits v ON v.patient_id = d.patient_id AND v.rn = 1;

GRANT USAGE ON DATABASE HEALTHFORCE TO ROLE HEALTHLINE_APP_ROLE;
GRANT USAGE ON SCHEMA HEALTHFORCE.CLINICAL TO ROLE HEALTHLINE_APP_ROLE;
GRANT SELECT ON TABLE HEALTHFORCE.CLINICAL.PATIENT_BLOOD_TYPE TO ROLE HEALTHLINE_APP_ROLE;

SELECT abo_rh, COUNT(*) n, ROUND(100 * RATIO_TO_REPORT(COUNT(*)) OVER (), 1) pct FROM HEALTHFORCE.CLINICAL.PATIENT_BLOOD_TYPE GROUP BY 1 ORDER BY n DESC;
SELECT * FROM HEALTHFORCE.CLINICAL.PATIENT_BLOOD_TYPE WHERE patient_id = 1805238;

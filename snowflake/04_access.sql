-- Let the web app's role run the agent. Tables, views and procedures in GOLD are already
-- covered by the future grants in 01_setup.sql; PATIENT_SENSITIVE is revoked in 02_gold.sql.
-- The semantic view (HEALTHLINE_ER) and agent (ER_ASSISTANT) are deployed from cortex_project/
-- with `cortex agent-studio sv-deploy` and `agent-deploy`, then this script grants access.

USE ROLE ACCOUNTADMIN;

ALTER AGENT HEALTHLINE.GOLD.ER_ASSISTANT SET
  PROFILE = '{"display_name": "HealthForce", "color": "orange"}';
ALTER AGENT HEALTHLINE.GOLD.ER_ASSISTANT SET
  COMMENT = 'ER assistant: identifies unknown patients, briefs clinicians and answers questions over the HealthForce gold layer.';

GRANT USAGE ON AGENT HEALTHLINE.GOLD.ER_ASSISTANT TO ROLE HEALTHLINE_APP_ROLE;
GRANT SELECT ON SEMANTIC VIEW HEALTHLINE.GOLD.HEALTHLINE_ER TO ROLE HEALTHLINE_APP_ROLE;
GRANT REFERENCES ON SEMANTIC VIEW HEALTHLINE.GOLD.HEALTHLINE_ER TO ROLE HEALTHLINE_APP_ROLE;

-- Back to a small warehouse once the gold build is done.
ALTER WAREHOUSE HEALTHLINE_WH SET WAREHOUSE_SIZE = SMALL;

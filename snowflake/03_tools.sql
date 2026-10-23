-- HealthForce agent tools. Each returns JSON that the agent reasons over and the web app
-- renders directly (funnel, candidates, patient chart). They run with owner's rights, so the
-- app role needs only USAGE on the procedure, not SELECT on SILVER, the vault or sensitive data.

USE ROLE ACCOUNTADMIN;

-- Narrow the population to the people who match what the clinician sees at the bedside.
-- Every argument is optional: pass '' or 0 for unknown. Lists are comma-separated.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.IDENTIFY_PATIENT(
  CITY VARCHAR, GENDER VARCHAR, AGE_MIN NUMBER, AGE_MAX NUMBER, HEIGHT_MIN NUMBER, HEIGHT_MAX NUMBER,
  MEDICATIONS VARCHAR, CARE_SITE VARCHAR, NAME VARCHAR, HAS_MARKS VARCHAR, RULED_OUT_MARKS VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'main'
COMMENT = 'Agent tool: ranks likely identities for an unidentified patient.'
EXECUTE AS OWNER
AS
$$
import json
import re

PROFILE = "HEALTHLINE.GOLD.PATIENT_PROFILE"


def split(value):
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def short_med(description):
    """'Clopidogrel 75 MG Oral Tablet' -> 'Clopidogrel 75 mg'. Synthea uses tall-man lettering
    (amLODIPine) and prefixes such as '24 HR' or 'NDA020800', so normalize all of that."""
    d = re.sub(r"\s*\[.*?\]", "", description)
    d = re.sub(r"^((abuse-deterrent|nda\d+|\d+ hr)\s+)+", "", d, flags=re.I)
    d = re.sub(r"^[\d.]+ (ml|mg|actuat)\s+", "", d, flags=re.I)
    m = re.match(r"^(\D+?)\s*(\d+(?:\.\d+)?)\s*(MG/HR|MG/ACTUAT|MG/ML|UNT/ML|MCG|MG)?\b", d, re.I)
    if m:
        name = " ".join(x for x in (m.group(1), m.group(2), (m.group(3) or "").lower()) if x)
    else:
        name = d
    if re.search(r"spray", d, re.I):
        name = re.split(r"\s\d", name)[0] + " spray"
    return re.sub(r"\s+", " ", name).strip().capitalize()



def main(session, city, gender, age_min, age_max, height_min, height_max,
         medications, care_site, name, has_marks, ruled_out_marks):
    steps = []  # (label, sql predicate, params), applied cumulatively

    city = (city or "").strip()
    base = "is_alive"
    base_params = []
    if city:
        base += " AND (synthea_city ILIKE ? OR city ILIKE ?)"
        base_params = [city, city]
    steps.append((f"Living patients in {city.title()}" if city else "Living patients", base, base_params))

    gender = (gender or "").strip().upper()[:1]
    age_min, age_max = int(age_min or 0), int(age_max or 0)
    if gender in ("M", "F") or age_min or age_max:
        lo, hi = age_min or 0, age_max or 120
        who = {"M": "Male", "F": "Female"}.get(gender, "Age")
        label = f"{who}, {lo} to {hi}" if (age_min or age_max) else who
        pred, params = [], []
        if gender in ("M", "F"):
            pred.append("gender = ?")
            params.append(gender)
        if age_min or age_max:
            pred.append("age BETWEEN ? AND ?")
            params += [lo, hi]
        steps.append((label, " AND ".join(pred), params))

    height_min, height_max = float(height_min or 0), float(height_max or 0)
    if height_min or height_max:
        lo, hi = height_min or 0, height_max or 250
        steps.append((f"{lo:g} to {hi:g} cm", "height_cm BETWEEN ? AND ?", [lo, hi]))

    for med in split(medications):
        steps.append((f"On {med.lower()}", "ARRAY_TO_STRING(active_medications, '|') ILIKE ?", [f"%{med}%"]))

    if (care_site or "").strip():
        site = care_site.strip()
        steps.append((f"Seen at {site} since 2023", "ARRAY_TO_STRING(recent_care_sites, '|') ILIKE ?", [f"%{site}%"]))

    if (name or "").strip():
        steps.append((f"Name like {name.strip()}", "full_name ILIKE ?", [f"%{name.strip()}%"]))

    for mark in split(has_marks):
        steps.append((f"Has {mark.lower()}", "ARRAY_TO_STRING(identifying_marks, '|') ILIKE ?", [f"%{mark}%"]))

    for mark in split(ruled_out_marks):
        steps.append((f"No {mark.lower()}", "NOT (ARRAY_TO_STRING(identifying_marks, '|') ILIKE ?)", [f"%{mark}%"]))

    # Funnel: one scan, a cumulative COUNT_IF per step.
    counts, params, preds = [], [], []
    for _, pred, p in steps:
        preds.append(f"({pred})")
        counts.append(f"COUNT_IF({' AND '.join(preds)})")
        params += [x for s in steps[:len(preds)] for x in s[2]]
    row = session.sql(f"SELECT {', '.join(counts)} FROM {PROFILE}", params=params).collect()[0]
    funnel = [{"label": s[0], "count": int(row[i])} for i, s in enumerate(steps)]

    # Rank the final set: closeness to the middle of the age and height ranges.
    where = " AND ".join(preds)
    where_params = [x for s in steps for x in s[2]]
    age_mid = (age_min + age_max) / 2 if age_min and age_max else None
    age_sd = max((age_max - age_min) / 4, 1.5) if age_mid else None
    h_mid = (height_min + height_max) / 2 if height_min and height_max else None
    h_sd = max((height_max - height_min) / 4, 2.0) if h_mid else None
    terms = []
    if age_mid:
        terms.append(f"POWER((age - {age_mid}) / {age_sd}, 2)")
    if h_mid:
        terms.append(f"POWER((COALESCE(height_cm, {h_mid} + 3 * {h_sd}) - {h_mid}) / {h_sd}, 2)")
    score = f"EXP(-0.5 * ({' + '.join(terms)}))" if terms else "1"

    rows = session.sql(f"""
        SELECT * FROM (
            SELECT patient_id, full_name, age, gender, height_cm, weight_kg, city, zip,
                   active_medications, identifying_marks, last_visit,
                   RATIO_TO_REPORT({score}) OVER () AS probability
            FROM {PROFILE}
            WHERE {where}
        )
        ORDER BY probability DESC, patient_id
        LIMIT 8
    """, params=where_params).collect()

    candidates = []
    for r in rows:
        meds = json.loads(r["ACTIVE_MEDICATIONS"] or "[]")
        marks = json.loads(r["IDENTIFYING_MARKS"] or "[]")
        notable = [short_med(m) for m in meds if re.search(
            r"clopidogrel|warfarin|apixaban|rivaroxaban|prasugrel|ticagrelor|heparin|insulin", m, re.I)]
        candidates.append({
            "patient_id": r["PATIENT_ID"],
            "name": r["FULL_NAME"],
            "age": r["AGE"],
            "gender": r["GENDER"],
            "height_cm": r["HEIGHT_CM"],
            "weight_kg": r["WEIGHT_KG"],
            "city": r["CITY"],
            "zip": r["ZIP"],
            "probability": round(float(r["PROBABILITY"] or 0), 3),
            "identifying_marks": marks,
            "notable_medications": notable[:3],
            "last_visit": str(r["LAST_VISIT"]) if r["LAST_VISIT"] else None,
        })

    # Marks that split the leading candidates are what the clinician should check next.
    checks = []
    top = candidates[:5]
    if len(top) > 1:
        seen = {}
        for c in top:
            for m in c["identifying_marks"]:
                seen.setdefault(m, []).append(c["name"])
        checks = [{"mark": m, "present_in": names} for m, names in seen.items() if len(names) < len(top)]
        checks.sort(key=lambda c: len(c["present_in"]))

    # A clear leader: the only match, or well ahead of the runner-up.
    leader = None
    if candidates:
        p = [c["probability"] for c in candidates]
        if len(p) == 1 or p[0] >= 0.5 or p[0] >= 2.5 * p[1]:
            leader = {"patient_id": candidates[0]["patient_id"], "name": candidates[0]["name"]}

    return {
        "funnel": funnel,
        "total_matches": funnel[-1]["count"],
        "candidates": candidates,
        "leader": leader,
        "bedside_checks": [] if leader else checks[:4],
        "as_of": "2024-11-01",
    }
$$;

-- Everything an ER clinician needs in the first minute, from one gold row.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.GET_PATIENT_CHART(PATIENT_ID NUMBER)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'main'
COMMENT = 'Agent tool: ER briefing chart for one patient.'
EXECUTE AS OWNER
AS
$$
import json
import re


def short_med(description):
    """'Clopidogrel 75 MG Oral Tablet' -> 'Clopidogrel 75 mg'. Synthea uses tall-man lettering
    (amLODIPine) and prefixes such as '24 HR' or 'NDA020800', so normalize all of that."""
    d = re.sub(r"\s*\[.*?\]", "", description)
    d = re.sub(r"^((abuse-deterrent|nda\d+|\d+ hr)\s+)+", "", d, flags=re.I)
    d = re.sub(r"^[\d.]+ (ml|mg|actuat)\s+", "", d, flags=re.I)
    m = re.match(r"^(\D+?)\s*(\d+(?:\.\d+)?)\s*(MG/HR|MG/ACTUAT|MG/ML|UNT/ML|MCG|MG)?\b", d, re.I)
    if m:
        name = " ".join(x for x in (m.group(1), m.group(2), (m.group(3) or "").lower()) if x)
    else:
        name = d
    if re.search(r"spray", d, re.I):
        name = re.split(r"\s\d", name)[0] + " spray"
    return re.sub(r"\s+", " ", name).strip().capitalize()



THINNERS = r"clopidogrel|warfarin|apixaban|rivaroxaban|dabigatran|heparin|enoxaparin|prasugrel|ticagrelor"
BETA = r"metoprolol|atenolol|propranolol|carvedilol|bisoprolol"
OPIOIDS = r"oxycodone|hydrocodone|fentanyl|morphine|tramadol|methadone|buprenorphine"


def main(session, patient_id):
    rows = session.sql(
        "SELECT *, HEX_ENCODE(patient_hk) AS hk FROM HEALTHLINE.GOLD.PATIENT_PROFILE WHERE patient_id = ?",
        params=[int(patient_id)]).collect()
    if not rows:
        return {"error": f"No patient {patient_id}"}
    p = rows[0].as_dict()
    load = lambda k: json.loads(p[k] or "[]")
    meds_full = load("ACTIVE_MEDICATIONS")

    meds = []
    for m in meds_full:
        flag = "bleeding" if re.search(THINNERS, m, re.I) else (
            "hypoglycemia" if re.search("insulin", m, re.I) else None)
        meds.append({"name": short_med(m), "full": m, "flag": flag})
    meds.sort(key=lambda m: (m["flag"] is None, m["name"]))

    allergies = load("ALLERGIES")
    marks = load("IDENTIFYING_MARKS")

    alerts = []
    thinners = [short_med(m) for m in meds_full if re.search(THINNERS, m, re.I)]
    if thinners:
        alerts.append({"level": "high", "title": "Bleeding risk", "detail": ", ".join(thinners)})
    for a in allergies:
        if a.get("severity") == "SEVERE":
            alerts.append({"level": "high", "title": f"Severe allergy: {a['substance']}",
                           "detail": a.get("reaction") or "Severe reaction on record"})
    if any(re.search("insulin", m, re.I) for m in meds_full):
        alerts.append({"level": "medium", "title": "On insulin", "detail": "Check glucose: hypoglycemia can mimic intoxication"})
    if any(re.search(BETA, m, re.I) for m in meds_full):
        alerts.append({"level": "medium", "title": "On a beta blocker", "detail": "Heart rate may stay low even if bleeding"})
    if any(re.search(OPIOIDS, m, re.I) for m in meds_full):
        alerts.append({"level": "medium", "title": "On opioids", "detail": "Consider naloxone if sedated"})
    if any("Pacemaker" in m or "assist device" in m for m in marks):
        alerts.append({"level": "medium", "title": "Implanted cardiac device", "detail": "Check before MRI or defibrillation"})

    return {
        "patient_id": p["PATIENT_ID"],
        "patient_hk": p["HK"],
        "name": p["FULL_NAME"],
        "first_name": p["FIRST_NAME"],
        "last_name": p["LAST_NAME"],
        "age": p["AGE"],
        "gender": p["GENDER"],
        "birthdate": str(p["BIRTHDATE"]),
        "city": p["CITY"],
        "state": p["STATE"],
        "zip": p["ZIP"],
        "alerts": alerts,
        "vitals": {
            "height_cm": p["HEIGHT_CM"], "weight_kg": p["WEIGHT_KG"], "heart_rate": p["HEART_RATE"],
            "bp": f"{p['BP_SYSTOLIC']:.0f}/{p['BP_DIASTOLIC']:.0f}" if p["BP_SYSTOLIC"] and p["BP_DIASTOLIC"] else None,
            "bmi": p["BMI"], "recorded_on": str(p["VITALS_DATE"]) if p["VITALS_DATE"] else None,
        },
        "medications": meds,
        "conditions": load("ACTIVE_CONDITIONS"),
        "allergies": allergies,
        "identifying_marks": marks,
        "care_sites": load("CARE_SITES")[:6],
        "visits": {
            "total": p["TOTAL_VISITS"], "er": p["ER_VISITS"], "inpatient": p["INPATIENT_STAYS"],
            "last_visit": str(p["LAST_VISIT"]) if p["LAST_VISIT"] else None,
            "last_er_visit": str(p["LAST_ER_VISIT"]) if p["LAST_ER_VISIT"] else None,
        },
        "sensitive_record_count": p["SENSITIVE_RECORD_COUNT"],
        "as_of": "2024-11-01",
    }
$$;

-- Emergency access to records hidden by default. Called by the app, not the agent,
-- and every call is written to ACCESS_LOG.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.BREAK_GLASS(PATIENT_ID NUMBER, REASON VARCHAR, CLINICIAN VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Reveals and logs sensitive records for one patient.'
EXECUTE AS OWNER
AS
$$
DECLARE
  recs VARIANT;
  n NUMBER;
BEGIN
  SELECT COALESCE(ANY_VALUE(records), []) INTO :recs
  FROM HEALTHLINE.GOLD.PATIENT_SENSITIVE WHERE patient_id = :PATIENT_ID;
  n := ARRAY_SIZE(recs);
  INSERT INTO HEALTHLINE.GOLD.ACCESS_LOG (patient_id, reason, clinician, records_shown)
    SELECT :PATIENT_ID, :REASON, :CLINICIAN, :n;
  RETURN OBJECT_CONSTRUCT('records', :recs, 'logged_at', CURRENT_TIMESTAMP());
END;
$$;

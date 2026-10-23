-- Healthline agent tools. Each returns JSON that the agent reasons over and the web app
-- renders directly (funnel, candidates, record, brief). They run with owner's rights, so the
-- app role needs only USAGE on the procedure, not SELECT on SILVER, the vault or sensitive data.
-- Everything is as of HEALTHLINE.GOLD.CLOCK (see 02_gold.sql).

USE ROLE ACCOUNTADMIN;

-- Earlier versions of these tools had other signatures; drop them so the agent sees one of each.
DROP PROCEDURE IF EXISTS HEALTHLINE.GOLD.IDENTIFY_PATIENT(VARCHAR, VARCHAR, NUMBER, NUMBER, NUMBER, NUMBER,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP PROCEDURE IF EXISTS HEALTHLINE.GOLD.IDENTIFY_PATIENT(VARCHAR, VARCHAR, NUMBER, NUMBER, NUMBER, NUMBER,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP PROCEDURE IF EXISTS HEALTHLINE.GOLD.GET_ER_BRIEF(NUMBER, VARCHAR);
DROP PROCEDURE IF EXISTS HEALTHLINE.GOLD.SEARCH_PATIENT_EVENTS(NUMBER, VARCHAR, VARCHAR);

-- Narrow the population to the people who match what a paramedic or clinician can see.
-- Every argument is optional: pass '' or 0 for unknown. Lists are comma-separated.
-- Besides the funnel and ranked candidates, it works out which question would narrow the
-- remaining people the most (the expected number left after hearing the answer).
-- JavaScript rather than Python: it starts in about half a second instead of about six, which
-- matters when every clue a paramedic adds should move the funnel on screen right away.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.IDENTIFY_PATIENT(
  CITY VARCHAR, GENDER VARCHAR, AGE_MIN FLOAT, AGE_MAX FLOAT, HEIGHT_MIN FLOAT, HEIGHT_MAX FLOAT,
  ZIP VARCHAR, MEDICATIONS VARCHAR, CARE_SITE VARCHAR, NAME VARCHAR, FIRST_INITIAL VARCHAR,
  HAS_MARKS VARCHAR, RULED_OUT_MARKS VARCHAR
)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
COMMENT = 'Agent tool: ranks likely identities for an unidentified patient and suggests the next question.'
EXECUTE AS OWNER
AS
$$
var PROFILE = "HEALTHLINE.GOLD.PATIENT_PROFILE";

function query(sql, binds) {
  var st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  var rs = st.execute(), names = [], out = [];
  for (var i = 1; i <= st.getColumnCount(); i++) names.push(st.getColumnName(i));
  while (rs.next()) {
    var row = {};
    for (var j = 0; j < names.length; j++) row[names[j]] = rs.getColumnValue(j + 1);
    out.push(row);
  }
  return out;
}

function split(v) { return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function title(s) { return s.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

// 'Clopidogrel 75 MG Oral Tablet' -> 'Clopidogrel 75 mg'. Synthea uses tall-man lettering
// (amLODIPine) and prefixes such as '24 HR' or 'NDA020800', so normalize all of that.
function shortMed(description) {
  var d = description.replace(/\s*\[.*?\]/g, "");
  d = d.replace(/^((abuse-deterrent|nda\d+|\d+ hr)\s+)+/i, "");
  d = d.replace(/^[\d.]+ (ml|mg|actuat)\s+/i, "");
  var m = d.match(/^(\D+?)\s*(\d+(?:\.\d+)?)\s*(MG\/HR|MG\/ACTUAT|MG\/ML|UNT\/ML|MCG|MG)?\b/i);
  var name = m ? [m[1], m[2], (m[3] || "").toLowerCase()].filter(Boolean).join(" ") : d;
  if (/spray/i.test(d)) name = name.split(/\s\d/)[0] + " spray";
  name = name.replace(/\s+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

// The drug a bottle would be labelled with: 'Clopidogrel 75 MG Oral Tablet' -> 'clopidogrel'.
function drug(description) { return shortMed(description).split(" ")[0].toLowerCase(); }

// Average number of people still matching after we learn one value. Each person is a list of
// values they could show (a bottle of any of their drugs); an empty list is its own answer.
function expectedLeft(values) {
  var people = values.map(function (v) {
    var u = {};
    (v.length ? v : ["(none)"]).forEach(function (x) { u[x] = true; });
    return Object.keys(u);
  });
  var counts = {};
  people.forEach(function (v) { v.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; }); });
  if (!people.length) return 0;
  var sum = 0;
  people.forEach(function (v) {
    var s = 0;
    v.forEach(function (x) { s += counts[x]; });
    sum += s / v.length;
  });
  return sum / people.length;
}

var steps = []; // [label, sql predicate, params], applied cumulatively
var clock = query("SELECT TO_VARCHAR(as_of, 'YYYY-MM-DD HH24:MI:SS') AS AS_OF FROM HEALTHLINE.GOLD.CLOCK")[0].AS_OF;

var city = String(CITY || "").trim();
steps.push([city ? "Everyone alive in " + title(city) : "Everyone alive",
  city ? "is_alive AND (synthea_city ILIKE ? OR city ILIKE ?)" : "is_alive", city ? [city, city] : []]);

var gender = String(GENDER || "").trim().toUpperCase().slice(0, 1);
if (gender === "M" || gender === "F") steps.push([gender === "M" ? "Male" : "Female", "gender = ?", [gender]]);

var ageMin = Math.round(AGE_MIN || 0), ageMax = Math.round(AGE_MAX || 0);
if (ageMin || ageMax) steps.push(["Age " + (ageMin || 0) + " to " + (ageMax || 120), "age BETWEEN ? AND ?", [ageMin || 0, ageMax || 120]]);

var zip = String(ZIP || "").replace(/\D/g, "").slice(0, 5);
if (zip) steps.push(["Lives in zip " + zip, "zip = ?", [Number(zip)]]);

var hMin = Number(HEIGHT_MIN || 0), hMax = Number(HEIGHT_MAX || 0);
if (hMin || hMax) steps.push(["Height " + (hMin || 0) + " to " + (hMax || 250) + " cm", "height_cm BETWEEN ? AND ?", [hMin || 0, hMax || 250]]);

var meds = split(MEDICATIONS);
meds.forEach(function (m) { steps.push(["Takes " + m.toLowerCase(), "ARRAY_TO_STRING(active_medications, '|') ILIKE ?", ["%" + m + "%"]]); });

var site = String(CARE_SITE || "").trim();
if (site) steps.push(["Seen at " + site + " since 2023", "ARRAY_TO_STRING(recent_care_sites, '|') ILIKE ?", ["%" + site + "%"]]);

var name = String(NAME || "").trim();
if (name) steps.push(["Name like " + name, "full_name ILIKE ?", ["%" + name + "%"]]);

var initial = String(FIRST_INITIAL || "").replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase();
if (initial) steps.push(["First name starts with " + initial, "first_name ILIKE ?", [initial + "%"]]);

var hasMarks = split(HAS_MARKS);
hasMarks.forEach(function (m) { steps.push(["Has " + m.toLowerCase(), "ARRAY_TO_STRING(identifying_marks, '|') ILIKE ?", ["%" + m + "%"]]); });
split(RULED_OUT_MARKS).forEach(function (m) { steps.push(["No " + m.toLowerCase(), "NOT (ARRAY_TO_STRING(identifying_marks, '|') ILIKE ?)", ["%" + m + "%"]]); });

// Funnel: one scan, a cumulative COUNT_IF per step.
var preds = [], counts = [], countParams = [];
steps.forEach(function (s, i) {
  preds.push("(" + s[1] + ")");
  counts.push("COUNT_IF(" + preds.join(" AND ") + ") AS C" + i);
  steps.slice(0, i + 1).forEach(function (t) { countParams = countParams.concat(t[2]); });
});
var row = query("SELECT " + counts.join(", ") + " FROM " + PROFILE, countParams)[0];
var funnel = steps.map(function (s, i) { return { label: s[0], count: row["C" + i] }; });
var total = funnel[funnel.length - 1].count;

var where = preds.join(" AND ");
var whereParams = [];
steps.forEach(function (s) { whereParams = whereParams.concat(s[2]); });

// Rank: closeness to the middle of the age and height ranges.
var ageMid = ageMin && ageMax ? (ageMin + ageMax) / 2 : null;
var ageSd = ageMid ? Math.max((ageMax - ageMin) / 4, 1.5) : null;
var hMid = hMin && hMax ? (hMin + hMax) / 2 : null;
var hSd = hMid ? Math.max((hMax - hMin) / 4, 2.0) : null;
var terms = [];
if (ageMid) terms.push("POWER((age - " + ageMid + ") / " + ageSd + ", 2)");
if (hMid) terms.push("POWER((COALESCE(height_cm, " + hMid + " + 3 * " + hSd + ") - " + hMid + ") / " + hSd + ", 2)");
var score = terms.length ? "EXP(-0.5 * (" + terms.join(" + ") + "))" : "1";

var rows = query(
  "SELECT * FROM (SELECT patient_id, first_name, last_name, full_name, age, gender, height_cm, weight_kg, city, zip, " +
  "TO_JSON(active_medications) AS meds, TO_JSON(identifying_marks) AS marks, TO_VARCHAR(last_visit) AS last_visit, " +
  "RATIO_TO_REPORT(" + score + ") OVER () AS probability FROM " + PROFILE + " WHERE " + where + ") " +
  "ORDER BY probability DESC, patient_id LIMIT 8", whereParams);

// When each candidate started the medications named in the clues, for the reasons.
var since = {};
if (rows.length && meds.length) {
  var ids = rows.map(function (r) { return Math.round(r.PATIENT_ID); }).join(",");
  query("SELECT patient_id, description, YEAR(MIN(event_at)) AS started FROM HEALTHLINE.GOLD.PATIENT_EVENTS " +
    "WHERE patient_id IN (" + ids + ") AND kind = 'medication' AND stop_at IS NULL AND (" +
    meds.map(function () { return "description ILIKE ?"; }).join(" OR ") + ") GROUP BY 1, 2",
    meds.map(function (m) { return "%" + m + "%"; })
  ).forEach(function (r) {
    var key = r.PATIENT_ID + "|" + drug(r.DESCRIPTION);
    since[key] = Math.min(since[key] || 9999, r.STARTED);
  });
}

var candidates = rows.map(function (r) {
  var marks = JSON.parse(r.MARKS || "[]"), active = JSON.parse(r.MEDS || "[]");
  var notable = active.filter(function (m) { return /clopidogrel|warfarin|apixaban|rivaroxaban|prasugrel|ticagrelor|heparin|insulin/i.test(m); }).map(shortMed);
  var reasons = [];
  if (ageMid) {
    var d = Math.abs(r.AGE - ageMid);
    reasons.push({ text: "Age " + r.AGE + (d <= 1 ? ", middle of " + ageMin + " to " + ageMax : ", " + d + " years from the middle"), strength: d <= ageSd ? "strong" : "match" });
  }
  if (hMid && r.HEIGHT_CM !== null) {
    var dh = Math.abs(r.HEIGHT_CM - hMid);
    reasons.push({ text: "Height " + r.HEIGHT_CM + " cm" + (dh < 0.5 ? ", exact" : ", " + dh.toFixed(1) + " cm off"), strength: dh <= hSd ? "strong" : "match" });
  }
  meds.forEach(function (m) {
    var started = since[r.PATIENT_ID + "|" + m.split(" ")[0].toLowerCase()];
    reasons.push({ text: "On " + m.toLowerCase() + (started ? " since " + started : ""), strength: "strong" });
  });
  if (zip) reasons.push({ text: "Lives in zip " + zip, strength: "match" });
  if (initial) reasons.push({ text: "First name starts with " + initial, strength: "match" });
  if (site) reasons.push({ text: "Seen at " + site + " since 2023", strength: "match" });
  hasMarks.forEach(function (m) { reasons.push({ text: "Has " + m.toLowerCase(), strength: "strong" }); });
  return {
    patient_id: r.PATIENT_ID, name: r.FULL_NAME, first_name: r.FIRST_NAME, last_name: r.LAST_NAME,
    age: r.AGE, gender: r.GENDER, height_cm: r.HEIGHT_CM, weight_kg: r.WEIGHT_KG, city: r.CITY, zip: r.ZIP,
    probability: Math.round((r.PROBABILITY || 0) * 1000) / 1000,
    identifying_marks: marks, notable_medications: notable.slice(0, 3), last_visit: r.LAST_VISIT, reasons: reasons
  };
});

// Which question narrows the remaining people the most? Score every clue we don't have yet by
// the expected number of people left after hearing the answer.
var nextQuestions = [];
if (total >= 3 && total <= 5000) {
  var pool = query("SELECT first_name, zip, height_cm, TO_JSON(active_medications) AS meds, TO_JSON(recent_care_sites) AS sites FROM " +
    PROFILE + " WHERE " + where, whereParams);
  var her = { F: "her", M: "him" }[gender] || "them", she = { F: "she", M: "he" }[gender] || "they";
  var options = [];
  if (!meds.length) options.push(["medication", "Is there any medication on " + her + ", like a pill bottle?", "medication",
    pool.map(function (p) { return JSON.parse(p.MEDS || "[]").map(drug); })]);
  if (!initial && !name) options.push(["first_initial", "Any jewelry, tattoo or ID with a name or initial on " + her + "?", "a first initial",
    pool.map(function (p) { return [String(p.FIRST_NAME || "?").slice(0, 1).toUpperCase()]; })]);
  if (!zip) options.push(["zip", "Where exactly was " + she + " found? A zip code helps.", "where they live",
    pool.map(function (p) { return [String(p.ZIP)]; })]);
  if (!hMid) options.push(["height", "Roughly how tall?", "height",
    pool.map(function (p) { return [String(Math.floor((p.HEIGHT_CM || 0) / 5) * 5)]; })]);
  if (!site) options.push(["care_site", "Any hospital wristband, appointment card or pharmacy slip?", "a care site",
    pool.map(function (p) { return JSON.parse(p.SITES || "[]").filter(Boolean); })]);
  options.map(function (o) { return { left: expectedLeft(o[3]), o: o }; })
    .sort(function (a, b) { return a.left - b.left; })
    .slice(0, 3)
    .forEach(function (x) {
      nextQuestions.push({
        clue: x.o[0], question: x.o[1], expected_left: Math.round(x.left * 10) / 10,
        why: "On average, " + x.o[2] + " would leave about " + commas(Math.max(1, Math.round(x.left))) + " of these " + commas(total) + "."
      });
    });
}

// Marks that split the leading candidates are what the clinician should check next.
var checks = [], top = candidates.slice(0, 5);
if (top.length > 1) {
  var seen = {};
  top.forEach(function (c) { c.identifying_marks.forEach(function (m) { (seen[m] = seen[m] || []).push(c.name); }); });
  checks = Object.keys(seen).filter(function (m) { return seen[m].length < top.length; })
    .map(function (m) { return { mark: m, present_in: seen[m] }; })
    .sort(function (a, b) { return a.present_in.length - b.present_in.length; });
}

// A clear leader: the only match, or well ahead of the runner-up in a short list.
var leader = null;
if (candidates.length && total <= 25) {
  var p = candidates.map(function (c) { return c.probability; });
  if (p.length === 1 || p[0] >= 0.5 || (p[1] > 0 && p[0] >= 2.5 * p[1])) leader = { patient_id: candidates[0].patient_id, name: candidates[0].name };
}

return {
  funnel: funnel,
  total_matches: total,
  candidates: candidates,
  leader: leader,
  next_questions: leader || total <= 4 ? [] : nextQuestions,
  bedside_checks: leader ? [] : checks.slice(0, 4),
  as_of: clock
};
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
    clock = session.sql("SELECT as_of FROM HEALTHLINE.GOLD.CLOCK").collect()[0][0]
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
        "as_of": str(clock),
    }
$$;
-- The patient's record pulled together across every care site, and the brief for the team
-- receiving them: what matters for this complaint, where each fact came from, what this ER's
-- own chart is missing, and what was missed before. Suggestions are for clinician review.
-- JavaScript for the same reason as IDENTIFY_PATIENT: it has to be ready before the ambulance is.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.GET_ER_BRIEF(PATIENT_ID FLOAT, COMPLAINT VARCHAR)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
COMMENT = 'Agent tool: unified record and pre-arrival ER brief for one patient, with a source for every fact.'
EXECUTE AS OWNER
AS
$$
function query(sql, binds) {
  var st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  var rs = st.execute(), names = [], out = [];
  for (var i = 1; i <= st.getColumnCount(); i++) names.push(st.getColumnName(i));
  while (rs.next()) {
    var row = {};
    for (var j = 0; j < names.length; j++) row[names[j]] = rs.getColumnValue(j + 1);
    out.push(row);
  }
  return out;
}

function shortMed(description) {
  var d = description.replace(/\s*\[.*?\]/g, "");
  d = d.replace(/^((abuse-deterrent|nda\d+|\d+ hr)\s+)+/i, "");
  d = d.replace(/^[\d.]+ (ml|mg|actuat)\s+/i, "");
  var m = d.match(/^(\D+?)\s*(\d+(?:\.\d+)?)\s*(MG\/HR|MG\/ACTUAT|MG\/ML|UNT\/ML|MCG|MG)?\b/i);
  var name = m ? [m[1], m[2], (m[3] || "").toLowerCase()].filter(Boolean).join(" ") : d;
  if (/spray/i.test(d)) name = name.split(/\s\d/)[0] + " spray";
  name = name.replace(/\s+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
function drug(d) { return shortMed(d).split(" ")[0].toLowerCase(); }

var THINNERS = /clopidogrel|warfarin|apixaban|rivaroxaban|dabigatran|heparin|enoxaparin|prasugrel|ticagrelor/i;
var NSAIDS = /naproxen|ibuprofen|diclofenac|ketorolac|meloxicam|celecoxib|indomethacin/i;
var BETA = /metoprolol|atenolol|propranolol|carvedilol|bisoprolol/i;
var HEART_MEDS = /metoprolol|atenolol|propranolol|carvedilol|bisoprolol|statin|nitroglycerin|lisinopril|amlodipine/i;
var OPIOIDS = /oxycodone|hydrocodone|fentanyl|morphine|tramadol|methadone|buprenorphine/i;
var CARDIAC = /heart|coronary|myocard|angina|atrial fib|cardiac/i;
var DIABETES = /\bdiabetes|hyperglyc/i;
var HEAD = /head|fall|concuss|skull|brain|tbi|confus/i;

// Clinical problems worth naming at a care site, most important first.
var PRIORITY = [CARDIAC, DIABETES, /stroke|cerebr/i, /kidney|renal/i, /copd|asthma|emphysema/i, /epilep|seizure/i,
  /cancer|neoplasm|carcinoma/i, /hypertension/i, /injury|fracture|laceration|sprain/i];

var PLAIN = {
  "Diabetes mellitus type 2": "Type 2 diabetes",
  "Ischemic heart disease": "Heart disease",
  "Abnormal findings diagnostic imaging heart+coronary circulat": "Abnormal cardiac imaging",
  "Injury of knee": "Knee injury",
  "Laceration - injury": "Laceration",
  "Essential hypertension": "High blood pressure"
};
var ENCOUNTER_KIND = { snf: "Skilled nursing stay", urgentcare: "Urgent care visit", emergency: "ER visit",
  inpatient: "Hospital stay", wellness: "Check-up", ambulatory: "Clinic visit", outpatient: "Outpatient visit",
  home: "Home visit", hospice: "Hospice", virtual: "Virtual visit" };

function clean(d) {
  d = String(d || "").replace(/\s*\((disorder|finding|situation|procedure|substance)\)$/, "");
  return PLAIN[d] || d;
}

var pid = Math.round(PATIENT_ID), complaint = String(COMPLAINT || "").trim();
var clock = query("SELECT TO_VARCHAR(as_of, 'YYYY-MM-DD HH24:MI:SS') AS AS_OF, er_site_id, er_site_name FROM HEALTHLINE.GOLD.CLOCK")[0];
var hereId = clock.ER_SITE_ID;

var prof = query("SELECT patient_id, full_name, first_name, last_name, age, gender, city, zip, height_cm FROM HEALTHLINE.GOLD.PATIENT_PROFILE WHERE patient_id = ?", [pid]);
if (!prof.length) return { error: "No patient " + pid };
var p = prof[0];

var ev = query(
  "SELECT kind, DATE_PART(epoch_second, event_at) AS t, TO_VARCHAR(event_at, 'YYYY-MM-DD') AS d, " +
  "TO_VARCHAR(event_at, 'Mon YYYY') AS mon, TO_VARCHAR(event_at, 'MMMM') AS month_name, YEAR(event_at) AS yr, " +
  "DATE_PART(epoch_second, stop_at) AS stop_t, stop_at IS NULL AS active, description, value, units, reason, severity, " +
  "encounter_id, encounter_class, organization_id, site_id " +
  "FROM HEALTHLINE.GOLD.PATIENT_EVENTS WHERE patient_id = ? ORDER BY event_at", [pid]);

var siteInfo = {};
query("SELECT site_id, site_name, city FROM HEALTHLINE.GOLD.CARE_SITES WHERE organization_id = site_id AND site_id IN " +
  "(SELECT DISTINCT site_id FROM HEALTHLINE.GOLD.PATIENT_EVENTS WHERE patient_id = ?)", [pid])
  .forEach(function (r) { siteInfo[r.SITE_ID] = { name: r.SITE_NAME, city: r.CITY }; });
function nameOf(sid) { return (siteInfo[sid] || {}).name || "Unknown site"; }
function src(e, kind) { return { site: nameOf(e.SITE_ID), kind: kind, date: e.D }; }

var visits = ev.filter(function (e) { return e.KIND === "visit"; });
var reasonByVisit = {};
visits.forEach(function (v) { reasonByVisit[v.ENCOUNTER_ID] = v.REASON; });
function active(kind) { return ev.filter(function (e) { return e.KIND === kind && e.ACTIVE; }); }
var meds = active("medication");
var conds = active("condition").filter(function (e) {
  return e.DESCRIPTION.indexOf("(situation)") < 0 && (e.DESCRIPTION.indexOf("(finding)") < 0 || CARDIAC.test(e.DESCRIPTION));
});
var allergies = active("allergy").filter(function (e) { return e.DESCRIPTION.toLowerCase().indexOf("allergy to substance") !== 0; });

// 1. The record, site by site.
var bySite = {};
visits.forEach(function (v) { (bySite[v.SITE_ID] = bySite[v.SITE_ID] || []).push(v); });
var sites = Object.keys(bySite).map(Number).sort(function (a, b) {
  return bySite[b].length - bySite[a].length || bySite[a][0].T - bySite[b][0].T;
}).map(function (sid) {
  var sv = bySite[sid], at = ev.filter(function (e) { return e.SITE_ID === sid; });
  var ids = {};
  sv.forEach(function (v) { ids[v.ORGANIZATION_ID] = true; });
  ids = Object.keys(ids).map(Number).sort();
  var thinner = at.filter(function (e) { return e.KIND === "medication" && THINNERS.test(e.DESCRIPTION); })[0];
  // The clearest problem from each visit, most important first, then most recent.
  var perVisit = {};
  at.forEach(function (e) {
    if (e.KIND !== "condition") return;
    var rank = -1;
    for (var i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].test(e.DESCRIPTION)) { rank = i; break; }
    if (rank < 0) return;
    var item = { rank: rank, name: clean(e.DESCRIPTION), t: e.T, yr: e.YR }, best = perVisit[e.ENCOUNTER_ID];
    if (!best || item.rank < best.rank || (item.rank === best.rank && item.name.length < best.name.length)) perVisit[e.ENCOUNTER_ID] = item;
  });
  var problems = [];
  Object.keys(perVisit).map(function (k) { return perVisit[k]; })
    .sort(function (a, b) { return a.rank - b.rank || b.t - a.t; })
    .forEach(function (x) { if (!problems.some(function (y) { return y.name === x.name; })) problems.push(x); });
  var highlight, key = null;
  if (thinner) { highlight = "Prescribed " + drug(thinner.DESCRIPTION) + ", " + thinner.MON; key = "bleeding"; }
  else if (problems.length) highlight = problems.slice(0, 2).map(function (x) { return x.name + " " + x.yr; }).join(" · ");
  else { var last = sv[sv.length - 1]; highlight = (ENCOUNTER_KIND[last.ENCOUNTER_CLASS] || "Visit") + ", " + last.MON; }
  return {
    site_id: sid, name: nameOf(sid), city: (siteInfo[sid] || {}).city || null, visits: sv.length,
    first_visit: sv[0].D, last_visit: sv[sv.length - 1].D, organization_ids: ids, merged: ids.length > 1,
    here: sid === hereId, highlight: highlight, key: key
  };
});

var here = sites.filter(function (s) { return s.here; })[0];
var hereHasThinner = ev.some(function (e) { return e.SITE_ID === hereId && e.KIND === "medication" && THINNERS.test(e.DESCRIPTION); });
var cleanup = sites.filter(function (s) { return s.merged; }).map(function (s) {
  return { name: s.name, organization_ids: s.organization_ids, text: "\"" + s.name + "\" was in the data under " + s.organization_ids.length + " IDs, merged" };
});

// 2. What matters for this patient now.
var head = HEAD.test(complaint);
var thinners = meds.filter(function (e) { return THINNERS.test(e.DESCRIPTION); });
var alerts = [], facts = [], actions = [], missed = [];

if (thinners.length) {
  var names = {};
  thinners.forEach(function (e) { names[drug(e.DESCRIPTION)] = true; });
  alerts.push({ level: "high", title: head ? "Bleeding risk: blood thinner + head injury" : "Bleeding risk: on a blood thinner",
    detail: "On " + Object.keys(names).sort().join(" and ") + ". Flagged for clinician review." });
  var t = thinners[0], dose = shortMed(t.DESCRIPTION).split(" ");
  var text = "**On " + dose[0].toLowerCase() + "** " + dose.slice(1).join(" ") + " since " + t.MON + ".";
  if (here && !hereHasThinner) text += " Not in this ER's chart.";
  facts.push({ topic: "bleeding", text: text, sources: [src(t, "medication")] });
  if (head) actions.push("Urgent head CT on arrival");
  actions.push("Avoid NSAIDs for pain");
}

allergies.forEach(function (a) {
  if (a.SEVERITY !== "SEVERE") return;
  alerts.push({ level: "high", title: "Severe allergy: " + clean(a.DESCRIPTION), detail: clean(a.REASON) || "Severe reaction on record" });
  facts.push({ topic: "allergy", text: "**Severe allergy** to " + clean(a.DESCRIPTION).toLowerCase() + ".", sources: [src(a, "allergy")] });
});

var cardiac = conds.filter(function (c) { return CARDIAC.test(c.DESCRIPTION) && c.DESCRIPTION.indexOf("(finding)") < 0; });
if (cardiac.length) {
  var c = cardiac[0], heartMeds = meds.filter(function (e) { return HEART_MEDS.test(e.DESCRIPTION); });
  var named = heartMeds.map(function (e) { return drug(e.DESCRIPTION) + (/spray/i.test(e.DESCRIPTION) ? " spray" : ""); }).sort();
  var also = named.length > 1 ? named.slice(0, -1).join(", ") + " and " + named[named.length - 1] : (named[0] || "");
  var sources = [src(c, "diagnosis")];
  if (heartMeds.length) sources.push({ site: nameOf(heartMeds[0].SITE_ID), kind: "medications", date: null });
  facts.push({ topic: "cardiac", text: "**" + clean(c.DESCRIPTION) + "** since " + c.YR + "." + (also ? " Also on " + also + "." : ""), sources: sources });
  if (meds.some(function (e) { return BETA.test(e.DESCRIPTION); })) actions.push("Expect a blunted heart rate (beta blocker)");
}

var diabetic = conds.filter(function (c) { return DIABETES.test(c.DESCRIPTION); });
if (diabetic.length) {
  var glucose = ev.filter(function (e) { return e.KIND === "lab" && /glucose/i.test(e.DESCRIPTION) && e.VALUE !== null; });
  var g = glucose[glucose.length - 1];
  var started = meds.filter(function (e) { return /metformin|insulin|glipizide|sitagliptin|liraglutide/i.test(e.DESCRIPTION); });
  var dtext = "**" + clean(diabetic[0].DESCRIPTION) + ".**", dsources = [src(diabetic[0], "diagnosis")];
  if (g) {
    dtext += " Blood glucose " + g.VALUE + " " + g.UNITS + " in " + g.MONTH_NAME;
    dsources = [src(g, "lab")];
    var same = started.filter(function (e) { return e.D === g.D; });
    dtext += same.length ? "; " + drug(same[0].DESCRIPTION) + " started the same day." : ".";
  }
  facts.push({ topic: "diabetes", text: dtext, sources: dsources });
  actions.push("Check glucose on arrival");
}

var opioid = meds.filter(function (e) { return OPIOIDS.test(e.DESCRIPTION); })[0];
if (opioid) facts.push({ topic: "opioid", text: "**On an opioid** (" + shortMed(opioid.DESCRIPTION).toLowerCase() + "). Consider naloxone if sedated.", sources: [src(opioid, "medication")] });

// 3. Missed before: an NSAID started while a blood thinner was active.
var allThinners = ev.filter(function (e) { return e.KIND === "medication" && THINNERS.test(e.DESCRIPTION); });
ev.filter(function (e) { return e.KIND === "medication" && NSAIDS.test(e.DESCRIPTION); }).forEach(function (n) {
  var on = allThinners.filter(function (t) { return t.T <= n.T && (t.STOP_T === null || t.STOP_T > n.T); })[0];
  if (!on) return;
  // What it was for: the shortest diagnosis from the same visit, else the visit's reason.
  var found = ev.filter(function (e) { return e.KIND === "condition" && e.ENCOUNTER_ID === n.ENCOUNTER_ID; })
    .map(function (e) { return clean(e.DESCRIPTION); }).sort(function (a, b) { return a.length - b.length; });
  var why = (found[0] || clean(reasonByVisit[n.ENCOUNTER_ID] || "")).toLowerCase();
  var who = n.SITE_ID === hereId ? "this ER" : nameOf(n.SITE_ID);
  var forWhat = why ? " for " + (/^[aeiou]/.test(why) ? "an " : "a ") + why : "";
  missed.push({
    text: "In " + n.MON + " " + who + " prescribed **" + drug(n.DESCRIPTION) + "**" + forWhat + " while " + (p.GENDER === "F" ? "she" : "he") +
      " was on " + drug(on.DESCRIPTION) + ". NSAIDs add to bleeding risk.",
    source: src(n, "medication")
  });
});

var imaging = ev.filter(function (e) { return e.KIND === "imaging"; });
var headImaging = imaging.filter(function (e) { return /head|brain|skull|cran/i.test(e.DESCRIPTION); });
var orgIds = {};
visits.forEach(function (v) { orgIds[v.ORGANIZATION_ID] = true; });

return {
  patient: { patient_id: p.PATIENT_ID, name: p.FULL_NAME, first_name: p.FIRST_NAME, last_name: p.LAST_NAME,
    age: p.AGE, gender: p.GENDER, city: p.CITY, zip: p.ZIP, height_cm: p.HEIGHT_CM },
  complaint: complaint,
  as_of: clock.AS_OF,
  er_site: clock.ER_SITE_NAME,
  visits_total: visits.length,
  organization_ids: Object.keys(orgIds).length,
  sites: sites,
  cleanup: cleanup,
  here: { visits: here ? here.visits : 0, has_blood_thinner_on_file: hereHasThinner, summary: here ? here.highlight : null },
  alerts: alerts,
  facts: facts.slice(0, 3),
  missed: missed.slice(0, 2),
  actions: actions.slice(0, 4),
  allergies: allergies.map(function (a) { return { substance: clean(a.DESCRIPTION), severity: a.SEVERITY }; }),
  imaging: { studies: imaging.length, head: headImaging.length, latest: imaging.length ? imaging[imaging.length - 1].D : null },
  active_medications: meds.map(function (e) { return shortMed(e.DESCRIPTION); })
};
$$;

-- A patient's history, filtered: for follow-up questions like "has she had a head scan before?".
-- kinds and keywords are comma-separated; '' means all. Returns newest first, with the source site.
-- Imaging studies are never filtered out by keywords. care_sites_searched is every site in the record.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.SEARCH_PATIENT_EVENTS(PATIENT_ID FLOAT, KINDS VARCHAR, KEYWORDS VARCHAR)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
COMMENT = 'Agent tool: one patient''s visits, medications, diagnoses, labs, imaging and procedures across every care site.'
EXECUTE AS OWNER
AS
$$
function query(sql, binds) {
  var st = snowflake.createStatement({ sqlText: sql, binds: binds || [] });
  var rs = st.execute(), names = [], out = [];
  for (var i = 1; i <= st.getColumnCount(); i++) names.push(st.getColumnName(i));
  while (rs.next()) {
    var row = {};
    for (var j = 0; j < names.length; j++) row[names[j]] = rs.getColumnValue(j + 1);
    out.push(row);
  }
  return out;
}

var ALL = ["visit", "medication", "condition", "allergy", "procedure", "imaging", "device", "vital", "lab"];
var ALIAS = { diagnosi: "condition", diagnose: "condition", med: "medication", scan: "imaging", allergie: "allergy" };
var kinds = String(KINDS || "").split(",").map(function (k) { k = k.trim().toLowerCase().replace(/s+$/, ""); return ALIAS[k] || k; })
  .filter(function (k) { return ALL.indexOf(k) >= 0; });
var words = String(KEYWORDS || "").split(",").map(function (w) { return w.trim(); }).filter(Boolean);

var where = ["e.patient_id = ?"], params = [Math.round(PATIENT_ID)];
if (kinds.length) {
  where.push("e.kind IN (" + kinds.map(function () { return "?"; }).join(", ") + ")");
  params = params.concat(kinds);
}
// Keywords narrow everything except imaging: there are few studies, and "no head CT" is only a
// safe answer when every study was looked at.
if (words.length) {
  where.push("(e.kind = 'imaging' OR " + words.map(function () { return "(e.description ILIKE ? OR e.reason ILIKE ?)"; }).join(" OR ") + ")");
  words.forEach(function (w) { params.push("%" + w + "%", "%" + w + "%"); });
}

var rows = query(
  "SELECT e.kind, TO_VARCHAR(e.event_at, 'YYYY-MM-DD') AS d, e.stop_at IS NULL AS open, e.description, e.value, e.units, " +
  "e.reason, s.site_name, s.site_id = k.er_site_id AS here " +
  "FROM HEALTHLINE.GOLD.PATIENT_EVENTS e LEFT JOIN HEALTHLINE.GOLD.CARE_SITES s ON s.organization_id = e.site_id " +
  "CROSS JOIN HEALTHLINE.GOLD.CLOCK k WHERE " + where.join(" AND ") + " ORDER BY e.event_at DESC", params);

// Every care site in the patient's record was searched, whether or not it had a match.
var searched = query("SELECT DISTINCT s.site_name FROM HEALTHLINE.GOLD.PATIENT_EVENTS e JOIN HEALTHLINE.GOLD.CARE_SITES s " +
  "ON s.organization_id = e.site_id WHERE e.patient_id = ? AND e.kind = 'visit' ORDER BY 1", [Math.round(PATIENT_ID)]).map(function (r) { return r.SITE_NAME; });
var counts = {}, sites = {};
rows.forEach(function (r) { counts[r.KIND] = (counts[r.KIND] || 0) + 1; if (r.SITE_NAME) sites[r.SITE_NAME] = true; });
function tidy(s) { return String(s || "").replace(/\s*\((disorder|finding|situation|procedure|body structure)\)/g, ""); }

return {
  total: rows.length,
  counts: counts,
  care_sites_searched: searched,
  care_sites_with_matches: Object.keys(sites).sort(),
  events: rows.slice(0, 60).map(function (r) {
    return {
      kind: r.KIND, date: r.D, description: tidy(r.DESCRIPTION),
      value: r.VALUE !== null && (r.KIND === "lab" || r.KIND === "vital") ? (r.VALUE + " " + (r.UNITS || "")).trim() : null,
      reason: r.REASON ? tidy(r.REASON) : null,
      active: !!r.OPEN && ["medication", "condition", "allergy", "device"].indexOf(r.KIND) >= 0,
      site: r.SITE_NAME, this_er: !!r.HERE
    };
  }),
  truncated: rows.length > 60
};
$$;

-- A clinician confirms who the patient is. The AI suggests; a person decides, and it's logged.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.CONFIRM_IDENTITY(
  PATIENT_ID NUMBER, PROBABILITY FLOAT, CLUES VARCHAR, CLINICIAN VARCHAR, ROLE VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Logs a clinician''s identity confirmation to IDENTITY_LOG.'
EXECUTE AS OWNER
AS
$$
BEGIN
  INSERT INTO HEALTHLINE.GOLD.IDENTITY_LOG (patient_id, probability, clues, clinician, role)
    SELECT :PATIENT_ID, :PROBABILITY, TRY_PARSE_JSON(:CLUES), :CLINICIAN, :ROLE;
  RETURN OBJECT_CONSTRUCT('patient_id', :PATIENT_ID, 'confirmed_at', CURRENT_TIMESTAMP());
END;
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

-- Turns what a paramedic says ("Female, mid-50s, fall with head strike", "pill bottle says
-- clopidogrel") into IDENTIFY_PATIENT arguments, with Claude through AI_COMPLETE and a JSON schema.
-- Fields the text doesn't mention come back empty or 0, so the app can merge them over earlier clues.
CREATE OR REPLACE PROCEDURE HEALTHLINE.GOLD.PARSE_CLUES(TEXT VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Extracts identification clues from a paramedic''s or clinician''s words.'
EXECUTE AS OWNER
AS
$$
DECLARE
  answer VARCHAR;
BEGIN
  SELECT AI_COMPLETE(
    model => 'claude-sonnet-4-6',
    prompt => 'You turn what a paramedic or ER clinician says about an unidentified patient into search clues. '
      || 'Only fill fields the text gives; leave others as an empty string or 0. '
      || 'gender is F or M. Apparent age is rough: "mid-50s" is 50 to 64, "about 40" is 35 to 45, "early 40s" is 39 to 44. '
      || 'Height: "about 155 cm" is 150 to 160; convert feet and inches to cm. '
      || 'medications: drug names only, comma-separated (a bottle of "Clopidogrel 75 mg" is "clopidogrel"). '
      || 'first_initial: a single letter from an engraved bracelet, tattoo or monogram. name: a full or partial name only if one is given. '
      || 'zip: a 5-digit zip where they were found or live. care_site: part of a hospital or clinic name on a wristband, slip or card. '
      || 'marks: visible scars or devices, comma-separated. city: the metro area if named. '
      || 'complaint: the injury or presentation in a few words, e.g. "Fall with head strike, confused". '
      || 'Text: ' || :TEXT,
    response_format => {
      'type': 'json',
      'schema': {
        'type': 'object',
        'properties': {
          'gender': {'type': 'string'}, 'age_min': {'type': 'number'}, 'age_max': {'type': 'number'},
          'height_min': {'type': 'number'}, 'height_max': {'type': 'number'}, 'zip': {'type': 'string'},
          'medications': {'type': 'string'}, 'care_site': {'type': 'string'}, 'name': {'type': 'string'},
          'first_initial': {'type': 'string'}, 'marks': {'type': 'string'}, 'city': {'type': 'string'},
          'complaint': {'type': 'string'}
        },
        'required': ['gender', 'age_min', 'age_max', 'height_min', 'height_max', 'zip', 'medications',
          'care_site', 'name', 'first_initial', 'marks', 'city', 'complaint']
      }
    }
  ) INTO :answer;
  RETURN PARSE_JSON(:answer);
END;
$$;

# Healthline

An ER assistant on Snowflake. An ambulance radios in a woman with a head injury and no ID. From what
the paramedic can see, Healthline narrows 361,520 Cleveland patients to one, a nurse confirms her,
her record comes together from six care sites, and the trauma bay gets a sourced brief before she
arrives: she's on a blood thinner this ER's own chart doesn't show.

```
Browser (Next.js) ──► /api/identify, /api/brief, /api/clues ──► procedures in HEALTHLINE.GOLD (direct, 1 to 3 s)
  (key-pair JWT)  ──► /api/agent ──SSE──► Cortex Agent  HEALTHLINE.GOLD.ER_ASSISTANT
                                          ├─ identify_patient       funnel, ranked candidates, best next question
                                          ├─ get_er_brief           unified record and pre-arrival brief, every fact sourced
                                          ├─ search_patient_events  one patient's history across every care site
                                          ├─ get_patient_chart      alerts, vitals, meds, care sites
                                          ├─ ask_data               Cortex Analyst on semantic view HEALTHLINE_ER
                                          └─ data_to_chart          Vega-Lite charts
```

The app has two views:

- **Inbound** (opens first) is the demo workflow for Medic 14: radio → clues → match → record → brief
  → ask → handoff. Each clue calls `IDENTIFY_PATIENT` directly so the funnel moves in a second or
  two; the radio call and typed clues go through `PARSE_CLUES` (Claude on `AI_COMPLETE`, JSON
  schema output); the nurse's confirmation is written to `IDENTITY_LOG`; Ask is the Cortex Agent.
  **Autoplay** runs the whole story hands-free against live data in about 90 seconds.
- **Chat** (`New case`, a bay, or `?view=chat`) is the general assistant: the agent's tool results
  are drawn by the app (funnel, candidates, patient panel, brief, records, tables, charts), and a
  question ends with an `options` block that becomes quick-reply chips.

## Data

| Layer | Where | What |
|---|---|---|
| Silver | `SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER` | Synthea: 1.42M patients, 64M visits, 763M observations, 12 metro areas, to Nov 2024 |
| Vault | `CLINICAL_CLAIMS_DV` | The team's Data Vault (AutomateDV): hubs, links, satellites, business vault |
| Gold | `HEALTHLINE.GOLD` | Clock, cleaned care sites, every patient event, one row per patient, ER board, stats, agent tools, semantic view, agent |

Gold tables, all built by `02_gold.sql` in about a minute on XL:

| Table | What |
|---|---|
| `CLOCK` | The moment the demo runs at: Mon 23 Sep 2024 06:21:14, Westpark ER, Cleveland |
| `CARE_SITES` | Every vault organization ID mapped to a cleaned site. IDs with the same name and street address merge (4,034 IDs → 3,909 sites; Lutheran Hospital had two) |
| `PATIENT_EVENTS` | ~410M rows: every visit, medication, diagnosis, allergy, procedure, imaging study, device, vital and key lab before the clock, each with its raw organization ID and cleaned site. Clustered by patient |
| `PATIENT_PROFILE` | One row per patient, derived from `PATIENT_EVENTS`: latest vitals, active meds and conditions, allergies, care sites, marks |
| `PATIENT_MARKS`, `PATIENT_SENSITIVE` | Bedside-checkable marks; hidden records only readable through `BREAK_GLASS` |
| `ER_BAYS` / `ER_BOARD` | The ER census; bay 6 is Medic 14, still inbound |
| `STATS` | Headline numbers, computed: shared SSNs, ER visits by patients on a blood thinner |
| `IDENTITY_LOG`, `ACCESS_LOG` | Every identity confirmation and break-the-glass access |

`PATIENT_PROFILE.PATIENT_HK` uses the vault's hash key formula, so gold rows join straight back to
the vault. Care sites come from the vault's organization hub and satellite.

**Vault sampling.** The vault's `STAGING.BASE_*` views each take `LIMIT 100000` rows independently,
so most sampled patients have no linked meds or visits (7% of medication links hit a sampled patient).
Until the vault loads whole patient histories, gold reads patient-level facts from Silver. Sampling by
patient instead fixes it, for example in every `BASE_*` view:

```sql
WHERE patient_id IN (SELECT patient_id FROM SILVER.PATIENTS WHERE synthea_city = 'CLEVELAND')
```

**As of the clock.** Everything is computed at 06:21 on the demo morning. A fact counts only if its
visit started before then, so the arriving patient's own 06:29 ER visit (and its concussion diagnosis,
dated that day) never leaks into her brief. Change `AS_OF` in `02_gold.sql` to move the demo.

**Tool latency.** `IDENTIFY_PATIENT`, `GET_ER_BRIEF` and `SEARCH_PATIENT_EVENTS` are JavaScript
procedures: they answer in 1 to 3 seconds through the app, where the same logic in Python spent about
5 seconds starting its sandbox on every call.

## Setup

Run as `ACCOUNTADMIN` on the `HACKATHON_JMZWKV` connection.

```bash
snow sql -c HACKATHON_JMZWKV -f snowflake/01_setup.sql     # warehouse, database, app role, service user
./scripts/setup-keypair.sh                                 # key pair for the service user (key stays in ~/.snowflake/keys)
snow sql -c HACKATHON_JMZWKV -f snowflake/02_gold.sql      # gold mart (size HEALTHLINE_WH up first; ~30s on XL)
snow sql -c HACKATHON_JMZWKV --enable-templating NONE -f snowflake/03_tools.sql   # agent tools
cortex agent-studio sv-deploy --connection HACKATHON_JMZWKV \
  --file-path cortex_project/HEALTHLINE_ER.sv.yaml --fqn HEALTHLINE.GOLD.HEALTHLINE_ER
cortex agent-studio agent-deploy --connection HACKATHON_JMZWKV \
  --file-path cortex_project/ER_ASSISTANT.agent.yaml --fqn HEALTHLINE.GOLD.ER_ASSISTANT
snow sql -c HACKATHON_JMZWKV -f snowflake/04_access.sql    # grants, warehouse back to Small
```

Deploy `03_tools.sql` with `--enable-templating NONE`: the CLI's default templating rewrites `&&` in
the JavaScript procedures to `&`, which deploys fine and quietly breaks them. `agent-deploy`
recreates the agent, so rerun `04_access.sql` after it.

Then the app:

```bash
cd web
cp .env.example .env.local   # set SNOWFLAKE_PRIVATE_KEY_PATH
pnpm install
pnpm dev                     # http://localhost:3000
```

## Demo

**Main demo: Inbound.** Press **Autoplay**, or click through (→ and ← step between stages):

1. **Inbound.** *Female, mid-50s. Fall with head strike, confused. No wallet, no ID.* Claude reads
   the call into clues. The ETA counts down at 5× story time from 8:00.
2. **Clues.** Female, 50 to 64: 40,980. Found in zip 44121: 1,405. About 155 cm: 379. The tool then
   ranks the next question by how many people each answer would leave: an initial (~23) beats a care
   site (~26) and a pill bottle (~71). Bracelet "T": 21. Pill bottle, clopidogrel: 5.
3. **Match.** Toni Rodriguez 0.56, ahead of Tera Rau 0.26, with the reasons. No SSN used. The nurse
   confirms; it's logged.
4. **Record.** 30 visits from 6 care sites, Lutheran's two IDs merged; this ER's chart has no blood
   thinner.
5. **Brief.** Bleeding risk: clopidogrel plus head injury. Three facts with their sources, and the
   miss: this ER prescribed naproxen in 2022 while she was on clopidogrel.
6. **Ask.** *Has she had a head scan before?* No: 4 imaging studies across 6 care sites, none of the
   head.
7. **Handoff.** 361,520 → 1, 7 IDs → 6 sites, 0 SSNs, 1 human decision; 113,062 ER visits since 2023
   by patients already on a blood thinner.

The radio call and what the paramedic can see are scripted; every count, name, date and source is
live from Snowflake.

**Chat.**

1. **Bay 4** (or the first suggestion): *Unconscious male, early 40s, about 177 cm. Nitroglycerin
   spray and a MetroHealth slip in his jacket. Found in Cleveland.* 361,520 → 13 people; three close
   candidates; the agent asks to check for an appendectomy scar or insulin injection sites.
2. Tap **Neither**. Two candidates drop out, Wally Koelpin leads, and his chart opens: clopidogrel
   (bleeding risk), metoprolol, ischemic heart disease.
3. *Any ER visits before?* None.
4. **Break the glass** on the hidden records. Every access is written to `HEALTHLINE.GOLD.ACCESS_LOG`.
5. **Bay 2**, *Who's waiting with a severe allergy?* and **Population** show bay briefings, Analyst
   answers and charts.

Keys: `d` toggles dark mode, `⌘K` starts a new case.

## Layout

```
snowflake/       SQL for setup, gold mart, tools and grants, in run order
cortex_project/  Semantic view and agent specs (deployed with cortex agent-studio)
scripts/         Service user key pair
web/             Next.js 16 app: app/api (agent stream, identify, clues, brief, confirm, stats, board,
                 break glass), components (inbound/ is the ambulance workflow), lib
```

All patient data is synthetic.

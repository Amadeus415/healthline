# Healthline

An ER assistant on Snowflake. A clinician describes an unidentified patient; a Cortex Agent narrows
1.4M patients to a few likely people, asks for one bedside check, names the most likely match, and
opens their chart, pulled together from every care site that holds their records.

```
Browser (Next.js) ──► /api/agent ──SSE──► Cortex Agent  HEALTHLINE.GOLD.ER_ASSISTANT
                     (key-pair JWT)       ├─ identify_patient    procedure: funnel + ranked candidates + bedside checks
                                          ├─ get_patient_chart   procedure: alerts, vitals, meds, care sites
                                          ├─ ask_data            Cortex Analyst on semantic view HEALTHLINE_ER
                                          └─ data_to_chart       Vega-Lite charts
```

The app draws tool results itself: `identify_patient` becomes the funnel and candidate list,
`get_patient_chart` opens the patient panel, and Analyst results become tables or charts. The agent
ends a question with an `options` block that the UI turns into quick-reply chips.

## Data

| Layer | Where | What |
|---|---|---|
| Silver | `SYNTHETIC_HEALTHCARE_DATA_CLINICAL_AND_CLAIMS.SILVER` | Synthea: 1.42M patients, 64M visits, 763M observations, 12 metro areas, to Nov 2024 |
| Vault | `CLINICAL_CLAIMS_DV` | The team's Data Vault (AutomateDV): hubs, links, satellites, business vault |
| Gold | `HEALTHLINE.GOLD` | One row per patient (`PATIENT_PROFILE`), identifying marks, ER board, agent tools, semantic view, agent |

`PATIENT_PROFILE.PATIENT_HK` uses the vault's hash key formula, so gold rows join straight back to
the vault. Care site names come from the vault's organization satellite.

**Vault sampling.** The vault's `STAGING.BASE_*` views each take `LIMIT 100000` rows independently,
so most sampled patients have no linked meds or visits (7% of medication links hit a sampled patient).
Until the vault loads whole patient histories, gold reads patient-level facts from Silver. Sampling by
patient instead fixes it, for example in every `BASE_*` view:

```sql
WHERE patient_id IN (SELECT patient_id FROM SILVER.PATIENTS WHERE synthea_city = 'CLEVELAND')
```

Ages and "active" are computed as of 2024-11-01, where the data ends.

## Setup

Run as `ACCOUNTADMIN` on the `HACKATHON_JMZWKV` connection.

```bash
snow sql -c HACKATHON_JMZWKV -f snowflake/01_setup.sql     # warehouse, database, app role, service user
./scripts/setup-keypair.sh                                 # key pair for the service user (key stays in ~/.snowflake/keys)
snow sql -c HACKATHON_JMZWKV -f snowflake/02_gold.sql      # gold mart (size HEALTHLINE_WH up first; ~30s on XL)
snow sql -c HACKATHON_JMZWKV -f snowflake/03_tools.sql     # agent tools
cortex agent-studio sv-deploy --connection HACKATHON_JMZWKV \
  --file-path cortex_project/HEALTHLINE_ER.sv.yaml --fqn HEALTHLINE.GOLD.HEALTHLINE_ER
cortex agent-studio agent-deploy --connection HACKATHON_JMZWKV \
  --file-path cortex_project/ER_ASSISTANT.agent.yaml --fqn HEALTHLINE.GOLD.ER_ASSISTANT
snow sql -c HACKATHON_JMZWKV -f snowflake/04_access.sql    # grants, warehouse back to Small
```

Then the app:

```bash
cd web
cp .env.example .env.local   # set SNOWFLAKE_PRIVATE_KEY_PATH
pnpm install
pnpm dev                     # http://localhost:3000
```

## Demo

1. **Bay 4** (or the first suggestion): *Unconscious male, early 40s, about 177 cm. Nitroglycerin
   spray and a MetroHealth slip in his jacket. Found in Cleveland.* 361,607 → 11 people; three close
   candidates; the agent asks to check for an appendectomy scar or insulin injection sites.
2. Tap **Neither**. Two candidates drop out, Wally Koelpin leads, and his chart opens: clopidogrel
   (bleeding risk), metoprolol, ischemic heart disease.
3. *Any ER visits before?* None.
4. **Break the glass** on the hidden records. Every access is written to `HEALTHLINE.GOLD.ACCESS_LOG`.
5. **Bay 2**, *Who's waiting with a severe allergy?* and **Population** show bay briefings, Analyst
   answers and charts.

Keys: `d` toggles dark mode, `⌘K` starts a new case.

## Team view (`/team`)

One Cortex Agent, three people, one case, side by side: **Paramedic** (Medic Rivera, Unit 12),
**Doctor** (Dr. Okafor) and **Nurse** (RN Chen). Every message is tagged with who sent it, and the agent
ends its replies with fenced JSON blocks that the app routes between the columns:

| Block | Goes to | Shows as |
|---|---|---|
| `handoff` | doctor, nurse or paramedic | Alert card in that column, pulsing ring and chime |
| `tasks` | nurse | Ready list; ticking an item notifies the doctor and the agent |
| `catches` | everyone | The "Healthline caught" strip: safety, time, cost, research |

The team protocol lives in `web/lib/personas.ts` and goes out with the first message of a case, so the
deployed agent needs no changes. A matching "Team mode" section is in `ER_ASSISTANT.agent.yaml` for the
next redeploy. One agent run at a time per case; messages from other columns queue.

Demo:

1. **Paramedic**: tap the field report (early 40s, BP 88/50, nitroglycerin, MetroHealth slip, aspirin
   given en route). Tap **Neither** for the bedside check. The doctor's column lights up: likely Wally
   Koelpin, dual antiplatelet on board, metoprolol masking the shock.
2. **Doctor**: tap *What would I miss on this patient? Then get the bay ready for him.* More catches, and
   the nurse's ready list fills.
3. **Nurse**: tick an item (the doctor sees it), then ask about allergies and access.
4. **Doctor**: open the chart and break the glass on the hidden records.

**Live vitals.** The field report starts a simulated ambulance monitor in the paramedic's column (BP 88/50
drifting to about 76/42, HR and RR climbing, SpO2 slipping; `web/lib/vitals.ts`). When BP falls below 80
or SpO2 below 92, the monitor sends an alarm to the agent itself, tagged `[Monitor]`: nobody asked, and the
doctor still gets a critical handoff and the nurse a ready list. Every human message also carries the
latest reading. The fast-forward button in the monitor runs the feed at 3x.

**Recording the demo.** With the app running, `cd web && node scripts/record-demo.mjs` drives the whole
flow in headless Chromium with captions and writes `web/demo-video/healthline-team-demo.webm`
(`npx playwright install chromium` once first). Convert for sharing with
`ffmpeg -i healthline-team-demo.webm -c:v libx264 -pix_fmt yuv420p healthline-team-demo.mp4`.

## Layout

```
snowflake/       SQL for setup, gold mart, tools and grants, in run order
cortex_project/  Semantic view and agent specs (deployed with cortex agent-studio)
scripts/         Service user key pair
web/             Next.js 16 app: app/api (agent stream, ER board, break glass), components, lib
```

All patient data is synthetic.

# Clara Answers — Automation Pipeline (n8n & Docker)

> **Zero-Cost Automation: Demo Call → Agent Spec (v1) → Onboarding Updates → Revised Agent (v2)**

An industrial-grade automation pipeline designed to process customer call transcripts and generate high-fidelity AI voice agent configurations. This project is built to run entirely on **n8n** and **Docker**, ensuring a reproducible, zero-cost, and robust environment.

---

## 🚀 Quick Start (Docker)

The fastest way to run the entire pipeline is using Docker Compose.

### 1. Prerequisites
- Docker & Docker Compose installed.
- Git (for cloning).

### 2. Launch n8n
```bash
# Clone the repository
git clone <your-repo-url>
cd clara-pipeline

# Start the services
docker-compose up -d
```

### 3. Access n8n
- **URL**: `http://localhost:5678`
- **Username**: `admin`
- **Password**: `clara2024`

---

## 🛠️ Workflow Import & Setup

To process the dataset effectively, import the provided workflows into n8n.

### 1. Import Steps
1. Open n8n in your browser.
2. Go to **Workflows** → **Add Workflow** → **Import from File**.
3. Select and import the following files from the `/workflows` directory:
   - `pipeline_a.json` (Demo → v1)
   - `pipeline_b.json` (Onboarding → v2)
   - `pipeline_master_batch.json` (**Master Orchestrator**)

### 2. Environment Variables
The pipeline is pre-configured in `docker-compose.yml`. Key variables include:
- `N8N_BASIC_AUTH_USER`: `admin`
- `N8N_BASIC_AUTH_PASSWORD`: `clara2024`
- `NODE_ENV`: `production`
- `N8N_BLOCK_FS_WRITE_ACCESS`: `false` (Required for script execution)

---

## 📂 Processing the Dataset

### Run All Dataset (Batch)
The **Master Batch Pipeline** is the primary way to process the entire dataset (including Ben's Electric) in one click.

1. Open the **Master Batch Pipeline** workflow in n8n.
2. Click **Execute Workflow**.
3. n8n will:
   - Execute the automation scripts within the container.
   - Process all demo files in `/data/demo` → `/outputs/accounts/<id>/v1`.
   - Process all onboarding files in `/data/onboarding` → `/outputs/accounts/<id>/v2`.
   - Log completion metrics in `/outputs/batch_summary.json`.

---

## 📊 Verifying Results

Since this is a backend-centric pipeline, results are verified via the filesystem and logs.

### 1. Account Folders
Check `outputs/accounts/bens_electric/`:
- `v1/agent_spec.json`: Initial Retell configuration.
- `v2/agent_spec.json`: Refined configuration after onboarding.
- `v2/changes.md`: A detailed human-readable changelog of what was learned.

### 2. Validation Suite
Run the automated validation check to ensure 100% schema compliance:
```bash
docker exec -it clara-n8n node scripts/validate_outputs.js
```

### 3. Execution Logs
Detailed logs for every run are saved to `outputs/batch_run.log`.

---

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Transcript  │────▶│  n8n Engine  │────▶│  Rule-Based      │────▶│  Agent Spec   │
│  (.txt file) │     │  (Docker)    │     │  Extraction      │     │  JSON (v1/v2) │
└──────────────┘     └──────────────┘     └──────────────────┘     └───────┬───────┘
                                                                           │
                                          ┌──────────────────┐     ┌───────▼───────┐
                                          │  Changelog       │◀────│  Task Tracker │
                                          │  (MD/JSON)       │     │  (tasks.json) │
                                          └──────────────────┘     └───────────────┘
```

## 🎙️ Transcription (Whisper)
A local Whisper integration is included for processing raw audio (`.m4a`). 
- Found in: `scripts/transcribe_audio.py`
- Usage: `npm run transcribe -- data/audio/file.m4a --id bens_electric`

---

## What "Great" Looks Like
- **Zero Manual Work**: One click in n8n triggers the full suite.
- **Robustness**: Handles missing files and provides clear error logs.
- **Traceability**: Every change from v1 to v2 is tracked in a human-readable changelog.

# Clara Answers — Zero-Cost Automation Pipeline

> **Demo Call → Retell Agent Draft → Onboarding Updates → Agent Revision**

An end-to-end automation pipeline that converts demo call transcripts into preliminary AI voice agent configurations (v1), then refines them with onboarding data (v2). Built with zero external cost using rule-based extraction and local JSON storage.

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Transcript  │────▶│  Parser      │────▶│  Rule-Based      │────▶│  Account Memo │
│  (.txt file) │     │  Normalizer  │     │  Extractor       │     │  JSON (v1)    │
└──────────────┘     └──────────────┘     └──────────────────┘     └───────┬───────┘
                                                                           │
                                          ┌──────────────────┐     ┌───────▼───────┐
                                          │  Task Tracker    │◀────│  Agent Spec   │
                                          │  (tasks.json)    │     │  Generator    │
                                          └──────────────────┘     └───────┬───────┘
                                                                           │
                                                                   ┌───────▼───────┐
                                                                   │  Retell Agent │
                                                                   │  Draft (v1)   │
                                                                   └───────────────┘

                          ═══ PIPELINE B (Onboarding) ═══

┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Onboarding  │────▶│  Parser      │────▶│  Deep Merge      │────▶│  Account Memo │
│  Transcript  │     │  Normalizer  │     │  Engine          │     │  JSON (v2)    │
└──────────────┘     └──────────────┘     │  (v1 + updates)  │     └───────┬───────┘
                                          └──────────────────┘             │
                                                                   ┌───────▼───────┐
                                          ┌──────────────────┐     │  Agent Spec   │
                                          │  Changelog       │◀────│  Generator    │
                                          │  (JSON + MD)     │     │  (v2)         │
                                          └──────────────────┘     └───────────────┘
```

## Tech Stack

| Tech | Choice | Cost |
|---|---|---|
| Runtime | Node.js 18+ | Free |
| Extraction | Rule-based (regex + keyword matching) | Free — no LLM |
| Transcription| OpenAI Whisper (local) | Free |
| Orchestrator | n8n (self-hosted Docker) + CLI batch runner | Free |
| Storage | Local JSON files (versioned per account) | Free |
| Task Tracker | Local JSON task board | Free |
| Retell | Mock spec JSON (portable agent config) | Free |
| Dashboard | Express + vanilla HTML/CSS/JS | Free |

**Total cost: $0.00**

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- Docker (optional, for n8n)

### 1. Install

```bash
git clone <repo-url>
cd clara-pipeline
npm install
```

### 2. Run the Full Pipeline

```bash
# Process all 10 transcripts (5 demo + 5 onboarding)
npm run batch

# Force re-process (overwrite existing outputs)
npm run batch:force
```

### 3. Validate Outputs

```bash
npm run validate
```

### 4. Transcribe Audio (Optional)
If you have `.m4a` or `.mp3` recordings, place them in `data/audio/onboarding/` and run:
```bash
npm run transcribe:install
npm run transcribe -- data/audio/onboarding/your_file.m4a --id account_id
```

### 5. Launch Dashboard
```bash
npm run dashboard
# Open http://localhost:3000
```

---

## Project Structure

```
clara-pipeline/
├── config.js                          # Central configuration
├── package.json                       # Dependencies & scripts
├── docker-compose.yml                 # n8n self-hosted setup
├── .env.example                       # Environment variables template
│
├── data/
│   ├── demo/                          # Demo call transcripts (input)
│   │   └── demo_bens_electric.txt
│   └── onboarding/                    # Onboarding call transcripts (input)
│       ├── onboarding_bens_electric.txt
│       └── audio1975518882.txt        # Whisper-generated transcript from M4A

│
├── scripts/
│   ├── parse_transcript.js            # Transcript parser & normalizer
│   ├── extract_memo.js                # Rule-based extraction engine
│   ├── generate_agent.js              # Retell agent spec generator
│   ├── apply_updates.js               # v1 → v2 deep merge engine
│   ├── generate_changelog.js          # Diff & changelog generator
│   ├── task_tracker.js                # Local task board
│   ├── batch_run.js                   # Main orchestrator
│   ├── validate_outputs.js            # Output validation
│   └── dashboard_server.js            # Dashboard API server
│
├── templates/
│   ├── agent_prompt_template.txt      # System prompt template
│   ├── memo_schema.json               # Account memo JSON schema
│   └── agent_spec_schema.json         # Agent spec JSON schema
│
├── workflows/
│   ├── pipeline_a.json                # n8n: Demo → v1
│   └── pipeline_b.json                # n8n: Onboarding → v2
│
├── dashboard/
│   └── index.html                     # Web dashboard SPA
│
└── outputs/                           # Generated outputs
    ├── accounts/
    │   └── <account_id>/
    │       ├── v1/
    │       │   ├── memo.json          # Account memo v1
    │       │   └── agent_spec.json    # Retell agent spec v1
    │       └── v2/
    │           ├── memo.json          # Account memo v2
    │           ├── agent_spec.json    # Retell agent spec v2
    │           ├── changes.json       # Changelog (JSON)
    │           └── changes.md         # Changelog (Markdown)
    ├── tasks.json                     # Task tracker
    ├── batch_summary.json             # Batch run metrics
    └── batch_run.log                  # Execution log
```

---

## How to Plug In Dataset Files

1. Place demo call transcripts in `data/demo/` as `.txt` files
2. Place onboarding transcripts in `data/onboarding/` as `.txt` files
3. Name files with pattern: `demo_<account_id>.txt` / `onboarding_<account_id>.txt`
4. Run `npm run batch` — the pipeline auto-matches demo ↔ onboarding by `account_id`

### Transcript Format

Each file should include a header block:

```
[Demo Call Transcript]
Account: Company Name (account_id)
Date: 2024-11-15
Participants: Speaker1 (Role), Speaker2 (Role)

---

Speaker1: Dialogue text here...
Speaker2: Response text here...
```

If no header is present, the `account_id` is inferred from the filename.

---

## n8n Setup (Docker)

```bash
# Start n8n
docker-compose up -d

# Access n8n at http://localhost:5678
# Login: admin / clara2024

# Import workflows:
# 1. Go to Workflows → Import from File
# 2. Import workflows/pipeline_a.json
# 3. Import workflows/pipeline_b.json
```

### Trigger via Webhook

```bash
# Pipeline A (demo → v1)
curl -X POST http://localhost:5678/webhook/pipeline-a \
  -H "Content-Type: application/json" \
  -d '{"file_path": "/data/demo/demo_bens_electric.txt"}'

# Pipeline B (onboarding → v2)
curl -X POST http://localhost:5678/webhook/pipeline-b \
  -H "Content-Type: application/json" \
  -d '{"file_path": "/data/onboarding/onboarding_bens_electric.txt"}'
```

---

## Retell Setup

### Creating a Retell Account

1. Go to [retellai.com](https://retellai.com) and create an account (free $10 credits)
2. Navigate to Dashboard → Settings → API Keys

### Importing an Agent

The pipeline generates a **portable Agent Spec JSON** for each account. To import into Retell:

1. Open Retell Dashboard → Agents → Create Agent
2. Set the agent name from `agent_spec.json → agent_name`
3. Copy the `system_prompt` field into the agent's prompt
4. Configure voice to match `voice_style`
5. Set up function tools matching `tool_invocations`

> **Note**: Retell's free tier includes $10 in credits (~60 min of calls). The pipeline does NOT make any Retell API calls — it produces spec JSON files that can be manually imported or programmatically pushed with an API key.

---

## Sample Accounts

| Account | Industry | Location | Demo | Onboarding | v1→v2 Changes |
|---|---|---|---|---|---|
| Ben's Electric | Electrical | Charlotte, NC | ✓ | ✓ | 13 |

---

## Known Limitations

1. **Rule-based extraction**: Regex patterns may miss novel phrasings or edge cases. Works well for structured transcripts but may need tuning for very casual conversations.
2. **Local Transcription**: Uses base Whisper model for accuracy. Larger models require more RAM/VRAM but provide higher fidelity. 
3. **Retell mock only**: Agent specs are portable JSON — no live API calls to Retell.
4. **No calendar/CRM integration**: Task tracker is local JSON.
5. **Static on-call rotation**: The pipeline captures on-call lists but doesn't support dynamic weekly rotation without manual updates.

## Production Improvements

- **LLM-powered extraction**: Replace regex engine with fine-tuned model for higher accuracy on ambiguous transcripts
- **Whisper integration**: Add automatic audio-to-text pipeline stage
- **Retell API integration**: Auto-create/update agents via Retell REST API
- **Database storage**: Move from JSON files to Supabase/PostgreSQL for concurrent access
- **Asana/Jira integration**: Auto-create task cards for each account
- **Webhook notifications**: Slack/email alerts on pipeline completion or failures
- **Multi-user dashboard**: Role-based access with auth
- **Confidence scoring**: Rate extraction confidence per field and flag low-confidence items for human review

---

## Running Tests

```bash
# Full pipeline on all 10 files
npm run batch:force

# Validate all outputs
npm run validate

# Idempotency test (should skip all)
npm run batch
```

---

## License

MIT

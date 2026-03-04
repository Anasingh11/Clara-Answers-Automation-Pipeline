/**
 * batch_run.js
 * ─────────────────────────────────────────────────
 * Main orchestrator — runs the full pipeline on all transcript files.
 * 
 * Pipeline A: demo transcripts → v1 (memo + agent spec)
 * Pipeline B: onboarding transcripts → v2 (updated memo + agent spec + changelog)
 *
 * Flags:
 *   --force    Overwrite existing outputs
 *   --verbose  Show detailed logs
 *
 * Usage:
 *   node scripts/batch_run.js
 *   node scripts/batch_run.js --force --verbose
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { parseTranscript } = require('./parse_transcript');
const { extractMemo } = require('./extract_memo');
const { generateAgentSpec } = require('./generate_agent');
const { applyUpdates } = require('./apply_updates');
const { generateChangelog } = require('./generate_changelog');
const { createTask, updateTask, printTaskSummary } = require('./task_tracker');

// ═══════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════
const FORCE = process.argv.includes('--force');
const VERBOSE = process.argv.includes('--verbose');

// ═══════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════
const LOG_FILE = path.join(config.OUTPUT_DIR, 'batch_run.log');

function log(msg, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level}] ${msg}`;
    console.log(formatted);
    fs.appendFileSync(LOG_FILE, formatted + '\n');
}

function logVerbose(msg) {
    if (VERBOSE) log(msg, 'DEBUG');
}

// ═══════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeJSON(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, text) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, text);
}

function getTranscriptFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(dir, f))
        .sort();
}

// ═══════════════════════════════════════════════════
// PIPELINE A: Demo → v1
// ═══════════════════════════════════════════════════
function runPipelineA(transcriptPath) {
    const filename = path.basename(transcriptPath);
    log(`━━━ Pipeline A: ${filename} ━━━`);

    try {
        // Step 1: Parse transcript
        logVerbose('  Parsing transcript...');
        const parsed = parseTranscript(transcriptPath);
        log(`  Account: ${parsed.account_id} (${parsed.company_name})`);

        // Step 2: Check idempotency
        const outputDir = path.join(config.ACCOUNTS_DIR, parsed.account_id, 'v1');
        if (fs.existsSync(path.join(outputDir, 'memo.json')) && !FORCE) {
            log(`  ⏭  Skipping — v1 output already exists (use --force to overwrite)`);
            return { account_id: parsed.account_id, status: 'skipped', version: 'v1' };
        }

        // Step 3: Extract memo
        logVerbose('  Extracting account memo...');
        const memo = extractMemo(parsed, 'v1');
        writeJSON(path.join(outputDir, 'memo.json'), memo);
        log(`  ✓ Memo written → ${path.relative(config.ROOT, path.join(outputDir, 'memo.json'))}`);

        // Step 4: Generate agent spec
        logVerbose('  Generating Retell agent spec...');
        const agentSpec = generateAgentSpec(memo);
        writeJSON(path.join(outputDir, 'agent_spec.json'), agentSpec);
        log(`  ✓ Agent spec written → ${path.relative(config.ROOT, path.join(outputDir, 'agent_spec.json'))}`);

        // Step 5: Create task tracker item
        createTask(parsed.account_id, parsed.company_name, 'v1', 'completed');
        log(`  ✓ Task created for ${parsed.company_name} v1`);

        return { account_id: parsed.account_id, status: 'success', version: 'v1' };
    } catch (err) {
        log(`  ✗ ERROR: ${err.message}`, 'ERROR');
        return { account_id: filename, status: 'error', version: 'v1', error: err.message };
    }
}

// ═══════════════════════════════════════════════════
// PIPELINE B: Onboarding → v2
// ═══════════════════════════════════════════════════
function runPipelineB(transcriptPath) {
    const filename = path.basename(transcriptPath);
    log(`━━━ Pipeline B: ${filename} ━━━`);

    try {
        // Step 1: Parse transcript
        logVerbose('  Parsing onboarding transcript...');
        const parsed = parseTranscript(transcriptPath);
        log(`  Account: ${parsed.account_id} (${parsed.company_name})`);

        // Step 2: Load v1 memo
        const v1MemoPath = path.join(config.ACCOUNTS_DIR, parsed.account_id, 'v1', 'memo.json');
        if (!fs.existsSync(v1MemoPath)) {
            log(`  ⚠ No v1 memo found for ${parsed.account_id} — running Pipeline A first would be needed`, 'WARN');
            return { account_id: parsed.account_id, status: 'missing_v1', version: 'v2' };
        }
        const v1Memo = JSON.parse(fs.readFileSync(v1MemoPath, 'utf-8'));

        // Step 3: Check idempotency
        const outputDir = path.join(config.ACCOUNTS_DIR, parsed.account_id, 'v2');
        if (fs.existsSync(path.join(outputDir, 'memo.json')) && !FORCE) {
            log(`  ⏭  Skipping — v2 output already exists (use --force to overwrite)`);
            return { account_id: parsed.account_id, status: 'skipped', version: 'v2' };
        }

        // Step 4: Apply updates
        logVerbose('  Applying onboarding updates...');
        const { v2Memo, changes } = applyUpdates(v1Memo, parsed);

        writeJSON(path.join(outputDir, 'memo.json'), v2Memo);
        log(`  ✓ v2 Memo written (${changes.length} changes)`);

        // Step 5: Generate v2 agent spec
        logVerbose('  Generating v2 agent spec...');
        const agentSpec = generateAgentSpec(v2Memo);
        writeJSON(path.join(outputDir, 'agent_spec.json'), agentSpec);
        log(`  ✓ v2 Agent spec written`);

        // Step 6: Generate changelog
        logVerbose('  Generating changelog...');
        const changelog = generateChangelog(parsed.account_id, parsed.company_name, changes);
        writeJSON(path.join(outputDir, 'changes.json'), changelog.json);
        writeText(path.join(outputDir, 'changes.md'), changelog.markdown);
        log(`  ✓ Changelog written (${changes.length} changes)`);

        // Step 7: Update task tracker
        updateTask(parsed.account_id, 'v2', {
            company_name: parsed.company_name,
            status: 'completed',
            notes: `Onboarding update applied: ${changes.length} changes`,
        });
        log(`  ✓ Task updated for ${parsed.company_name} v2`);

        return { account_id: parsed.account_id, status: 'success', version: 'v2', changes: changes.length };
    } catch (err) {
        log(`  ✗ ERROR: ${err.message}`, 'ERROR');
        return { account_id: filename, status: 'error', version: 'v2', error: err.message };
    }
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════
function main() {
    ensureDir(config.OUTPUT_DIR);
    ensureDir(config.ACCOUNTS_DIR);

    // Clear log file
    fs.writeFileSync(LOG_FILE, '');

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║     CLARA ANSWERS — AUTOMATION PIPELINE BATCH RUN       ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Data dir:   ${config.DATA_DIR.padEnd(42)}║`);
    console.log(`║  Output dir: ${config.OUTPUT_DIR.padEnd(42)}║`);
    console.log(`║  Force mode: ${String(FORCE).padEnd(42)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    log('=== BATCH RUN STARTED ===');

    // ── Phase 1: Pipeline A (Demo → v1) ──
    const demoDir = path.join(config.DATA_DIR, 'demo');
    const demoFiles = getTranscriptFiles(demoDir);
    log(`Found ${demoFiles.length} demo transcript(s) in ${demoDir}`);

    const pipelineAResults = [];
    for (const file of demoFiles) {
        const result = runPipelineA(file);
        pipelineAResults.push(result);
    }

    console.log('');

    // ── Phase 2: Pipeline B (Onboarding → v2) ──
    const onboardingDir = path.join(config.DATA_DIR, 'onboarding');
    const onboardingFiles = getTranscriptFiles(onboardingDir);
    log(`Found ${onboardingFiles.length} onboarding transcript(s) in ${onboardingDir}`);

    const pipelineBResults = [];
    for (const file of onboardingFiles) {
        const result = runPipelineB(file);
        pipelineBResults.push(result);
    }

    // ── Summary ──
    console.log('');
    log('=== BATCH RUN COMPLETED ===');
    console.log('');

    const summary = {
        pipeline_a: {
            total: pipelineAResults.length,
            success: pipelineAResults.filter(r => r.status === 'success').length,
            skipped: pipelineAResults.filter(r => r.status === 'skipped').length,
            errors: pipelineAResults.filter(r => r.status === 'error').length,
        },
        pipeline_b: {
            total: pipelineBResults.length,
            success: pipelineBResults.filter(r => r.status === 'success').length,
            skipped: pipelineBResults.filter(r => r.status === 'skipped').length,
            errors: pipelineBResults.filter(r => r.status === 'error').length,
            missing_v1: pipelineBResults.filter(r => r.status === 'missing_v1').length,
            total_changes: pipelineBResults.reduce((sum, r) => sum + (r.changes || 0), 0),
        },
    };

    console.log('┌──────────────────────────────────────────┐');
    console.log('│          BATCH RUN SUMMARY               │');
    console.log('├──────────────────────────────────────────┤');
    console.log(`│  Pipeline A (Demo → v1):                 │`);
    console.log(`│    Processed: ${String(summary.pipeline_a.total).padEnd(26)}│`);
    console.log(`│    Success:   ${String(summary.pipeline_a.success).padEnd(26)}│`);
    console.log(`│    Skipped:   ${String(summary.pipeline_a.skipped).padEnd(26)}│`);
    console.log(`│    Errors:    ${String(summary.pipeline_a.errors).padEnd(26)}│`);
    console.log('├──────────────────────────────────────────┤');
    console.log(`│  Pipeline B (Onboarding → v2):           │`);
    console.log(`│    Processed: ${String(summary.pipeline_b.total).padEnd(26)}│`);
    console.log(`│    Success:   ${String(summary.pipeline_b.success).padEnd(26)}│`);
    console.log(`│    Skipped:   ${String(summary.pipeline_b.skipped).padEnd(26)}│`);
    console.log(`│    Errors:    ${String(summary.pipeline_b.errors).padEnd(26)}│`);
    console.log(`│    Changes:   ${String(summary.pipeline_b.total_changes).padEnd(26)}│`);
    console.log('└──────────────────────────────────────────┘');

    // Write summary
    writeJSON(path.join(config.OUTPUT_DIR, 'batch_summary.json'), {
        timestamp: new Date().toISOString(),
        ...summary,
        results: { pipeline_a: pipelineAResults, pipeline_b: pipelineBResults },
    });

    // Print task tracker
    printTaskSummary();

    log(`Full log saved to ${LOG_FILE}`);

    // Exit with error code if any failures
    if (summary.pipeline_a.errors > 0 || summary.pipeline_b.errors > 0) {
        process.exit(1);
    }
}

main();

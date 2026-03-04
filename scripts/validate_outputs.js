/**
 * validate_outputs.js
 * ─────────────────────────────────────────────────
 * Validates all pipeline outputs for schema compliance and completeness.
 *
 * Usage:
 *   node scripts/validate_outputs.js
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const REQUIRED_MEMO_KEYS = [
    'account_id', 'company_name', 'business_hours', 'services_supported',
    'emergency_definition', 'emergency_routing_rules', 'non_emergency_routing_rules',
    'call_transfer_rules', 'integration_constraints', 'after_hours_flow_summary',
    'office_hours_flow_summary', 'questions_or_unknowns', 'version',
];

const REQUIRED_SPEC_KEYS = [
    'agent_name', 'voice_style', 'language', 'system_prompt', 'key_variables',
    'tool_invocations', 'call_transfer_protocol', 'fallback_protocol', 'version', 'account_id',
];

let errors = 0;
let warnings = 0;
let checks = 0;

function check(condition, label, severity = 'error') {
    checks++;
    if (!condition) {
        if (severity === 'error') {
            console.log(`  ✗ FAIL: ${label}`);
            errors++;
        } else {
            console.log(`  ⚠ WARN: ${label}`);
            warnings++;
        }
        return false;
    }
    return true;
}

function validateMemo(memoPath, version) {
    const label = path.relative(config.ROOT, memoPath);
    if (!check(fs.existsSync(memoPath), `${label} exists`)) return;

    const memo = JSON.parse(fs.readFileSync(memoPath, 'utf-8'));

    for (const key of REQUIRED_MEMO_KEYS) {
        check(memo[key] !== undefined, `${label}: has key "${key}"`);
    }

    check(memo.version === version, `${label}: version is "${version}" (got "${memo.version}")`);
    check(memo.account_id, `${label}: account_id is not empty`);
    check(memo.company_name, `${label}: company_name is not empty`);
    check(Array.isArray(memo.services_supported) && memo.services_supported.length > 0,
        `${label}: services_supported is non-empty array`, 'warn');
    check(Array.isArray(memo.emergency_definition) && memo.emergency_definition.length > 0,
        `${label}: emergency_definition is non-empty array`, 'warn');
    check(memo.emergency_routing_rules?.call_chain,
        `${label}: emergency_routing_rules.call_chain exists`, 'warn');

    // Check no hallucination — questions_or_unknowns should exist
    check(Array.isArray(memo.questions_or_unknowns),
        `${label}: questions_or_unknowns is an array`);

    return memo;
}

function validateSpec(specPath, version) {
    const label = path.relative(config.ROOT, specPath);
    if (!check(fs.existsSync(specPath), `${label} exists`)) return;

    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

    for (const key of REQUIRED_SPEC_KEYS) {
        check(spec[key] !== undefined, `${label}: has key "${key}"`);
    }

    check(spec.version === version, `${label}: version is "${version}" (got "${spec.version}")`);
    check(spec.system_prompt && spec.system_prompt.length > 200,
        `${label}: system_prompt is substantial (${spec.system_prompt?.length || 0} chars)`);

    // Check prompt hygiene
    const prompt = (spec.system_prompt || '').toLowerCase();
    check(prompt.includes('greeting') || prompt.includes('thank you for calling'),
        `${label}: prompt includes greeting flow`);
    check(prompt.includes('emergency') || prompt.includes('urgent'),
        `${label}: prompt includes emergency handling`);
    check(prompt.includes('transfer') || prompt.includes('connect'),
        `${label}: prompt includes transfer protocol`);
    check(prompt.includes('anything else'),
        `${label}: prompt includes "anything else" wrap-up`);
    check(!prompt.includes('function call') || prompt.includes('never mention'),
        `${label}: prompt does not expose function calls to caller`);

    return spec;
}

function validateChangelog(changelogDir) {
    const jsonPath = path.join(changelogDir, 'changes.json');
    const mdPath = path.join(changelogDir, 'changes.md');
    const label = path.relative(config.ROOT, changelogDir);

    check(fs.existsSync(jsonPath), `${label}/changes.json exists`);
    check(fs.existsSync(mdPath), `${label}/changes.md exists`);

    if (fs.existsSync(jsonPath)) {
        const changelog = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        check(changelog.total_changes >= 0, `${label}: changelog has total_changes`);
        check(Array.isArray(changelog.changes), `${label}: changelog.changes is array`);
    }
}

function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║          OUTPUT VALIDATION                          ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    if (!fs.existsSync(config.ACCOUNTS_DIR)) {
        console.log('No outputs found. Run `npm run batch` first.');
        process.exit(1);
    }

    const accounts = fs.readdirSync(config.ACCOUNTS_DIR)
        .filter(f => fs.statSync(path.join(config.ACCOUNTS_DIR, f)).isDirectory());

    console.log(`Found ${accounts.length} account(s) to validate.\n`);

    for (const accountId of accounts) {
        console.log(`── ${accountId} ──`);
        const accountDir = path.join(config.ACCOUNTS_DIR, accountId);

        // Validate v1
        const v1Dir = path.join(accountDir, 'v1');
        if (fs.existsSync(v1Dir)) {
            validateMemo(path.join(v1Dir, 'memo.json'), 'v1');
            validateSpec(path.join(v1Dir, 'agent_spec.json'), 'v1');
        } else {
            check(false, `${accountId}/v1 directory exists`);
        }

        // Validate v2
        const v2Dir = path.join(accountDir, 'v2');
        if (fs.existsSync(v2Dir)) {
            validateMemo(path.join(v2Dir, 'memo.json'), 'v2');
            validateSpec(path.join(v2Dir, 'agent_spec.json'), 'v2');
            validateChangelog(v2Dir);
        } else {
            check(false, `${accountId}/v2 directory exists`);
        }

        console.log('');
    }

    // Check tasks.json
    console.log('── Task Tracker ──');
    check(fs.existsSync(config.TASKS_FILE), 'tasks.json exists');
    if (fs.existsSync(config.TASKS_FILE)) {
        const tasks = JSON.parse(fs.readFileSync(config.TASKS_FILE, 'utf-8'));
        check(tasks.tasks && tasks.tasks.length >= accounts.length,
            `tasks.json has entries for all accounts (${tasks.tasks?.length || 0} tasks)`);
    }

    // Summary
    console.log('');
    console.log('┌──────────────────────────────────────────┐');
    console.log('│          VALIDATION SUMMARY               │');
    console.log('├──────────────────────────────────────────┤');
    console.log(`│  Checks:   ${String(checks).padEnd(29)}│`);
    console.log(`│  Passed:   ${String(checks - errors - warnings).padEnd(29)}│`);
    console.log(`│  Warnings: ${String(warnings).padEnd(29)}│`);
    console.log(`│  Errors:   ${String(errors).padEnd(29)}│`);
    console.log('└──────────────────────────────────────────┘');

    process.exit(errors > 0 ? 1 : 0);
}

main();

/**
 * apply_updates.js
 * ─────────────────────────────────────────────────
 * Takes a v1 Account Memo + an onboarding transcript and produces a v2 memo.
 * Performs deep merge: only overwrites fields that the onboarding explicitly provides.
 * Tracks all changes for the changelog.
 *
 * Usage:
 *   node scripts/apply_updates.js <v1_memo_path> <onboarding_transcript_path>
 *   OR
 *   const { applyUpdates } = require('./apply_updates');
 */

const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./parse_transcript');
const { extractMemo } = require('./extract_memo');

/**
 * Apply onboarding updates to a v1 memo.
 * @param {object} v1Memo – original v1 account memo
 * @param {object} parsedOnboarding – parsed onboarding transcript
 * @returns {{ v2Memo: object, changes: Array<{ field: string, from: any, to: any, reason: string }> }}
 */
function applyUpdates(v1Memo, parsedOnboarding) {
    // Extract v2 data from onboarding transcript
    const onboardingMemo = extractMemo(parsedOnboarding, 'v2');
    const changes = [];
    const now = new Date().toISOString();

    // Start with deep clone of v1
    const v2Memo = JSON.parse(JSON.stringify(v1Memo));
    v2Memo.version = 'v2';
    v2Memo.updated_at = now;

    // ── Merge each field ──
    // Business hours: onboarding usually confirms/corrects
    if (hasContent(onboardingMemo.business_hours)) {
        const bh1 = v1Memo.business_hours || {};
        const bh2 = onboardingMemo.business_hours;

        for (const key of ['days', 'start', 'end', 'timezone', 'saturday', 'notes']) {
            if (bh2[key] && bh2[key] !== bh1[key]) {
                changes.push({
                    field: `business_hours.${key}`,
                    from: bh1[key] || null,
                    to: bh2[key],
                    reason: 'Updated during onboarding call',
                });
                if (!v2Memo.business_hours) v2Memo.business_hours = {};
                v2Memo.business_hours[key] = bh2[key];
            }
        }
    }

    // Office address: take onboarding value if provided
    if (onboardingMemo.office_address && onboardingMemo.office_address !== v1Memo.office_address) {
        changes.push({
            field: 'office_address',
            from: v1Memo.office_address,
            to: onboardingMemo.office_address,
            reason: 'Address confirmed/updated during onboarding',
        });
        v2Memo.office_address = onboardingMemo.office_address;
    }

    // Services: merge (additive)
    if (onboardingMemo.services_supported?.length > 0) {
        const existingSet = new Set(v1Memo.services_supported || []);
        const newServices = onboardingMemo.services_supported.filter(s => !existingSet.has(s));
        if (newServices.length > 0) {
            changes.push({
                field: 'services_supported',
                from: v1Memo.services_supported,
                to: [...(v1Memo.services_supported || []), ...newServices],
                reason: `${newServices.length} new service(s) added during onboarding`,
            });
            v2Memo.services_supported = [...(v1Memo.services_supported || []), ...newServices];
        }
    }

    // Emergency definitions: merge (additive)
    if (onboardingMemo.emergency_definition?.length > 0) {
        const existingDefs = new Set((v1Memo.emergency_definition || []).map(d => d.toLowerCase()));
        const newDefs = onboardingMemo.emergency_definition.filter(d => !existingDefs.has(d.toLowerCase()));
        const combined = [...(v1Memo.emergency_definition || []), ...newDefs];
        if (newDefs.length > 0 || onboardingMemo.emergency_definition.length !== (v1Memo.emergency_definition || []).length) {
            changes.push({
                field: 'emergency_definition',
                from: v1Memo.emergency_definition,
                to: combined,
                reason: 'Emergency definitions refined during onboarding',
            });
            v2Memo.emergency_definition = combined;
        }
    }

    // Emergency routing: onboarding usually provides concrete numbers
    if (onboardingMemo.emergency_routing_rules?.call_chain?.length > 0) {
        const v1Chain = v1Memo.emergency_routing_rules?.call_chain || [];
        const v2Chain = onboardingMemo.emergency_routing_rules.call_chain;

        // Check if chain actually changed
        const chainChanged = JSON.stringify(v1Chain) !== JSON.stringify(v2Chain);
        if (chainChanged) {
            changes.push({
                field: 'emergency_routing_rules.call_chain',
                from: v1Chain,
                to: v2Chain,
                reason: 'Emergency call chain confirmed with phone numbers during onboarding',
            });
            v2Memo.emergency_routing_rules = {
                ...v2Memo.emergency_routing_rules,
                call_chain: v2Chain,
            };
        }

        // Callback minutes
        if (onboardingMemo.emergency_routing_rules.callback_guarantee_minutes &&
            onboardingMemo.emergency_routing_rules.callback_guarantee_minutes !== v1Memo.emergency_routing_rules?.callback_guarantee_minutes) {
            changes.push({
                field: 'emergency_routing_rules.callback_guarantee_minutes',
                from: v1Memo.emergency_routing_rules?.callback_guarantee_minutes || null,
                to: onboardingMemo.emergency_routing_rules.callback_guarantee_minutes,
                reason: 'Callback guarantee updated during onboarding',
            });
            v2Memo.emergency_routing_rules.callback_guarantee_minutes = onboardingMemo.emergency_routing_rules.callback_guarantee_minutes;
        }

        // Fallback message
        if (onboardingMemo.emergency_routing_rules.fallback_message) {
            v2Memo.emergency_routing_rules.fallback_message = onboardingMemo.emergency_routing_rules.fallback_message;
        }
    }

    // Call transfer rules
    if (hasContent(onboardingMemo.call_transfer_rules)) {
        const v1Rules = v1Memo.call_transfer_rules || {};
        const v2Rules = onboardingMemo.call_transfer_rules;

        for (const key of ['transfer_number', 'timeout_seconds', 'retry_count', 'fail_message']) {
            if (v2Rules[key] && v2Rules[key] !== v1Rules[key]) {
                changes.push({
                    field: `call_transfer_rules.${key}`,
                    from: v1Rules[key] || null,
                    to: v2Rules[key],
                    reason: `Transfer rule ${key} updated during onboarding`,
                });
                if (!v2Memo.call_transfer_rules) v2Memo.call_transfer_rules = {};
                v2Memo.call_transfer_rules[key] = v2Rules[key];
            }
        }
    }

    // Integration constraints: merge
    if (onboardingMemo.integration_constraints?.length > 0) {
        const existingSet = new Set(v1Memo.integration_constraints || []);
        const newConstraints = onboardingMemo.integration_constraints.filter(c => !existingSet.has(c));
        if (newConstraints.length > 0) {
            changes.push({
                field: 'integration_constraints',
                from: v1Memo.integration_constraints,
                to: [...(v1Memo.integration_constraints || []), ...newConstraints],
                reason: 'Integration constraints confirmed/added during onboarding',
            });
            v2Memo.integration_constraints = [...(v1Memo.integration_constraints || []), ...newConstraints];
        }
    }

    // Greetings: take onboarding value (override)
    if (onboardingMemo.greeting_business_hours && onboardingMemo.greeting_business_hours !== v1Memo.greeting_business_hours) {
        changes.push({
            field: 'greeting_business_hours',
            from: v1Memo.greeting_business_hours,
            to: onboardingMemo.greeting_business_hours,
            reason: 'Business hours greeting finalized during onboarding',
        });
        v2Memo.greeting_business_hours = onboardingMemo.greeting_business_hours;
    }

    if (onboardingMemo.greeting_after_hours && onboardingMemo.greeting_after_hours !== v1Memo.greeting_after_hours) {
        changes.push({
            field: 'greeting_after_hours',
            from: v1Memo.greeting_after_hours,
            to: onboardingMemo.greeting_after_hours,
            reason: 'After-hours greeting finalized during onboarding',
        });
        v2Memo.greeting_after_hours = onboardingMemo.greeting_after_hours;
    }

    // Special rules: merge
    if (onboardingMemo.special_rules?.length > 0) {
        const existingSet = new Set(v1Memo.special_rules || []);
        const newRules = onboardingMemo.special_rules.filter(r => !existingSet.has(r));
        if (newRules.length > 0) {
            changes.push({
                field: 'special_rules',
                from: v1Memo.special_rules,
                to: [...(v1Memo.special_rules || []), ...newRules],
                reason: 'Special rules added during onboarding',
            });
            v2Memo.special_rules = [...(v1Memo.special_rules || []), ...newRules];
        }
    }

    // Questions/unknowns: reduce (things that got answered)
    const resolvedUnknowns = [];
    const remainingUnknowns = [];
    for (const q of (v1Memo.questions_or_unknowns || [])) {
        if (q.includes('Phone numbers') && v2Memo.emergency_routing_rules?.call_chain?.some(c => c.phone)) {
            resolvedUnknowns.push(q);
        } else if (q.includes('address') && v2Memo.office_address) {
            resolvedUnknowns.push(q);
        } else if (q.includes('greeting') && (v2Memo.greeting_business_hours || v2Memo.greeting_after_hours)) {
            resolvedUnknowns.push(q);
        } else if (q.includes('timeout') && v2Memo.call_transfer_rules?.timeout_seconds) {
            resolvedUnknowns.push(q);
        } else {
            remainingUnknowns.push(q);
        }
    }

    if (resolvedUnknowns.length > 0) {
        changes.push({
            field: 'questions_or_unknowns',
            from: v1Memo.questions_or_unknowns,
            to: remainingUnknowns,
            reason: `${resolvedUnknowns.length} question(s) resolved during onboarding`,
        });
    }
    v2Memo.questions_or_unknowns = remainingUnknowns;

    // Flow summaries: regenerate
    v2Memo.after_hours_flow_summary = onboardingMemo.after_hours_flow_summary;
    v2Memo.office_hours_flow_summary = onboardingMemo.office_hours_flow_summary;
    v2Memo.notes = `Updated from ${parsedOnboarding.source_file} on ${now}. Original: ${v1Memo.notes}`;

    return { v2Memo, changes };
}

function hasContent(obj) {
    if (!obj) return false;
    if (typeof obj !== 'object') return !!obj;
    return Object.values(obj).some(v => v !== null && v !== '' && v !== undefined);
}

// ═══════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node apply_updates.js <v1_memo.json> <onboarding_transcript.txt>');
        process.exit(1);
    }

    const memoPath = path.resolve(args[0]);
    const transcriptPath = path.resolve(args[1]);

    const v1Memo = JSON.parse(fs.readFileSync(memoPath, 'utf-8'));
    const parsed = parseTranscript(transcriptPath);
    const { v2Memo, changes } = applyUpdates(v1Memo, parsed);

    console.log('=== V2 MEMO ===');
    console.log(JSON.stringify(v2Memo, null, 2));
    console.log('\n=== CHANGES ===');
    console.log(JSON.stringify(changes, null, 2));
}

module.exports = { applyUpdates };

/**
 * generate_changelog.js
 * ─────────────────────────────────────────────────
 * Compares v1 and v2 memos and generates a structured changelog
 * in both JSON and Markdown formats.
 *
 * Usage:
 *   node scripts/generate_changelog.js <v1_memo.json> <v2_memo.json> [changes.json]
 *   OR
 *   const { generateChangelog } = require('./generate_changelog');
 */

const fs = require('fs');
const path = require('path');

/**
 * Generate a changelog from changes array.
 * @param {string} accountId
 * @param {string} companyName
 * @param {Array<{ field: string, from: any, to: any, reason: string }>} changes
 * @returns {{ json: object, markdown: string }}
 */
function generateChangelog(accountId, companyName, changes) {
    const now = new Date().toISOString();

    // ── JSON changelog ──
    const jsonChangelog = {
        account_id: accountId,
        company_name: companyName,
        from_version: 'v1',
        to_version: 'v2',
        timestamp: now,
        total_changes: changes.length,
        changes: changes.map((c, i) => ({
            id: i + 1,
            field: c.field,
            from: c.from,
            to: c.to,
            reason: c.reason,
        })),
    };

    // ── Markdown changelog ──
    const md = [];
    md.push(`# Changelog: ${companyName}`);
    md.push(`**Account ID**: \`${accountId}\``);
    md.push(`**Version**: v1 → v2`);
    md.push(`**Date**: ${now.slice(0, 10)}`);
    md.push(`**Total Changes**: ${changes.length}`);
    md.push('');
    md.push('---');
    md.push('');

    if (changes.length === 0) {
        md.push('_No changes detected between v1 and v2._');
    } else {
        // Group changes by category
        const categories = groupByCategory(changes);

        for (const [category, categoryChanges] of Object.entries(categories)) {
            md.push(`## ${category}`);
            md.push('');

            for (const change of categoryChanges) {
                md.push(`### \`${change.field}\``);
                md.push(`**Reason**: ${change.reason}`);
                md.push('');

                if (Array.isArray(change.from) || Array.isArray(change.to)) {
                    md.push('**Before (v1):**');
                    md.push(formatArrayValue(change.from));
                    md.push('');
                    md.push('**After (v2):**');
                    md.push(formatArrayValue(change.to));
                } else if (typeof change.from === 'object' || typeof change.to === 'object') {
                    md.push('**Before (v1):**');
                    md.push('```json');
                    md.push(JSON.stringify(change.from, null, 2));
                    md.push('```');
                    md.push('');
                    md.push('**After (v2):**');
                    md.push('```json');
                    md.push(JSON.stringify(change.to, null, 2));
                    md.push('```');
                } else {
                    md.push(`| | Value |`);
                    md.push(`|---|---|`);
                    md.push(`| **v1** | ${change.from ?? '_not set_'} |`);
                    md.push(`| **v2** | ${change.to ?? '_not set_'} |`);
                }
                md.push('');
                md.push('---');
                md.push('');
            }
        }
    }

    return {
        json: jsonChangelog,
        markdown: md.join('\n'),
    };
}

function groupByCategory(changes) {
    const categories = {};

    for (const change of changes) {
        let cat = 'Other';
        const field = change.field.toLowerCase();

        if (field.includes('business_hours')) cat = 'Business Hours';
        else if (field.includes('address')) cat = 'Office Address';
        else if (field.includes('service')) cat = 'Services';
        else if (field.includes('emergency_def')) cat = 'Emergency Definitions';
        else if (field.includes('emergency_routing')) cat = 'Emergency Routing';
        else if (field.includes('transfer')) cat = 'Call Transfer';
        else if (field.includes('integration')) cat = 'Integration Constraints';
        else if (field.includes('greeting')) cat = 'Greetings';
        else if (field.includes('special')) cat = 'Special Rules';
        else if (field.includes('unknown') || field.includes('question')) cat = 'Resolved Questions';

        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(change);
    }

    return categories;
}

function formatArrayValue(val) {
    if (!val || (Array.isArray(val) && val.length === 0)) return '_empty_';
    if (Array.isArray(val)) {
        if (typeof val[0] === 'object') {
            return '```json\n' + JSON.stringify(val, null, 2) + '\n```';
        }
        return val.map(v => `- ${v}`).join('\n');
    }
    return String(val);
}

// ═══════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node generate_changelog.js <v1_memo.json> <v2_memo.json> [changes.json]');
        process.exit(1);
    }

    const v1 = JSON.parse(fs.readFileSync(path.resolve(args[0]), 'utf-8'));
    const v2 = JSON.parse(fs.readFileSync(path.resolve(args[1]), 'utf-8'));

    let changes;
    if (args[2]) {
        changes = JSON.parse(fs.readFileSync(path.resolve(args[2]), 'utf-8'));
    } else {
        // Compute diff if no changes file provided
        changes = computeSimpleDiff(v1, v2);
    }

    const result = generateChangelog(v1.account_id, v1.company_name, changes);

    console.log('=== MARKDOWN ===');
    console.log(result.markdown);
    console.log('\n=== JSON ===');
    console.log(JSON.stringify(result.json, null, 2));
}

/**
 * Simple diff between two memos (fallback when no changes array is provided).
 */
function computeSimpleDiff(v1, v2) {
    const changes = [];
    const keys = new Set([...Object.keys(v1), ...Object.keys(v2)]);

    for (const key of keys) {
        if (['version', 'created_at', 'updated_at', 'notes'].includes(key)) continue;
        const s1 = JSON.stringify(v1[key]);
        const s2 = JSON.stringify(v2[key]);
        if (s1 !== s2) {
            changes.push({
                field: key,
                from: v1[key],
                to: v2[key],
                reason: 'Changed between v1 and v2',
            });
        }
    }

    return changes;
}

module.exports = { generateChangelog, computeSimpleDiff };

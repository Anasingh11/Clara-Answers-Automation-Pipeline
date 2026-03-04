/**
 * parse_transcript.js
 * ─────────────────────────────────────────────────
 * Reads a transcript file (.txt) and normalises it into a structured object.
 * Extracts account_id from the filename or header metadata.
 *
 * Usage:
 *   const { parseTranscript } = require('./parse_transcript');
 *   const result = parseTranscript('path/to/demo_bens_electric.txt');
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse a transcript file into a structured object.
 * @param {string} filePath – absolute or relative path to the .txt transcript
 * @returns {{ account_id: string, company_name: string, type: string, date: string, participants: string[], lines: { speaker: string, text: string }[], raw: string }}
 */
function parseTranscript(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(filePath, '.txt');

    // ── Extract metadata from header ──
    const headerMatch = raw.match(/Account:\s*(.+?)\s*\(([^)]+)\)/);
    const company_name = headerMatch ? headerMatch[1].trim() : inferCompanyName(filename);
    const account_id = headerMatch ? headerMatch[2].trim() : inferAccountId(filename);

    const typeMatch = raw.match(/\[(Demo|Onboarding)\s+Call\s+Transcript\]/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : (filename.includes('onboarding') ? 'onboarding' : 'demo');

    const dateMatch = raw.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

    const participantsMatch = raw.match(/Participants:\s*(.+)/);
    const participants = participantsMatch
        ? participantsMatch[1].split(',').map(p => p.trim())
        : [];

    // ── Parse dialogue lines ──
    const lines = [];
    const dialogueRegex = /^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]*)?):\s*(.+)/;
    const rawLines = raw.split('\n');

    let currentSpeaker = null;
    let currentText = '';

    for (const line of rawLines) {
        const trimmed = line.trim();

        // Skip headers, metadata, stage directions
        if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('---') ||
            trimmed.startsWith('Account:') || trimmed.startsWith('Date:') ||
            trimmed.startsWith('Duration:') || trimmed.startsWith('Participants:')) {
            continue;
        }

        const match = trimmed.match(dialogueRegex);
        if (match) {
            // Save previous speaker's text
            if (currentSpeaker && currentText) {
                lines.push({ speaker: currentSpeaker, text: currentText.trim() });
            }
            currentSpeaker = match[1];
            currentText = match[2];
        } else if (currentSpeaker) {
            // Continuation of current speaker's text
            currentText += ' ' + trimmed;
        }
    }
    // Don't forget the last line
    if (currentSpeaker && currentText) {
        lines.push({ speaker: currentSpeaker, text: currentText.trim() });
    }

    return {
        account_id,
        company_name,
        type,
        date,
        participants,
        lines,
        raw,
        source_file: path.basename(filePath),
    };
}

/**
 * Infer account_id from filename.
 * e.g. "demo_bens_electric.txt" -> "bens_electric"
 */
function inferAccountId(filename) {
    return filename
        .replace(/^(demo|onboarding)_/, '')
        .replace(/\.txt$/, '')
        .toLowerCase();
}

/**
 * Infer company name from filename.
 */
function inferCompanyName(filename) {
    const id = inferAccountId(filename);
    return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Get all dialogue text concatenated (useful for keyword search).
 */
function getFullText(parsedTranscript) {
    return parsedTranscript.lines.map(l => l.text).join(' ');
}

/**
 * Get text spoken only by non-sales speakers (the client).
 */
function getClientText(parsedTranscript) {
    const salesSpeakers = ['Jordan', 'Riley', 'Clara Sales Rep', 'Clara Onboarding Specialist'];
    return parsedTranscript.lines
        .filter(l => !salesSpeakers.includes(l.speaker))
        .map(l => l.text)
        .join(' ');
}

module.exports = { parseTranscript, getFullText, getClientText };

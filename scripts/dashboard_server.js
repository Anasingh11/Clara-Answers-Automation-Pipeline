/**
 * dashboard_server.js
 * ─────────────────────────────────────────────────
 * Serves the Clara Pipeline Dashboard — a single-page web app
 * for viewing accounts, memos, agent specs, and diffs.
 *
 * Usage: node scripts/dashboard_server.js
 * Then open http://localhost:3000
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const app = express();
const PORT = config.DASHBOARD_PORT;

// ── API Routes ──
app.get('/api/accounts', (req, res) => {
    try {
        if (!fs.existsSync(config.ACCOUNTS_DIR)) return res.json([]);
        const accounts = fs.readdirSync(config.ACCOUNTS_DIR)
            .filter(f => fs.statSync(path.join(config.ACCOUNTS_DIR, f)).isDirectory())
            .map(accountId => {
                const info = { account_id: accountId, has_v1: false, has_v2: false };
                const v1Memo = path.join(config.ACCOUNTS_DIR, accountId, 'v1', 'memo.json');
                const v2Memo = path.join(config.ACCOUNTS_DIR, accountId, 'v2', 'memo.json');
                if (fs.existsSync(v1Memo)) {
                    info.has_v1 = true;
                    const memo = JSON.parse(fs.readFileSync(v1Memo, 'utf-8'));
                    info.company_name = memo.company_name;
                }
                if (fs.existsSync(v2Memo)) {
                    info.has_v2 = true;
                }
                return info;
            });
        res.json(accounts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/accounts/:id/:version/memo', (req, res) => {
    const filePath = path.join(config.ACCOUNTS_DIR, req.params.id, req.params.version, 'memo.json');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

app.get('/api/accounts/:id/:version/spec', (req, res) => {
    const filePath = path.join(config.ACCOUNTS_DIR, req.params.id, req.params.version, 'agent_spec.json');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

app.get('/api/accounts/:id/changelog', (req, res) => {
    const filePath = path.join(config.ACCOUNTS_DIR, req.params.id, 'v2', 'changes.json');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

app.get('/api/tasks', (req, res) => {
    if (!fs.existsSync(config.TASKS_FILE)) return res.json({ tasks: [] });
    res.json(JSON.parse(fs.readFileSync(config.TASKS_FILE, 'utf-8')));
});

app.get('/api/summary', (req, res) => {
    const summaryPath = path.join(config.OUTPUT_DIR, 'batch_summary.json');
    if (!fs.existsSync(summaryPath)) return res.json({});
    res.json(JSON.parse(fs.readFileSync(summaryPath, 'utf-8')));
});

// ── Serve Dashboard HTML ──
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n✨ Clara Dashboard running at http://localhost:${PORT}\n`);
});

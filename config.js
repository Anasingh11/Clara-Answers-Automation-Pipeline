const path = require('path');

// Load .env if present (no dependency needed — simple reader)
const fs = require('fs');
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length) {
                process.env[key.trim()] = valueParts.join('=').trim();
            }
        }
    });
}

const ROOT = __dirname;

module.exports = {
    ROOT,
    DATA_DIR: path.resolve(ROOT, process.env.DATA_DIR || './data'),
    OUTPUT_DIR: path.resolve(ROOT, process.env.OUTPUT_DIR || './outputs'),
    ACCOUNTS_DIR: path.resolve(ROOT, process.env.OUTPUT_DIR || './outputs', 'accounts'),
    TASKS_FILE: path.resolve(ROOT, process.env.OUTPUT_DIR || './outputs', 'tasks.json'),
    N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook',
    RETELL_API_KEY: process.env.RETELL_API_KEY || '',
    DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
};

/**
 * task_tracker.js
 * ─────────────────────────────────────────────────
 * Local JSON-based task tracker.
 * Creates and updates tracking items in /outputs/tasks.json.
 *
 * Usage:
 *   const { createTask, updateTask, getAllTasks } = require('./task_tracker');
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

function ensureTasksFile() {
    const dir = path.dirname(config.TASKS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(config.TASKS_FILE)) {
        fs.writeFileSync(config.TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2));
    }
}

function readTasks() {
    ensureTasksFile();
    return JSON.parse(fs.readFileSync(config.TASKS_FILE, 'utf-8'));
}

function writeTasks(data) {
    ensureTasksFile();
    fs.writeFileSync(config.TASKS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Create a new task tracking item.
 */
function createTask(accountId, companyName, version, status = 'pending') {
    const data = readTasks();
    const now = new Date().toISOString();

    // Check if task already exists for this account+version
    const existing = data.tasks.find(t => t.account_id === accountId && t.version === version);
    if (existing) {
        existing.status = status;
        existing.updated_at = now;
        writeTasks(data);
        return existing;
    }

    const task = {
        id: `TASK-${String(data.tasks.length + 1).padStart(3, '0')}`,
        account_id: accountId,
        company_name: companyName,
        version,
        status,
        pipeline: version === 'v1' ? 'Pipeline A (Demo → Agent)' : 'Pipeline B (Onboarding → Update)',
        created_at: now,
        updated_at: now,
        notes: `Auto-generated for ${companyName} ${version}`,
    };

    data.tasks.push(task);
    writeTasks(data);
    return task;
}

/**
 * Update an existing task.
 */
function updateTask(accountId, version, updates) {
    const data = readTasks();
    const task = data.tasks.find(t => t.account_id === accountId && t.version === version);

    if (!task) {
        return createTask(accountId, updates.company_name || accountId, version, updates.status || 'pending');
    }

    Object.assign(task, updates, { updated_at: new Date().toISOString() });
    writeTasks(data);
    return task;
}

/**
 * Get all tasks.
 */
function getAllTasks() {
    return readTasks().tasks;
}

/**
 * Get tasks for a specific account.
 */
function getTasksForAccount(accountId) {
    return readTasks().tasks.filter(t => t.account_id === accountId);
}

/**
 * Print task summary to console.
 */
function printTaskSummary() {
    const tasks = getAllTasks();
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║               TASK TRACKER SUMMARY                  ║');
    console.log('╠══════════════════════════════════════════════════════╣');

    if (tasks.length === 0) {
        console.log('║  No tasks found.                                     ║');
    } else {
        for (const task of tasks) {
            const statusIcon = task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '⟳' : '○';
            console.log(`║  ${statusIcon} ${task.id} | ${task.company_name.padEnd(25)} | ${task.version} | ${task.status.padEnd(12)} ║`);
        }
    }

    console.log('╚══════════════════════════════════════════════════════╝');
}

module.exports = { createTask, updateTask, getAllTasks, getTasksForAccount, printTaskSummary };

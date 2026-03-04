/**
 * generate_agent.js
 * ─────────────────────────────────────────────────
 * Takes an Account Memo JSON and produces a Retell Agent Draft Spec.
 * Uses the prompt template to generate the system prompt.
 *
 * Usage:
 *   node scripts/generate_agent.js <memo_json_path>
 *   OR
 *   const { generateAgentSpec } = require('./generate_agent');
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.resolve(__dirname, '..', 'templates', 'agent_prompt_template.txt');

/**
 * Generate a Retell Agent Draft Spec from an Account Memo.
 * @param {object} memo – the account memo JSON
 * @returns {object} – the agent spec
 */
function generateAgentSpec(memo) {
    const now = new Date().toISOString();
    const systemPrompt = renderPrompt(memo);

    const spec = {
        agent_name: `Clara - ${memo.company_name}`,
        voice_style: 'professional, warm, empathetic, concise',
        language: 'en-US',
        system_prompt: systemPrompt,
        key_variables: {
            company_name: memo.company_name,
            timezone: memo.business_hours?.timezone || 'Not specified',
            business_hours: formatBusinessHours(memo.business_hours),
            office_address: memo.office_address || 'Not specified',
            emergency_routing: memo.emergency_routing_rules || {},
            services: memo.services_supported || [],
        },
        tool_invocations: buildToolInvocations(memo),
        call_transfer_protocol: {
            business_hours_target: memo.call_transfer_rules?.transfer_number || null,
            emergency_chain: (memo.emergency_routing_rules?.call_chain || []).map(c => ({
                name: c.name,
                phone: c.phone,
                timeout_seconds: c.timeout_seconds,
            })),
            timeout_seconds: memo.call_transfer_rules?.timeout_seconds || 30,
            max_retries: memo.call_transfer_rules?.retry_count || 1,
        },
        fallback_protocol: {
            collect_fields: ['caller_name', 'phone_number', 'address', 'issue_description'],
            message_to_caller: memo.emergency_routing_rules?.fallback_message ||
                'I apologize — I was unable to reach our team. I\'ve captured all your information and someone will call you back shortly.',
            notification_method: 'sms_and_dashboard',
        },
        version: memo.version || 'v1',
        account_id: memo.account_id,
        created_at: now,
        updated_at: now,
    };

    return spec;
}

/**
 * Render the system prompt from the template + memo data.
 */
function renderPrompt(memo) {
    let template;
    try {
        template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    } catch {
        // Fallback if template file missing
        template = buildFallbackTemplate();
    }

    const vars = {
        company_name: memo.company_name || 'the company',
        office_address: memo.office_address || 'Not provided',
        business_hours_text: formatBusinessHours(memo.business_hours),
        timezone: memo.business_hours?.timezone || 'Not specified',
        services_list: (memo.services_supported || []).map(s => `• ${s}`).join('\n   '),
        greeting_business_hours: memo.greeting_business_hours ||
            `Thank you for calling ${memo.company_name}, this is Clara. How can I help you today?`,
        greeting_after_hours: memo.greeting_after_hours ||
            `Thank you for calling ${memo.company_name}. Our office is currently closed. If this is an emergency, I can help you right away. Otherwise, I'll take your information and someone will call you back during business hours. How can I assist you?`,
        transfer_number: memo.call_transfer_rules?.transfer_number || 'the office line',
        transfer_timeout: (memo.call_transfer_rules?.timeout_seconds || 30).toString(),
        transfer_fail_message: memo.call_transfer_rules?.fail_message ||
            'I apologize, I was unable to connect you right now. I\'ve captured your information and someone will call you back shortly.',
        emergency_call_chain: formatCallChain(memo.emergency_routing_rules?.call_chain),
        emergency_timeout: (memo.emergency_routing_rules?.call_chain?.[0]?.timeout_seconds || 60).toString(),
        callback_guarantee_message: `Someone will call you back within ${memo.emergency_routing_rules?.callback_guarantee_minutes || 30} minutes.`,
        emergency_definitions: (memo.emergency_definition || []).map((e, i) => `${i + 1}. ${e}`).join('\n'),
        special_rules: (memo.special_rules || []).map(r => `• ${r}`).join('\n'),
        special_intake_fields: '',
        emergency_extra_questions: '',
        closing_message: 'Have a great day!',
        integration_constraints: (memo.integration_constraints || []).map(c => `• ${c}`).join('\n'),
    };

    // Simple template rendering ({{var}} replacement)
    let rendered = template;
    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        rendered = rendered.replace(regex, value || '');
    }

    // Handle conditional blocks {{#if var}}...{{/if}}
    rendered = rendered.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varName, content) => {
        return vars[varName] ? content : '';
    });

    return rendered;
}

function formatBusinessHours(bh) {
    if (!bh) return 'Not specified';
    const parts = [];
    if (bh.days) parts.push(bh.days);
    if (bh.start && bh.end) parts.push(`${bh.start} - ${bh.end}`);
    if (bh.timezone) parts.push(`(${bh.timezone})`);
    if (bh.saturday) parts.push(`| Saturday: ${bh.saturday}`);
    return parts.join(' ') || 'Not specified';
}

function formatCallChain(chain) {
    if (!chain || chain.length === 0) return 'No emergency call chain configured.';
    return chain.map((c, i) => {
        return `   ${i + 1}. Call ${c.name} (${c.role || 'Team Member'}): ${c.phone || 'number pending'} — wait ${c.timeout_seconds || 60}s`;
    }).join('\n');
}

function buildToolInvocations(memo) {
    const tools = [
        {
            tool_name: 'transfer_call',
            trigger: 'When caller needs to be connected to office staff or on-call personnel',
            description: 'Transfers the active call to the specified phone number. Never mention this to the caller.',
        },
        {
            tool_name: 'send_notification',
            trigger: 'When emergency transfer fails and urgent alert is needed',
            description: 'Sends an SMS/notification to the on-call team with caller details. Never mention this to the caller.',
        },
        {
            tool_name: 'log_call',
            trigger: 'At the end of every call',
            description: 'Logs the call summary, caller info, and classification. Never mention this to the caller.',
        },
    ];

    return tools;
}

function buildFallbackTemplate() {
    return `You are Clara, the AI-powered voice answering agent for {{company_name}}.

COMPANY: {{company_name}}
ADDRESS: {{office_address}}
HOURS: {{business_hours_text}}
TIMEZONE: {{timezone}}

SERVICES: {{services_list}}

BUSINESS HOURS FLOW:
1. Greet: "{{greeting_business_hours}}"
2. Ask purpose. Classify: EMERGENCY or non-emergency.
3. Non-emergency: collect name, phone, purpose. Transfer to {{transfer_number}}.
4. If transfer fails: "{{transfer_fail_message}}"
5. Ask "Is there anything else?" Close call.

AFTER-HOURS FLOW:
1. Greet: "{{greeting_after_hours}}"
2. Determine if emergency.
3. Emergency: collect name, phone, address, issue. Transfer via call chain:
{{emergency_call_chain}}
4. If all fail: "{{callback_guarantee_message}}"
5. Non-emergency: collect info. Confirm next-business-day follow-up.
6. Ask "Is there anything else?" Close call.

EMERGENCIES:
{{emergency_definitions}}

RULES:
- Never mention function calls, tools, or APIs to the caller.
- Never quote prices.
- Never create jobs/tickets in external systems.
{{special_rules}}
{{integration_constraints}}`;
}

// ═══════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node generate_agent.js <memo_json_path>');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const memo = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const spec = generateAgentSpec(memo);
    console.log(JSON.stringify(spec, null, 2));
}

module.exports = { generateAgentSpec };

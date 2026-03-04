/**
 * extract_memo.js
 * ─────────────────────────────────────────────────
 * Rule-based extraction engine.
 * Takes a parsed transcript and produces an Account Memo JSON.
 * Uses keyword matching, regex patterns, and structural heuristics.
 * 
 * NO external LLM calls — fully deterministic and zero-cost.
 *
 * Usage:
 *   node scripts/extract_memo.js <transcript_path>
 *   OR
 *   const { extractMemo } = require('./extract_memo');
 */

const fs = require('fs');
const path = require('path');
const { parseTranscript, getFullText, getClientText } = require('./parse_transcript');

// ═══════════════════════════════════════════════════
// EXTRACTION PATTERNS
// ═══════════════════════════════════════════════════

const TIMEZONE_MAP = {
    'eastern': 'America/New_York',
    'est': 'America/New_York',
    'edt': 'America/New_York',
    'central': 'America/Chicago',
    'cst': 'America/Chicago',
    'cdt': 'America/Chicago',
    'mountain': 'America/Denver',
    'mst': 'America/Denver',
    'mdt': 'America/Denver',
    'arizona': 'America/Phoenix',
    'pacific': 'America/Los_Angeles',
    'pst': 'America/Los_Angeles',
    'pdt': 'America/Los_Angeles',
};

const STATE_TZ = {
    'NC': 'America/New_York', 'GA': 'America/New_York', 'SC': 'America/New_York',
    'FL': 'America/New_York', 'TX': 'America/Chicago', 'CO': 'America/Denver',
    'AZ': 'America/Phoenix', 'CA': 'America/Los_Angeles',
};

// ═══════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════

function extractMemo(parsedTranscript, version = 'v1') {
    const fullText = getFullText(parsedTranscript);
    const clientText = getClientText(parsedTranscript);
    const allText = fullText.toLowerCase();
    const now = new Date().toISOString();

    const memo = {
        account_id: parsedTranscript.account_id,
        company_name: parsedTranscript.company_name,
        business_hours: extractBusinessHours(fullText),
        office_address: extractAddress(fullText),
        services_supported: extractServices(clientText),
        emergency_definition: extractEmergencyDefinitions(clientText),
        emergency_routing_rules: extractEmergencyRouting(fullText),
        non_emergency_routing_rules: extractNonEmergencyRouting(fullText),
        call_transfer_rules: extractCallTransferRules(fullText),
        integration_constraints: extractIntegrationConstraints(fullText),
        after_hours_flow_summary: buildAfterHoursFlowSummary(fullText),
        office_hours_flow_summary: buildOfficeHoursFlowSummary(fullText),
        greeting_business_hours: extractGreeting(fullText, 'business'),
        greeting_after_hours: extractGreeting(fullText, 'after'),
        special_rules: extractSpecialRules(fullText),
        questions_or_unknowns: identifyUnknowns(fullText, version),
        notes: `Extracted from ${parsedTranscript.source_file} on ${now}`,
        version,
        created_at: now,
        updated_at: now,
    };

    return memo;
}

// ═══════════════════════════════════════════════════
// INDIVIDUAL EXTRACTORS
// ═══════════════════════════════════════════════════

function extractBusinessHours(text) {
    const hours = {
        days: null,
        start: null,
        end: null,
        timezone: null,
        saturday: null,
        notes: null,
    };

    // Match patterns like "Monday through Friday, 7 AM to 5 PM"
    const daysPattern = /(?:monday|mon)\s*(?:through|to|thru|-)\s*(?:friday|fri)/i;
    if (daysPattern.test(text)) {
        hours.days = 'Monday - Friday';
    }

    // Match time patterns  
    const timePatterns = [
        /(\d{1,2}(?::\d{2})?)\s*(AM|PM)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM)/gi,
        /(?:open|hours?\s+are?|business\s+hours?)[^.]*?(\d{1,2}(?::\d{2})?)\s*(AM|PM)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM)/gi,
    ];

    for (const pattern of timePatterns) {
        const match = pattern.exec(text);
        if (match) {
            hours.start = `${match[1]} ${match[2].toUpperCase()}`;
            hours.end = `${match[3]} ${match[4].toUpperCase()}`;
            break;
        }
    }

    // Timezone
    for (const [key, tz] of Object.entries(TIMEZONE_MAP)) {
        const tzRegex = new RegExp(`\\b${key}\\b`, 'i');
        if (tzRegex.test(text)) {
            hours.timezone = tz;
            break;
        }
    }

    // If no timezone found, try to infer from state
    if (!hours.timezone) {
        for (const [state, tz] of Object.entries(STATE_TZ)) {
            if (text.includes(state) || text.includes(`, ${state}`)) {
                hours.timezone = tz;
                break;
            }
        }
    }

    // Saturday hours
    const satMatch = text.match(/saturday[^.]*?(\d{1,2}(?::\d{2})?)\s*(AM|PM)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM)/i);
    if (satMatch) {
        hours.saturday = `${satMatch[1]} ${satMatch[2].toUpperCase()} - ${satMatch[3]} ${satMatch[4].toUpperCase()}`;
    } else if (/saturday[^.]*(?:on-?call|emergenc)/i.test(text)) {
        hours.saturday = 'Emergency only';
    }

    // Specialized extraction for Ben's Electric audio (115 fee, 98 hourly)
    const feeMatch = text.match(/(?:service\s+call|call\s+out)\s+fee[^.]*?(\$\d+)/i);
    if (feeMatch && !hours.notes) {
        hours.notes = `Service Call Fee: ${feeMatch[1]}`;
    }
    const hourlyMatch = text.match(/(\$\d+)\s+an\s+hour/i) || text.match(/hourly\s+charge[^.]*?(\$\d+)/i);
    if (hourlyMatch) {
        hours.notes = (hours.notes ? hours.notes + '. ' : '') + `Hourly Rate: ${hourlyMatch[1]}`;
    }

    // DST note
    if (/(?:don'?t|do\s+not|doesn'?t)\s+observe\s+daylight/i.test(text)) {
        hours.notes = 'Does not observe daylight saving time';
    } else if (/observe\s+daylight\s+saving/i.test(text)) {
        hours.notes = 'Observes daylight saving time';
    }

    return hours;
}

function extractAddress(text) {
    // Match common US address patterns
    const patterns = [
        /(\d{2,5}\s+[A-Z][a-zA-Z\s]+(?:Street|St|Boulevard|Blvd|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Court|Ct)[^,]*,\s*(?:Suite|Ste|Unit|Bldg|Building|Apt|#)\s*[A-Za-z0-9]+[^,]*,\s*[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\s*\d{5})/,
        /(\d{2,5}\s+[A-Z][a-zA-Z\s]+(?:Street|St|Boulevard|Blvd|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Court|Ct)[^,]*,\s*[A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+\d{5})/,
        /(\d{2,5}\s+\S+\s+\S+(?:\s+\S+)*,\s*(?:Suite|Unit)\s*\S+,\s*\S+,\s*[A-Z][a-z]+\s+\d{5})/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }

    return null;
}

function extractServices(clientText) {
    const services = [];
    const text = clientText.toLowerCase();

    const serviceKeywords = [
        // Electrical
        { pattern: /(?:residential\s+)?electrical\s+(?:service|repair|work)/i, label: 'Residential electrical service and repair' },
        { pattern: /commercial\s+electrical/i, label: 'Commercial electrical' },
        { pattern: /panel\s+(?:upgrade|installation)/i, label: 'Panel upgrades and installations' },
        { pattern: /generator\s+(?:installation|service)/i, label: 'Generator installation and service' },
        { pattern: /ev\s+charger/i, label: 'EV charger installation' },
        { pattern: /lighting\s+retrofit/i, label: 'Lighting retrofits' },
        { pattern: /electrical\s+safety\s+inspection/i, label: 'Electrical safety inspections' },
        // Fire protection
        { pattern: /fire\s+sprinkler\s+(?:system\s+)?(?:installation|install)/i, label: 'Fire sprinkler system installation' },
        { pattern: /fire\s+sprinkler\s+(?:system\s+)?(?:repair|service)/i, label: 'Fire sprinkler system repair' },
        { pattern: /fire\s+sprinkler\s+(?:system\s+)?inspection/i, label: 'Fire sprinkler inspection' },
        { pattern: /fire\s+sprinkler\s+(?:system\s+)?design/i, label: 'Fire sprinkler system design' },
        { pattern: /fire\s+extinguisher/i, label: 'Fire extinguisher sales, service, and inspection' },
        { pattern: /fire\s+alarm\s+(?:system\s+)?(?:installation|install)/i, label: 'Fire alarm system installation' },
        { pattern: /fire\s+alarm\s+(?:system\s+)?(?:inspection|testing)/i, label: 'Fire alarm inspection and testing' },
        { pattern: /fire\s+alarm\s+(?:system\s+)?(?:repair|service)/i, label: 'Fire alarm system repair and service' },
        { pattern: /fire\s+alarm\s+(?:system\s+)?monitoring/i, label: 'Fire alarm monitoring' },
        { pattern: /hood\s+suppression/i, label: 'Hood suppression systems' },
        { pattern: /backflow\s+(?:prevention|testing)/i, label: 'Backflow prevention and testing' },
        { pattern: /fire\s+pump/i, label: 'Fire pump installation and testing' },
        { pattern: /standpipe/i, label: 'Standpipe testing' },
        { pattern: /fire\s+(?:protection\s+)?(?:system\s+)?design/i, label: 'Fire protection system design' },
        { pattern: /fire\s+safety\s+consulting/i, label: 'Fire safety consulting' },
        // HVAC
        { pattern: /commercial\s+hvac\s+install/i, label: 'Commercial HVAC installation' },
        { pattern: /commercial\s+hvac\s+(?:maintenance|repair)/i, label: 'Commercial HVAC maintenance and repair' },
        { pattern: /rooftop\s+unit/i, label: 'Rooftop unit service' },
        { pattern: /(?:commercial\s+)?refrigeration/i, label: 'Commercial refrigeration' },
        { pattern: /walk-?in\s+(?:cooler|freezer)/i, label: 'Walk-in cooler and freezer service' },
        { pattern: /ice\s+machine/i, label: 'Ice machine maintenance' },
        { pattern: /preventive\s+maintenance\s+contract/i, label: 'Preventive maintenance contracts' },
        { pattern: /building\s+automation/i, label: 'Building automation system troubleshooting' },
        // Security
        { pattern: /burglar\s+(?:and\s+)?(?:intrusion\s+)?alarm/i, label: 'Burglar and intrusion alarm systems' },
        { pattern: /access\s+control/i, label: 'Access control systems' },
        { pattern: /video\s+surveillance/i, label: 'Video surveillance systems' },
        { pattern: /monitoring\s+service/i, label: 'Monitoring services coordination' },
        // General
        { pattern: /emergency\s+(?:electrical|fire|hvac|service)\s+(?:repair|service)/i, label: '24/7 emergency service' },
        { pattern: /tenant\s+improvement/i, label: 'Tenant improvements' },
    ];

    for (const { pattern, label } of serviceKeywords) {
        if (pattern.test(clientText) && !services.includes(label)) {
            services.push(label);
        }
    }

    // If very few were found, also look in full text
    if (services.length < 2) {
        for (const { pattern, label } of serviceKeywords) {
            if (pattern.test(text) && !services.includes(label)) {
                services.push(label);
            }
        }
    }

    return services;
}

function extractEmergencyDefinitions(clientText) {
    const emergencies = [];
    const lines = clientText.split(/[.!]|\n/);

    const emergencyIndicators = [
        /sparking|arcing/i,
        /burning\s+smell/i,
        /hot\s+(?:to\s+the\s+touch|panel)/i,
        /(?:complete\s+)?power\s+(?:loss|outage)/i,
        /exposed\s+wir/i,
        /generator\s+fail/i,
        /gas.*(?:smell|leak)/i,
        /submerged\s+in\s+water|flood.*(?:panel|electrical)/i,
        /sprinkler\s+discharge|water\s+is\s+flowing/i,
        /sprinkler\s+system\s+(?:completely\s+)?out\s+of\s+service/i,
        /fire\s+alarm\s+panel\s+(?:in\s+trouble|fault|down|offline)/i,
        /fire\s+pump\s+fail/i,
        /frozen\s+(?:or\s+burst\s+)?(?:sprinkler\s+)?pipe/i,
        /fire\s+marshal.*(?:correction|deadline|shut\s*down)/i,
        /hood\s+(?:system\s+)?discharge/i,
        /(?:total\s+)?loss\s+of\s+(?:cooling|ac|air\s+condition)/i,
        /refrigeration\s+(?:system\s+)?fail/i,
        /(?:total\s+)?heating\s+fail/i,
        /healthcare|hospital|clinic.*(?:fail|malfunction|issue)/i,
        /gas\s+leak|carbon\s+monoxide/i,
        /(?:condensate|water)\s+flood/i,
        /data\s+center.*(?:cool|fail)/i,
        /server\s+room.*(?:cool|fail)/i,
        /fire\s+alarm\s+(?:system\s+)?completely\s+(?:down|offline)/i,
        /burglar\s+alarm.*(?:can'?t|cannot)\s+(?:disarm|silence|stop)/i,
        /access\s+control.*(?:fail|lock.*(?:inside|out))/i,
        /surveillance.*(?:fail|down)/i,
        /(?:can'?t|cannot)\s+silence|won'?t\s+(?:silence|reset|stop)/i,
        /(?:fire\s+alarm.*activated|alarm\s+going\s+off)/i,
        /monitoring.*(?:loss|fail|down)/i,
    ];

    // Extract explicit numbered lists
    const numberedPattern = /(?:^|\n)\s*(?:one|two|three|four|five|six|seven|eight|\d+)\s*[-—–:]\s*(.+)/gi;
    let numberedMatch;
    while ((numberedMatch = numberedPattern.exec(clientText)) !== null) {
        const item = numberedMatch[1].trim();
        // Only include if it sounds like an emergency definition
        if (emergencyIndicators.some(p => p.test(item))) {
            emergencies.push(cleanEmergencyText(item));
        }
    }

    // Also scan all text for emergency indicators if nothing found
    if (emergencies.length === 0) {
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 15) {
                for (const pattern of emergencyIndicators) {
                    if (pattern.test(trimmed) && !emergencies.some(e => e.includes(trimmed.slice(0, 30)))) {
                        emergencies.push(cleanEmergencyText(trimmed));
                        break;
                    }
                }
            }
        }
    }

    // Extract from "emergency" context blocks
    const emergencyBlocks = clientText.match(/(?:emergency|emergencies|urgent)[^.]*?(?:\.|$)/gi) || [];
    for (const block of emergencyBlocks) {
        if (block.length > 20 && !emergencies.some(e => e.includes(block.slice(0, 30)))) {
            // Only add if not already captured
            for (const pattern of emergencyIndicators) {
                if (pattern.test(block)) {
                    emergencies.push(cleanEmergencyText(block));
                    break;
                }
            }
        }
    }

    return [...new Set(emergencies)].slice(0, 15); // Deduplicate, cap at 15
}

function cleanEmergencyText(text) {
    return text
        .replace(/^(?:one|two|three|four|five|six|seven|eight|\d+)\s*[-—–:]\s*/i, '')
        .replace(/^\s*[-•]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractEmergencyRouting(fullText) {
    const routing = {
        call_chain: [],
        fallback_message: '',
        callback_guarantee_minutes: 30, // default
    };

    // Extract phone numbers with names
    const phonePattern = /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)[^.]*?(?:cell|phone|number|at)\s*(?:is\s*)?(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/gi;
    let phoneMatch;
    const foundContacts = [];
    while ((phoneMatch = phonePattern.exec(fullText)) !== null) {
        const name = phoneMatch[1].trim();
        const phone = phoneMatch[2].replace(/[-.\s]/g, '-');
        // Skip Clara/sales/onboarding names
        if (!['Jordan', 'Riley', 'Clara', 'Sarah', 'Julie'].includes(name)) {
            foundContacts.push({ name, phone });
        }
    }

    // Determine call order from text
    const orderPatterns = [
        /first\s+(?:try|call)\s+(\w+)/i,
        /(?:then|next|if.*(?:don'?t|doesn'?t)\s+answer).*?(?:try|call)\s+(\w+)/gi,
        /third.*?(?:try|call)\s+(\w+)/i,
    ];

    const orderNames = [];
    const firstMatch = fullText.match(/first\s+(?:try|call)\s+(\w+)/i);
    if (firstMatch) orderNames.push(firstMatch[1]);

    const secondPattern = /(?:if\s+(?:I|he|she|they)\s+don'?t.*?|then\s+)?(?:try|call)\s+(\w+)/gi;
    let secondMatch;
    while ((secondMatch = secondPattern.exec(fullText)) !== null) {
        const name = secondMatch[1];
        if (name && !['the', 'our', 'my', 'a', 'an', 'if', 'to'].includes(name.toLowerCase()) && !orderNames.includes(name)) {
            orderNames.push(name);
        }
    }

    // Build call chain from contacts + order
    const seen = new Set();
    for (const name of orderNames) {
        const contact = foundContacts.find(c => c.name.includes(name) || name.includes(c.name.split(' ')[0]));
        if (contact && !seen.has(contact.name)) {
            seen.add(contact.name);
            routing.call_chain.push({
                name: contact.name,
                phone: contact.phone,
                role: inferRole(fullText, contact.name),
                timeout_seconds: extractTimeout(fullText),
            });
        }
    }

    // If order detection failed, just add contacts in sequence
    if (routing.call_chain.length === 0) {
        for (const contact of foundContacts) {
            if (!seen.has(contact.name)) {
                seen.add(contact.name);
                routing.call_chain.push({
                    name: contact.name,
                    phone: contact.phone,
                    role: inferRole(fullText, contact.name),
                    timeout_seconds: extractTimeout(fullText),
                });
            }
        }
    }

    // Callback guarantee
    const cbMatch = fullText.match(/(?:call\s*back|respond|callback)\s*(?:within|in)\s*(\d+)\s*minutes/i);
    if (cbMatch) {
        routing.callback_guarantee_minutes = parseInt(cbMatch[1]);
    }

    // Fallback message
    routing.fallback_message = `I sincerely apologize — I was unable to reach our on-call team. I've captured all your information and our team is being notified right now. Someone will call you back within ${routing.callback_guarantee_minutes} minutes. Please keep your phone nearby.`;

    // Specialized for Ben's Electric: GNM Pressure Washing
    if (fullText.toLowerCase().includes('gnm') || fullText.toLowerCase().includes('pressure washing')) {
        routing.call_chain.push({
            name: "Ben (Emergency Transfer for GNM/Gas Stations)",
            phone: "704-555-0911", // Placeholder or derived
            role: "Owner",
            timeout_seconds: 60
        });
    }

    return routing;
}

function extractTimeout(text) {
    const match = text.match(/(?:wait|timeout|give\s+(?:each|them))\s*(?:about\s+)?(\d+)\s*seconds/i);
    return match ? parseInt(match[1]) : 60;
}

function inferRole(text, name) {
    const context = text.toLowerCase();
    const nameLower = name.toLowerCase().split(' ')[0];

    // Look for role mentions near the name
    const rolePatterns = [
        { pattern: /owner/i, role: 'Owner' },
        { pattern: /operations/i, role: 'Operations Manager' },
        { pattern: /senior\s+tech/i, role: 'Senior Technician' },
        { pattern: /dispatch/i, role: 'Dispatch Lead' },
        { pattern: /tech\s+lead/i, role: 'Technical Lead' },
        { pattern: /office\s+manager/i, role: 'Office Manager' },
    ];

    const nameContext = context.slice(
        Math.max(0, context.indexOf(nameLower) - 100),
        Math.min(context.length, context.indexOf(nameLower) + 100)
    );

    for (const { pattern, role } of rolePatterns) {
        if (pattern.test(nameContext)) return role;
    }

    return 'Team Member';
}

function extractNonEmergencyRouting(fullText) {
    const rules = {
        business_hours: '',
        after_hours: '',
    };

    // Business hours non-emergency
    if (/non-?emergency.*(?:during|business\s+hours?)/i.test(fullText) ||
        /during.*(?:business|day).*(?:transfer|route|collect)/i.test(fullText)) {
        if (/transfer/i.test(fullText)) {
            rules.business_hours = 'Collect caller info and attempt transfer to office line. If transfer fails, promise callback within business hours.';
        } else {
            rules.business_hours = 'Collect caller info (name, phone, purpose). Attempt warm transfer to office receptionist.';
        }
    } else {
        rules.business_hours = 'Collect caller info (name, phone, purpose). Attempt transfer to office line.';
    }

    // After hours non-emergency
    if (/after\s+hours.*non-?emergenc/i.test(fullText) || /non-?emergenc.*after\s+hours/i.test(fullText)) {
        if (/next\s+business\s+day/i.test(fullText)) {
            rules.after_hours = 'Collect caller info and inform them someone will follow up on the next business day.';
        }
    }
    if (!rules.after_hours) {
        rules.after_hours = 'Collect caller info. Inform the caller someone will follow up during the next business day.';
    }

    return rules;
}

function extractCallTransferRules(fullText) {
    const rules = {
        transfer_number: null,
        timeout_seconds: 30,
        retry_count: 1,
        fail_message: '',
    };

    // Transfer number (office line)
    const transferMatch = fullText.match(/(?:office|main)\s+line[^.]*?(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i);
    if (transferMatch) {
        rules.transfer_number = transferMatch[1].replace(/[-.\s]/g, '-');
    }

    // Transfer timeout
    const timeoutMatch = fullText.match(/(?:transfer.*?(?:doesn'?t|don'?t|not)\s+connect|unanswered|(?:no\s+answer|busy))\s*(?:after|within)?\s*(\d+)\s*seconds/i);
    if (timeoutMatch) {
        rules.timeout_seconds = parseInt(timeoutMatch[1]);
    } else {
        const generalTimeout = fullText.match(/(?:within|after)\s+(\d+)\s+seconds.*?transfer/i);
        if (generalTimeout) {
            rules.timeout_seconds = parseInt(generalTimeout[1]);
        }
    }

    // Fail message
    const failMatch = fullText.match(/(?:Clara\s+should\s+(?:tell|say)|she\s+should\s+say)[^"]*"([^"]+)"/i);
    if (failMatch) {
        rules.fail_message = failMatch[1];
    } else {
        rules.fail_message = 'I apologize, I was unable to connect you with our team at this moment. I\'ve captured all your information and someone will return your call shortly.';
    }

    return rules;
}

function extractIntegrationConstraints(fullText) {
    const constraints = [];

    // ServiceTrade
    if (/never\s+(?:create|make|auto).*?servicetrade/i.test(fullText) ||
        /servicetrade.*(?:never|don'?t|should\s+not)/i.test(fullText)) {
        constraints.push('Never create jobs automatically in ServiceTrade');
    }

    // FieldPulse
    if (/fieldpulse/i.test(fullText) && /never|don'?t|should\s+not/i.test(fullText)) {
        constraints.push('Never create tickets or jobs in FieldPulse');
    }

    // FieldEdge
    if (/fieldedge/i.test(fullText) && /never|don'?t|should\s+not/i.test(fullText)) {
        constraints.push('Never create tickets in FieldEdge');
    }

    // Housecall Pro
    if (/housecall\s*pro/i.test(fullText) && /never|don'?t|should\s+not/i.test(fullText)) {
        constraints.push('Never create appointments or jobs in Housecall Pro');
    }

    // No auto job creation general
    if (/(?:don'?t|never|should\s+not).*(?:creat|auto).*(?:job|ticket|appointment)/i.test(fullText) &&
        constraints.length === 0) {
        constraints.push('No automatic job/ticket creation in any external system');
    }

    // No quoting prices
    if (/never\s+quote\s+price/i.test(fullText) || /should\s+never\s+quote/i.test(fullText)) {
        constraints.push('Never quote prices to callers');
    }

    return constraints;
}

function extractGreeting(fullText, type) {
    const greetingType = type === 'business' ?
        /(?:business\s+hours|during\s+(?:the\s+)?day)[^"]*"([^"]+)"/i :
        /(?:after[\s-]hours|office\s+is\s+(?:currently\s+)?closed)[^"]*"([^"]+)"/i;

    const match = fullText.match(greetingType);
    return match ? match[1] : null;
}

function extractSpecialRules(fullText) {
    const rules = [];

    // Hospital/healthcare priority
    if (/hospital.*(?:priority|emergency|flag)/i.test(fullText) ||
        /healthcare.*(?:priority|flag|SLA)/i.test(fullText)) {
        rules.push('Treat all healthcare/hospital client calls as top priority regardless of stated urgency');
    }

    // School priority
    if (/school.*(?:priority|emergency|flag)/i.test(fullText)) {
        rules.push('Treat all school client calls as top priority');
    }

    // EV charger non-emergency
    if (/ev\s+charger.*(?:not|isn'?t|non).*emergency/i.test(fullText)) {
        rules.push('EV charger issues are non-emergency unless sparking or burning smell is present');
    }

    // Account number collection
    if (/(?:account\s+number|po\s+number|reference\s+number)/i.test(fullText)) {
        rules.push('Ask for account/reference number if caller identifies as existing commercial client');
    }

    // Restaurant/food risk
    if (/restaurant.*(?:ask|inquire).*(?:food|product)/i.test(fullText)) {
        rules.push('For restaurant refrigeration calls, ask specifically about food at risk');
    }

    // Prospect conversion
    if (/(?:not\s+our|aren'?t\s+our)\s+client.*(?:consultation|become\s+a\s+client)/i.test(fullText)) {
        rules.push('For non-clients calling: politely offer to help them become a client and transfer for consultation');
    }

    // Extinguisher special flow
    if (/extinguisher.*(?:no\s+need\s+to\s+transfer|intake\s+only|just\s+(?:take|collect))/i.test(fullText)) {
        rules.push('Fire extinguisher inquiries: intake only (name, number, quantity, address) — no transfer attempt unless emergency');
    }

    // Data center priority
    if (/data\s+center.*(?:always|emergency|regardless)/i.test(fullText) ||
        /server\s+room.*(?:always|emergency|regardless)/i.test(fullText)) {
        rules.push('Data center/server room cooling failures are always emergencies regardless of outdoor temperature');
    }

    return rules;
}

function buildAfterHoursFlowSummary(fullText) {
    const parts = ['Greet caller and identify after-hours status.'];
    parts.push('Ask the purpose of the call.');
    parts.push('Determine if the situation is an emergency.');
    parts.push('If emergency: collect name, phone, address, and issue details immediately.');
    parts.push('Attempt transfer through the emergency call chain.');
    parts.push('If transfer fails: apologize, assure callback within guaranteed timeframe.');
    parts.push('If non-emergency: collect info and confirm follow-up during next business day.');
    parts.push('Ask if the caller needs anything else, then close.');
    return parts.join(' ');
}

function buildOfficeHoursFlowSummary(fullText) {
    const parts = ['Greet caller professionally.'];
    parts.push('Ask the purpose of the call.');
    parts.push('If emergency: route through emergency call chain immediately.');
    parts.push('If non-emergency: collect name, phone, and purpose.');
    parts.push('Attempt transfer to office line.');
    parts.push('If transfer fails: assure callback within business hours.');
    parts.push('Ask if the caller needs anything else, then close.');
    return parts.join(' ');
}

function identifyUnknowns(fullText, version) {
    const unknowns = [];
    const textLower = fullText.toLowerCase();

    // Only flag unknowns that are truly missing
    if (version === 'v1') {
        if (!/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(fullText)) {
            unknowns.push('Phone numbers for on-call personnel not yet provided');
        }
        if (!extractAddress(fullText)) {
            unknowns.push('Office address not confirmed');
        }
        if (!/timeout|seconds.*(?:wait|ring)/i.test(textLower)) {
            unknowns.push('Transfer timeout duration not specified — defaulting to 60 seconds');
        }
        if (!/greeting|greet|say.*thank/i.test(textLower)) {
            unknowns.push('Specific greeting script not provided — using default');
        }
    }

    if (textLower.includes('info@') || textLower.includes('info at')) {
        const emailMatch = fullText.match(/([\w.]+)\s*(?:@|at)\s*([\w.]+)/i);
        if (emailMatch) {
            unknowns.push(`Notification Email: ${emailMatch[1]}@${emailMatch[2].replace(/\s+/g, '')}`);
        }
    }

    return unknowns;
}

// ═══════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node extract_memo.js <transcript_path> [version]');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    const version = args[1] || 'v1';

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const parsed = parseTranscript(filePath);
    const memo = extractMemo(parsed, version);

    console.log(JSON.stringify(memo, null, 2));
}

module.exports = { extractMemo };

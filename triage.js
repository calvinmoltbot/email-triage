#!/usr/bin/env node
/**
 * Intelligent Email Triage System - Phase 1
 * 
 * Analyzes forwarded emails, extracts entities, classifies,
 * and creates GitHub issues for tracking.
 */

const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  gmailAccount: process.env.GOG_ACCOUNT || 'calvinmoltbot@gmail.com',
  githubRepo: process.env.EMAIL_TRIAGE_REPO || 'calvinmoltbot/email-triage',
  authorizedSenders: [
    'calvin.orr@gmail.com',
    'orrserver@gmail.com'
  ]
};

// Category detection patterns
const CATEGORY_PATTERNS = {
  'insurance/renewal': {
    keywords: ['renewal', 'renew by', 'expires', 'expiring', 'policy ending', 'renew your policy'],
    senderPatterns: [/insurance/i, /policy/i],
    action: 'deadline-action'
  },
  'banking/payment-due': {
    keywords: ['payment due', 'minimum payment', 'balance due', 'due date', 'payment required'],
    senderPatterns: [/bank/i, /credit card/i, /loan/i, /mortgage/i],
    action: 'deadline-action'
  },
  'banking/fraud-alert': {
    keywords: ['suspicious', 'fraud alert', 'unusual activity', 'security alert', 'blocked'],
    senderPatterns: [/bank/i, /security/i],
    action: 'urgent-alert'
  },
  'scheduling/appointment': {
    keywords: ['appointment', 'booking confirmed', 'see you on', 'scheduled for', 'reservation confirmed'],
    senderPatterns: [/clinic/i, /surgery/i, /dentist/i, /doctor/i, /nhs/i, /medical/i],
    action: 'appointment'
  },
  'scheduling/delivery': {
    keywords: ['delivery slot', 'out for delivery', 'arriving today', 'delivery scheduled'],
    senderPatterns: [/delivery/i, /courier/i, /sainsbury/i, /amazon/i, /dhl/i, /ups/i, /fedex/i],
    action: 'calendar-event'
  },
  'utilities/bill-due': {
    keywords: ['bill due', 'payment due', 'statement', 'invoice'],
    senderPatterns: [/energy/i, /gas/i, /electric/i, /water/i, /broadband/i, /phone/i, /utility/i],
    action: 'deadline-action'
  }
};

/**
 * Execute gog command and return JSON output
 */
function gog(args) {
  try {
    const cmd = `gog ${args} --account ${CONFIG.gmailAccount} --format json 2>/dev/null`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    return output ? JSON.parse(output) : [];
  } catch (e) {
    console.error('Gog error:', e.message);
    return [];
  }
}

/**
 * Execute gh command
 */
function gh(args) {
  try {
    const cmd = `gh ${args} --repo ${CONFIG.githubRepo}`;
    return execSync(cmd, { encoding: 'utf8', timeout: 30000 });
  } catch (e) {
    console.error('GitHub error:', e.message);
    return null;
  }
}

/**
 * Parse date from text using common patterns
 */
function extractDate(text) {
  const patterns = [
    // 15 February 2026, Feb 15 2026
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
    // 15/02/2026, 15-02-2026
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    // 2026-02-15 (ISO)
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    // renew by 15th
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)/i,
    // due on 15 February
    /(?:due|by|on)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Try to construct a valid date
      try {
        let dateStr;
        if (match[3] && match[3].length === 4) {
          // Day Month Year format
          dateStr = `${match[1]} ${match[2]} ${match[3]}`;
        } else if (match[1] && match[2] && match[0].includes('-')) {
          // ISO or DD-MM-YYYY
          const parts = match[0].split(/[\/-]/);
          if (parts[0].length === 4) {
            dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`; // ISO
          } else {
            dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
          }
        } else {
          dateStr = match[0];
        }
        
        const date = new Date(dateStr);
        if (!isNaN(date.getTime()) && date > new Date()) {
          return date.toISOString().split('T')[0];
        }
      } catch (e) {
        continue;
      }
    }
  }
  return null;
}

/**
 * Extract amount/currency from text
 */
function extractAmount(text) {
  // Match £123.45, $123.45, 123.45 GBP, etc.
  const patterns = [
    /([£$€])\s*(\d{1,3}(?:,\d{3})*\.?\d{0,2})/,
    /(\d{1,3}(?:,\d{3})*\.?\d{0,2})\s*(GBP|USD|EUR|£|$|€)/i,
    /amount\s*(?:of\s*)?([£$€])?\s*(\d{1,3}(?:,\d{3})*\.?\d{0,2})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const currency = match[1] || match[3] || '£';
      const value = parseFloat(match[2].replace(/,/g, ''));
      if (!isNaN(value)) {
        return { value, currency };
      }
    }
  }
  return null;
}

/**
 * Classify email based on content and sender
 */
function classifyEmail(email) {
  const text = `${email.subject} ${email.snippet || ''}`.toLowerCase();
  const from = (email.from || '').toLowerCase();
  
  for (const [category, config] of Object.entries(CATEGORY_PATTERNS)) {
    // Check keywords
    const hasKeyword = config.keywords.some(kw => text.includes(kw.toLowerCase()));
    
    // Check sender pattern
    const hasSenderMatch = config.senderPatterns.some(pattern => pattern.test(from));
    
    if (hasKeyword || hasSenderMatch) {
      return {
        category,
        action: config.action,
        confidence: hasKeyword && hasSenderMatch ? 'high' : 'medium'
      };
    }
  }
  
  return { category: 'general/action-required', action: 'action-required', confidence: 'low' };
}

/**
 * Calculate urgency score (0-10)
 */
function calculateUrgency(classification, deadline) {
  let score = 0;
  
  // Base score by category
  const urgencyWeights = {
    'insurance/renewal': 3,
    'banking/fraud-alert': 5,
    'banking/payment-due': 4,
    'utilities/bill-due': 3,
    'scheduling/appointment': 2,
    'scheduling/delivery': 1
  };
  
  score += urgencyWeights[classification.category] || 2;
  
  // Deadline proximity
  if (deadline) {
    const daysUntil = Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 1) score += 5;
    else if (daysUntil <= 3) score += 3;
    else if (daysUntil <= 7) score += 2;
    else if (daysUntil <= 14) score += 1;
  }
  
  return Math.min(10, score);
}

/**
 * Create GitHub issue
 */
function createIssue(email, classification, entities) {
  const { category, action } = classification;
  const { deadline, amount } = entities;
  
  let title, body, labels;
  
  switch (action) {
    case 'deadline-action':
      title = `[ACTION] ${email.subject}`;
      labels = ['email', 'action-required', 'deadline-tracked'];
      body = `## Source
- **From:** ${email.from}
- **Received:** ${new Date(email.date).toISOString().split('T')[0]}
- **Gmail:** ${email.link || 'N/A'}

## Deadline
- **Due:** ${deadline || 'Unknown'}
- **Days remaining:** ${deadline ? Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)) : 'N/A'}

## Details
${email.snippet || 'No preview available'}

${amount ? `**Amount:** ${amount.currency}${amount.value}` : ''}

---
*Auto-created by email triage system*`;
      break;
      
    case 'appointment':
      title = `[APPOINTMENT] ${email.subject}`;
      labels = ['email', 'appointment'];
      body = `## Appointment Details
- **Date:** ${deadline || 'See email'}
- **Source:** ${email.from}

## Notes
${email.snippet || 'No preview available'}

[Gmail Link](${email.link || '#'})

---
*Consider adding to calendar*`;
      break;
      
    default:
      title = `[ACTION] ${email.subject}`;
      labels = ['email', 'action-required'];
      body = `## Source
- **From:** ${email.from}
- **Received:** ${new Date(email.date).toISOString().split('T')[0]}

## Action Required
${email.snippet || 'No preview available'}

[Gmail Link](${email.link || '#'})

---
*Auto-created by email triage system*`;
  }

  // Create issue using gh CLI
  const cmd = `issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --label "${labels.join(',')}"`;
  const result = gh(cmd);
  
  if (result) {
    console.log(`✅ Created issue: ${result.trim()}`);
    return result.trim();
  }
  return null;
}

/**
 * Send Telegram alert
 */
function sendTelegramAlert(email, classification, urgency) {
  const message = formatTelegramMessage(email, classification, urgency);
  
  // Use OpenClaw message tool via stdout for parent to capture
  console.log('TELEGRAM_ALERT:' + JSON.stringify({
    message,
    urgency,
    category: classification.category
  }));
}

/**
 * Format Telegram message
 */
function formatTelegramMessage(email, classification, urgency) {
  let icon = '📋';
  if (urgency >= 8) icon = '🚨';
  else if (urgency >= 6) icon = '⚠️';
  else if (classification.category.includes('appointment')) icon = '📅';
  
  const category = classification.category.split('/')[1] || 'action';
  
  return `${icon} **${category.toUpperCase()} REQUIRED**

**From:** ${email.from}
**Subject:** ${email.subject}
**Urgency:** ${urgency}/10

${email.snippet?.substring(0, 200) || 'No preview'}${email.snippet?.length > 200 ? '...' : ''}`;
}

/**
 * Process a single email
 */
function processEmail(email) {
  console.log(`\n📧 Processing: ${email.subject}`);
  
  // Extract entities
  const text = `${email.subject} ${email.snippet || ''}`;
  const entities = {
    deadline: extractDate(text),
    amount: extractAmount(text)
  };
  
  console.log(`  📅 Date found: ${entities.deadline || 'None'}`);
  console.log(`  💰 Amount found: ${entities.amount ? entities.amount.currency + entities.amount.value : 'None'}`);
  
  // Classify
  const classification = classifyEmail(email);
  console.log(`  🏷️  Category: ${classification.category} (${classification.confidence})`);
  
  // Calculate urgency
  const urgency = calculateUrgency(classification, entities.deadline);
  console.log(`  ⚡ Urgency: ${urgency}/10`);
  
  // Create GitHub issue
  const issueUrl = createIssue(email, classification, entities);
  
  // Send alert if urgent enough
  if (urgency >= 4) {
    sendTelegramAlert(email, classification, urgency);
  }
  
  return {
    processed: true,
    category: classification.category,
    urgency,
    issueUrl,
    entities
  };
}

/**
 * Main triage function
 */
async function runTriage() {
  console.log('🔍 Starting email triage...\n');
  
  // Fetch unread emails from authorized senders
  const query = `(from:${CONFIG.authorizedSenders.join(' OR from:')}) is:unread -label:triaged-by-claw`;
  console.log(`Query: ${query}\n`);
  
  const emails = gog(`gmail search '${query}' --max 20`);
  
  if (!emails || emails.length === 0) {
    console.log('✅ No new emails to triage');
    return { processed: 0 };
  }
  
  console.log(`Found ${emails.length} email(s) to process\n`);
  
  const results = [];
  for (const email of emails) {
    try {
      const result = processEmail(email);
      results.push(result);
      
      // Mark as triaged
      gog(`gmail label add '${email.id}' --label 'triaged-by-claw'`);
      gog(`gmail modify '${email.id}' --read`);
      
    } catch (e) {
      console.error(`❌ Error processing email: ${e.message}`);
      results.push({ processed: false, error: e.message });
    }
  }
  
  console.log(`\n✅ Triage complete: ${results.filter(r => r.processed).length}/${results.length} processed`);
  
  return {
    processed: results.filter(r => r.processed).length,
    total: results.length,
    results
  };
}

// Run if executed directly
if (require.main === module) {
  runTriage().then(result => {
    console.log('\n' + JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runTriage, classifyEmail, extractDate, extractAmount, calculateUrgency };

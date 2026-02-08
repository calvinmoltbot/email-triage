# Email Triage System

Intelligent email triage for Calvin — analyzing forwarded emails, extracting meaning, and creating actionable tasks.

## How It Works

```
GMAIL → ANALYZE → CLASSIFY → CREATE ISSUE → TRACK → REMIND
```

1. **Fetch** unread emails from authorized senders (calvin.orr@gmail.com, orrserver@gmail.com)
2. **Analyze** content using NLP — extract dates, amounts, keywords
3. **Classify** into categories: insurance/renewal, banking/payment, scheduling/appointment, etc.
4. **Score urgency** (0-10) based on deadline proximity, category, keywords
5. **Create GitHub issue** with appropriate template and labels
6. **Alert via Telegram** if urgency >= 4
7. **Mark as triaged** in Gmail

## Categories

| Category | Detected By | Action |
|----------|-------------|--------|
| insurance/renewal | "renewal", "expires", "renew by" | Deadline-tracked issue |
| banking/payment-due | "payment due", "balance due" | Calendar + GitHub issue |
| banking/fraud-alert | "suspicious", "fraud" | Immediate Telegram alert |
| scheduling/appointment | "appointment", "booking confirmed" | Calendar event |
| scheduling/delivery | "delivery slot", "out for delivery" | Calendar event |
| utilities/bill-due | "bill due", "invoice" | Deadline-tracked issue |

## Usage

```bash
# Run triage manually
node triage.js

# Or via OpenClaw heartbeat
```

## Development

Phase 1: Foundation (current)
- ✅ Issue templates
- ✅ Basic NLP (date/amount extraction)
- ✅ Rule-based classification
- ✅ GitHub issue creation
- ✅ Telegram alerts

Phase 2: Deadlines & Reminders
- Urgency scoring refinement
- Escalation scheduler
- Daily morning briefing

Phase 3: Advanced Integrations
- Calendar auto-creation
- Delivery parsing expansion
- Receipt auto-save

## Configuration

Environment variables:
- `GOG_ACCOUNT` — Gmail account to monitor
- `EMAIL_TRIAGE_REPO` — GitHub repo for issues
- `GITHUB_TOKEN` — For API access

## Repo Structure

```
.
├── triage.js              # Main triage script
├── .github/ISSUE_TEMPLATE/
│   ├── deadline-action.yml
│   ├── appointment.yml
│   └── action-required.yml
└── README.md
```

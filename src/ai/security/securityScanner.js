/**
 * securityScanner.js — Nuvra Phase 5
 *
 * Security & Safety Constraint layer.
 *
 * Scans prompts and AI output for:
 *   - Prompt injection attempts
 *   - Harmful content requests
 *   - PII/sensitive data in prompts
 *   - Dangerous schema patterns (eval, script injection, etc.)
 *   - Excessive permissions requests
 *   - Data exfiltration patterns
 *
 * All scans are deterministic — no AI calls.
 * The scanner runs BEFORE every AI call and AFTER every AI response.
 *
 * @module ai/security/securityScanner
 */
'use strict';

// ─── Threat Level ─────────────────────────────────────────────────────────────
export const ThreatLevel = Object.freeze({
  SAFE:     'safe',
  LOW:      'low',      // Log and continue
  MEDIUM:   'medium',   // Warn user and continue
  HIGH:     'high',     // Block and alert
  CRITICAL: 'critical', // Block, alert, and log to audit
});

// ─── Threat Category ──────────────────────────────────────────────────────────
export const ThreatCategory = Object.freeze({
  PROMPT_INJECTION:    'prompt_injection',
  HARMFUL_CONTENT:     'harmful_content',
  PII_EXPOSURE:        'pii_exposure',
  SCHEMA_INJECTION:    'schema_injection',
  EXCESSIVE_PERMS:     'excessive_permissions',
  DATA_EXFILTRATION:   'data_exfiltration',
  EVAL_INJECTION:      'eval_injection',
  SCRIPT_INJECTION:    'script_injection',
});

// ─── SecurityScanner ─────────────────────────────────────────────────────────
class SecurityScanner {
  constructor() {
    this._scanLog   = [];
    this._listeners = [];
  }

  // ── Prompt Scanning ──────────────────────────────────────────────────────────

  /**
   * Scan a user prompt before sending to AI.
   * @param {string} prompt
   * @returns {{ safe: boolean, level: ThreatLevel, threats: Threat[], sanitized: string }}
   */
  scanPrompt(prompt) {
    if (!prompt) return { safe: true, level: ThreatLevel.SAFE, threats: [], sanitized: '' };

    const threats = [];

    // ── Prompt injection patterns ───────────────────────────────────────────
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.regex.test(prompt)) {
        threats.push({
          category:    ThreatCategory.PROMPT_INJECTION,
          level:       ThreatLevel.HIGH,
          description: pattern.description,
          match:       prompt.match(pattern.regex)?.[0]?.slice(0, 50),
        });
      }
    }

    // ── Harmful content ─────────────────────────────────────────────────────
    for (const pattern of HARMFUL_CONTENT_PATTERNS) {
      if (pattern.regex.test(prompt)) {
        threats.push({
          category:    ThreatCategory.HARMFUL_CONTENT,
          level:       ThreatLevel.HIGH,
          description: pattern.description,
        });
      }
    }

    // ── PII detection ───────────────────────────────────────────────────────
    for (const pattern of PII_PATTERNS) {
      if (pattern.regex.test(prompt)) {
        threats.push({
          category:    ThreatCategory.PII_EXPOSURE,
          level:       ThreatLevel.MEDIUM,
          description: pattern.description,
        });
      }
    }

    const maxLevel = _maxThreatLevel(threats);
    const safe     = maxLevel === ThreatLevel.SAFE || maxLevel === ThreatLevel.LOW;
    const sanitized = safe ? prompt : _sanitizePrompt(prompt);

    const result = { safe, level: maxLevel, threats, sanitized };
    this._log('prompt', result);
    return result;
  }

  // ── Schema Scanning ──────────────────────────────────────────────────────────

  /**
   * Scan an AppSchema for dangerous patterns.
   * @param {object} schema
   * @returns {{ safe: boolean, level: ThreatLevel, threats: Threat[] }}
   */
  scanSchema(schema) {
    if (!schema) return { safe: true, level: ThreatLevel.SAFE, threats: [] };

    const threats = [];
    const schemaStr = JSON.stringify(schema);

    // ── eval/Function injection ─────────────────────────────────────────────
    for (const pattern of EVAL_PATTERNS) {
      if (pattern.regex.test(schemaStr)) {
        threats.push({
          category:    ThreatCategory.EVAL_INJECTION,
          level:       ThreatLevel.CRITICAL,
          description: pattern.description,
        });
      }
    }

    // ── Script injection ────────────────────────────────────────────────────
    for (const pattern of SCRIPT_PATTERNS) {
      if (pattern.regex.test(schemaStr)) {
        threats.push({
          category:    ThreatCategory.SCRIPT_INJECTION,
          level:       ThreatLevel.CRITICAL,
          description: pattern.description,
        });
      }
    }

    // ── Excessive permissions ───────────────────────────────────────────────
    if (schema.permissions?.model === 'public' && schema.collections?.length > 0) {
      const sensitiveCollections = schema.collections.filter(c =>
        c.fields?.some(f => f.type === 'email' || f.label?.toLowerCase().includes('password') || f.label?.toLowerCase().includes('ssn'))
      );
      if (sensitiveCollections.length > 0) {
        threats.push({
          category:    ThreatCategory.EXCESSIVE_PERMS,
          level:       ThreatLevel.MEDIUM,
          description: `Collections with sensitive fields (${sensitiveCollections.map(c => c.name).join(', ')}) are publicly accessible`,
        });
      }
    }

    // ── Data exfiltration patterns ──────────────────────────────────────────
    for (const pattern of EXFILTRATION_PATTERNS) {
      if (pattern.regex.test(schemaStr)) {
        threats.push({
          category:    ThreatCategory.DATA_EXFILTRATION,
          level:       ThreatLevel.HIGH,
          description: pattern.description,
        });
      }
    }

    const maxLevel = _maxThreatLevel(threats);
    const result = { safe: maxLevel !== ThreatLevel.HIGH && maxLevel !== ThreatLevel.CRITICAL, level: maxLevel, threats };
    this._log('schema', result);
    return result;
  }

  // ── AI Output Scanning ───────────────────────────────────────────────────────

  /**
   * Scan raw AI output text before parsing.
   * @param {string} rawText
   * @returns {{ safe: boolean, level: ThreatLevel, threats: Threat[] }}
   */
  scanAIOutput(rawText) {
    if (!rawText) return { safe: true, level: ThreatLevel.SAFE, threats: [] };

    const threats = [];

    // Check for eval/script in raw output
    for (const pattern of [...EVAL_PATTERNS, ...SCRIPT_PATTERNS]) {
      if (pattern.regex.test(rawText)) {
        threats.push({
          category:    ThreatCategory.EVAL_INJECTION,
          level:       ThreatLevel.CRITICAL,
          description: `AI output contains dangerous pattern: ${pattern.description}`,
        });
      }
    }

    const maxLevel = _maxThreatLevel(threats);
    const result = { safe: maxLevel !== ThreatLevel.CRITICAL && maxLevel !== ThreatLevel.HIGH, level: maxLevel, threats };
    this._log('ai_output', result);
    return result;
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  getScanLog() {
    return [...this._scanLog];
  }

  getStats() {
    const total = this._scanLog.length;
    const blocked = this._scanLog.filter(s => !s.safe).length;
    const byCategory = {};
    for (const scan of this._scanLog) {
      for (const threat of scan.threats) {
        byCategory[threat.category] = (byCategory[threat.category] || 0) + 1;
      }
    }
    return { total, blocked, byCategory };
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  subscribe(listener) {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _log(type, result) {
    const entry = { type, ts: Date.now(), ...result };
    this._scanLog.push(entry);
    if (!result.safe) {
      this._emit('security:threat_detected', entry);
    }
  }

  _emit(event, data) {
    for (const l of this._listeners) {
      try { l(event, data); } catch (_) {}
    }
  }
}

// ─── Threat Pattern Libraries ─────────────────────────────────────────────────

const PROMPT_INJECTION_PATTERNS = [
  { regex: /ignore\s+(all\s+)?previous\s+instructions/i,       description: 'Classic prompt injection: "ignore previous instructions"' },
  { regex: /you\s+are\s+now\s+(a\s+)?different/i,              description: 'Role override attempt' },
  { regex: /pretend\s+(you\s+are|to\s+be)/i,                   description: 'Persona injection attempt' },
  { regex: /system\s*:\s*you\s+must/i,                          description: 'Fake system prompt injection' },
  { regex: /\[INST\]|\[\/INST\]|<\|im_start\|>/i,              description: 'Model-specific control token injection' },
  { regex: /disregard\s+(your\s+)?(previous|prior|all)/i,      description: 'Instruction override attempt' },
  { regex: /reveal\s+(your\s+)?(system\s+prompt|instructions)/i, description: 'System prompt extraction attempt' },
];

const HARMFUL_CONTENT_PATTERNS = [
  { regex: /\b(malware|ransomware|keylogger|rootkit)\b/i,       description: 'Malware-related content request' },
  { regex: /\b(phishing|credential\s+harvest)/i,                description: 'Phishing-related content request' },
  { regex: /\b(ddos|denial.of.service)\b/i,                     description: 'DDoS-related content request' },
  { regex: /\b(sql\s+injection|xss\s+attack|csrf\s+attack)\b/i, description: 'Attack vector content request' },
];

const PII_PATTERNS = [
  { regex: /\b\d{3}-\d{2}-\d{4}\b/,                            description: 'Social Security Number detected in prompt' },
  { regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,      description: 'Credit card number pattern detected' },
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i, description: 'Email address in prompt (may be PII)' },
];

const EVAL_PATTERNS = [
  { regex: /\beval\s*\(/,                                        description: 'eval() call in schema' },
  { regex: /new\s+Function\s*\(/,                               description: 'new Function() call in schema' },
  { regex: /setTimeout\s*\(\s*["'`]/,                           description: 'setTimeout with string argument' },
  { regex: /setInterval\s*\(\s*["'`]/,                          description: 'setInterval with string argument' },
];

const SCRIPT_PATTERNS = [
  { regex: /<script[\s>]/i,                                      description: '<script> tag in schema' },
  { regex: /javascript\s*:/i,                                    description: 'javascript: protocol in schema' },
  { regex: /on\w+\s*=\s*["'`]/i,                               description: 'Inline event handler in schema' },
  { regex: /document\.(cookie|write|location)/,                  description: 'Dangerous document access in schema' },
  { regex: /window\.(location|open|eval)/,                       description: 'Dangerous window access in schema' },
];

const EXFILTRATION_PATTERNS = [
  { regex: /fetch\s*\(\s*["'`]https?:\/\/(?!localhost)/,        description: 'External fetch call in schema' },
  { regex: /XMLHttpRequest/,                                     description: 'XMLHttpRequest in schema' },
  { regex: /navigator\.sendBeacon/,                              description: 'sendBeacon in schema' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const LEVEL_ORDER = [ThreatLevel.SAFE, ThreatLevel.LOW, ThreatLevel.MEDIUM, ThreatLevel.HIGH, ThreatLevel.CRITICAL];

function _maxThreatLevel(threats) {
  if (!threats.length) return ThreatLevel.SAFE;
  return threats.reduce((max, t) => {
    return LEVEL_ORDER.indexOf(t.level) > LEVEL_ORDER.indexOf(max) ? t.level : max;
  }, ThreatLevel.SAFE);
}

function _sanitizePrompt(prompt) {
  // Remove the most dangerous patterns while preserving the legitimate intent
  let sanitized = prompt;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern.regex, '[REMOVED]');
  }
  return sanitized;
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const securityScanner = new SecurityScanner();
export default securityScanner;

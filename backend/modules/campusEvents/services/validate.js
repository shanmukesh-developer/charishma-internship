// Input validation for organizer event forms and student answers. Everything is cleaned + range-checked
// here; unknown keys are ignored. Organizer questions can never ask for ID numbers / phones / passwords.
const E = require('../enums');
const { fail, cleanText, num, parseTime, optTime, bool, money } = require('./util');

const L = E.LIMITS;
const FORBIDDEN_QUESTION_RE = /\b(aadhaar|aadhar|pan\s*(card|number)?|passport|password|otp|pin\s*code|phone|mobile|whatsapp|bank|account\s*number|ifsc|upi|card\s*number|cvv)\b/i;

const cleanQuestions = (raw) => {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw fail(400, 'INVALID_INPUT', 'questions must be a list.', { field: 'questions' });
  if (raw.length > L.QUESTIONS) throw fail(400, 'INVALID_INPUT', `At most ${L.QUESTIONS} questions.`, { field: 'questions' });
  const seen = new Set();
  return raw.map((q, i) => {
    const field = `questions[${i}]`;
    if (!q || typeof q !== 'object') throw fail(400, 'INVALID_INPUT', 'Each question needs a label and a type.', { field });
    const label = cleanText(q.label, L.QUESTION_LABEL);
    if (!label) throw fail(400, 'INVALID_INPUT', 'Each question needs a label.', { field });
    if (FORBIDDEN_QUESTION_RE.test(label)) throw fail(400, 'QUESTION_NOT_ALLOWED', 'Questions may not ask for ID numbers, phone numbers, bank or payment details. ZenWe already verified the student.', { field });
    const type = String(q.type || 'TEXT').toUpperCase();
    if (!E.QUESTION_TYPES.includes(type)) throw fail(400, 'INVALID_INPUT', `Question type must be one of ${E.QUESTION_TYPES.join(', ')}.`, { field });
    let id = cleanText(q.id, 24).replace(/[^A-Za-z0-9_-]/g, '') || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const out = { id, label, type, required: q.required !== false && bool(q.required === undefined ? true : q.required) };
    if (type === 'CHOICE' || type === 'MULTI_CHOICE') {
      const opts = (Array.isArray(q.options) ? q.options : []).map((o) => cleanText(o, 80)).filter(Boolean);
      if (opts.length < 2 || opts.length > L.OPTIONS) throw fail(400, 'INVALID_INPUT', `Choice questions need 2 to ${L.OPTIONS} options.`, { field });
      out.options = [...new Set(opts)];
    }
    if (type === 'TEXT' || type === 'LONG_TEXT') out.maxLength = num(q.maxLength, { min: 1, max: L.ANSWER, int: true, field }) || (type === 'TEXT' ? 200 : L.ANSWER);
    return out;
  });
};

/** Validates answers against the event's questions. Returns { [id]: value } (only known ids). */
const cleanAnswers = (questions, raw) => {
  const qs = Array.isArray(questions) ? questions : [];
  const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const q of qs) {
    const field = `answers.${q.id}`;
    const v = a[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (q.required) throw fail(400, 'ANSWER_REQUIRED', `Please answer: ${q.label}`, { field });
      continue;
    }
    switch (q.type) {
      case 'TEXT': case 'LONG_TEXT': {
        const s = cleanText(v, q.maxLength || L.ANSWER, { multiline: q.type === 'LONG_TEXT' });
        if (!s && q.required) throw fail(400, 'ANSWER_REQUIRED', `Please answer: ${q.label}`, { field });
        if (typeof v === 'string' && v.trim().length > (q.maxLength || L.ANSWER)) throw fail(400, 'INVALID_ANSWER', `Answer is too long (max ${q.maxLength || L.ANSWER} characters): ${q.label}`, { field });
        if (s) out[q.id] = s;
        break;
      }
      case 'NUMBER': out[q.id] = num(v, { min: -1e9, max: 1e9, field, label: q.label }); break;
      case 'YES_NO': {
        if (![true, false, 'true', 'false', 'yes', 'no'].includes(v)) throw fail(400, 'INVALID_ANSWER', `Answer yes or no: ${q.label}`, { field });
        out[q.id] = v === true || v === 'true' || v === 'yes';
        break;
      }
      case 'CHOICE': {
        if (!q.options.includes(String(v))) throw fail(400, 'INVALID_ANSWER', `Pick one of the options: ${q.label}`, { field });
        out[q.id] = String(v);
        break;
      }
      case 'MULTI_CHOICE': {
        const list = Array.isArray(v) ? v.map(String) : [String(v)];
        if (!list.every((x) => q.options.includes(x))) throw fail(400, 'INVALID_ANSWER', `Pick from the options: ${q.label}`, { field });
        out[q.id] = [...new Set(list)];
        break;
      }
      default: break;
    }
  }
  return out;
};

/** The questions as answered (id, label, type, options) stored on the registration with the answers. */
const questionsSnapshot = (questions) => (Array.isArray(questions) && questions.length
  ? questions.map((q) => ({ id: q.id, label: q.label, type: q.type, ...(Array.isArray(q.options) ? { options: q.options } : {}) }))
  : null);

/**
 * Answers with their labels, in question order: [{ id, label, type, value }]. Labels come from the snapshot
 * taken at registration (fallback: the event's current questions, for rows saved before snapshots); an
 * answer whose question is gone is still listed with its id as the label.
 */
const labelAnswers = (answers, snapshot, fallbackQuestions) => {
  const a = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const qs = Array.isArray(snapshot) && snapshot.length ? snapshot : (Array.isArray(fallbackQuestions) ? fallbackQuestions : []);
  const out = [];
  const seen = new Set();
  for (const q of qs) {
    if (!q || !Object.prototype.hasOwnProperty.call(a, q.id)) continue;
    seen.add(q.id);
    out.push({ id: q.id, label: q.label, type: q.type, value: a[q.id] });
  }
  for (const k of Object.keys(a)) if (!seen.has(k)) out.push({ id: k, label: k, type: null, value: a[k] });
  return out;
};

/** Rules acceptance: required whenever the event has rules; must match the current rulesVersion. */
const checkRules = (event, body) => {
  if (!event.rules || !String(event.rules).trim()) return Number(event.rulesVersion) || 1;
  const accepted = bool(body && body.acceptRules);
  const ver = Number(body && body.rulesVersion);
  if (!accepted) throw fail(400, 'RULES_NOT_ACCEPTED', 'Please read and accept the rules and cancellation terms.', { rulesVersion: Number(event.rulesVersion) || 1 });
  if (ver !== (Number(event.rulesVersion) || 1)) throw fail(409, 'RULES_CHANGED', 'The rules changed since you opened the event. Please review them again.', { rulesVersion: Number(event.rulesVersion) || 1 });
  return ver;
};

const listOf = (v, field, max, itemMax) => {
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v)) throw fail(400, 'INVALID_INPUT', `${field} must be a list.`, { field });
  return [...new Set(v.map((x) => cleanText(x, itemMax)).filter(Boolean))].slice(0, max);
};

/**
 * Cleans an organizer's create / edit body into model fields (only keys present in the body).
 * settings: readSettings() (price / capacity caps). Media is checked separately (services/media).
 */
const cleanEventInput = (body, settings) => {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (has('title')) { out.title = cleanText(b.title, L.TITLE); if (out.title.length < 3) throw fail(400, 'INVALID_INPUT', 'Give the event a title (3+ characters).', { field: 'title' }); }
  if (has('category')) {
    const c = String(b.category || '').toUpperCase();
    if (!E.CATEGORIES.includes(c)) throw fail(400, 'INVALID_INPUT', `Category must be one of ${E.CATEGORIES.join(', ')}.`, { field: 'category' });
    out.category = c;
  }
  if (has('tags')) out.tags = listOf(b.tags, 'tags', L.TAGS, 24);
  if (has('description')) out.description = cleanText(b.description, L.DESCRIPTION, { multiline: true });
  if (has('venue')) out.venue = cleanText(b.venue, L.VENUE);
  if (has('venueDirections')) out.venueDirections = cleanText(b.venueDirections, 500, { multiline: true });
  if (has('venueLat')) out.venueLat = num(b.venueLat, { min: -90, max: 90, field: 'venueLat', decimals: 6 });
  if (has('venueLon')) out.venueLon = num(b.venueLon, { min: -180, max: 180, field: 'venueLon', decimals: 6 });
  for (const k of ['startAt', 'endAt']) if (has(k)) out[k] = parseTime(b[k], k);
  for (const k of ['regOpensAt', 'regClosesAt', 'publishAt']) if (has(k)) out[k] = optTime(b[k], k);
  if (has('format')) {
    const f = String(b.format || '').toUpperCase();
    if (!Object.values(E.FORMAT).includes(f)) throw fail(400, 'INVALID_INPUT', 'Format must be INDIVIDUAL, SLOT or TEAM.', { field: 'format' });
    out.format = f;
  }
  if (has('capacity')) out.capacity = num(b.capacity, { min: 1, max: settings.maxCapacity, int: true, field: 'capacity' });
  if (has('maxTeams')) out.maxTeams = num(b.maxTeams, { min: 1, max: 1000, int: true, field: 'maxTeams' });
  if (has('teamMin')) out.teamMin = num(b.teamMin, { min: 1, max: L.ABSOLUTE_MAX_TEAM, int: true, field: 'teamMin' });
  if (has('teamMax')) out.teamMax = num(b.teamMax, { min: 1, max: L.ABSOLUTE_MAX_TEAM, int: true, field: 'teamMax' });
  for (const k of ['captainRequired', 'allowSubstitutions', 'multiTeamAllowed', 'attendancePerMember', 'approvalRequired', 'waitlistEnabled']) if (has(k)) out[k] = bool(b[k]);
  if (has('maxBookingsPerStudent')) out.maxBookingsPerStudent = num(b.maxBookingsPerStudent, { min: 1, max: 20, int: true, field: 'maxBookingsPerStudent' }) || 1;
  if (has('minParticipants')) out.minParticipants = num(b.minParticipants, { min: 0, max: settings.maxCapacity, int: true, field: 'minParticipants' });
  if (has('priceType')) {
    const p = String(b.priceType || '').toUpperCase();
    if (!Object.values(E.PRICE_TYPE).includes(p)) throw fail(400, 'INVALID_INPUT', 'priceType must be FREE or PAID.', { field: 'priceType' });
    out.priceType = p;
  }
  if (has('price')) out.price = num(b.price, { min: 0, max: settings.maxPrice, field: 'price' }) || 0;
  if (has('extraCharges')) {
    if (b.extraCharges !== null && !Array.isArray(b.extraCharges)) throw fail(400, 'INVALID_INPUT', 'extraCharges must be a list.', { field: 'extraCharges' });
    out.extraCharges = (b.extraCharges || []).slice(0, 5).map((c, i) => ({
      label: cleanText(c && c.label, 60) || `Charge ${i + 1}`,
      amount: num(c && c.amount, { min: 0, max: settings.maxPrice, field: `extraCharges[${i}].amount` }) || 0,
    }));
  }
  if (has('paymentModes')) {
    const list = (Array.isArray(b.paymentModes) ? b.paymentModes : []).map((m) => String(m).toUpperCase());
    if (!list.length || !list.every((m) => E.PAID_MODES.includes(m))) throw fail(400, 'INVALID_INPUT', 'paymentModes must list VENUE, WALLET and / or ONLINE.', { field: 'paymentModes' });
    out.paymentModes = [...new Set(list)];
  }
  if (has('eligibility')) {
    const el = b.eligibility && typeof b.eligibility === 'object' ? b.eligibility : {};
    out.eligibility = {
      years: (Array.isArray(el.years) ? el.years : []).map(Number).filter((y) => Number.isInteger(y) && y >= 1 && y <= 6),
      branches: (Array.isArray(el.branches) ? el.branches : []).map((x) => cleanText(x, 30).toUpperCase()).filter(Boolean).slice(0, 30),
      adultOnly: bool(el.adultOnly),
    };
  }
  if (has('rules')) out.rules = cleanText(b.rules, L.RULES, { multiline: true });
  if (has('questions')) out.questions = cleanQuestions(b.questions);
  if (has('equipment')) out.equipment = cleanText(b.equipment, L.TEXT, { multiline: true });
  if (has('contactText')) {
    out.contactText = cleanText(b.contactText, 300);
  }
  if (has('instructions')) out.instructions = cleanText(b.instructions, L.TEXT, { multiline: true });
  if (has('cancellationPolicy')) {
    const c = b.cancellationPolicy && typeof b.cancellationPolicy === 'object' ? b.cancellationPolicy : {};
    out.cancellationPolicy = {
      userCancelUntilHours: c.userCancelUntilHours === undefined || c.userCancelUntilHours === null || c.userCancelUntilHours === '' ? null : num(c.userCancelUntilHours, { min: 0, max: 720, int: true, field: 'cancellationPolicy.userCancelUntilHours' }),
      refundPct: c.refundPct === undefined || c.refundPct === null || c.refundPct === '' ? null : num(c.refundPct, { min: 0, max: 100, int: true, field: 'cancellationPolicy.refundPct' }),
      text: cleanText(c.text, 500, { multiline: true }),
    };
  }
  if (has('entryOpensBeforeMin')) out.entryOpensBeforeMin = num(b.entryOpensBeforeMin, { min: 0, max: 1440, int: true, field: 'entryOpensBeforeMin' });
  if (has('waitlistOfferMinutes')) out.waitlistOfferMinutes = num(b.waitlistOfferMinutes, { min: 10, max: 1440, int: true, field: 'waitlistOfferMinutes' });
  return out;
};

/** Whole-event consistency (merged current + changes). Used on create, edit and submit. */
const checkEventShape = (ev, { forSubmit = false } = {}) => {
  const req = (k, label) => { if (ev[k] === undefined || ev[k] === null || ev[k] === '') throw fail(400, 'INCOMPLETE', `Add ${label} before submitting.`, { field: k }); };
  if (forSubmit) {
    req('title', 'a title'); req('venue', 'the venue'); req('startAt', 'the start time'); req('endAt', 'the end time'); req('description', 'a description');
  }
  if (ev.startAt && ev.endAt && new Date(ev.endAt).getTime() <= new Date(ev.startAt).getTime()) throw fail(400, 'INVALID_INPUT', 'The event must end after it starts.', { field: 'endAt' });
  if (ev.regOpensAt && ev.regClosesAt && new Date(ev.regClosesAt).getTime() <= new Date(ev.regOpensAt).getTime()) throw fail(400, 'INVALID_INPUT', 'Registration must close after it opens.', { field: 'regClosesAt' });
  if (ev.regClosesAt && ev.endAt && new Date(ev.regClosesAt).getTime() > new Date(ev.endAt).getTime()) throw fail(400, 'INVALID_INPUT', 'Registration must close before the event ends.', { field: 'regClosesAt' });
  if (ev.format === E.FORMAT.TEAM) {
    if (forSubmit) { req('maxTeams', 'the number of teams'); req('teamMin', 'the minimum team size'); req('teamMax', 'the maximum team size'); }
    if (ev.teamMin && ev.teamMax && ev.teamMin > ev.teamMax) throw fail(400, 'INVALID_INPUT', 'Minimum team size cannot be more than the maximum.', { field: 'teamMin' });
  } else if (ev.format === E.FORMAT.INDIVIDUAL && forSubmit) req('capacity', 'the capacity');
  if (ev.priceType === E.PRICE_TYPE.PAID) {
    if (forSubmit && !(money(ev.price) > 0)) throw fail(400, 'INCOMPLETE', 'A paid event needs a price above ₹0 (or make it FREE).', { field: 'price' });
    if (forSubmit && (!Array.isArray(ev.paymentModes) || !ev.paymentModes.length)) throw fail(400, 'INCOMPLETE', 'Choose how students pay.', { field: 'paymentModes' });
  }
};

module.exports = { questionsSnapshot, labelAnswers, cleanQuestions, cleanAnswers, checkRules, cleanEventInput, checkEventShape };

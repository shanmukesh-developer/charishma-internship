// Allowed values for Tasks status / kind columns. migrations/tasks.js builds Postgres CHECKs from these.
module.exports = {
  CATEGORIES: ['tutoring', 'notes_printouts', 'project_help', 'design_media', 'coding_help', 'errands', 'other'],
  CATEGORY_LABELS: {
    tutoring: 'Tutoring & doubts',
    notes_printouts: 'Notes & printouts',
    project_help: 'Project help',
    design_media: 'Design, presentations & video',
    coding_help: 'Coding help',
    errands: 'Errands & deliveries',
    other: 'Other',
  },
  // Lifecycle (the only values a task row can hold). "Application received" and "Mutual reviews" are
  // display stages derived from open + applicationCount and completed + reviews (see stageOf).
  TASK_STATUS: ['open', 'assigned', 'in_progress', 'submitted', 'completed', 'cancelled', 'expired', 'disputed'],
  ACTIVE_STATUS: ['open', 'assigned', 'in_progress', 'submitted', 'disputed'],
  TERMINAL_STATUS: ['completed', 'cancelled', 'expired'],
  // Moderation state, separate from the lifecycle. 'rejected' = refused by the academic-integrity
  // check (kept as evidence and so the poster can appeal; never shown to anyone else).
  MOD_STATUS: ['visible', 'pending_review', 'hidden', 'removed', 'rejected'],
  FULFILLMENT: ['online', 'on_campus', 'either'],
  APPLICATION_STATUS: ['pending', 'selected', 'accepted', 'rejected', 'withdrawn', 'declined'],
  ONE_HELPER_STATUS: ['selected', 'accepted'], // fta_one_active: at most one per task
  DISPUTE_OUTCOMES: ['completed', 'cancelled', 'in_progress'],

  TITLE_MIN: 5,
  TITLE_MAX: 100,
  DESCRIPTION_MIN: 20,
  DESCRIPTION_MAX: 2000,
  REWARD_MIN: 0,
  REWARD_MAX: 50000,
  MAX_SKILLS: 8,
  SKILL_MAX: 30,
  AREA_HINT_MAX: 60,
  MAX_MEDIA: 4,
  NOTE_MAX: 500,
  REASON_MAX: 500,
  REVIEW_TEXT_MAX: 500,
  DEADLINE_MIN_MINUTES: 30,
  DEADLINE_MAX_DAYS: 90,
  MAX_SUBMISSION_REJECTIONS: 3,
  REVIEW_WINDOW_DAYS: 30,
  CHAT_OPEN_DAYS_AFTER_COMPLETION: 7,

  // Exact text from the owner's spec (section 8). Tests compare it character for character.
  PAYMENT_NOTICE: 'ZenWe does not collect, hold, escrow, or guarantee payments between students. Any payment is arranged directly between the participating users. Verify the recipient and amount before making a payment.',
};

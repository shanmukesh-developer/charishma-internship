const { Op } = require('sequelize');
const crypto = require('crypto');
const {
  getWhisperModel,
  getDailyQuestionModel,
  getQuestionAnswerModel,
  getCampusEventModel,
  getMessMenuModel,
  getCampusProfileModel,
} = require('../models');
const { getMessageModel } = require('../../../models/Message');
const { getConversationModel } = require('../../../models/Conversation');

const WHISPER_TOPICS = ['Hostels', 'Academics', 'Canteen', 'Crushes', 'Late Night', 'General'];

const ADJECTIVES = ['Silent', 'Mystic', 'Midnight', 'Secret', 'Wandering', 'Cosmic', 'Velvet', 'Hidden', 'Golden', 'Restless'];
const NOUNS = ['Falcon', 'Koala', 'Panda', 'Otter', 'Fox', 'Tiger', 'Dolphin', 'Owl', 'Comet', 'Wolf'];

// Deterministic anonymous alias derived from userId — stable but detached from identity.
// Keyed with a server secret: a plain hash of the user id let anyone who saw an account id (people
// search, proximity messages, rides) recompute the alias and unmask that person's whispers / answers.
const ALIAS_KEY = () => process.env.WHISPER_ALIAS_SECRET || process.env.JWT_SECRET || 'zenvy-whisper-alias';
const aliasFor = (userId) => {
  const h = crypto.createHmac('sha256', ALIAS_KEY()).update(`whisper:${String(userId)}`).digest();
  const adj = ADJECTIVES[h[0] % ADJECTIVES.length];
  const noun = NOUNS[h[1] % NOUNS.length];
  const num = h[2] % 90 + 10;
  return `${adj} ${noun}${num}`;
};

// Campus days follow India Standard Time (Render runs in UTC).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayStr = (d = new Date()) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// Start / end of the IST calendar day containing d, as real instants.
const dayBounds = (d = new Date()) => {
  const start = new Date(`${todayStr(d)}T00:00:00.000+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
};

// The 9 PM question takes answers only on its own IST day, inside its opensAt/closesAt window.
const questionWindow = (question, now = new Date()) => {
  const isToday = String(question.promptDate) === todayStr(now);
  const opensAt = question.opensAt ? new Date(question.opensAt) : null;
  const closesAt = question.closesAt ? new Date(question.closesAt) : null;
  const isOpen = isToday && (!opensAt || now >= opensAt) && (!closesAt || now <= closesAt);
  return { isToday, isOpen, opensAt, closesAt };
};

// ── Today on Campus (real mess menu + real events) ───────────────────────────
// @route GET /api/campus/pulse/today
const getToday = async (req, res) => {
  try {
    const MessMenu = getMessMenuModel();
    const CampusEvent = getCampusEventModel();
    const date = todayStr();
    const { start, end } = dayBounds();

    const [menuRows, eventRows] = await Promise.all([
      MessMenu.findAll({ where: { menuDate: date } }),
      CampusEvent.findAll({
        where: { startsAt: { [Op.between]: [start, end] } },
        order: [['startsAt', 'ASC']],
      }),
    ]);

    const mess = {};
    for (const m of menuRows) mess[m.meal] = m.items;

    const events = eventRows.map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      category: e.category,
      description: e.description,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
    }));

    res.json({ date, mess, events });
  } catch (err) {
    console.error('[PULSE_TODAY_ERR]', err);
    res.status(500).json({ message: 'Failed to load today on campus' });
  }
};

// ── The 9 PM Question (real daily question + answers) ────────────────────────
// @route GET /api/campus/pulse/question
const getDailyQuestion = async (req, res) => {
  try {
    const DailyQuestion = getDailyQuestionModel();
    const QuestionAnswer = getQuestionAnswerModel();

    let question = await DailyQuestion.findOne({ where: { promptDate: todayStr() } });
    if (!question) {
      question = await DailyQuestion.findOne({ order: [['promptDate', 'DESC']] });
    }
    if (!question) return res.json({ question: null, answers: [], answerCount: 0, iAnswered: false });

    const rows = await QuestionAnswer.findAll({
      where: { questionId: question.id },
      order: [['createdAt', 'DESC']],
      limit: 200,
    });

    const uid = req.user.id;
    const answers = rows.map((a) => {
      const ups = a.upvotes || [];
      return {
        id: a.id,
        alias: a.alias,
        answer: a.answer,
        upvotes: ups.length,
        iUpvoted: ups.includes(uid),
        createdAt: a.createdAt,
      };
    });

    const win = questionWindow(question);
    const answerCount = await QuestionAnswer.count({ where: { questionId: question.id } });
    const iAnswered = rows.some((a) => a.userId === uid)
      || (answerCount > rows.length && !!(await QuestionAnswer.findOne({ where: { questionId: question.id, userId: uid }, attributes: ['id'] })));
    res.json({
      question: {
        id: question.id,
        question: question.question,
        promptDate: question.promptDate,
        opensAt: win.opensAt,
        closesAt: win.closesAt,
        isToday: win.isToday,
        isOpen: win.isOpen,
      },
      answers,
      answerCount,
      iAnswered,
    });
  } catch (err) {
    console.error('[PULSE_QUESTION_ERR]', err);
    res.status(500).json({ message: 'Failed to load the daily question' });
  }
};

// @route POST /api/campus/pulse/question/answer
const answerDailyQuestion = async (req, res) => {
  try {
    const { answer } = req.body;
    if (!answer || !answer.trim()) return res.status(400).json({ message: 'Write your answer first' });
    if (answer.trim().length > 500) return res.status(400).json({ message: 'Keep it under 500 characters' });

    const DailyQuestion = getDailyQuestionModel();
    const QuestionAnswer = getQuestionAnswerModel();

    let question = await DailyQuestion.findOne({ where: { promptDate: todayStr() } });
    if (!question) question = await DailyQuestion.findOne({ order: [['promptDate', 'DESC']] });
    if (!question) return res.status(404).json({ message: 'No active question tonight' });
    const win = questionWindow(question);
    if (!win.isOpen) {
      const opensMsg = win.isToday && win.opensAt && new Date() < win.opensAt
        ? `Answers open at ${win.opensAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`
        : "Tonight's question is closed. A new one drops soon!";
      return res.status(403).json({ code: 'QUESTION_CLOSED', message: opensMsg, opensAt: win.opensAt, closesAt: win.closesAt });
    }

    const uid = req.user.id;
    const existing = await QuestionAnswer.findOne({ where: { questionId: question.id, userId: uid } });
    if (existing) return res.status(409).json({ message: 'You already answered tonight' });

    // C2: same rules as whispers for these anonymous answers (sanctions, slurs / threats, masking).
    const guard = await require('../../friends/services/ugc').postGuard(uid);
    if (guard) return res.status(guard.status).json(guard.body);
    const filtered = require('../../../utils/contentFilter').analyse(answer.trim());
    if (filtered.action === 'block') return require('../../../utils/contentFilter').rejectBlocked(res, 'answer');
    const created = await QuestionAnswer.create({
      questionId: question.id,
      userId: uid,
      alias: aliasFor(uid),
      answer: filtered.text,
      upvotes: [uid],
    });

    const count = await QuestionAnswer.count({ where: { questionId: question.id } });
    res.status(201).json({
      message: 'Answer submitted anonymously',
      answer: {
        id: created.id,
        alias: created.alias,
        answer: created.answer,
        upvotes: 1,
        iUpvoted: true,
        createdAt: created.createdAt,
      },
      answerCount: count,
    });
  } catch (err) {
    console.error('[PULSE_ANSWER_ERR]', err);
    res.status(500).json({ message: 'Failed to submit answer' });
  }
};

// @route POST /api/campus/pulse/question/answer/:id/upvote
const upvoteAnswer = async (req, res) => {
  try {
    const QuestionAnswer = getQuestionAnswerModel();
    const row = await QuestionAnswer.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Answer not found' });

    const uid = req.user.id;
    const ups = row.upvotes || [];
    const has = ups.includes(uid);
    row.upvotes = has ? ups.filter((x) => x !== uid) : [...ups, uid];
    await row.save();

    res.json({ id: row.id, upvotes: row.upvotes.length, iUpvoted: !has });
  } catch (err) {
    console.error('[PULSE_UPVOTE_ERR]', err);
    res.status(500).json({ message: 'Failed to upvote' });
  }
};

// ── Campus Whispers (real anonymous feed) ────────────────────────────────────
// @route GET /api/campus/pulse/whispers
const getWhispers = async (req, res) => {
  try {
    const Whisper = getWhisperModel();
    const where = {};
    const topic = req.query.topic;
    if (topic && topic !== 'All' && WHISPER_TOPICS.includes(topic)) where.topic = topic;

    let rows = await Whisper.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
    const uid = req.user.id;
    // C2: moderated (hidden / pending review / removed) whispers are left out. The author id is used on the
    // server only and never sent. Blocks are NOT applied here (31 Oct 2026): a whisper's alias is the same for
    // all of one person's whispers, so hiding a blocked author's whispers let anyone unmask an author by
    // blocking a suspect and watching that alias disappear. Same rule as the Friends Pulse feed: blocks filter
    // named content only. An unwanted whisper is reported / hidden like any other.
    const ugc = require('../../friends/services/ugc');
    rows = await ugc.filterVisible('whisper', rows);
    const whispers = rows.map((w) => {
      const hearts = w.hearts || [];
      return {
        id: w.id,
        alias: w.alias,
        topic: w.topic,
        text: w.text,
        hearts: hearts.length,
        iHearted: hearts.includes(uid),
        createdAt: w.createdAt,
      };
    });
    res.json({ whispers, topics: WHISPER_TOPICS });
  } catch (err) {
    console.error('[PULSE_WHISPERS_ERR]', err);
    res.status(500).json({ message: 'Failed to load whispers' });
  }
};

// @route POST /api/campus/pulse/whispers
const createWhisper = async (req, res) => {
  try {
    const { text, topic } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Write your whisper first' });
    if (text.trim().length > 400) return res.status(400).json({ message: 'Keep it under 400 characters' });
    const safeTopic = WHISPER_TOPICS.includes(topic) ? topic : 'General';

    // Anonymous posting is for verified students only (the app promises this on the verify banner).
    const profile = await getCampusProfileModel().findOne({ where: { userId: req.user.id }, attributes: ['verificationStatus'] });
    if (profile?.verificationStatus !== 'verified' && String(req.user.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({
        code: 'VERIFICATION_REQUIRED',
        message: 'Verify your student ID to post whispers. It keeps anonymous posts safe for everyone.'
      });
    }

    const Whisper = getWhisperModel();
    const uid = req.user.id;
    // C2: sanctioned authors cannot post, per-user limits (DB counts), slurs / threats refused, profanity masked.
    const ugc = require('../../friends/services/ugc');
    const guard = await ugc.postGuard(uid);
    if (guard) return res.status(guard.status).json(guard.body);
    if (String(req.user.role || '').toLowerCase() !== 'admin') {
      const limited = await ugc.checkRate('whisper', (since) => Whisper.count({ where: { userId: uid, createdAt: { [Op.gte]: since } } }));
      if (limited) {
        res.set('Retry-After', String(limited.body.retryAfter));
        return res.status(limited.status).json(limited.body);
      }
    }
    const filter = require('../../../utils/contentFilter').analyse(text.trim());
    if (filter.action === 'block') return require('../../../utils/contentFilter').rejectBlocked(res, 'text');
    const created = await Whisper.create({
      userId: uid,
      alias: aliasFor(uid),
      topic: safeTopic,
      text: filter.text,
      hearts: [uid],
    });

    res.status(201).json({
      message: 'Whisper posted anonymously',
      whisper: {
        id: created.id,
        alias: created.alias,
        topic: created.topic,
        text: created.text,
        hearts: 1,
        iHearted: true,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    console.error('[PULSE_CREATE_WHISPER_ERR]', err);
    res.status(500).json({ message: 'Failed to post whisper' });
  }
};

// @route POST /api/campus/pulse/whispers/:id/react
const reactWhisper = async (req, res) => {
  try {
    const Whisper = getWhisperModel();
    const row = await Whisper.findByPk(req.params.id);
    if (!row || await require('../../friends/services/ugc').isHidden('whisper', row.id)) return res.status(404).json({ message: 'Whisper not found' });

    const uid = req.user.id;
    const hearts = row.hearts || [];
    const has = hearts.includes(uid);
    row.hearts = has ? hearts.filter((x) => x !== uid) : [...hearts, uid];
    await row.save();

    res.json({ id: row.id, hearts: row.hearts.length, iHearted: !has });
  } catch (err) {
    console.error('[PULSE_REACT_ERR]', err);
    res.status(500).json({ message: 'Failed to react' });
  }
};

// ── Branch Wars (computed from REAL campus activity) ─────────────────────────
// @route GET /api/campus/pulse/branch-wars
const getBranchLeaderboard = async (req, res) => {
  try {
    const CampusProfile = getCampusProfileModel();
    const Message = getMessageModel();

    // Scoped to the caller's campus; only students who set their branch themselves are counted.
    const me = await CampusProfile.findOne({ where: { userId: req.user.id }, attributes: ['campusId'] });
    const profileWhere = { branch: { [Op.ne]: null } };
    if (me?.campusId) profileWhere.campusId = me.campusId;
    const profiles = await CampusProfile.findAll({
      where: profileWhere,
      attributes: ['userId', 'branch'],
    });

    const branchOf = {};
    const members = {};
    for (const p of profiles) {
      const b = (p.branch || '').trim().toUpperCase();
      if (!b) continue;
      branchOf[p.userId] = b;
      members[b] = (members[b] || 0) + 1;
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let messages = [];
    if (Message) {
      // Only campus group chats (classes, clubs, rides) count, not private friend DMs or friend groups.
      const campusGroups = await getConversationModel().findAll({
        where: { isGroup: true, type: { [Op.in]: ['class', 'club', 'ride', 'secret'] } },
        attributes: ['id'],
        raw: true,
      });
      const groupIds = campusGroups.map((c) => c.id);
      const senderIds = Object.keys(branchOf);
      if (groupIds.length && senderIds.length) {
        messages = await Message.findAll({
          where: {
            createdAt: { [Op.gte]: weekAgo },
            conversationId: { [Op.in]: groupIds },
            senderId: { [Op.in]: senderIds },
          },
          attributes: ['senderId'],
          raw: true,
        });
      }
    }

    const msgCount = {};
    const activeSet = {};
    for (const m of messages) {
      const b = branchOf[m.senderId];
      if (!b) continue;
      msgCount[b] = (msgCount[b] || 0) + 1;
      (activeSet[b] = activeSet[b] || new Set()).add(m.senderId);
    }

    const branches = Object.keys(members).map((code) => {
      const msgs = msgCount[code] || 0;
      const mem = members[code] || 0;
      const active = activeSet[code] ? activeSet[code].size : 0;
      return {
        code,
        members: mem,
        activeMembers: active,
        messagesThisWeek: msgs,
        points: msgs * 10 + mem * 25 + active * 15,
      };
    });

    branches.sort((a, b) => b.points - a.points);
    const standings = branches.map((b, i) => ({ ...b, rank: i + 1 }));

    res.json({
      standings,
      userBranch: (() => {
        const uid = req.user.id;
        return branchOf[uid] || null;
      })(),
      window: { since: weekAgo, label: 'Last 7 days of real campus activity' },
    });
  } catch (err) {
    console.error('[PULSE_BRANCH_ERR]', err);
    res.status(500).json({ message: 'Failed to load branch standings' });
  }
};

module.exports = {
  getToday,
  getDailyQuestion,
  answerDailyQuestion,
  upvoteAnswer,
  getWhispers,
  createWhisper,
  reactWhisper,
  getBranchLeaderboard,
  WHISPER_TOPICS,
};

const { getCampusPollModel } = require('../models/CampusPoll');
const { requireMember, sendAccessError } = require('../membership');

const pollLocks = new Map(); // pollId -> tail promise
const withPollLock = (id, fn) => {
  const key = String(id);
  const prev = pollLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  pollLocks.set(key, tail);
  tail.then(() => { if (pollLocks.get(key) === tail) pollLocks.delete(key); });
  return run;
};

// Anonymous polls never reveal who voted for what: every other voter's id becomes 'anonymous', so
// option counts (array length) and "did I vote for this" (includes(myId)) keep working in the apps.
const ANON_VOTER = 'anonymous';
// Connect chats hide who is who (account ids / real names): every other person's id in a poll (creator, voters)
// becomes their Connect alias, the same masking the chat history and socket events use (connectChatIdentity).
// `ident` = identityFor(conversation): null for ordinary chats (nothing changes).
const { identityFor, maskFor } = require('../../friends/services/connectChatIdentity');
const publicPoll = (poll, viewerId, ident = null) => {
  const json = typeof poll.toJSON === 'function' ? poll.toJSON() : { ...poll };
  const votes = poll.votes || {};
  const out = {};
  const counts = {};
  for (const [k, list] of Object.entries(votes)) {
    const arr = Array.isArray(list) ? list : [];
    counts[k] = arr.length;
    out[k] = poll.isAnonymous ? arr.map((uid) => (String(uid) === String(viewerId) ? uid : ANON_VOTER)) : arr;
  }
  json.votes = out;
  json.voteCounts = counts;
  return ident ? maskFor(json, viewerId, ident) : json;
};

// @desc    Create a poll in a conversation
// @route   POST /api/campus/polls
const createPoll = async (req, res) => {
  try {
    const { conversationId, question, options, isMulti, isAnonymous } = req.body;
    if (!conversationId || !question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ message: 'Conversation, question, and at least 2 options are required' });
    }
    const cleanOptions = options.map((o) => String(o).trim()).filter(Boolean);
    if (typeof question !== 'string' || !question.trim() || question.length > 200) {
      return res.status(400).json({ message: 'Please keep the question under 200 characters.' });
    }
    if (cleanOptions.length < 2 || cleanOptions.length > 10 || cleanOptions.some((o) => o.length > 100)) {
      return res.status(400).json({ message: 'Polls need 2 to 10 options of up to 100 characters each.' });
    }
    const { conversation } = await requireMember(conversationId, req.user);
    const ident = await identityFor(conversation);

    // C2: slurs / threats in the question or an option are refused, profanity masked.
    const cf = require('../../../utils/contentFilter');
    const fields = { question: question.trim() };
    cleanOptions.forEach((o, i) => { fields[`option${i}`] = o; });
    const text = cf.cleanFields(fields);
    if (text.blocked) return cf.rejectBlocked(res, text.field.startsWith('option') ? 'options' : text.field);

    const CampusPoll = getCampusPollModel();
    const poll = await CampusPoll.create({
      conversationId,
      creatorId: req.user.id,
      question: text.values.question,
      options: cleanOptions.map((o, i) => text.values[`option${i}`]),
      isMulti: !!isMulti,
      isAnonymous: !!isAnonymous,
      votes: {},
    });

    res.status(201).json({ message: 'Poll created', poll: publicPoll(poll, req.user.id, ident) });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[CREATE_POLL_ERR]', err);
    res.status(500).json({ message: 'Failed to create poll' });
  }
};

// @desc    List polls for a conversation
// @route   GET /api/campus/polls/:conversationId
const getPolls = async (req, res) => {
  try {
    const { conversation } = await requireMember(req.params.conversationId, req.user);
    const ident = await identityFor(conversation);
    const CampusPoll = getCampusPollModel();
    let polls = await CampusPoll.findAll({
      where: { conversationId: req.params.conversationId },
      order: [['createdAt', 'DESC']],
    });
    // C2: moderated polls and polls by people blocked either way are left out.
    const ugc = require('../../friends/services/ugc');
    polls = await ugc.filterVisible('poll', polls);
    const blocked = await ugc.blockedIds(req.user.id);
    if (blocked.size) polls = polls.filter((p) => !blocked.has(String(p.creatorId)));
    res.json({ polls: polls.map((p) => publicPoll(p, req.user.id, ident)) });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[GET_POLLS_ERR]', err);
    res.status(500).json({ message: 'Failed to load polls' });
  }
};

// @desc    Cast a vote on a poll
// @route   POST /api/campus/polls/:id/vote
const votePoll = async (req, res) => {
  try {
    const { optionIndexes } = req.body;
    const CampusPoll = getCampusPollModel();
    const found = await CampusPoll.findByPk(req.params.id);
    if (!found || await require('../../friends/services/ugc').isHidden('poll', found.id)) return res.status(404).json({ message: 'Poll not found' });
    const { conversation } = await requireMember(found.conversationId, req.user);
    if (found.expiresAt && new Date(found.expiresAt).getTime() < Date.now()) return res.status(400).json({ message: 'Poll is closed' });

    // De-duplicated: [0,0,0] on a multi-select poll counts once.
    const idxs = [...new Set((Array.isArray(optionIndexes) ? optionIndexes : [optionIndexes])
      .map((i) => parseInt(i, 10))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < found.options.length))];
    if (!idxs.length) return res.status(400).json({ message: 'Invalid option' });

    const userId = req.user.id;
    const chosen = found.isMulti ? idxs : [idxs[0]];
    // Read-modify-write of the votes JSON, serialised per poll in this process and under a row lock in
    // the database, so two members voting at once both count.
    const poll = await withPollLock(found.id, () => CampusPoll.sequelize.transaction(async (t) => {
      const row = await CampusPoll.findByPk(found.id, { transaction: t, lock: t.LOCK.UPDATE });
      const votes = row.votes || {};
      // Remove the user's previous votes, then apply the new selection.
      for (const key of Object.keys(votes)) {
        votes[key] = (votes[key] || []).filter((uid) => uid !== userId);
      }
      for (const i of chosen) {
        votes[String(i)] = [...(votes[String(i)] || []), userId];
      }
      row.votes = votes;
      await row.save({ transaction: t });
      return row;
    }));

    res.json({ message: 'Vote recorded', poll: publicPoll(poll, req.user.id, await identityFor(conversation)) });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[VOTE_POLL_ERR]', err);
    res.status(500).json({ message: 'Failed to vote' });
  }
};

module.exports = { createPoll, getPolls, votePoll, publicPoll };

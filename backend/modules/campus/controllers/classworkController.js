const { getClassAssignmentModel } = require('../models/ClassAssignment');
const { getClassSubmissionModel } = require('../models/ClassSubmission');
const { getFacultyAnnouncementModel } = require('../models/FacultyAnnouncement');
const { getConversationModel } = require('../../../models/Conversation');
const { Op } = require('sequelize');
const { requireMember, requireTeachingMember, sendAccessError } = require('../membership');

// @desc    Assignments across all groups the current user belongs to, with their own submission status
// @route   GET /api/campus/assignments
const getMyAssignments = async (req, res) => {
  try {
    const Conversation = getConversationModel();
    const ClassAssignment = getClassAssignmentModel();
    const ClassSubmission = getClassSubmissionModel();
    const uid = req.user.id;

    const groups = await Conversation.findAll({
      where: { isGroup: true, participants: { [Op.like]: `%${uid}%` } },
      attributes: ['id', 'name', 'participants'],
    });
    const myGroups = groups.filter((g) => (g.participants || []).includes(uid));
    const groupName = {};
    const convIds = myGroups.map((g) => { groupName[g.id] = g.name; return g.id; });

    if (convIds.length === 0) return res.json({ assignments: [] });

    const rows = await ClassAssignment.findAll({
      where: { conversationId: { [Op.in]: convIds } },
      include: ClassSubmission ? [{ model: ClassSubmission, as: 'submissions' }] : [],
      order: [['dueDate', 'ASC']],
    });

    const assignments = rows.map((a) => {
      const mine = (a.submissions || []).find((s) => s.studentId === uid);
      const json = a.get({ plain: true });
      delete json.submissions;
      return {
        ...json,
        groupName: groupName[a.conversationId] || null,
        mySubmission: mine
          ? { status: mine.status, turnedInAt: mine.turnedInAt, submissionText: mine.submissionText, fileUrl: mine.fileUrl, grade: mine.grade }
          : null,
      };
    });

    res.json({ assignments });
  } catch (err) {
    console.error('[GET_MY_ASSIGNMENTS_ERR]', err);
    res.status(500).json({ message: 'Failed to fetch your assignments' });
  }
};

// @desc    Create a new assignment (Faculty / CR)
// @route   POST /api/campus/assignments
const createAssignment = async (req, res) => {
  try {
    const { conversationId, title, instructions, topic, points, dueDate, attachments } = req.body;
    if (!conversationId || !title || !dueDate) {
      return res.status(400).json({ message: 'Conversation, title, and due date are required' });
    }
    await requireTeachingMember(conversationId, req.user);

    const ClassAssignment = getClassAssignmentModel();
    const assignment = await ClassAssignment.create({
      conversationId,
      facultyId: req.user.id,
      facultyName: req.user.name,
      title: title.trim(),
      instructions: instructions || '',
      topic: topic || 'General',
      points: points || 100,
      dueDate: new Date(dueDate),
      attachments: attachments || [],
    });

    res.status(201).json({
      message: 'Assignment created successfully',
      assignment,
    });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[CREATE_ASSIGNMENT_ERR]', err);
    res.status(500).json({ message: 'Failed to create assignment' });
  }
};

// @desc    Get assignments for a class
// @route   GET /api/campus/assignments/:conversationId
const getAssignments = async (req, res) => {
  try {
    const ClassAssignment = getClassAssignmentModel();
    const ClassSubmission = getClassSubmissionModel();

    const { isGroupAdmin } = await requireMember(req.params.conversationId, req.user);

    const assignments = await ClassAssignment.findAll({
      where: { conversationId: req.params.conversationId },
      include: ClassSubmission ? [{ model: ClassSubmission, as: 'submissions' }] : [],
      order: [['dueDate', 'ASC']],
    });

    // Students see only their own submission; the class admin / author sees everyone's.
    res.json(assignments.map((a) => {
      const json = a.get({ plain: true });
      if (!isGroupAdmin && json.facultyId !== req.user.id) {
        json.submissions = (json.submissions || []).filter((s) => s.studentId === req.user.id);
      }
      return json;
    }));
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[GET_ASSIGNMENTS_ERR]', err);
    res.status(500).json({ message: 'Failed to fetch assignments' });
  }
};

// @desc    Submit / turn in an assignment (Student)
// @route   POST /api/campus/assignments/:id/submit
const submitAssignment = async (req, res) => {
  try {
    const { submissionText } = req.body || {};
    // S0: fileUrl must be our own media link (a private one only when it is the student's own upload)
    // or a plain https link (GitHub / Drive, what the app's "paste a link" field sends). No other schemes
    // (javascript:, data:, http:), nothing over 2048 characters.
    let fileUrl = req.body ? req.body.fileUrl : undefined;
    if (fileUrl !== undefined && fileUrl !== null && fileUrl !== '') {
      const v = typeof fileUrl === 'string' ? fileUrl.trim() : '';
      const { mediaIdOf, publicBase } = require('../../../utils/imageStore');
      const mid = mediaIdOf(v);
      if (mid) {
        if (!(await require('../../../utils/mediaAccess').mayAttach(v, req.user.id))) {
          return res.status(400).json({ code: 'BAD_FILE_URL', message: 'Attach your own upload or an https link.' });
        }
        fileUrl = `${publicBase(req)}/api/campus/media/${mid}`;
      } else if (/^https:\/\/[^\s"'<>]{3,2040}$/i.test(v) && v.length <= 2048) {
        fileUrl = v;
      } else {
        return res.status(400).json({ code: 'BAD_FILE_URL', message: 'Links should start with https://' });
      }
    } else {
      fileUrl = undefined;
    }
    if (submissionText !== undefined && submissionText !== null && typeof submissionText !== 'string') {
      return res.status(400).json({ message: 'Your answer must be text.' });
    }
    const ClassAssignment = getClassAssignmentModel();
    const ClassSubmission = getClassSubmissionModel();

    const assignment = await ClassAssignment.findByPk(req.params.id);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    await requireMember(assignment.conversationId, req.user);

    const isLate = new Date() > new Date(assignment.dueDate);

    let submission = await ClassSubmission.findOne({
      where: {
        assignmentId: assignment.id,
        studentId: req.user.id,
      }
    });

    if (submission) {
      // Update submission
      await submission.update({
        submissionText: submissionText || submission.submissionText,
        fileUrl: fileUrl || submission.fileUrl,
        turnedInAt: new Date(),
        status: isLate ? 'late' : 'turned_in',
      });
    } else {
      submission = await ClassSubmission.create({
        assignmentId: assignment.id,
        studentId: req.user.id,
        studentName: req.user.name,
        submissionText,
        fileUrl,
        status: isLate ? 'late' : 'turned_in',
      });
    }

    res.json({
      message: isLate ? 'Turned in late' : 'Assignment turned in successfully!',
      submission,
    });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[SUBMIT_ASSIGNMENT_ERR]', err);
    res.status(500).json({ message: 'Failed to submit assignment' });
  }
};

// @desc    Post faculty announcement
// @route   POST /api/campus/announcements
const createAnnouncement = async (req, res) => {
  try {
    const { conversationId, title, body, priority = 'normal' } = req.body;
    if (!conversationId || !title || !body) {
      return res.status(400).json({ message: 'Conversation, title, and body are required' });
    }
    await requireTeachingMember(conversationId, req.user);

    const FacultyAnnouncement = getFacultyAnnouncementModel();
    const announcement = await FacultyAnnouncement.create({
      conversationId,
      facultyId: req.user.id,
      facultyName: req.user.name,
      title: title.trim(),
      body: body.trim(),
      priority,
      acks: [],
      seenBy: [req.user.id],
    });

    res.status(201).json({
      message: 'Announcement posted to class channel',
      announcement,
    });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[CREATE_ANNOUNCEMENT_ERR]', err);
    res.status(500).json({ message: 'Failed to post announcement' });
  }
};

// @desc    Acknowledge faculty announcement ("Got it")
// @route   POST /api/campus/announcements/:id/ack
const acknowledgeAnnouncement = async (req, res) => {
  try {
    const FacultyAnnouncement = getFacultyAnnouncementModel();
    const announcement = await FacultyAnnouncement.findByPk(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: 'Announcement not found' });
    }
    await requireMember(announcement.conversationId, req.user);

    const acks = announcement.acks || [];
    if (!acks.includes(req.user.id)) {
      acks.push(req.user.id);
      announcement.acks = acks;
      await announcement.save();
    }

    res.json({
      message: 'Acknowledged',
      ackCount: acks.length,
    });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[ACK_ANNOUNCEMENT_ERR]', err);
    res.status(500).json({ message: 'Failed to acknowledge announcement' });
  }
};

// @desc    List announcements for a class channel
// @route   GET /api/campus/announcements/:conversationId
const getAnnouncements = async (req, res) => {
  try {
    await requireMember(req.params.conversationId, req.user);
    const FacultyAnnouncement = getFacultyAnnouncementModel();
    const announcements = await FacultyAnnouncement.findAll({
      where: { conversationId: req.params.conversationId },
      order: [['createdAt', 'DESC']],
    });
    res.json({ announcements });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    console.error('[GET_ANNOUNCEMENTS_ERR]', err);
    res.status(500).json({ message: 'Failed to fetch announcements' });
  }
};

module.exports = {
  getMyAssignments,
  createAssignment,
  getAssignments,
  submitAssignment,
  createAnnouncement,
  acknowledgeAnnouncement,
  getAnnouncements,
};

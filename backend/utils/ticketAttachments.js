// Support ticket photos (customer polish, 22 Oct). The app uploads each photo to POST /api/campus/media
// with purpose 'support' (private), then sends the returned paths as `attachments` on POST /api/tickets.
//   validateAttachments(userId, raw) -> { paths } | { error }   (max 3, own 'support' uploads only)
//   signTicketAttachments(req, tickets) -> tickets with `attachments` as signed URLs (1 h, private media)
// Tickets are only ever listed to their customer (getMyTickets) or to admins (getAllTickets), the two
// viewers allowed to see these photos.
const { mediaIdIn, loadMediaMeta, signedUrlForId } = require('./mediaAccess');

const MAX_ATTACHMENTS = 3;

const validateAttachments = async (userId, raw) => {
  if (raw === undefined || raw === null) return { paths: [] };
  if (!Array.isArray(raw)) return { error: 'Photos must be a list.' };
  if (raw.length > MAX_ATTACHMENTS) return { error: `You can attach up to ${MAX_ATTACHMENTS} photos.` };
  const ids = [];
  for (const v of raw) {
    const id = mediaIdIn(String(v || ''));
    if (!id) return { error: 'One of the photos could not be attached. Please add it again.' };
    if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return { paths: [] };
  const meta = await loadMediaMeta(ids);
  for (const id of ids) {
    const m = meta.get(id);
    if (!m || String(m.ownerId) !== String(userId) || m.purpose !== 'support') {
      return { error: 'One of the photos could not be attached. Please add it again.' };
    }
  }
  return { paths: ids.map((id) => `/api/campus/media/${id}`) };
};

const signTicketAttachments = async (req, tickets) => {
  const list = Array.isArray(tickets) ? tickets : [];
  for (const t of list) {
    const raw = Array.isArray(t && t.attachments) ? t.attachments : [];
    t.attachments = raw.map((p) => mediaIdIn(String(p || ''))).filter(Boolean).map((id) => signedUrlForId(req, id));
  }
  return list;
};

module.exports = { validateAttachments, signTicketAttachments, MAX_ATTACHMENTS };

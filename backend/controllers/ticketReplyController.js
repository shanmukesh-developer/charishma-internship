// Customer replies on their own support ticket (polish hunt C-M11: support was one-way).
//   POST /api/tickets/:id/reply { text }   protect
// Only the customer who opened the ticket can reply (riders and other accounts get 404, so ticket ids
// are not confirmed to strangers). A Closed ticket takes no replies (open a new one); a Resolved
// ticket reopens as Open. The reply is appended to Ticket.responses as { text, at, by: 'customer' }
// (support replies are by: 'support'), and the text transcript in adminResponse labels it "You:".
const { getTicketModel } = require('../models/Ticket');
const realtime = require('../utils/realtime');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;
const MAX_CUSTOMER_REPLIES = 20;
const MAX_THREAD = 50;

const stamp = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Text transcript of a ticket thread, oldest first; customer lines start with "You:". */
const transcriptOf = (thread) => {
  const list = Array.isArray(thread) ? thread : [];
  if (list.length === 1 && list[0].by !== 'customer') return String(list[0].text || '');
  return list.map((r) => `[${stamp(r.at)}] ${r.by === 'customer' ? 'You: ' : ''}${r.text}`).join('\n\n');
};

const replyToMyTicket = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) return res.status(404).json({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    const raw = req.body && req.body.text;
    const text = typeof raw === 'string' ? raw.replace(/[<>]/g, '').trim() : '';
    if (!text) return res.status(400).json({ code: 'INVALID_INPUT', field: 'text', message: 'Write a reply first.' });
    if (text.length > MAX_TEXT) return res.status(400).json({ code: 'INVALID_INPUT', field: 'text', message: `Keep your reply under ${MAX_TEXT} characters.` });

    const Ticket = getTicketModel();
    const ticket = await Ticket.findByPk(id);
    if (!ticket || !ticket.userId || String(ticket.userId) !== String(req.user.id)) {
      return res.status(404).json({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    }
    if (ticket.status === 'Closed') {
      return res.status(409).json({ code: 'TICKET_CLOSED', message: 'This ticket is closed. Please open a new one if you still need help.' });
    }

    const thread = Array.isArray(ticket.responses) ? [...ticket.responses] : [];
    // Older tickets kept the first support reply only in adminResponse: keep it in the thread.
    if (thread.length === 0 && ticket.adminResponse) {
      thread.push({ text: String(ticket.adminResponse), at: new Date(ticket.updatedAt || Date.now()).toISOString(), by: 'support' });
    }
    if (thread.filter((r) => r && r.by === 'customer').length >= MAX_CUSTOMER_REPLIES) {
      return res.status(429).json({ code: 'TOO_MANY_REPLIES', message: 'This ticket has a lot of replies. Please wait for support to answer.' });
    }
    thread.push({ text, at: new Date().toISOString(), by: 'customer' });
    ticket.responses = thread.slice(-MAX_THREAD);
    ticket.adminResponse = transcriptOf(ticket.responses);
    if (ticket.status === 'Resolved') ticket.status = 'Open';
    await ticket.save();

    realtime.notifyAdmin('ticket', 'updated', ticket.id);
    try {
      const io = req.app.get('io');
      if (io) io.to('user_' + ticket.userId).emit('ticket_updated', { id: ticket.id, status: ticket.status, adminResponse: ticket.adminResponse });
    } catch { /* live update is best effort */ }
    return res.status(201).json(ticket);
  } catch (error) {
    console.error('[TICKET_REPLY_ERROR]', error);
    return res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};

module.exports = { replyToMyTicket, transcriptOf };

// PDF files attached to a service booking (print jobs): POST /api/services/book `attachmentDocument`.
//
// PDFs never go through the image path (utils/imageStore sniffs JPEG/PNG/WEBP/GIF and its media URLs
// can be attached to profiles, stores and posts). Instead:
//   • the upload must be `data:application/pdf;base64,…`, decode cleanly, start with the %PDF- header
//     and be at most MAX_PDF_BYTES;
//   • the bytes go to a PRIVATE CampusMedia row with purpose 'service_doc' (same db / R2 storage as
//     photos, no schema change);
//   • GET /api/campus/media/:id refuses that purpose (404) and mediaAccess.mayAttach refuses to attach
//     it anywhere, so the only way to read it is GET /api/services/:id/document, which checks the
//     booking (student, assigned partner, admin) and sends it as a download, never inline.
const crypto = require('crypto');

const DOC_PURPOSE = 'service_doc';
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const DATA_PREFIX = 'data:application/pdf;base64,';
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const fail = (status, code, message) => ({ ok: false, status, code, message });

/** "../My Notes<1>.pdf" -> "My Notes1.pdf"; always ends in .pdf, at most 80 characters. */
const cleanPdfName = (raw) => {
  const base = String(typeof raw === 'string' ? raw : '').split(/[\\/]/).pop() || '';
  let name = base.replace(/[^\w .()-]/g, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/\.pdf$/i, '').slice(0, 76).trim();
  return `${name || 'Document'}.pdf`;
};

/**
 * Validates and stores a PDF upload. `doc` is { dataUrl, name } (or null/undefined for none).
 * Returns { ok: true, value: null | { mediaId, name, size } } or { ok: false, status, code, message }.
 */
const storeServiceDocument = async (doc, { ownerId }) => {
  if (doc === null || doc === undefined || doc === '') return { ok: true, value: null };
  if (typeof doc !== 'object' || Array.isArray(doc)) return fail(400, 'BAD_DOCUMENT', 'Send the PDF as a file upload.');
  const raw = typeof doc.dataUrl === 'string' ? doc.dataUrl.trim() : '';
  if (!raw.toLowerCase().startsWith(DATA_PREFIX)) return fail(400, 'BAD_DOCUMENT', 'Only PDF files can be attached here.');
  const b64 = raw.slice(DATA_PREFIX.length).replace(/\s+/g, '');
  if (!b64 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) return fail(400, 'BAD_DOCUMENT', 'That PDF could not be read. Please pick it again.');
  if (Math.floor((b64.length * 3) / 4) > MAX_PDF_BYTES + 2) {
    return fail(413, 'FILE_TOO_LARGE', `That PDF is larger than ${MAX_PDF_BYTES / (1024 * 1024)} MB. Share it on a pen drive or when the partner calls.`);
  }
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return fail(400, 'BAD_DOCUMENT', 'That PDF is empty.');
  if (buf.length > MAX_PDF_BYTES) {
    return fail(413, 'FILE_TOO_LARGE', `That PDF is larger than ${MAX_PDF_BYTES / (1024 * 1024)} MB. Share it on a pen drive or when the partner calls.`);
  }
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return fail(400, 'BAD_DOCUMENT', 'That file is not a PDF.');

  const { getCampusMediaModel } = require('../modules/campus/models/CampusMedia');
  const Media = getCampusMediaModel && getCampusMediaModel();
  if (!Media) return fail(500, 'MEDIA_SAVE_FAILED', 'Could not save the PDF. Please try again.');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  try {
    const row = await require('./mediaStorage').createMediaRow(Media, {
      ownerId,
      purpose: DOC_PURPOSE,
      mime: 'application/pdf',
      size: buf.length,
      sha256,
      isPrivate: true,
    }, buf);
    return { ok: true, value: { mediaId: row.id, name: cleanPdfName(doc.name), size: buf.length } };
  } catch (err) {
    console.error('[SERVICE_DOC_SAVE_ERR]', err && err.message);
    return fail(500, 'MEDIA_SAVE_FAILED', 'Could not save the PDF. Please try again.');
  }
};

/**
 * Sends the booking's PDF as a download. `doc` is booking.specifications.document; the row must be a
 * service document owned by the student who booked. Answers 404 for anything else.
 */
const sendServiceDocument = async (res, booking, doc) => {
  const notFound = () => res.status(404).json({ success: false, message: 'No file attached to this booking' });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!doc || typeof doc !== 'object' || !UUID.test(String(doc.mediaId || ''))) return notFound();
  const { getCampusMediaModel } = require('../modules/campus/models/CampusMedia');
  const Media = getCampusMediaModel && getCampusMediaModel();
  const row = Media ? await Media.findByPk(doc.mediaId) : null;
  if (!row || row.purpose !== DOC_PURPOSE || String(row.ownerId) !== String(booking.userId) || row.mime !== 'application/pdf') return notFound();
  const bytes = await require('./mediaStorage').readAllBytes(row);
  if (!bytes || !bytes.length) return notFound();
  const name = cleanPdfName(doc.name);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(bytes.length),
    'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  return res.status(200).end(bytes);
};

module.exports = { DOC_PURPOSE, MAX_PDF_BYTES, cleanPdfName, storeServiceDocument, sendServiceDocument };

/**
 * Print PDFs are uploaded on their own, before the booking (POST /api/services/documents, multipart field
 * 'document'): the student sees progress and can retry just the file, and the booking request then
 * carries only { documentId } instead of ~7 MB of base64 JSON that often timed out on 4G.
 * React Native's XMLHttpRequest streams the local file (Expo's fetch cannot send { uri } file parts).
 */
import { API_URL } from '../../constants/api';
import { getToken, SERVER_BUSY_MESSAGE } from '../../utils/auth';
import { versionHeaders } from '../../utils/forceUpdate';

export const PDF_UPLOAD_TIMEOUT_MS = 90000;
const RETRY_DELAY_MS = 1500;

export class PdfUploadError extends Error {
  /** Worth a "Retry" button (no answer, a timeout or a busy server), as opposed to a bad / too-large file. */
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'PdfUploadError';
    this.retryable = retryable;
  }
}

type Result = { status: number; json: any };

const sendOnce = (uri: string, name: string, token: string, onProgress?: (fraction: number) => void): Promise<Result> =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('document', { uri, name: name || 'Document.pdf', type: 'application/pdf' } as any);
    form.append('name', name || 'Document.pdf');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/services/documents`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    for (const [k, v] of Object.entries(versionHeaders())) xhr.setRequestHeader(k, v);
    xhr.timeout = PDF_UPLOAD_TIMEOUT_MS;
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e: any) => {
        if (e && e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      if (!xhr.status) { reject(Object.assign(new Error('no answer'), { code: 'XHR_ERROR' })); return; }
      let json: any = null;
      try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { json = null; }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(Object.assign(new Error('network error'), { code: 'XHR_ERROR' }));
    xhr.ontimeout = () => reject(Object.assign(new Error('timeout'), { code: 'XHR_TIMEOUT' }));
    xhr.send(form as any);
  });

const busy = (status: number) => status === 408 || status === 502 || status === 503 || status === 504;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uploads a picked PDF (local file uri). Resolves { id, name, size }; one automatic retry after 1.5 s. */
export async function uploadServicePdf(
  file: { uri: string; name: string },
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; name: string; size: number }> {
  const token = await getToken();
  if (!token) throw new PdfUploadError('Please sign in again to attach the PDF.', false);
  let result: Result | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      onProgress?.(0);
      result = await sendOnce(file.uri, file.name, token, onProgress);
      if (attempt === 1 && busy(result.status)) { await wait(RETRY_DELAY_MS); continue; }
      break;
    } catch {
      result = null;
      if (attempt === 1) { await wait(RETRY_DELAY_MS); continue; }
      throw new PdfUploadError('The PDF upload was interrupted. Check your internet and tap Retry.', true);
    }
  }
  if (!result) throw new PdfUploadError('The PDF upload was interrupted. Check your internet and tap Retry.', true);
  const { status, json } = result;
  if (status >= 200 && status < 300 && json && json.document && json.document.id) {
    onProgress?.(1);
    return { id: String(json.document.id), name: String(json.document.name || file.name), size: Number(json.document.size) || 0 };
  }
  if (busy(status)) throw new PdfUploadError(SERVER_BUSY_MESSAGE, true);
  if (status === 401) throw new PdfUploadError('Your session has expired. Please sign in again.', false);
  if (status === 413) throw new PdfUploadError('That PDF is larger than 5 MB. Share it on a pen drive or when the print shop calls.', false);
  const msg = json && typeof json.message === 'string' && json.message ? json.message : 'The PDF did not upload. Tap Retry.';
  throw new PdfUploadError(msg, status >= 500);
}

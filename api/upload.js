// api/upload.js
// Vercel serverless function: receives one or more files from the React extension
// and attaches them to one of four pre-approved Airtable fields on an existing record.

const AIRTABLE_BASE_ID = 'applvQ2MJMxt2eIes';

const TARGETS = {
  properties:     { table: 'Portfolio',        field: 'Property Import File' },
  coa:            { table: 'Portfolio',        field: 'COA File' },
  rent_roll:      { table: 'Budget Versions',  field: 'Rent Roll File' },
  general_ledger: { table: 'Budget Versions',  field: 'GL Import Files' },
};

export const config = { api: { bodyParser: { sizeLimit: '25mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) return res.status(500).json({ error: 'Server missing AIRTABLE_PAT env var' });

  try {
    const { target, recordId, filename, contentType, fileBase64, files } = req.body || {};

    if (!target || !TARGETS[target]) {
      return res.status(400).json({ error: 'Invalid or missing "target". Allowed: ' + Object.keys(TARGETS).join(', ') });
    }
    if (!recordId) {
      return res.status(400).json({ error: 'Missing required field: recordId' });
    }

    // Normalize input to an array of files.
    // Accepts either: { files: [{filename, contentType, fileBase64}, ...] }
    // or (legacy single-file): { filename, contentType, fileBase64 }
    let fileList;
    if (Array.isArray(files) && files.length > 0) {
      fileList = files;
    } else if (filename && contentType && fileBase64) {
      fileList = [{ filename, contentType, fileBase64 }];
    } else {
      return res.status(400).json({ error: 'Missing files. Provide either a "files" array or filename/contentType/fileBase64.' });
    }

    // Validate every file in the list before we start uploading,
    // so we don't half-upload on bad input.
    for (const f of fileList) {
      if (!f || !f.filename || !f.contentType || !f.fileBase64) {
        return res.status(400).json({ error: 'Each file must include filename, contentType, and fileBase64' });
      }
    }

    const { field } = TARGETS[target];
    const uploadUrl = `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`;

    // Airtable's uploadAttachment endpoint appends to a multi-attachment field,
    // so we call it once per file and aggregate the results.
    const results = [];
    for (const f of fileList) {
      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: f.contentType, file: f.fileBase64, filename: f.filename }),
      });
      const result = await uploadResp.json().catch(() => ({}));
      if (!uploadResp.ok) {
        return res.status(uploadResp.status).json({
          error: 'Airtable upload failed',
          target,
          failedAt: f.filename,
          uploaded: results,
          details: result,
        });
      }
      results.push({ filename: f.filename, result });
    }

    // Back-compat: when only one file was uploaded, also surface 'result'
    // so any existing client expecting the old single-file shape keeps working.
    const response = { success: true, target, recordId, field, count: results.length, results };
    if (results.length === 1) response.result = results[0].result;
    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}

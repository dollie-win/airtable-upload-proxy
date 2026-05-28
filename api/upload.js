// api/upload.js
// Vercel serverless function for creating Import Files records in Airtable.
// React posts { target, portfolioId, budgetVersionId?, files }. For each file
// in the request, the function creates its own Import Files record (with that
// file's name as File Name), links it to the Portfolio and (where applicable)
// the Budget Version, sets Status = Pending and Uploaded At = now, then
// attaches the file to that record's File Attachment field.

const AIRTABLE_BASE_ID = 'applvQ2MJMxt2eIes';
const IMPORT_FILES_TABLE_ID = 'tblwJC66ZxXlSrpOd';
const ATTACHMENT_FIELD = 'File Attachment';

// target -> { File Type singleSelect value, whether Budget Version link is required }
const TARGETS = {
  properties:     { fileType: 'Property List',         needsBudgetVersion: false },
  rent_roll:      { fileType: 'Rent Roll',             needsBudgetVersion: true  },
  general_ledger: { fileType: 'GL / Income Statement', needsBudgetVersion: true  },
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
    const body = req.body || {};
    const {
      target,
      portfolioId,
      budgetVersionId,
      files,
      // Legacy single-file convenience fields (treated as a one-element files array)
      filename,
      contentType,
      fileBase64,
    } = body;

    const targetCfg = TARGETS[target];
    if (!targetCfg) {
      return res.status(400).json({
        error: 'Invalid or missing "target". Allowed: ' + Object.keys(TARGETS).join(', '),
      });
    }
    if (!portfolioId) {
      return res.status(400).json({ error: 'Missing required field: portfolioId' });
    }
    if (targetCfg.needsBudgetVersion && !budgetVersionId) {
      return res.status(400).json({ error: 'Target "' + target + '" requires budgetVersionId' });
    }

    // Normalize input to an array of files.
    let fileList;
    if (Array.isArray(files) && files.length > 0) {
      fileList = files;
    } else if (filename && contentType && fileBase64) {
      fileList = [{ filename, contentType, fileBase64 }];
    } else {
      return res.status(400).json({
        error: 'Missing files. Provide a "files" array of { filename, contentType, fileBase64 }.',
      });
    }
    for (const f of fileList) {
      if (!f || !f.filename || !f.contentType || !f.fileBase64) {
        return res.status(400).json({ error: 'Each file must include filename, contentType, and fileBase64' });
      }
    }

    const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${IMPORT_FILES_TABLE_ID}`;
    const uploadedAt = new Date().toISOString();
    const created = [];

    // For each file, create its own Import Files record and attach the file.
    for (const f of fileList) {
      const fields = {
        'File Name': f.filename,
        'File Type': targetCfg.fileType,
        'Portfolio': [portfolioId],
        'Status': 'Pending',
        'Uploaded At': uploadedAt,
      };
      if (targetCfg.needsBudgetVersion) {
        fields['Budget Version'] = [budgetVersionId];
      }

      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
        // typecast intentionally omitted: with typecast Airtable would *create*
        // new linked records by name when a portfolioId / budgetVersionId doesn't
        // match an existing record, which masks bad IDs as phantom records.
        body: JSON.stringify({ fields }),
      });
      const createBody = await createResp.json().catch(() => ({}));
      if (!createResp.ok) {
        return res.status(createResp.status).json({
          error: 'Failed to create Import Files record',
          target,
          failedAt: f.filename,
          created,
          details: createBody,
        });
      }
      const recordId = createBody.id;
      if (!recordId) {
        return res.status(500).json({
          error: 'Airtable returned no record id',
          target,
          failedAt: f.filename,
          created,
          details: createBody,
        });
      }

      const uploadUrl = `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(ATTACHMENT_FIELD)}/uploadAttachment`;
      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: f.contentType, file: f.fileBase64, filename: f.filename }),
      });
      const uploadBody = await uploadResp.json().catch(() => ({}));
      if (!uploadResp.ok) {
        return res.status(uploadResp.status).json({
          error: 'Airtable file attach failed',
          target,
          failedAt: f.filename,
          recordId,
          created,
          details: uploadBody,
        });
      }

      created.push({ filename: f.filename, recordId, result: uploadBody });
    }

    return res.status(200).json({
      success: true,
      target,
      fileType: targetCfg.fileType,
      portfolioId,
      budgetVersionId: targetCfg.needsBudgetVersion ? budgetVersionId : undefined,
      count: created.length,
      records: created,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}

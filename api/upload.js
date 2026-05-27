// api/upload.js
// Vercel serverless function: receives a file from the React extension
// and uploads it to an Airtable attachment field via the Upload Attachment API.

const AIRTABLE_BASE_ID = 'applvQ2MJMxt2eIes';
const AIRTABLE_TABLE   = 'Portfolios';
const AIRTABLE_FIELD   = 'Property Import File';

export const config = {
    api: {
          bodyParser: { sizeLimit: '5mb' },
    },
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const pat = process.env.AIRTABLE_PAT;
    if (!pat) return res.status(500).json({ error: 'Server missing AIRTABLE_PAT env var' });

  try {
        const { recordId, filename, contentType, fileBase64 } = req.body || {};
        if (!filename || !contentType || !fileBase64) {
                return res.status(400).json({ error: 'Missing required fields: filename, contentType, fileBase64' });
        }

      let targetRecordId = recordId;
        if (!targetRecordId) {
                const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;
                const createResp = await fetch(createUrl, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ fields: {} }),
                });
                if (!createResp.ok) {
                          const details = await createResp.text();
                          return res.status(createResp.status).json({ error: 'Failed to create Airtable record', details });
                }
                const created = await createResp.json();
                targetRecordId = created.id;
        }

      const uploadUrl = `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${targetRecordId}/${encodeURIComponent(AIRTABLE_FIELD)}/uploadAttachment`;
        const uploadResp = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ contentType, file: fileBase64, filename }),
        });

      const result = await uploadResp.json().catch(() => ({}));
        if (!uploadResp.ok) {
                return res.status(uploadResp.status).json({ error: 'Airtable upload failed', details: result });
        }
        return res.status(200).json({ success: true, recordId: targetRecordId, result });
  } catch (err) {
        return res.status(500).json({ error: 'Server error', message: err.message });
  }
}

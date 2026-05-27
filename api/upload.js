// api/upload.js
// Vercel serverless function: receives a file from the React extension
// and attaches it to one of four pre-approved Airtable fields on an existing record.

const AIRTABLE_BASE_ID = 'applvQ2MJMxt2eIes';

const TARGETS = {
    properties:     { table: 'Portfolio',       field: 'Property Import File' },
    coa:            { table: 'Portfolio',       field: 'COA File' },
    rent_roll:      { table: 'Budget Versions', field: 'Rent Roll File' },
    general_ledger: { table: 'Budget Versions', field: 'GL Import Files' },
};

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

const pat = process.env.AIRTABLE_PAT;
    if (!pat) return res.status(500).json({ error: 'Server missing AIRTABLE_PAT env var' });

try {
    const { target, recordId, filename, contentType, fileBase64 } = req.body || {};

    if (!target || !TARGETS[target]) {
        return res.status(400).json({ error: 'Invalid or missing "target". Allowed: ' + Object.keys(TARGETS).join(', ') });
    }
    if (!recordId || !filename || !contentType || !fileBase64) {
        return res.status(400).json({ error: 'Missing required fields. Need: recordId, filename, contentType, fileBase64' });
    }

    const { field } = TARGETS[target];
    const uploadUrl = `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`;

    const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, file: fileBase64, filename }),
    });

    const result = await uploadResp.json().catch(() => ({}));
    if (!uploadResp.ok) {
        return res.status(uploadResp.status).json({ error: 'Airtable upload failed', target, details: result });
    }
    return res.status(200).json({ success: true, target, recordId, field, result });
} catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
}
}

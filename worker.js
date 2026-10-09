const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const stringFields = [
  'namaPemesan',
  'emailPemesan',
  'nomorTelepon',
  'jenisKendaraan',
  'platNomor',
  'tanggalMulaiSewa',
  'tanggalSelesaiSewa',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/api/rental-approved') {
      return env.ASSETS.fetch(request);
    }

    console.info('Received rental approval notification request.');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: jsonHeaders });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: jsonHeaders });
    }

    const webhookUrl = env.RENTAL_APPROVAL_WEBHOOK_URL || env.EXPO_PUBLIC_RENTAL_AUTOMATION_URL;
    if (!webhookUrl) {
      console.error('Rental approval webhook URL is not configured.');
      const availableBindings = Object.keys(env).filter((name) => /RENTAL|WEBHOOK|AUTOMATION/i.test(name)).sort();
      console.error('Available rental webhook binding names:', availableBindings);
      return Response.json({
        error: 'Webhook URL is not available in the active production Worker.',
        availableBindings,
      }, { status: 500, headers: jsonHeaders });
    }
    if (!env.RENTAL_APPROVAL_WEBHOOK_URL) console.warn('Using the existing rental automation URL fallback.');

    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body.' }, { status: 400, headers: jsonHeaders });
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      stringFields.some((field) => typeof payload[field] !== 'string') ||
      !Number.isInteger(payload.jumlahHariSewa)
    ) {
      return Response.json({ error: 'Invalid rental approval payload.' }, { status: 400, headers: jsonHeaders });
    }

    try {
      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!webhookResponse.ok) {
        console.error(`Rental approval webhook returned HTTP ${webhookResponse.status}.`);
        return Response.json({ error: `Webhook returned ${webhookResponse.status}.` }, { status: 502, headers: jsonHeaders });
      }

      return Response.json({ ok: true }, { headers: jsonHeaders });
    } catch (error) {
      console.error('Rental approval webhook request failed.', error);
      return Response.json({ error: 'Webhook request failed.' }, { status: 502, headers: jsonHeaders });
    }
  },
};
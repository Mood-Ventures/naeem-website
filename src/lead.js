// POST /api/lead stores a Peak Wheel submission in D1.
// The Apps Script in lead-capture/ is a later Sheet and email hookup, not this path.

const MAX_BODY = 16000;

export async function handleLead(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!originAllowed(request)) return json({ error: 'Lead capture is not available from this site.' }, 403);

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return json({ error: 'That request is too large.' }, 413);

  let text = '';
  try {
    text = await request.text();
  } catch {
    return json({ error: 'That request could not be read.' }, 400);
  }
  if (text.length > MAX_BODY) return json({ error: 'That request is too large.' }, 413);

  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: 'That request could not be read.' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: 'That request could not be read.' }, 400);
  }

  // Honeypot. Bots fill this. People never see it. Pretend it worked and store nothing.
  if (String(payload.company || '').trim()) return json({ ok: true });

  const firstName = clean(payload.firstName, 80);
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = clean(payload.phone, 40);
  if (!firstName) return json({ error: 'Enter your first name.' }, 400);
  if (!isValidEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (phone && !isValidPhone(phone)) return json({ error: 'Enter a phone number, or leave it blank.' }, 400);

  let scores = '';
  let gaps = '';
  try {
    scores = JSON.stringify(payload.scores == null ? {} : payload.scores);
    gaps = JSON.stringify(payload.gaps == null ? [] : payload.gaps);
  } catch {
    return json({ error: 'That request could not be read.' }, 400);
  }
  if (scores.length > 8000 || gaps.length > 4000) return json({ error: 'That request is too large.' }, 413);

  const peak = Number(payload.peakScore);
  const peakScore = Number.isFinite(peak) ? Math.round(peak * 10) / 10 : null;
  const submittedAt = timestamp(payload.submittedAt) || new Date().toISOString();
  const source = clean(payload.source, 80) || 'start-peak-wheel';
  const userAgent = clean(request.headers.get('user-agent'), 400);
  const ipCountry = clean(country(request), 8);

  if (!env.BLOG_DB) {
    console.error('BLOG_DB binding is missing');
    return json({ error: 'Lead capture is temporarily unavailable.' }, 503);
  }

  try {
    await env.BLOG_DB.prepare(
      `INSERT INTO leads (
         first_name, email, phone, scores, gaps, peak_score, submitted_at, source, user_agent, ip_country
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      firstName,
      email,
      phone,
      scores,
      gaps,
      peakScore,
      submittedAt,
      source,
      userAgent,
      ipCountry
    ).run();
  } catch (err) {
    console.error('lead save failed', err);
    return json({ error: 'We could not save your score. Please try again.' }, 500);
  }

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function originAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let host = '';
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  const self = new URL(request.url).hostname;
  return host === self
    || host === 'naeemmood.com'
    || host === 'www.naeemmood.com'
    || host === 'localhost'
    || host === '127.0.0.1';
}

function isValidEmail(email) {
  if (email.length < 6 || email.length > 254) return false;
  return /^[a-z0-9._%+\-]+@[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)+$/.test(email);
}

function isValidPhone(value) {
  if (!/^[0-9+\-().\s]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function clean(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function timestamp(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 40) return '';
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toISOString();
}

function country(request) {
  if (request.cf && request.cf.country) return request.cf.country;
  return request.headers.get('cf-ipcountry') || '';
}

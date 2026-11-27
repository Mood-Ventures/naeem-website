// Daily Protocol opt-in. Isolated from the blog renderer so styling edits
// in worker.js do not have to touch this file.
//
// Kit v4 can create tags and sequences. It cannot create forms or visual
// automations. Signup adds the person to the "Peak Humans Daily Protocol"
// tag and to the sequence of the same name, which sends the welcome email.

const TAG_NAME = 'Peak Humans Daily Protocol';
const SEQUENCE_NAME = 'Peak Humans Daily Protocol';
const WELCOME_SUBJECT = 'Your Peak Humans Daily Protocol';
const PDF_PATH = '/gifts/peak-humans-daily-protocol.pdf';
const PDF_URL = 'https://naeemmood.com' + PDF_PATH;
const POPUP_SCRIPT = '<script src="/assets/js/gift-popup.js" defer></script>';
const SEND_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

let kitReady = null;

export async function handleSubscribe(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { Allow: 'POST, OPTIONS' },
    });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (!originAllowed(request)) {
    return json({ error: 'Signup is not available from this site.' }, 403);
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20000) return json({ error: 'That request is too large.' }, 413);

  let payload;
  try {
    payload = await readPayload(request);
  } catch {
    return json({ error: 'That request could not be read.' }, 400);
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const firstName = cleanName(payload.first_name || payload.firstName || '');
  const source = sourcePage(payload.source || payload.source_page || '', request);

  if (!isValidEmail(email)) {
    return json({ error: 'Enter a valid email address.' }, 400);
  }
  if (!env.BLOG_DB) {
    console.error('BLOG_DB binding is missing');
    return json({ error: 'Signup is temporarily unavailable.' }, 503);
  }
  if (!env.KIT_API_KEY) {
    console.error('KIT_API_KEY is not configured');
    return json({ error: 'Signup is temporarily unavailable.' }, 503);
  }

  try {
    await ensureSubscribers(env);
    const createdAt = new Date().toISOString();
    await env.BLOG_DB.prepare(
      `INSERT OR IGNORE INTO subscribers (email, first_name, source_page, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(email, firstName, source, createdAt).run();
  } catch (err) {
    console.error('subscriber save failed', err);
    return json({ error: 'We could not save your signup. Please try again.' }, 500);
  }

  try {
    await subscribeInKit(env, { email, firstName, source });
  } catch (err) {
    console.error('Kit subscribe failed', err);
    return json({ error: 'We could not finish your signup. Please try again.' }, 502);
  }

  const origin = new URL(request.url).origin;
  return json({ ok: true, downloadUrl: origin + PDF_PATH });
}

export function injectGiftPopup(response) {
  if (!response || response.body == null) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  if (response.status === 204 || response.status === 304) return response;
  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.append(POPUP_SCRIPT, { html: true });
      },
    })
    .transform(response);
}

async function readPayload(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return await request.json();
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData();
    return {
      email: form.get('email'),
      first_name: form.get('first_name'),
      source: form.get('source'),
    };
  }
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
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

function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function sourcePage(value, request) {
  const raw = String(value || request.headers.get('referer') || '').trim();
  if (!raw) return '';
  try {
    const url = raw.startsWith('/') ? new URL(raw, request.url) : new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.pathname.slice(0, 300);
  } catch {
    return '';
  }
}

async function ensureSubscribers(env) {
  await env.BLOG_DB.prepare(
    `CREATE TABLE IF NOT EXISTS subscribers (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL UNIQUE COLLATE NOCASE,
       first_name TEXT NOT NULL DEFAULT '',
       source_page TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL
     )`
  ).run();
}

async function subscribeInKit(env, person) {
  const ids = await kitIds(env);
  await kit(env, 'POST', '/subscribers', {
    email_address: person.email,
    first_name: person.firstName || null,
  });
  await kit(env, 'POST', `/tags/${ids.tagId}/subscribers`, {
    email_address: person.email,
  });
  if (ids.formId) {
    const referrer = person.source ? 'https://naeemmood.com' + person.source : 'https://naeemmood.com/';
    await kit(env, 'POST', `/forms/${ids.formId}/subscribers`, {
      email_address: person.email,
      referrer,
    });
  }
  await kit(env, 'POST', `/sequences/${ids.sequenceId}/subscribers`, {
    email_address: person.email,
  });
}

function kitIds(env) {
  if (!kitReady) {
    kitReady = loadKitIds(env).catch((err) => {
      kitReady = null;
      throw err;
    });
  }
  return kitReady;
}

async function loadKitIds(env) {
  const tag = await kit(env, 'POST', '/tags', { name: TAG_NAME });
  const tagId = tag && tag.tag && tag.tag.id;
  if (!tagId) throw new Error('Kit did not return a tag id');

  const forms = await listAll(env, '/forms?status=all', 'forms');
  const form = forms.find((item) => String(item.name || '').trim().toLowerCase() === TAG_NAME.toLowerCase());

  const sequences = await listAll(env, '/sequences', 'sequences');
  let sequence = sequences.find((item) => String(item.name || '').trim().toLowerCase() === SEQUENCE_NAME.toLowerCase());
  if (!sequence) sequence = await createSequence(env);
  if (!sequence || !sequence.id) throw new Error('Kit did not return a sequence id');
  if (!sequence.active) {
    const updated = await kit(env, 'PUT', `/sequences/${sequence.id}`, { active: true });
    sequence = (updated && updated.sequence) || sequence;
  }
  await ensureWelcomeEmail(env, sequence.id);

  return { tagId, formId: form ? form.id : null, sequenceId: sequence.id };
}

async function createSequence(env) {
  const sendingAddress = await accountSendingAddress(env);
  const templateId = await defaultTemplateId(env);
  const body = {
    name: SEQUENCE_NAME,
    send_days: SEND_DAYS,
    send_hour: 8,
    time_zone: 'America/New_York',
    active: true,
  };
  if (sendingAddress) body.email_address = sendingAddress;
  if (templateId) body.email_template_id = templateId;
  const created = await kit(env, 'POST', '/sequences', body);
  return created && created.sequence;
}

async function accountSendingAddress(env) {
  const data = await kit(env, 'GET', '/account');
  const addresses = (data.account && data.account.sending_addresses) || [];
  const match = addresses.find((item) => item.is_default && item.is_verified)
    || addresses.find((item) => item.is_verified)
    || addresses.find((item) => item.is_default);
  return match ? match.email_address : '';
}

async function defaultTemplateId(env) {
  const data = await kit(env, 'GET', '/email_templates?per_page=100');
  const templates = data.email_templates || [];
  const match = templates.find((item) => item.is_default) || templates[0];
  return match ? match.id : null;
}

async function ensureWelcomeEmail(env, sequenceId) {
  const emails = await listAll(env, `/sequences/${sequenceId}/emails`, 'emails');
  const existing = emails.find((item) => item.subject === WELCOME_SUBJECT);
  if (existing && existing.published) return;
  if (existing && !existing.published) {
    await kit(env, 'PUT', `/sequences/${sequenceId}/emails/${existing.id}`, { published: true });
    return;
  }
  const templateId = await defaultTemplateId(env);
  const body = {
    subject: WELCOME_SUBJECT,
    preview_text: 'The daily system is ready to download.',
    content: welcomeHtml(),
    delay_value: 0,
    delay_unit: 'days',
    published: true,
    position: 0,
    send_days: SEND_DAYS,
  };
  if (templateId) body.email_template_id = templateId;
  await kit(env, 'POST', `/sequences/${sequenceId}/emails`, body);
}

function welcomeHtml() {
  return [
    '<p>Here is The Peak Humans Daily Protocol.</p>',
    '<p>It is a simple daily system for high-performing men who are ready to stop operating at 70% and start showing up with energy, focus, and presence.</p>',
    `<p><a href="${PDF_URL}">Download The Peak Humans Daily Protocol</a></p>`,
    '<p>Morning, midday, and evening. Tick every box you hit. Aim for progress, not perfection.</p>',
    '<p>Naeem Mahmood<br>Peak Humans</p>',
  ].join('\n');
}

async function listAll(env, path, key) {
  const all = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const joiner = path.includes('?') ? '&' : '?';
    const query = `${path}${joiner}per_page=500${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
    const data = await kit(env, 'GET', query);
    const batch = (data && data[key]) || [];
    all.push(...batch);
    if (!data || !data.pagination || !data.pagination.has_next_page || !data.pagination.end_cursor) break;
    cursor = data.pagination.end_cursor;
  }
  return all;
}

async function kit(env, method, path, body) {
  const res = await fetch('https://api.kit.com/v4' + path, {
    method,
    headers: {
      'X-Kit-Api-Key': env.KIT_API_KEY,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const errors = data && Array.isArray(data.errors) ? data.errors.join('; ') : '';
    const message = errors || (data && data.error) || `Kit HTTP ${res.status}`;
    throw new Error(message);
  }
  return data || {};
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

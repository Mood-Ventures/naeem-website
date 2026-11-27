/**
 * Peak Wheel lead capture for naeemmood.com/start
 *
 * Setup
 * 1. Create a Google Sheet for these leads.
 * 2. In that sheet: Extensions > Apps Script. Replace the default file with this one.
 *    The script has to live on the sheet. A standalone script has no active spreadsheet.
 * 3. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 4. Authorize Sheets and Gmail when Google asks.
 * 5. Copy the web app URL.
 *    Either paste it into public/assets/js/lead-config.js as window.LEAD_ENDPOINT,
 *    or set the LEAD_ENDPOINT variable on the naeem-website Cloudflare Worker
 *    and redeploy. The page reads that one value.
 * 6. Send a test from /start. A "Leads" tab is created on the first POST.
 *    An alert email goes to n@naeemmood.com.
 *
 * The page sends text/plain JSON:
 * { firstName, email, phone, scores, gaps, peakScore, submittedAt, source }
 * source is "start-peak-wheel".
 */

var ALERT_TO = 'n@naeemmood.com';
var SHEET_NAME = 'Leads';
var HEADERS = ['submittedAt', 'firstName', 'email', 'phone', 'peakScore', 'scores', 'gaps', 'source'];

function doGet() {
  return ContentService
    .createTextOutput('Peak Wheel lead capture is ready.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);
    var sheet = getSheet_();
    sheet.appendRow([
      data.submittedAt || new Date().toISOString(),
      data.firstName || '',
      data.email || '',
      data.phone || '',
      data.peakScore != null ? data.peakScore : '',
      JSON.stringify(data.scores || {}),
      JSON.stringify(data.gaps || []),
      data.source || ''
    ]);
    MailApp.sendEmail({
      to: ALERT_TO,
      subject: 'New Peak Wheel lead: ' + (data.firstName || 'Unknown'),
      body: alertBody_(data)
    });
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function alertBody_(data) {
  var lines = [
    'New Peak Wheel submission',
    '',
    'Name: ' + (data.firstName || ''),
    'Email: ' + (data.email || ''),
    'Phone: ' + (data.phone || ''),
    'Peak Score: ' + (data.peakScore != null ? data.peakScore : ''),
    'Source: ' + (data.source || ''),
    '',
    'Biggest gaps:'
  ];
  var gaps = data.gaps || [];
  if (!gaps.length) lines.push('(none)');
  for (var i = 0; i < gaps.length; i++) {
    var gap = gaps[i] || {};
    lines.push((i + 1) + '. ' + (gap.label || gap.id || 'Area') + ' (' + (gap.score != null ? gap.score : '') + '/10)');
    if (gap.cost) lines.push('   ' + gap.cost);
  }
  lines.push('');
  lines.push('Scores:');
  lines.push(JSON.stringify(data.scores || {}, null, 2));
  return lines.join('\n');
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Open this script from the Google Sheet (Extensions, then Apps Script).');
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

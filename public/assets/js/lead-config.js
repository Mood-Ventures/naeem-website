// Single lead endpoint for the /start Peak Wheel.
//
// Paste the Google Apps Script web app URL from lead-capture/apps-script.gs,
// or set the LEAD_ENDPOINT variable on the naeem-website Worker. When that
// variable is set, the Worker serves this file with the variable's value.
//
// The page POSTs JSON as text/plain so a Google Apps Script web app can read it.
// Leave the string empty to skip sending. The score still shows either way.
window.LEAD_ENDPOINT = window.LEAD_ENDPOINT || "";

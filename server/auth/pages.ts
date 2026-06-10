const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri;
  }
}

const QUADRANT_MARK = `<svg class="qmark" width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 12 L52 12 A40 40 0 0 1 12 52 Z M20.3 25.5 a5.2 5.2 0 1 0 10.4 0 a5.2 5.2 0 1 0 -10.4 0 Z"></path></svg>`;

function strokeIcon(size: number, paths: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const FINGERPRINT_PATHS = `<path d="M12 4.5a7.5 7.5 0 0 0-7.5 7.5v1.5"></path><path d="M19.5 13.5V12A7.5 7.5 0 0 0 14 4.8"></path><path d="M8 12a4 4 0 0 1 8 0v1.5"></path><path d="M16 16.5a14 14 0 0 1-.6 3.5"></path><path d="M12 12v2.5a9 9 0 0 1-1.2 4.5"></path><path d="M8 15.5A8 8 0 0 1 8 19"></path>`;
const LAPTOP_PATHS = `<rect x="4" y="5" width="16" height="11" rx="1.5"></rect><path d="M2 20h20"></path><path d="M9.5 20l.5-2h4l.5 2"></path>`;
const ARROW_RIGHT_PATHS = `<path d="M4 12h15M13 6l6 6-6 6"></path>`;

function brandMark(): string {
  return `<span class="brandmark">${QUADRANT_MARK}<span class="wm"><span class="name">PFA</span><span class="desc">Personal Finance Assistant</span></span></span>`;
}

function deviceChip(): string {
  return `<span class="device-chip"><span class="dc-ico">${strokeIcon(13, LAPTOP_PATHS)}</span><b id="device-name">This device</b><span>&middot; Passkey</span></span>`;
}

function shell(title: string, body: string, script: string): string {
  const wiring = script
    ? `<script src="/assets/webauthn.js"></script>\n<script>\n${script}\n</script>`
    : "";
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/auth.css">
<script>(function(){try{if(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches){document.documentElement.setAttribute("data-theme","light");}}catch(e){}})();</script>
</head>
<body>
<main class="auth-stage ruled">
<div class="auth-card" id="card">
${body}
</div>
</main>
${wiring}
</body>
</html>`;
}

const DEVICE_SCRIPT = `
function labelDevice() {
  try {
    var ua = navigator.userAgent || "";
    var name = "This device";
    if (/iPhone/.test(ua)) name = "iPhone";
    else if (/iPad/.test(ua)) name = "iPad";
    else if (/Android/.test(ua)) name = "Android";
    else if (/Macintosh|Mac OS X/.test(ua)) name = "Mac";
    else if (/Windows/.test(ua)) name = "Windows";
    else if (/Linux/.test(ua)) name = "Linux";
    var el = document.getElementById("device-name");
    if (el) el.textContent = name;
  } catch (e) {}
}`;

const STATE_RENDERERS = `
var card = document.getElementById("card");
var FP = '${strokeIcon(64, FINGERPRINT_PATHS)}';
var CHECK = '${strokeIcon(26, '<path d="m4 12 5 5L20 6"></path>')}';
var ALERT = '${strokeIcon(26, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5M12 16h.01"></path>')}';
var REFRESH = '${strokeIcon(17, '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"></path><path d="M21 4v4h-4"></path><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"></path><path d="M3 20v-4h4"></path>')}';
function render(html) { card.innerHTML = html; }
function waiting(hint) {
  render('<div class="waiting fade-in"><div class="fp-pulse">' + FP + '</div><div class="center-col"><div class="sb-title">Waiting for your passkey</div><div class="auth-sub">' + hint + '</div></div></div>');
}`;

export function loginPage(
  reqId: string,
  consent: { clientName?: string; redirectUri: string },
): string {
  const host = escapeHtml(hostOf(consent.redirectUri));
  const named = consent.clientName ? ` (${escapeHtml(consent.clientName)})` : "";
  const body = `${brandMark()}
<div class="auth-head">
<h1 class="auth-title">Sign in</h1>
<p class="auth-lede">Use the passkey saved on this device. No password to remember, nothing to phish.</p>
</div>
<div class="consent">
<span class="to"><span class="ico">${strokeIcon(14, ARROW_RIGHT_PATHS)}</span>Authorizing access for</span>
<span class="host">${host}${named}</span>
<span class="caution">Only approve if you started this and recognise that destination.</span>
</div>
<button id="go" class="btn btn-primary btn-lg btn-block passkey-btn"><span class="pk-ico">${strokeIcon(20, FINGERPRINT_PATHS)}</span>Sign in with a passkey</button>
<div class="auth-foot">${deviceChip()}</div>`;
  const script = `
var REQ = ${JSON.stringify(reqId)};
${STATE_RENDERERS}
${DEVICE_SCRIPT}
function success(redirect) {
  render('<div class="state-block fade-in"><div class="seal-ok">' + CHECK + '</div><div class="center-col"><div class="sb-title">You\\'re in</div><div class="sb-text">Verified with your passkey.</div></div><div class="row-2" style="justify-content:center"><span class="badge ok"><span class="led"></span>verified</span></div><button id="continue" class="btn btn-primary btn-lg btn-block">Continue</button></div>');
  document.getElementById("continue").addEventListener("click", function () { window.location = redirect; });
  setTimeout(function () { window.location = redirect; }, 1100);
}
function error() {
  render('<div class="state-block fade-in"><div class="seal-err">' + ALERT + '</div><div class="center-col"><div class="sb-title">Passkey not verified</div><div class="sb-text">The prompt was dismissed or it timed out. Nothing was sent and your account is unaffected.</div></div><div class="stack-2"><button id="retry" class="btn btn-primary btn-lg btn-block"><span class="pk-ico">' + REFRESH + '</span>Try again</button></div></div>');
  document.getElementById("retry").addEventListener("click", signIn);
}
async function signIn() {
  waiting("Confirm with Touch ID, Face ID, or your system prompt");
  try {
    var optRes = await fetch("/webauthn/authenticate/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ req: REQ }) });
    if (!optRes.ok) { error(); return; }
    var opt = await optRes.json();
    var assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: opt.options });
    var verifyRes = await fetch("/webauthn/authenticate/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ req: REQ, challengeId: opt.challengeId, response: assertion }) });
    if (!verifyRes.ok) { error(); return; }
    var out = await verifyRes.json();
    success(out.redirect);
  } catch (e) {
    error();
  }
}
document.getElementById("go").addEventListener("click", signIn);
labelDevice();`;
  return shell("PFA — authorize access", body, script);
}

export function enrollPage(token: string): string {
  const body = `${brandMark()}
<div class="auth-head">
<h1 class="auth-title">Create a passkey</h1>
<p class="auth-lede">Set up a passkey on this device to sign in to PFA. This enrolment link is single-use.</p>
</div>
<button id="go" class="btn btn-primary btn-lg btn-block passkey-btn"><span class="pk-ico">${strokeIcon(20, FINGERPRINT_PATHS)}</span>Create a passkey</button>
<div class="auth-foot">${deviceChip()}</div>`;
  const script = `
var TOKEN = ${JSON.stringify(token)};
${STATE_RENDERERS}
${DEVICE_SCRIPT}
function done() {
  render('<div class="state-block fade-in"><div class="seal-ok">' + CHECK + '</div><div class="center-col"><div class="sb-title">Passkey enrolled</div><div class="sb-text">You can now sign in to PFA from your client.</div></div></div>');
}
function failed(message) {
  render('<div class="state-block fade-in"><div class="seal-err">' + ALERT + '</div><div class="center-col"><div class="sb-title">Enrolment failed</div><div class="sb-text">' + message + '</div></div><div class="stack-2"><button id="retry" class="btn btn-primary btn-lg btn-block"><span class="pk-ico">' + REFRESH + '</span>Try again</button></div></div>');
  document.getElementById("retry").addEventListener("click", enrol);
}
async function enrol() {
  waiting("Confirm with Touch ID, Face ID, or your system prompt");
  try {
    var optRes = await fetch("/webauthn/register/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    if (!optRes.ok) { failed("This enrolment link is no longer valid."); return; }
    var opt = await optRes.json();
    var attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: opt.options });
    var label = navigator.platform || "passkey";
    var verifyRes = await fetch("/webauthn/register/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN, challengeId: opt.challengeId, response: attestation, label: label }) });
    if (!verifyRes.ok) { failed("The passkey could not be registered. Try again."); return; }
    done();
  } catch (e) {
    failed("The prompt was dismissed or it timed out. Nothing was saved.");
  }
}
document.getElementById("go").addEventListener("click", enrol);
labelDevice();`;
  return shell("PFA — enrol a passkey", body, script);
}

export function errorPage(message: string): string {
  const body = `${brandMark()}
<div class="state-block">
<div class="seal-err">${strokeIcon(26, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5M12 16h.01"></path>')}</div>
<div class="center-col">
<div class="sb-title">Can't continue</div>
<div class="sb-text">${escapeHtml(message)}</div>
</div>
</div>`;
  return shell("PFA — error", body, "");
}

export function landingPage(): string {
  const body = `${brandMark()}
<div class="auth-head">
<h1 class="auth-title">Private endpoint</h1>
<p class="auth-lede">PFA is a single-user personal finance assistant. Access is by authorized client only &mdash; there is nothing to sign in to here.</p>
</div>`;
  return shell("PFA", body, "");
}

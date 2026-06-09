function shell(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.25rem; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; cursor: pointer; }
  .status { margin-top: 1rem; min-height: 1.5rem; color: #555; }
  .error { color: #a00; }
</style>
</head>
<body>
${body}
<div class="status" id="status"></div>
<script src="/assets/webauthn.js"></script>
<script>
function setStatus(msg, isError) {
  var el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : "");
}
${script}
</script>
</body>
</html>`;
}

export function loginPage(reqId: string): string {
  const body = `<h1>pfa — sign in</h1>
<p>Verify your passkey to continue.</p>
<button id="go">Sign in with passkey</button>`;
  const script = `
var REQ = ${JSON.stringify(reqId)};
async function signIn() {
  try {
    setStatus("Waiting for your passkey…");
    var optRes = await fetch("/webauthn/authenticate/options", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    var opt = await optRes.json();
    var assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: opt.options });
    var verifyRes = await fetch("/webauthn/authenticate/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ req: REQ, challengeId: opt.challengeId, response: assertion }) });
    if (!verifyRes.ok) { setStatus("Sign-in failed. Try again.", true); return; }
    var out = await verifyRes.json();
    setStatus("Signed in. Returning to the app…");
    window.location = out.redirect;
  } catch (e) {
    setStatus("Sign-in failed: " + (e && e.message ? e.message : e), true);
  }
}
document.getElementById("go").addEventListener("click", signIn);`;
  return shell("pfa — sign in", body, script);
}

export function enrollPage(token: string): string {
  const body = `<h1>pfa — enrol a passkey</h1>
<p>Create a passkey on this device. Single-use link.</p>
<button id="go">Create passkey</button>`;
  const script = `
var TOKEN = ${JSON.stringify(token)};
async function enrol() {
  try {
    setStatus("Creating your passkey…");
    var optRes = await fetch("/webauthn/register/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    if (!optRes.ok) { setStatus("This enrolment link is no longer valid.", true); return; }
    var opt = await optRes.json();
    var attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: opt.options });
    var label = navigator.platform || "passkey";
    var verifyRes = await fetch("/webauthn/register/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN, challengeId: opt.challengeId, response: attestation, label: label }) });
    if (!verifyRes.ok) { setStatus("Enrolment failed. Try again.", true); return; }
    setStatus("Passkey enrolled. You can now sign in.");
    document.getElementById("go").disabled = true;
  } catch (e) {
    setStatus("Enrolment failed: " + (e && e.message ? e.message : e), true);
  }
}
document.getElementById("go").addEventListener("click", enrol);`;
  return shell("pfa — enrol a passkey", body, script);
}

export function errorPage(message: string): string {
  return shell("pfa — error", `<h1>pfa</h1><p class="error">${message}</p>`, "");
}

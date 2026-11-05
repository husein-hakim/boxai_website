// Vercel function: adds a waitlist signup to Resend Contacts.
// Needs the RESEND_API_KEY environment variable.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function send(res, status, body) {
  res.statusCode = status;
  // A plain HTML form post (no JavaScript) gets a page back instead of JSON.
  const isFormPost = (res.req?.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded");
  if (isFormPost) {
    if (status === 200) {
      res.statusCode = 303;
      res.setHeader("Location", "/joined");
      return res.end();
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("That didn't go through. Please go back, check your email address and try again.");
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function isCrossOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }
  if (isCrossOrigin(req)) return send(res, 403, { error: "forbidden" });

  let body;
  try {
    body = req.body; // Vercel's getter throws on malformed JSON.
  } catch {
    return send(res, 400, { error: "invalid_email" });
  }

  // Honeypot: only bots fill this hidden field. Report success and store nothing.
  if (body?.company) return send(res, 200, { ok: true });

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) {
    return send(res, 400, { error: "invalid_email" });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("waitlist: RESEND_API_KEY is not set");
    return send(res, 503, { error: "unavailable" });
  }

  try {
    const response = await fetch("https://api.resend.com/contacts", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
    // 409: already on the list, which is the outcome the visitor wanted.
    if (response.ok || response.status === 409) return send(res, 200, { ok: true });

    console.error("waitlist: Resend returned", response.status, await response.text());
    return send(res, 502, { error: "unavailable" });
  } catch (error) {
    console.error("waitlist: could not reach Resend", error);
    return send(res, 502, { error: "unavailable" });
  }
}

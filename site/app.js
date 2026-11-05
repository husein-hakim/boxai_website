const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPOS = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmil.com": "gmail.com", "gamil.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gnail.com": "gmail.com", "icoud.com": "icloud.com",
  "iclod.com": "icloud.com", "icloud.co": "icloud.com", "icloud.con": "icloud.com", "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com", "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com",
};
const params = new URLSearchParams(location.search);

// Analytics: anonymous events only. Never sends the email address. Off when no key is set at build time.
const POSTHOG_KEY = "{{POSTHOG_KEY}}";
const visitor = crypto.randomUUID?.() ?? String(Math.random());
const context = {
  $process_person_profile: false,
  $current_url: location.href,
  $pathname: location.pathname,
  $referrer: document.referrer,
  in_app_browser: /BytedanceWebview|musical_ly|TikTok/i.test(navigator.userAgent) ? "tiktok" : /Instagram|FBAN|FBAV/.test(navigator.userAgent) ? "meta" : "none",
  ...Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content"].filter((k) => params.has(k)).map((k) => [k, params.get(k)])),
};
// Every event name gets the baw_ prefix, so website events stay separate from the app's in PostHog.
function track(event, properties = {}) {
  if (!POSTHOG_KEY) return;
  fetch("https://us.i.posthog.com/i/v0/e/", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: POSTHOG_KEY, event: `baw_${event}`, distinct_id: visitor, properties: { ...context, ...properties } }),
  }).catch(() => {});
}
track("pageview");
document.addEventListener("timer:started", ({ detail }) => track("timer_started", detail)); // Sent by timer.js

// Hero overlay, showing what Live Pads displays on a hit
const hud = document.querySelector(".hud");
if (hud && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const hits = [["287 ms", "Cross recognized", "COMBO ×4"], ["341 ms", "Left hook recognized", "COMBO ×5"], ["312 ms", "Jab recognized", "COMBO ×3"]];
  let hit = 0;
  setInterval(() => {
    const [ms, punch, combo] = hits[hit++ % hits.length];
    document.getElementById("hud-ms").textContent = ms;
    document.getElementById("hud-punch").textContent = punch;
    document.getElementById("hud-combo").textContent = combo;
    hud.classList.remove("pop");
    void hud.offsetWidth;
    hud.classList.add("pop");
  }, 2400);
}

// Signup forms
const forms = [...document.querySelectorAll("form.signup")];
const sticky = document.querySelector(".sticky");
let joined = false;
let focused = false;

function shareLink() {
  const url = new URL(location.origin);
  url.searchParams.set("utm_source", "share");
  return url.href;
}

function showDone(form, email) {
  const box = document.createElement("div");
  box.className = "done";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = `<h3>You’re on the list</h3><p></p><button type="button">Send to a training partner</button>`;
  box.querySelector("p").textContent = `We’ll email ${email} the day Box AI launches.`;
  const share = box.querySelector("button");
  share.addEventListener("click", async () => {
    track("waitlist_share_clicked");
    const url = shareLink();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Box AI", text: "AI boxing coach that watches your rounds. Joining the waitlist:", url });
      } else {
        await navigator.clipboard.writeText(url);
        share.textContent = "Link copied";
      }
    } catch {
      /* The visitor closed the share sheet. */
    }
  });
  form.replaceWith(box);
}

function setNote(note, message, isError) {
  note.textContent = message;
  note.classList.toggle("is-error", isError);
}

for (const form of forms) {
  const input = form.querySelector("input[type=email]");
  const button = form.querySelector("button");
  const note = form.nextElementSibling;
  let skipTypoCheck = false;

  input.addEventListener("focus", () => {
    if (!focused) track("waitlist_email_focused", { place: form.dataset.place });
    focused = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!EMAIL.test(email)) {
      input.setAttribute("aria-invalid", "true");
      setNote(note, "Please enter a valid email address.", true);
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");

    const [name, domain] = [email.slice(0, email.lastIndexOf("@")), email.slice(email.lastIndexOf("@") + 1).toLowerCase()];
    if (TYPOS[domain] && !skipTypoCheck) {
      const fixed = `${name}@${TYPOS[domain]}`;
      skipTypoCheck = true;
      note.classList.add("is-error");
      note.textContent = "Did you mean ";
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = fixed;
      use.addEventListener("click", () => {
        input.value = fixed;
        form.requestSubmit();
      });
      note.append(use, "? Tap it, or press the button again to keep yours.");
      return;
    }

    note.classList.remove("is-error");
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Joining…";

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, company: form.elements.company.value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      joined = true;
      track("waitlist_joined", { place: form.dataset.place });
      for (const other of forms) {
        const otherNote = other.nextElementSibling;
        showDone(other, email);
        if (other === form) {
          otherNote.textContent = `You’re on the list. We’ll email ${email} the day Box AI launches.`;
          otherNote.className = "sr-only";
        } else {
          otherNote.remove();
        }
      }
      if (sticky) sticky.classList.remove("show");
    } catch {
      setNote(note, "That didn’t go through. Please try again.", true);
      button.disabled = false;
      button.textContent = label;
    }
  });
}

// Sticky button on phones: shown only when no signup form is on screen
if (sticky && forms.length) {
  sticky.hidden = false;
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
    sticky.classList.toggle("show", !joined && visible.size === 0);
  }, { threshold: 0.2 });
  forms.forEach((form) => observer.observe(form));
  sticky.addEventListener("click", (event) => {
    event.preventDefault();
    track("waitlist_sticky_clicked");
    forms[0].querySelector("input[type=email]").focus();
    forms[0].scrollIntoView({ block: "center" });
  });
}

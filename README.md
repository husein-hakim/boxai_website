# Box AI waitlist site

Static pages in `site/`, built to `dist/` by `build.mjs`, plus one Vercel function (`api/waitlist.js`) that saves signups to Resend Contacts. See [SEO.md](SEO.md) for the keyword research and action plan.

## Pad round demo

`#try` on the home page opens a 15-second Live Pads demo. `site/pad-round.js` runs the camera and the round, and `site/pad-logic.js` detects punches from pose keypoints (`npm test` covers it with synthetic traces). `site/assets/pose/` holds LiteRT.js and the same MoveNet Lightning model the app uses. None of this loads with the page: the script loads when the overlay opens, and the runtime and model when someone taps Start. No video leaves the device. The detector is written for the site and doesn't share code with the app's recognizer. Camera access needs HTTPS or localhost, so test on a phone through a Vercel deployment.

## Run locally

```bash
npm run dev
```

Opens on http://localhost:4173. Signups go to `.waitlist-dev.jsonl`, not to Resend. Restart it to pick up edits, because it builds once on start.

## Deploy

1. Create a Resend account and an API key.
2. Import this repository into Vercel and set the project's Root Directory to `website`.
3. Add these environment variables, then deploy:
   - `RESEND_API_KEY` (required)
   - `POSTHOG_KEY` (optional, turns on anonymous conversion events)
   - `SITE_URL` (optional, otherwise Vercel's production domain is used)
4. Add your domain in Vercel, and redeploy so canonical tags and the sitemap use it.
5. Submit a test email on the live site and check that it appears under Contacts in Resend.

## At launch

Verify your sending domain in Resend, then send a Broadcast to your contacts with the App Store link.

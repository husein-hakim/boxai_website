# Box AI waitlist site

Static pages in `site/`, built to `dist/` by `build.mjs`, plus one Vercel function (`api/waitlist.js`) that saves signups to Resend Contacts. See [SEO.md](SEO.md) for the keyword research and action plan.

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

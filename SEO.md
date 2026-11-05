# Box AI website: SEO, AEO and TikTok conversion notes

Researched November 5, 2026. No Ahrefs or Semrush data was available, so nothing here includes real search volumes. Demand is judged from Google and YouTube autocomplete, what ranks today, and App Store search. Connect one of those tools, or check Search Console after launch, before treating any of this as measured.

## Main findings

1. **The name is the biggest SEO risk.** "Box AI" is the official name of Box, Inc.'s enterprise AI product. Searching the bare name returns Box's docs and university help pages, so you won't rank for "box ai" and AI assistants may confuse the two. It's also worth asking a trademark lawyer about it before launch. Every page now says "Box AI" alongside "boxing coach," and the site states it isn't affiliated.
2. **Ambo has done almost no SEO.** Its site has no robots.txt, sitemap, llms.txt or schema, and the page is around 40 words. It isn't the SEO competitor to worry about.
3. **The real competitors are app makers running blogs.** Combo Ai, mmaGPT, JabMaxx (Titans Grip), Heavy Bag Pro and The Shadow Boxing App all publish "best boxing apps" lists, often ranking themselves first. AI answers currently draw on these pages.
4. **A new domain won't win "best boxing app" soon.** Question searches like "can you learn boxing at home" are the better entry point, and they suit an answer-first page.
5. **Being recommended takes third-party mentions.** Your own pages can get you cited. Getting named in "best AI boxing app" answers depends on reviews, roundups and forums, which can only start once the app is out.

## Keyword targets

Difficulty and opportunity are judgment calls from the search results, not tool scores.

| Keyword cluster | Example searches (from autocomplete) | Intent | Difficulty | Opportunity | Page |
|---|---|---|---|---|---|
| AI boxing coach | ai boxing coach app, ai boxing trainer app, best ai boxing app | Commercial | Moderate, new niche | High | Home, AI guide |
| Do AI coaches work | do ai boxing apps work, can ai replace a boxing coach | Informational | Moderate | High | AI guide |
| Learn at home | learn boxing at home, learn boxing at home app, best app to learn boxing at home | Mixed | Moderate | High | Home guide |
| Learn alone | can you learn boxing without a coach, on your own, by yourself | Question | Low to moderate | High | Home guide |
| No equipment | boxing at home no equipment, without a bag | Informational | Moderate | High | Home guide |
| Late or partial starts | can you learn boxing at 30, from YouTube, without sparring | Question | Low | Medium | Home guide |
| Shadow boxing how-to | how to shadow box properly, shadow boxing for beginners at home | Informational | Moderate | High | Shadow guide |
| Shadow boxing routines | shadow boxing workout routine, combos for beginners | Informational | Moderate | High | Shadow guide |
| Shadow boxing app | shadow boxing app, shadow boxing app free | Commercial | Hard, established apps | Medium | Home |
| iPhone boxing app | boxing app for iphone, boxing app for beginners | Commercial | Hard | Medium | Home |
| Punch callouts | boxing app that calls out punches | Commercial | Low to moderate | Medium | Home (Live Pads) |
| Round timer | boxing round timer online, with sound, app | Tool | Moderate | High | Round timer |
| Training plan | boxing training plan for beginners, schedule, pdf | Informational | Moderate | Medium, not built | Possible guide |
| Fix a mistake | how to keep your hands up, how to fix boxing stance | Question | Moderate | Medium, not built | Possible guides, matches TikTok topics |

**Skip for now:** bare "boxing" and "shadow boxing" (mostly fight news, or very competitive), "near me" searches (local gyms), and "mod apk" searches.

## What changed on the site

| Area | Before | Now |
|---|---|---|
| Title and H1 | "Early access," "Your phone is the ring" | Both include "AI boxing coach" |
| Page content | About 40 words | Home has about 900 words, plus 3 guides of 800 to 900 words each |
| AI answers | Nothing to quote | Answer-first paragraphs, tables, FAQs, sourced claims and update dates |
| Structured data | None | Organization, WebSite, MobileApplication, Article, BreadcrumbList, FAQPage |
| Crawling | None | robots.txt, sitemap.xml, llms.txt, canonical tags, share image |
| Signup without JavaScript | Failed | Works, and redirects to a confirmation page |

**FAQ markup:** Google stopped showing FAQ rich results in May 2026, so this won't earn a special Google listing. It's kept because the answers are useful and other AI engines can parse them.

**App rich results:** Google's software app result needs real ratings, so there's no star snippet until launch. Don't add placeholder ratings.

## TikTok conversion choices

These follow common practice, and most published benchmarks come from waitlist vendors, so test them on your own traffic.

- The form and button stay above the fold, even at 620px tall, to allow for TikTok's browser bars.
- One field, an email keyboard and autofill hints. The hero first load is about 137 KB.
- Common email typos like "gmial.com" get a one-tap fix, so launch emails don't bounce.
- A sticky button appears on phones whenever no form is on screen.
- The post-signup screen has a share button, tracked with `utm_source=share`.

**No invented numbers:** the site has no fake user counts, ratings or testimonials. On a public site these risk the FTC's fake review rule, and they'd undermine the honesty that makes the guides citable. Add real proof as you get it: the waitlist count, and beta tester quotes with permission.

## Measuring it

Set `POSTHOG_KEY` in Vercel to turn on anonymous events. Use a link like this in your TikTok bio:

`https://yourdomain.com/?utm_source=tiktok&utm_medium=bio`

Use `utm_content=<video-name>` wherever you can set a link per video. All website events start with `baw_`. The funnel to watch is `baw_pageview` → `baw_waitlist_email_focused` → `baw_waitlist_joined`, split by `in_app_browser` and `utm_content`. The round timer also sends `baw_timer_started` with the session settings, to show how many visitors use it.

## Action plan

**Before launch**
1. Choose a domain and set it as the production domain in Vercel. Canonical tags and the sitemap pick it up automatically.
2. Verify the site in Google Search Console and Bing Webmaster Tools, then submit the sitemap. Copilot draws on Bing's index.
3. Get a real boxing coach to review the guides, and credit them by name. This is the biggest available improvement to credibility.
4. Replace the staged hero with real footage if you can.
5. Get trademark advice on the "Box AI" name.

**In the coming months**
1. Turn your best TikTok topics into guides, such as keeping your hands up or fixing your stance, and embed the video. Each one targets real searches and uses work you've already done.
2. Once the app is live, pitch the roundups already ranking and ask real users for App Store reviews. Don't pay for or fake them.
3. Test 10 to 20 target questions in ChatGPT, Perplexity and Google each month, 3 to 5 runs each, and log how often Box AI gets mentioned.
4. Add a head-to-head comparison page only after launch, when claims can be checked against the real app.

## Sources

- [Google: FAQ rich results removed](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
- [Google: software app structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Box AI documentation (Box, Inc.)](https://docs.box.com/en/ai)
- [TikTok: landing page best practices](https://ads.tiktok.com/help/article/ad-review-checklist-landing-page?lang=en)
- [TikTok: autofill for third-party landing pages](https://ads.tiktok.com/help/article/autofill-for-third-party-landing-page)
- [Combo Ai: best AI boxing apps](https://getcombo.app/blog/best-ai-boxing-apps)
- [Heavy Bag Pro: do AI boxing apps work?](https://heavybag.pro/do-ai-boxing-apps-actually-work/)
- [mmaGPT: shadow boxing app](https://mmagpt.app/shadow-boxing-app)
- [The Shadow Boxing App: best boxing apps](https://shadowboxingapp.com/best-boxing-apps-2026/)
- [LaunchList: waitlist benchmarks](https://app.getlaunchlist.com/tools/waitlist-benchmark)

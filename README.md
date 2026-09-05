# FoodProof

An evidence and complaint-preparation app for India's celiac community.

**Status: approved visual direction and reviewed documentation; application implementation has not started.** Supabase, Mixpanel, AI and deployment are not verified live.

Start with [the handoff](docs/FOODPROOF_BUILD_HANDOFF.md), then [the PRD](docs/FOODPROOF_PRD.md). Review [the audit and open items](docs/FOODPROOF_REVIEW_REPORT.md) before assigning [build tickets](docs/FOODPROOF_BUILD_TICKETS.md).

- Repository: https://github.com/GaytriKhatwani/FoodProof.git
- Local folder: `/Users/gaytrikhatwani/ClaudeProjects/GovtCaseStudy/FoodProof/`
- Approved design: [Clear Signal preview](design/foodproof-clear-signal.html), [concept image](design/reference/approved-concept.png), [design rules](docs/DESIGN.md).
- Preview is an interaction reference with fictional data. It saves nothing to a backend and sends nothing.

No application install/run commands exist yet. T0 must add verified commands after scaffolding. Do not invent a working `npm run dev` until that script exists.

## Release sequence

1. Public introduction plus restricted invited demo; mocked identity labels, real demo persistence and consented analytics.
2. Real email OTP, phone OTP, Google sign-in, production permissions and public-launch readiness.
3. Reminders and translations, separately scoped after public launch.

FoodProof prepares and organizes concerns. Official complaints are filed through government channels; brand messages are sent by the user. Community publication does not file a complaint or certify safety.

# FoodProof — Approved prototype to implementation

The user approved Clear Signal. Preserve the cobalt actions, navy oversized stacked headlines, warm white, label photography, open ruled layouts and restrained motion. Use the approved preview as a visual reference alongside DESIGN.md.

The preview is an interaction demonstration, not a complete app or executable technical contract.

| Preview behaviour | Required application behaviour |
|---|---|
| Screen dropdown exposes all screens | Remove from shipped app; real navigation and guarded routes |
| In-memory sample role switches | Invitation determines server role; exit/re-enter to change role |
| Fixed fictional product and placeholder records | Clearly marked seed records plus persisted independent reports |
| “Save” updates local state | Confirm only after successful Supabase commit; survive reload |
| Sample evidence button | Real validated uploads, progress/failure, roles and immutable reviewed copies |
| Single local report timeline | Own-report list, persisted history, separate submissions and updates |
| Simplified review toggles | Exact consented snapshot, owner-only decisions, reasons, stale-version protection |
| Simplified share/withdraw | Transactional revisions, protected assets, immediate subsequent-read withdrawal |
| Illustrative response screen | Persist private response; separate consent and response review |
| Local message template | Saved editable templates and real server AI only when configured |
| No service analytics | Real consent-controlled allowlisted Mixpanel delivery |
| Limited navigation states | Implement all screen-spec loading/empty/error/expiry/not-found states |

Do not copy in-memory state or relaxed review shortcuts into production handlers. Do not transplant the entire preview as the Next.js app. Rebuild reusable components in bounded slices while matching the visual direction.

## Asset inventory

- `../design/reference/approved-concept.png`: selected concept, visual reference only.
- `../design/assets/clear-signal-label.png`: generated fictional label photograph for illustration/seed exercises.
- `../design/assets/clear-signal-label.png.json`: exact generation prompt/provenance.
- `../design/assets/clear-signal-label-preview.jpg`: compressed prototype image.
- `../design/foodproof-clear-signal.fragment.html`: editable preview source.
- `../design/foodproof-clear-signal.html`: standalone preview; may require internet for fonts/icons.

Always label the photograph fictional/illustrative. It is not evidence against a real brand. Test image text against the accompanying prompt; do not use the image's generated typography as an OCR truth benchmark without manually checking it. Self-host or bundle fonts/icons for the built app as appropriate; the preview's external font loading is not an infrastructure decision.

The illustrative community feed is not a verified content dataset. The approved design does not approve publishing research-report allegations.

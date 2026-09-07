---
name: FoodProof — Clear Signal
description: Evidence-led community reporting with bold typography and warm label photography.
colors:
  primary: '#183cce'
  paper: '#fffdf7'
  surface: '#ffffff'
  ink: '#06132f'
  muted: '#4d5668'
  rule: '#cbd0d9'
  tint: '#e6ebff'
  status-ink: '#1c399d'
  error: '#a12c2a'
  error-tint: '#fbf1f1'
typography:
  display:
    fontFamily: 'Inter Tight, sans-serif'
    fontSize: 'clamp(44px, 6.6vw, 88px)'
    fontWeight: 700
    lineHeight: 1.03
    letterSpacing: '-0.025em'
  body:
    fontFamily: 'DM Sans, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.55
rounded:
  control: '1px'
spacing:
  sm: '12px'
  md: '20px'
  lg: '32px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
    padding: '13px 22px'
---

## Overview

**Creative North Star: "A closer look."**

Clear Signal is the user's explicitly selected blue direction (D22). Bold navy headlines and cobalt actions sit on warm white. Physical label photography connects the interface to the evidence people are documenting. This captures the interactive prototype's visual system; backend requirements remain in the technical specification.

## Colors

Cobalt identifies actions and navigation. Navy carries primary text. Warm paper is the page ground; white fields and pale blue notices establish subtle separation. Error red accompanies explanatory text. Status colour never implies food safety.

## Typography

Use Inter Tight for strong, compact headings and the wordmark; DM Sans for reading and controls. Both load as variable fonts through `next/font` in `app/layout.tsx` (self-hosted, metric-compatible fallback); the tokens `--font-display` and `--font-body` consume them. Keep the homepage's three-line headline. Form inputs remain 16px. Supporting captions may use 12–13px; essential instructions stay at body size.

Type ramp (px). Public home display 44–82 (fluid); page title 36–52; statement 26–44; section title 24–34; block title 20–26; record title 19–22; lede 18; reading 17; body 16; controls and dense chrome 14–15; captions and metadata 12–13. Fluid steps interpolate between their two endpoints; product surfaces use the fixed steps. One size per heading level on a screen: an `h2` that carries a blocking instruction is set at section-title scale, never smaller than the sections it gates.

## Layout

The public home is composed, not stacked: the hero is an asymmetric split with the label photograph, loaded eagerly, bleeding to the right page edge; sequences are ruled rows with display numerals; standing notices are bands or composed blocks, never repeated tinted boxes. Pilot entry is two parts at desktop (explanation left, the acting surface right) and one column below 900px, in source order. Pilot chrome is one two-row band: masthead above, navigation and session controls below, with the current view underlined on the band's bottom rule; navigation carries exactly one filled create action ("Raise a concern"). Reporter screens contribute no page padding of their own (the shell's `main` supplies it) and use one spacing scale: 8, 12, 20, 32, 48px.

Use open sections, ruled rows, and evidence beside its explanation. The container caps at 1200px with 36px desktop gutters. At 680px and below use 20px gutters, stack evidence and forms, and give feed search its own full-width row. Mobile homepage type is 52px. Let text wrap and pages grow naturally.

## Elevation & Depth

Interface surfaces remain flat. Photography provides material depth through paper, light, and the magnifying glass. Avoid decorative interface shadows.

## Shapes

Controls have almost square corners. Thin rules divide records; roomy layouts establish grouping without repeated rounded cards.

## Components

Primary buttons use cobalt and white, with a minimum 48px height. Hover darkens the fill. Keyboard focus is a visible cobalt outline with 4px offset. Navigation is text with an underline for the current view. Inputs have visible labels, white surfaces and thin neutral borders.

State blocks come in two placements: a bordered inline note, and a page state that drops the box and is typeset as the screen's own headline. Loading placeholders reserve the shape of the screen they stand in for (feed records, a detail band, a page), never a generic stack of bars. Report status is three separate dimensions: inline label-plus-value where status accompanies something else; a hairline-divided board of three cells where status is the subject; never a bar, arrow or total between them. Error surfaces use `error-tint` behind `error` text; no coloured side rails.

Review labels belong below the record headline. Always pair status colours with words. The generated fictional label must retain its illustrative caption and provenance. Route changes use a restrained 260ms reveal; the headline underline draws once. Reduced-motion preference disables motion and cancels active transitions.

## Do's and Don'ts

- Do lead with the concern and supporting evidence.
- Do preserve the large label photograph and clear action hierarchy.
- Do distinguish sharing from filing an official complaint.
- Don't restore the superseded teal or burgundy directions.
- Don't use generic dashboard cards, decorative badges, or safety scores.
- Don't present fictional evidence as a real complaint.

Approved preview and asset inventory: FOODPROOF_PROTOTYPE_TO_BUILD.md. User approval is recorded in D23; current files live under ../design/.

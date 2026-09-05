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

Use Inter Tight for strong, compact headings and the wordmark; DM Sans for reading and controls. Keep the homepage's three-line headline. Form inputs remain 16px. Supporting captions may use 12–13px; essential instructions stay at body size.

## Layout

Use open sections, ruled rows, and evidence beside its explanation. The container caps at 1200px with 36px desktop gutters. At 680px and below use 20px gutters, stack evidence and forms, and give feed search its own full-width row. Mobile homepage type is 52px. Let text wrap and pages grow naturally.

## Elevation & Depth

Interface surfaces remain flat. Photography provides material depth through paper, light, and the magnifying glass. Avoid decorative interface shadows.

## Shapes

Controls have almost square corners. Thin rules divide records; roomy layouts establish grouping without repeated rounded cards.

## Components

Primary buttons use cobalt and white, with a minimum 48px height. Hover darkens the fill. Keyboard focus is a visible cobalt outline with 4px offset. Navigation is text with an underline for the current view. Inputs have visible labels, white surfaces and thin neutral borders.

Review labels belong below the record headline. Always pair status colours with words. The generated fictional label must retain its illustrative caption and provenance. Route changes use a restrained 260ms reveal; the headline underline draws once. Reduced-motion preference disables motion and cancels active transitions.

## Do's and Don'ts

- Do lead with the concern and supporting evidence.
- Do preserve the large label photograph and clear action hierarchy.
- Do distinguish sharing from filing an official complaint.
- Don't restore the superseded teal or burgundy directions.
- Don't use generic dashboard cards, decorative badges, or safety scores.
- Don't present fictional evidence as a real complaint.

Approved preview and asset inventory: FOODPROOF_PROTOTYPE_TO_BUILD.md. User approval is recorded in D23; current files live under ../design/.

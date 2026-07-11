# Design System

## Overview
An iPhone-first utility interface with a warm paper background, ink-like typography, and a restrained cobalt action color. The visual language is calm and editorial, not a generic dark downloader tool.

## Theme
- Mode: light
- Scene: a person saving a reference clip on an iPhone in daylight, moving quickly between apps.
- Color strategy: restrained

## Colors
- Canvas: `oklch(0.975 0.006 80)`
- Surface: `oklch(0.995 0.003 80)`
- Ink: `oklch(0.22 0.02 260)`
- Muted ink: `oklch(0.53 0.015 260)`
- Line: `oklch(0.9 0.01 260)`
- Accent: `oklch(0.53 0.2 265)`
- Success: `oklch(0.62 0.16 155)`
- Danger: `oklch(0.58 0.19 25)`

## Typography
- Family: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`
- Display: 32px/1.08, 720
- Title: 20px/1.2, 700
- Body: 15px/1.45, 400
- Label: 13px/1.2, 650

## Components
- Controls: 16px radius, 52px minimum height, clear focus ring.
- Primary action: solid cobalt fill with white-tinted label.
- Secondary action: pale neutral fill and thin full border.
- Feedback: inline messages and skeletal loading blocks, never modal-first.

## Motion
- 180ms ease-out transitions for opacity and transform only.
- No decorative entrance choreography. Reduced motion disables transitions.

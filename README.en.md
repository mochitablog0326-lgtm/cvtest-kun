# CV Test Kun (CVテスト君)

**An automated CV (conversion) form testing tool for Japanese websites.**

> **`CV` here means _conversion_, not _curriculum vitae_.**
> In the Japanese marketing industry, "CV" is the standard term for a conversion
> (a form submission, a booking, a lead). This tool has nothing to do with résumés.

> The form submits fine — but the conversion was never tracked.
> You find out when you read the monthly report.

日本語 README: [README.md](README.md)

---

## What it is

A desktop app that fills in and submits Japanese contact/booking forms, then verifies
that your **conversion tracking tags actually fired** — including *how many times*.

- **Shape**: Electron local app (no server; everything stays on your machine)
- **Engine**: Playwright
- **License**: MIT

---

## ⚠️ Read this first

**This tool really submits forms and really makes bookings.**

- If you target a site you do not operate, **get the operator's permission first**
- The authors accept no liability for damage caused by use against production systems
- **It does not bypass CAPTCHA / reCAPTCHA, and never will.**
  Use a staging environment or an IP allowlist instead.

---

## Why it targets Japan specifically

Japanese web forms have conventions that generic form-fillers handle badly:

- **Confirmation screens** (確認画面) — a mandatory second page before submission,
  so the second page's DOM does not exist while you are on the first
- **Japanese era dates** (和暦) — `令和8年9月15日` = 2026-09-15
- **`○ △ ×` availability calendars** — booking grids where availability is a symbol,
  not a `disabled` attribute
- **Table-layout forms** — labels live in a `<th>`, not in a `<label>`
- **Full-width digits** (`２０２６`) mixed into date fields
- **Ad-network test-conversion rules** — each Japanese ad network has its own way of
  marking a conversion as a test (see below)

---

## Features

- Point-and-click element picker to build a scenario — no selector writing
- Booking-calendar support: relative dates and **automatic open-slot selection**
- AI-assisted value generation, **always behind a human review step**
- **Conversion tag verification**, counting fire events to catch double-firing
- Screenshots, Playwright traces, and a result JSON saved for every run
- **Built-in test-conversion presets** for Japanese ad networks

## What it deliberately does not do

| Not supported | Reason |
|---|---|
| CAPTCHA / reCAPTCHA bypass | Terms-of-service violation. Will not be implemented |
| Breaking into login-gated pages | Credentials can be passed, but MFA is out of scope |
| Elements inside closed Shadow DOM | Not reachable from the browser |
| Server sync / accounts | Local-only by design |

---

## Install

### GUI (Homebrew Cask)

```bash
brew tap mochitablog0326-lgtm/cvtest-kun
brew install --cask cvtest-kun
```

### CLI (npm)

```bash
npm install -g cvtest-kun
cvtest --help
```

Browsers are not bundled (`playwright-core`). If Google Chrome is installed it just works;
otherwise run `npx playwright install chromium`.

---

## CLI

```bash
cvtest run scenario.json          # run a scenario
cvtest extract https://…/contact  # dump detected form fields
cvtest presets                    # list ad-network presets
cvtest validate scenario.json     # check the scenario schema
```

Exit code is `0` on success and `1` on failure, so it drops into CI.
Add `--headless` and `--json` for machine-readable output.

---

## Scenario JSON

The format is documented and stable — generate it from your own tooling if you like.
See the [Japanese README](README.md#シナリオjsonの仕様) for the full table of step types,
or [`src/types/scenario.ts`](src/types/scenario.ts) for the schema source of truth.

```json
{
  "version": 1,
  "name": "Contact form",
  "url": "https://example.com/contact",
  "steps": [
    { "id": "s1", "type": "fill", "selector": "#email",
      "value": "test+{{timestamp}}@example.com" },
    { "id": "s2", "type": "click", "selector": "button[type=submit]" },
    { "id": "s3", "type": "assertTracking", "provider": "GA4",
      "eventName": "generate_lead", "expectedCount": 1 }
  ],
  "createdAt": "2026-09-01T00:00:00.000Z",
  "updatedAt": "2026-09-01T00:00:00.000Z"
}
```

All date math is **fixed to JST**, independent of the machine's timezone.

---

## Conversion tag verification

The differentiating feature. Watching the browser's outgoing requests tells you
immediately whether a conversion fired — no waiting for an ad platform dashboard
to refresh (some take an hour, and show only the most recent conversion).

It counts fires, not just presence. A misconfigured GTM trigger that fires on
*every* button on the page inflates conversion numbers; `expectedCount` catches it.

Detected: GA4, Google Ads, Yahoo! Japan Ads, Meta, GTM, LINE, X, Microsoft Ads.

---

## Test-conversion presets

Japanese ad networks each define how to mark a conversion as a test. Those rules are
built in, applied automatically, and enforced *after* value generation:

| Network | How a test conversion is recognized | Cleanup |
|---|---|---|
| qualva | Include テスト / てすと in a name field | Auto-deleted daily at 02:00 |
| Dairin | Nothing — it counts as a real conversion | **Manual rejection required** in the admin console |
| Gunosy Ads | Access via a dedicated conversion URL | Not needed if already verified for the tag ID |

After each run, a cleanup checklist is generated — including **which booking slot was
taken**, because you cannot cancel what you cannot identify.

Presets live in [`src/presets/data/presets.json`](src/presets/data/presets.json).
**PRs adding networks are very welcome.**

---

## AI value generation

**The AI never writes selectors.** Selectors are extracted deterministically from the
live DOM; the model only decides *what to type into each field*, answering with opaque
IDs (`f1`, `f2`) that the code maps back to real selectors. A hallucinated element is
therefore structurally impossible.

Model output is schema-validated, and values that are unknown, honeypot-targeted,
outside a `<select>`'s options, or over-length are discarded.

Provider: **Codex CLI** (`codex`). It appears in the generation dropdown when installed.
The subprocess runs in a temp directory with a read-only sandbox so the coding agent
does not touch your working tree.

> Using it sends form field metadata (labels and types) to that service.
> Scenarios stay local; analysis does not.
> Whether a subscription CLI may be used as another app's backend depends on that
> service's own terms — check them yourself.

The `AIProvider` abstraction is still in place, so adding another backend is a
one-line change in `src/ai/index.ts`.

Generation and execution are **separate buttons**. Nothing is submitted until a human
has reviewed the values.

---

## Development

```bash
npm install
npm run dev        # Electron in dev mode
npm test           # test suite (drives a real browser)
npm run typecheck
npm run dist:mac   # build a signed DMG
```

The design document ([docs/DESIGN.md](docs/DESIGN.md)) is in Japanese and is the
authoritative spec. `src/engine/` is shared between the GUI and CLI builds.

## License

MIT — see [LICENSE](LICENSE).

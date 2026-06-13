# BigSet Hermes Explainer Video — Production Notes

## Deliverable

- Final MP4: `dist/bigset-hermes-codex-explainer.mp4`
- Format: 16:9 horizontal public explainer
- Runtime: 110.021 seconds
- Video: H.264, 1920x1080, 30fps, ~3.77 Mbps
- Audio: AAC stereo, 48kHz, ~191 kbps
- File size: ~52 MB
- Faststart: yes (`moov` atom before `mdat`)

## Source artifacts

- `DESIGN.md` — visual identity and constraints
- `SCRIPT.md` — updated explainer voiceover and on-screen beats
- `index.html` — HyperFrames source composition
- `assets/narration_updated_145.mp3` — ElevenLabs narration sped to 1.45x and used in final render
- `previews/contact-sheet-updated.jpg` — current QA contact sheet
- `previews/frame-updated-*.jpg` — representative QA frames

## Verification

Commands run:

```bash
npm run check
npx --yes hyperframes@0.6.96 render --quality high --fps 30 --output dist/bigset-hermes-codex-explainer.mp4
ffmpeg -y -i dist/bigset-hermes-codex-explainer.mp4 -c copy -movflags +faststart dist/bigset-hermes-codex-explainer.faststart.mp4
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration,bit_rate -of json dist/bigset-hermes-codex-explainer.mp4
```

HyperFrames check result:

- Lint: 0 errors, 2 warnings
  - `gsap_studio_edit_blocked`: GSAP owns background animation elements. Intentional.
  - `timeline_track_too_dense`: this one-off explainer keeps 10 timed scenes in one HTML file. Acceptable for this artifact.
- Validate: no console errors; sampled text passes WCAG AA.
- Inspect: 0 layout issues across sampled timeline points.

Frame QA:

- Representative frames generated at 3s, 14s, 27s, 40s, 53s, 65s, 77s, 89s, 100s, and 107s.
- Contact-sheet vision QA found no obvious clipped or overlapping major text, no missing elements, and a consistent public-ready visual system. Minor note: small card/code text is dense in the contact sheet but readable at full 1920x1080.

## Updated instructional angle

The video now explains:

1. What BigSet is: plain English data request → live, refreshable dataset.
2. How this repo uses Hermes Agent with Codex OAuth as the local model/web runtime.
3. The security boundary: Hermes researches and returns strict JSON; BigSet validates and writes.
4. The `bigset` skill workflow: discovery questions → bounded prompt → source-verifiable rows.
5. Production constraints: 10-row demos, 25-row production, source URLs, no private scraping.
6. The proof loop: AI services outreach dataset → 25 rows → PDF report → email delivery.
7. Public reproducibility: Hermes setup, `.env` template, `make dev`, report export/email scripts.

## Suggested public post copy

BigSet now runs in Hermes mode.

Plain-English dataset idea → BigSet skill discovery → bounded prompt → Hermes Agent + Codex OAuth web research → source-backed rows → refresh/export → PDF/email delivery.

Hermes handles intelligence and web research. BigSet owns state, auth, rows, refresh, export, and delivery.

Repo: https://github.com/dax8it/bigset-oauth

#HermesAgent #Codex #OpenSource #LocalFirst #Agents

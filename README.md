# creepjs-lab

A browser-fingerprinting **research lab**. The public page looks like a simple image-share page and,
on load (no clicks), measures the visitor's browser/device two ways and stores the result:

- a **custom collector** (canvas, WebGL/GPU, audio, fonts, screen, hardware, timezone, math, storage, UA data, ...), hashed to one id;
- a self-hosted copy of **CreepJS**, run in a hidden same-origin iframe; the lab reads its **FP ID**, **fuzzy** hash and **lies** count.

An admin page (no auth, by request) lists every visit and lets you upload the image shown on the public page.

> The public page shows a visible research notice that it collects browser/device data. This keeps the lab an
> honest test rig for measuring fingerprint effectiveness and your own browsers — not a covert tracker. Keep it that way.

## Layout
```
app.py                  Flask app: /, /collect, /admin, /admin/upload, /admin/visit/<id>, /uploads/<f>
templates/index.html    image-share page + research notice
templates/admin.html    visits table + image upload
static/collect.js       custom fingerprint collector + CreepJS iframe reader
static/creep/           vendored CreepJS build (self-hosted; computes locally, no external call)
render.yaml             Render web service + 1GB persistent disk for the SQLite db
```

## Run locally
```
pip install -r requirements.txt
python app.py              # http://127.0.0.1:8000  (admin at /admin)
```
Data: SQLite at `DB_PATH` (default `./fingerprints.db`). Uploads at `UPLOAD_DIR` (default `static/uploads`).

## Deploy on Render (via GitHub)
1. Push this repo to GitHub.
2. Render -> New -> Web Service -> connect the GitHub repo. `render.yaml` sets it up (gunicorn + a persistent disk so the SQLite data survives restarts/redeploys).
3. Open the service URL; visit `/` to be fingerprinted, `/admin` to review and to upload the displayed image.

## Notes
- CreepJS is vendored from its published build and runs entirely client-side; it needs no external API for the FP ID.
- `/admin` is intentionally unauthenticated. Anyone with the URL can see the data and upload — put it behind something before real use, or ask me to add a token.
- SQLite + Render free disk: fine for a lab. The DB file is git-ignored.
- Tests: `python -m unittest discover -s tests -t .`

## Verified
Flask routes, collect/store, admin, upload, and the full browser flow (custom hash + CreepJS FP ID/fuzzy/lies landing in one visit row) were tested in a real headless browser.

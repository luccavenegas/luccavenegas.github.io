# Lucca Venegas — Engineering Portfolio

Plain HTML/CSS, no build step. Double-click `index.html` to preview locally.

## Files
- `index.html` — home page (hero, projects, experience, skills, contact)
- `arctos.html` — Arctos 6-DOF arm project page + build log
- `styles.css` — all styling (light/dark follow the visitor's system setting)
- `assets/` — photos, compressed videos, public resume PDF (no address/phone)
- `.nojekyll` — tells GitHub Pages to serve the files as-is

## Publishing (one-time setup)
1. Create a free account at github.com.
2. In GitHub Desktop: File → Add local repository → choose this folder.
3. Click **Publish repository**. Name it exactly `<your-username>.github.io`
   and **uncheck** "Keep this code private".
4. On github.com, open the repo → Settings → Pages →
   Source: "Deploy from a branch", Branch: `main`, folder `/ (root)` → Save.
5. About a minute later the site is live at `https://<your-username>.github.io`.

## Updating
Every push to `main` redeploys automatically (about 1 minute).
In GitHub Desktop: write a summary → **Commit to main** → **Push origin**.

## Adding a new project
1. Copy `arctos.html` to `new-project.html` and replace the content.
2. On `index.html`, copy one `<article class="card">…</article>` block in Projects and link it to the new page.
3. Put media in `assets/`. Keep photos ≤1600 px and compress videos (ask Claude to do it).

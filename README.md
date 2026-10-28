# MANIFOLD
### Interactive Dimensionality Reduction Learning Platform

> A browser-based teaching platform for exploring Machine Learning concepts — no installation, no backend, runs entirely in the browser.

---


## 📚 What's Inside

| Section | Topic |
|---|---|
| 01 | Curse of Dimensionality |
| 02 | What is Dimensionality Reduction? |
| 03A | PCA — Principal Component Analysis |
| 03B | t-SNE |
| 03C | UMAP |
| 03D | LDA — Linear Discriminant Analysis |
| 03E | Isomap |
| 04 | Compare Techniques Side-by-Side |
| 05 | Dataset Playground |
| 06 | Gaussian Process Regression |

---

## ✨ Features

- **Interactive visualisations** — all algorithms run live in the browser
- **Dataset Playground** — upload any CSV or use built-in datasets
- **Google Sign-In** — secure access with any Google account
- **Compare mode** — run any two techniques side-by-side
- **No dependencies** — pure HTML, CSS and JavaScript

---

## 🛠 Tech Stack

- Pure HTML / CSS / JavaScript — no frameworks
- Canvas API for all visualisations
- Google Identity Services for authentication
- EmailJS for welcome emails
- Hosted on Cloudflare Workers (static assets + a small Worker for server-side sign-in)

---



## 👤 Author

Made with 💙 for the classroom.  
Contact — [shrawanvedshree@gmail.com](mailto:shrawanvedshree@gmail.com)


---

## 🧪 Tests

The shared maths lives in `manifold-core.js` (eigen-solvers, PCA, LDA, Isomap, UMAP graph/σ/a,b, t-SNE, metrics, CSV).
It is checked against NumPy / SciPy / scikit-learn reference values:

```bash
node tests/core.test.js
```

---

## 🧪 Playground (for AMBE-style data)

Built for tables like *17 temperatures × 625–2,500 features* (MD / Voronoi volumes), biomedical features, imaging
features and material-test data:

- **Wide data (n ≪ d)** handled exactly (PCA via the n×n Gram matrix; LDA pre-reduces with PCA) with rank warnings
- **Continuous colour + trajectory** (plasma scale, points joined in order, start/end markers) and a **Transpose** button
- **Transition detector**: step size between consecutive states in high-D vs 2-D, flags candidate jumps (heuristic)
- **Quality metrics**: trustworthiness, continuity, k-NN overlap and a random baseline, with small-n warnings
- **PCA scree + loadings** (which original columns drive PC1/PC2)
- Scaling choices (z-score / global min-max / none), optional PCA pre-reduction, missing rows dropped (not zeroed)

---

## ☁️ Cloudflare

```
public/            static site (login.html, dashboard.html, section pages, manifold-core.js, guard.js)
src/worker.mjs     Worker: verifies the Google ID token server-side, sets a signed HttpOnly session cookie,
                   serves ./public DENY-BY-DEFAULT (only login.html + shared JS are public), adds security headers
wrangler.jsonc     Worker + static assets config
tests/             core.test.js (maths vs NumPy/SciPy/sklearn) and worker.test.mjs (auth, cookies, gating)
AUDIT.md           audit findings and fix status
```

**Deploy (dashboard, no computer needed):** Cloudflare dashboard → *Workers & Pages* → *Create* → *Import a repository*
→ pick this repo → keep the defaults (deploy command `npx wrangler deploy`). The Worker name must stay `manifold`.

**Required secret:** `SESSION_SECRET` — a long random string (Worker → *Settings* → *Variables and Secrets* → add as *Secret*).
**Vars** (already in `wrangler.jsonc`): `GOOGLE_CLIENT_ID`, `OWNER_EMAIL` (display-only role label).

**Sign-in:** username + password works with no setup. Two built-in admin accounts (`vashudev@outpulse.company`,
`vedshree@outpulse.company`) are reserved; other people create an account on their device. Everything runs in the browser
(accounts are device-only, passwords stored as salted PBKDF2 hashes), so this is a convenience lock — set `GATE_MODE` to
`"server"` in `wrangler.jsonc` (and sign in with Google) for real server-side protection.

**Google sign-in (optional):** in Google Cloud Console → OAuth client → *Authorised JavaScript origins*, add your Worker URL
(e.g. `https://manifold.<your-subdomain>.workers.dev`) and any custom domain.

**Static hosting (no server):** the contents of `public/` also run on Cloudflare Pages (upload a zip / folder) or GitHub Pages.
There is no `/api`, so the login falls back to a browser-only token check — a courtesy login, **not** access control.
Use the Worker deployment above when the content must be protected.

**CLI alternative:** `npm i && npx wrangler secret put SESSION_SECRET && npx wrangler deploy`
(local dev: copy `.dev.vars.example` to `.dev.vars`, then `npx wrangler dev`).

**Tests:** `npm test`

> Still recommended: in the EmailJS dashboard restrict allowed origins and fix the template recipient (the public key
> is visible in `login.html`), and pin `@emailjs/browser` to an exact version with an SRI hash.

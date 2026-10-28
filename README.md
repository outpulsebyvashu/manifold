# MANIFOLD
### Interactive Dimensionality Reduction Learning Platform

> A browser-based teaching platform for exploring Machine Learning concepts — no installation, no backend, runs entirely in the browser.

---

## 🌐 Live Site
**[barfiiii.github.io/Manifold/login.html](https://barfiiii.github.io/Manifold/login.html?v=2)**

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
- Hosted on GitHub Pages

---

## 🚀 Run Locally

```bash
# Clone the repo
git clone https://github.com/barfiiii/Manifold.git
cd Manifold

# Start a local server
python -m http.server 8000

# Open in browser
http://localhost:8000/login.html
```

---

## 📁 File Structure

```
Manifold/
├── login.html
├── dashboard.html
├── section-01.html       # Curse of Dimensionality
├── section-02.html       # What is DR?
├── section-pca.html
├── section-tsne.html
├── section-umap.html
├── section-lda.html
├── section-isomap.html
├── section-compare.html
├── section05-playground.html
└── section-gpr.html
```

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

## 🔐 Notes on access control

`guard.js` redirects to `login.html` when there is no session, but **this is a courtesy lock only** — everything runs in
the browser and can be bypassed. For real access control, verify the Google ID token on a server. Also review your
EmailJS dashboard: restrict allowed origins and fix the template recipient so the public key cannot be used to mail
arbitrary addresses.

## 📁 Extra files

```
manifold-core.js     # shared, tested maths + helpers
guard.js             # session redirect + progress recording
tests/               # node tests + NumPy/SciPy fixtures
AUDIT.md             # audit findings and fix status
```

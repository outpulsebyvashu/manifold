# Manifold — Audit

Scope: all 12 HTML files, read statically. The riskiest suspected bugs were verified by running the code (marked **[verified]**). Everything else is from reading the source. Severity: 🔴 wrong result or serious risk · 🟠 misleading or fragile · 🟡 minor.

---

## A. Algorithm and theory errors

### UMAP (`section-umap.html`, duplicated in `section05-playground.html` and `section-compare.html`)
1. 🔴 **[verified] σ binary search runs in the wrong direction.** `if(sum>target) lo=sigma; else hi=sigma;` The sum Σexp(−(d−ρ)/σ) *increases* with σ, so when it is too big σ must go *down*. Result: σ always runs to the upper bound (1000), every kNN edge gets weight ≈ 1, and UMAP's local-scale adaptation, which is its core idea, is silently disabled. On a test neighbourhood the repo code returns σ=1000 with sum 14.98 against a target of 3.91. The corrected logic converges to σ=0.69 with sum 3.91. Same bug in `buildUMAPEdges` in the playground and in the compare page.
2. 🔴 **[verified] Wrong a/b values are claimed as the defaults.** The page says "defaults (min_dist=0.1): a=1.929, b=0.791". Fitting the UMAP curve gives a=1.577, b=0.895 for min_dist=0.1. The values 1.929/0.792 belong to min_dist=0.001. The constants are also hard-coded, so any min_dist slider or text would have no effect.
3. 🔴 **The "t-SNE comparison" layout is fabricated.** `computeSimpleTSNELayout` places points in per-class clusters on a circle using the *ground-truth labels* plus noise. It is not t-SNE and it leaks labels, so comparisons against it prove nothing.
4. 🟠 **"Spectral initialisation" isn't spectral.** `spectralInit` uses random points in [−5,5] plus 3 smoothing passes. The page teaches Laplacian eigenmaps and the "global head-start" claim, but the code does neither.
5. 🟠 Repulsion is weighted by `(1−w)` of the *positive* edge. UMAP's negative-sampling gradient uses 1 for a sampled non-neighbour. Edges are also visited once per epoch with attraction scaled by w, instead of being sampled in proportion to w.
6. 🟠 Claims "Preserves global structure" and "significantly better at global structure" are stated as fact. Published analyses (Kobak & Linderman 2021) attribute most of this to the initialisation, which this page doesn't implement. It should be hedged.
7. 🟡 UMAP's `dist2` returns *squared* distance, while Isomap's `dist2` returns plain distance. The same name means different things across files.

### t-SNE (`section-tsne.html`, playground, compare)
8. 🟠 Reported KL cost is computed against exaggerated P (`exagg*P`) without renormalising, so during the first 100 iterations the plotted cost is not a KL divergence and jumps when exaggeration ends.
9. 🟠 No re-centring of Y each iteration (standard in reference implementations) and fixed `lr=200` regardless of n. For small n (≈120) it may be too aggressive (not tested).
10. 🟠 Perplexity search starts from β=1 on *unscaled* squared distances. On unstandardised data with large feature scales P degenerates to near one-hot rows and the 50-iteration cap can end unconverged without any warning.
11. 🟡 Playground version uses `hi===1000` as a "not set" sentinel, which collides with a legitimate β. A comment says "Early exaggeration" above code that does nothing of the sort.
12. 🟡 Fixed 500 iterations with no convergence criterion. "Phase" labels are hard-coded by iteration number.

### LDA (`section-lda.html`, playground, compare)
13. 🔴 **Deflation is invalid for this matrix.** M = S_W⁻¹S_B is *not symmetric*, but eigenvectors are found by power iteration and deflated with `M − λvvᵀ`, which is only correct for symmetric matrices with orthonormal eigenvectors. The second discriminant direction is therefore wrong in general. The standard fix is to whiten via Cholesky of S_W and use a symmetric eigensolver, or use the generalised eigenproblem directly.
14. 🔴 **Two-class fallback invents a fake 2nd axis.** With C=2 there is only one discriminant. The code makes the second axis from the first two coordinates of v1 (`v2=[−v1[1], v1[0], 0…]`), which isn't orthogonal to v1 when d>2. It is plotted as if it were a real discriminant.
15. 🟠 S_W gets a fixed `+1e-6` ridge. With correlated or near-constant features (e.g. pixels) or n < d the inverse is unstable. There is no shrinkage, no small-sample-size handling and no warning. `matInvNxN` silently replaces a ~0 pivot with 1e-12.
16. 🟡 Features aren't standardised, so S_B/S_W is scale-dependent in the display units.

### PCA (`section-pca.html`, playground, compare)
17. 🔴 **Explained-variance ratio is wrong when d > 8.** `topKEigen` computes only the top 8 eigenvalues, then `totalVar = Σ(those 8)`. EVR is therefore divided by the variance of 8 components instead of the trace, overstating every ratio on higher-dimensional data. The compare page does this correctly via the trace, so the two pages can disagree.
18. 🟠 Power iteration uses a fixed 180–300 iterations with no convergence test, so it converges slowly when the top two eigenvalues are close. Repeated deflation accumulates error, and there is no check that components are orthogonal. A Jacobi or QR eigensolver would be exact for the sizes used here.
19. 🟠 The page says "standardise features first" but offers no standardisation. On the "Wine" data, SO₂ has a standard deviation of 5–6 against 0.01–0.08 for others, so PC1 is just "SO₂". Students would learn the wrong lesson.
20. 🟡 Covariance divides by n rather than n−1. Directions and EVR are unaffected, but printed eigenvalues won't match NumPy or sklearn.
21. 🟡 Sign of each eigenvector is arbitrary. Projections can flip between runs or datasets and this isn't mentioned.
22. 🟡 Dead code in compare's `runPCA` (`totalVar` is computed and never used).

### Isomap (`section-isomap.html`, playground, compare)
23. 🔴 **Graph is directed.** `dijkstraAll` walks `knn[u]` as a one-way adjacency list, so the kNN relation is never symmetrised. D[i][j] ≠ D[j][i], so B is not symmetric and classical MDS is invalid. Isomap requires an undirected neighbourhood graph.
24. 🔴 **Power iteration finds the largest |λ|, not the largest λ.** Geodesic B matrices are not guaranteed PSD and can have large negative eigenvalues. Power iteration can lock onto a negative one, which is then clipped to 0 (`Math.max(0,lam)`), collapsing that axis.
25. 🟠 Disconnected graph handled by setting all ∞ distances to `2·maxD`. This is an arbitrary hack that injects fake geometry. The standard remedies are to increase k or embed the largest connected component, with a warning.
26. 🟠 Dijkstra is the O(n²) array-scan version run from every source, giving O(n³) overall, with no cap on n in the playground. See issue 33.

### Gaussian Process Regression (`section-gpr.html`)
27. 🟠 No hyperparameter learning. The text and the "Advanced" tag suggest tuning, but there is no marginal likelihood and no optimiser. Users hand-tune ℓ, σ_f, σ_n and cannot see why one setting is better, which is the central GPR lesson.
28. 🟠 Zero-mean prior with no y-centring or normalisation. Data with a nonzero offset gives badly biased extrapolation, and this isn't explained.
29. 🟠 The 95% band is for the latent function f, not for new observations (which also include σ_n²). The page doesn't say which, so students will misread coverage.
30. 🟡 `cholesky` clamps a non-positive pivot to 1e-10 instead of failing, so an indefinite matrix gives plausible-looking wrong output. Jitter differs between functions (1e-9 vs 1e-6).
31. ✅ RBF, Matérn-5/2 and periodic kernel formulas, and the Cholesky solve for mean and variance, are correct.

---

## B. Methodology problems

32. 🔴 **The datasets are synthetic but labelled as real.** "Iris Flowers" and "Wine Quality" are generated by sampling independent Gaussians from published class means and standard deviations. Real Iris features are strongly correlated (e.g. petal length vs width). Independent sampling removes that structure, which is exactly what PCA/LDA exploit. Results shown to students are therefore not Iris results. Either use the real data or relabel the sets "Iris-like (synthetic)".
33. 🔴 **No size limits or workers.** All algorithms run on the main thread. A large CSV in the playground (O(n²) t-SNE per step, O(n³) Isomap) will freeze the tab. There is no row cap, no sampling and no progress or cancel for Isomap.
34. 🟠 **No quantitative evaluation anywhere.** The compare page shows two scatter plots and a hand-written table ("Global: Yes/No", "Speed: Medium"). No trustworthiness, continuity, kNN preservation, stress or silhouette is computed, so "which is better" is eyeballed and the table values are opinion.
35. 🟠 **No standardisation, no missing-value handling.** `parseFloat(x)||0` turns blanks and non-numeric values into **0**, which biases every embedding. Column type detection uses `parseFloat`, which accepts "12abc" and "2024-01-01" (→ 2024) as numeric.
36. 🟠 **When no label column is chosen, points are coloured by the argmax feature.** This is scale-dependent (the largest-magnitude column always "wins") and has no analytical meaning, but it's presented as classes.
37. 🟠 **Non-reproducibility.** The Curse-of-Dimensionality demos use `Math.random()`, so the numbers on screen differ each run and the contrast-ratio badge flickers between thresholds. Algorithm pages elsewhere use seeded RNGs. Mixed approach.
38. 🟠 The distance-contrast metric is `max/min` with arbitrary traffic-light thresholds (>4 / >2). The standard measure is the *relative contrast* (max−min)/min. With 120 uniform points it also only illustrates the i.i.d. case, not data on a low-dimensional manifold, which is why dimensionality reduction works at all.
39. 🟡 Algorithm code is copy-pasted across 8 files (`powerIter`, `randn`, `seededRNG`, kNN, Dijkstra, t-SNE, UMAP). Fixing a bug in one place leaves it in the others, so every bug above exists 2–3 times already. No shared JS module and no tests.

---

## C. Content errors

40. 🔴 **Quiz Q2 (Curse of Dimensionality) contradicts itself.** The correct option says "About 100,000 (10³ more)", but 1,000 × 10³ = 1,000,000, and the feedback text says "1,000 × 1,000 = 1,000,000 total". Following the page's own 10-per-axis logic, going from 1,000 points in 2D (≈31.6 per axis) to 5D at equal density needs ≈ 31.6⁵ ≈ **3.2 × 10⁷** points. Neither 100k nor 1M is right.
41. 🟠 "All data concentrates at the edges / corners" and the "≈0%" sphere stat are right for a uniform cube, but the framing doesn't say the demo uses a uniform distribution. Real data is rarely uniform.
42. 🟠 The 4 "Techniques" badge on the old dashboard said 04 while five techniques are listed, and it said 9 sections when the code lists 10 (README also says 10). Counts were hard-coded, so they drift.
43. 🟡 README says Sections 03A–E and 06; filenames are inconsistent (`section-01`, `section05-playground`, `section-pca`, …).

---

## D. Security and privacy

44. 🔴 **Authentication is client-side only and can be bypassed.** The Google ID token is base64-decoded in the browser with **no signature check and no `aud`/`iss`/`exp` validation**. The "session" is four plain strings in `sessionStorage`. Anyone can set `manifold_role=owner` in the console. Also, **no page other than the dashboard checks for a session**: `section-*.html` open for anyone with the URL. If the platform is meant to be gated, nothing gates it.
45. 🔴 **EmailJS can be abused as a mail relay.** Service ID, template ID and public key are in the page source, and `to_email` is a template variable. Anyone can call EmailJS with those values and send emails to any address through the owner's account until quota runs out. Lock the template recipient server-side and restrict allowed origins in the EmailJS dashboard.
46. 🟠 Every login silently logs the user's **email and name** to a Google Form and sends a welcome email on *every* login, with no consent notice or privacy policy. This is a GDPR/DPDP exposure for a public site. The Form URL and entry IDs are also public, so anyone can POST fake or spam entries.
47. 🟠 **Stored XSS-style injection from CSV.** Column headers and label values go into `innerHTML` unescaped (`playground`: column list, legend, colour panel). **[verified]** A crafted numeric-column header or label value in a CSV (e.g. `<img src=x onerror=…>`) executes script when the file is loaded. This is self-XSS today, but it becomes real if sharing is ever added.
48. 🟠 The previous dashboard injected `picture` from `sessionStorage` straight into `innerHTML`. This is **fixed in the rebuild** (https-only URL set via DOM property).
49. 🟡 Owner email is hard-coded in public source, and the owner check is `email === OWNER_EMAIL` on an unverified token (see 44). `jsdelivr` script `@emailjs/browser@4` is unpinned with no SRI hash, so a compromised or changed release runs in your login page.
50. 🟡 CSV parser: quote handling toggles on every `"`, so escaped quotes (`""`), commas or newlines inside quoted fields break rows, and rows with the wrong field count are silently dropped.

---

## E. UX, accessibility and engineering

51. 🟠 **Only the rebuilt dashboard is mobile-first.** All other pages still use the old fixed layouts. Many use canvases sized from `offsetWidth` once, and fixed heights (e.g. 240 px) and I did not test them on a phone, so rotation and narrow-screen behaviour is unverified.
52. 🟠 Accessibility: no `alt`, ARIA, focus styles or keyboard operation on any page except the rebuilt dashboard. Quiz options are `<button onclick>` but the explorer canvases have no text alternative. Colour is the only channel for class identity in every scatter plot (poor for colour-blind users).
53. 🟠 Heavy continuous animations (particle background, `requestAnimationFrame` loops) run on login and every page, with no `prefers-reduced-motion` handling. This is costly on phones.
54. 🟡 Each page redefines the theme toggle and reads `manifold_theme` independently. Default was dark; the rebuilt dashboard defaults to light, so a first visit now flips theme between dashboard and section pages until the user picks one.
55. 🟡 No LICENSE, no tests, no CI, no `.gitignore`. Commit history is "Add files via upload" ×N, so there's no traceable change history. README claims "no dependencies" but login depends on Google GSI, EmailJS and Google Fonts.

---

## Suggested fix order
1. UMAP σ direction (#1) and a/b text (#2). Two small edits that change real results.
2. Isomap: symmetrise kNN graph, use symmetric eigensolver (#23, #24).
3. LDA: Cholesky-whitened symmetric eigenproblem, drop the fake 2nd axis (#13, #14).
4. PCA EVR denominator = trace (#17).
5. Real or clearly-labelled datasets (#32); remove the fabricated t-SNE layout (#3).
6. Security: rotate/limit EmailJS, verify the ID token server-side or drop the "role" idea, add session checks (#44–46).
7. Fix quiz Q2 (#40), add row caps and a worker for the playground (#33).
8. Extract the shared maths into one `manifold-core.js` and add unit tests against NumPy/sklearn outputs (#39).


---

## Fix status (second pass)

All items below were re-verified in a real browser (served over HTTP) and, where possible, against NumPy/SciPy/scikit-learn (`node tests/core.test.js`, 26 checks).

**Fixed**
- UMAP: σ search direction (#1), a/b fitted from `min_dist` and text corrected (#2), fabricated t-SNE panel replaced by a real t-SNE run (#3), real spectral initialisation (#4), repulsion weight (#5), over-claims hedged (#6). Fuzzy-union bug in the playground/compare copies also fixed.
- t-SNE: true-P KL cost (#8), re-centring (#9), scale-aware perplexity search (#10, #11).
- LDA: symmetric Cholesky-whitened solve (#13), no fake 2nd axis, labelled as a residual PC (#14), shrinkage + proper Cholesky (#15).
- PCA: exact Jacobi solver, EVR over the trace (#17, #18), standardise toggle with a scale warning (#19), deterministic eigenvector signs (#21).
- Isomap: undirected graph (#23), largest-algebraic eigenpairs (#24), disconnection reported honestly instead of faked (#25). Output matches scikit-learn (Procrustes disparity 0.0000).
- GPR: log-marginal-likelihood fit button (#27), optional y-centring (#28), band wording (#29), strict Cholesky with jitter (#30).
- Methodology: real Iris, real Wine and Digits in the playground, synthetic sets relabelled (#32); row caps + file-size limit (#33); trustworthiness and k-NN overlap shown under each Compare plot (#34); standardisation option (#35); missing values dropped, not zeroed (#35); strict numeric detection (#35); no more argmax colouring (#36); seeded, reproducible demos (#37); shared tested core replaces most copy-paste (#39).
- Content: quiz Q2 corrected (#40); Curse-page explorer now *measures* its numbers (they were formulas / random before); section-02 "Before" plot was random noise and is now real Iris data; several over-claims softened.
- Security: CSV XSS fixed and re-tested (#47); session guard on every protected page (#44, partial); token claim checks on login; welcome email and form logging only on first sign-in, with a consent notice (#46, #45 mitigated); CSP on all non-login pages (#49 partial); logout clears the session.
- Dashboard: contrast (all text ≥4.5:1), aria on tabs/toggles, honest dataset count, tab/search sync, tab-overflow fade, in-page reset confirmation, per-account progress, progress counted when pages are opened directly.
- Accessibility/motion: canvases get an accessible name; `prefers-reduced-motion` respected (CSS + particle canvas hidden).

**Not fixable in this repo (needs you)**
- #44/#45 properly: verify the Google ID token on a server; lock EmailJS template recipient and allowed origins in the EmailJS dashboard.
- #49: pin `@emailjs/browser` to an exact version with an SRI hash — I could not download the file from this sandbox to compute the hash.
- CSP on `login.html`: not added because Google Identity Services could not be tested here and a wrong policy would break sign-in.
- #51 other pages are still desktop-first layouts; #52 colour-only class encoding; web-worker offloading; LICENSE choice; theme default differs between dashboard (light) and other pages (dark) until a user picks one.

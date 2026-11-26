// Aide : visite guidée (lancement à la 1re connexion, chaque étape pointe le bon élément, carte toujours visible,
// clavier, ordinateur et téléphone) et guide (sujets, recherche, lancement de la visite).
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FB = HERE + "/node_modules/firebase13/";
const SRC = process.env.SRC || path.resolve(HERE, "..");
const PROJECT = "demo-factures";
let html = fs.readFileSync(SRC + "/index.html", "utf8");
html = html.replace('signOut, GoogleAuthProvider', 'signOut, connectAuthEmulator, GoogleAuthProvider')
           .replace('updateDoc, deleteField }', 'updateDoc, deleteField, connectFirestoreEmulator }')
           .replace('const db = getFirestore(fbApp);', 'const db = getFirestore(fbApp); connectFirestoreEmulator(db,"127.0.0.1",8080); connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});')
           .replace('projectId: "factures-outilsmalins"', `projectId: "${PROJECT}"`);
const srv = http.createServer((q, r) => {
  const f = q.url.split("?")[0] === "/" ? "/index.html" : q.url.split("?")[0];
  if (f === "/index.html") { r.writeHead(200, { "content-type": "text/html" }); return r.end(html); }
  const p = path.join(SRC, f); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, f.endsWith(".js") ? { "content-type": "application/javascript" } : {}); r.end(fs.readFileSync(p));
}).listen(5067);
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.resolve(HERE, "../firestore.rules"), "utf8") }] } }) });

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
// LANG UTF-8 : sans lui, Chromium sous Linux ne sait pas créer de dossier au nom accentué (« Facture électronique »)
const browser = await chromium.launch({ env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.route(/www\.gstatic\.com\/firebasejs\/13\.3\.0\/(.*)$/, route => route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(FB + route.request().url().split("/").pop()) }));
const clearToast = () => page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
const waitToast = async (re, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await page.locator("#toast").textContent()) || ""; if (re.test(t)) return t; await page.waitForTimeout(150); } return (await page.locator("#toast").textContent()) || ""; };
const tree = () => page.evaluate(async () => {   // liste de tous les fichiers du dossier de test
  const out = []; async function walk(d, pre) { for await (const [n, h] of d.entries()) { if (h.kind === "directory") await walk(h, pre + n + "/"); else out.push(pre + n); } }
  await walk(await navigator.storage.getDirectory(), ""); return out.sort();
});

const SHOT = process.env.SHOT;
async function signup(pg, email) {
  await pg.goto("http://127.0.0.1:5067/");
  await pg.click('#authSeg button[data-v="signup"]');
  await pg.fill("#aEmail", email); await pg.fill("#aPass", "motdepasse1"); await pg.fill("#aPass2", "motdepasse1"); await pg.check("#aTerms"); await pg.click("#aSubmit");
  await pg.waitForSelector("#sName", { state: "visible", timeout: 15000 });
}
// parcourt toute la visite et vérifie chaque étape
async function walk(pg, label) {
  const res = [];
  for (let k = 0; k < 20; k++) {
    await pg.waitForTimeout(450);
    const st = await pg.evaluate(() => {
      const c = document.querySelector("#tour .t-card").getBoundingClientRect(), h = document.querySelector("#tour .t-hole"), hr = h.getBoundingClientRect();
      const T = window.__tour, e = T.cur; const er = e ? e.getBoundingClientRect() : null;
      return { step: document.querySelector("#tStep").textContent, title: document.querySelector("#tTitle").textContent, none: h.classList.contains("none"),
        card: [c.left, c.top, c.right, c.bottom], vw: innerWidth, vh: innerHeight, hole: [hr.left, hr.top, hr.width, hr.height],
        elInView: er ? er.bottom > 0 && er.top < innerHeight && er.right > 0 && er.left < innerWidth : null, next: document.querySelector("#tNext").textContent };
    });
    res.push(st);
    if (SHOT && [2, 4, 6].includes(k)) await pg.screenshot({ path: `${SHOT}-${label}-${k + 1}.png` });
    if (/Terminer/.test(st.next)) { await pg.click("#tNext"); break; }
    await pg.click("#tNext");
  }
  return res;
}
const inside = s => s.card[0] >= 0 && s.card[1] >= 0 && s.card[2] <= s.vw + 0.5 && s.card[3] <= s.vh + 0.5;
const overlap = s => { if (s.none) return 0; const [l, t, r, b] = s.card, [hl, ht, hw, hh] = s.hole; const w = Math.max(0, Math.min(r, hl + hw) - Math.max(l, hl)), h = Math.max(0, Math.min(b, ht + hh) - Math.max(t, ht)); return (w * h) / ((r - l) * (b - t)); };

// ---------- ordinateur ----------
await signup(page, "tuto@ex.fr");
await page.waitForSelector("#tour.on", { timeout: 5000 }).catch(() => {});
ok(await page.locator("#tour.on").count() === 1, "1re connexion : la visite guidée se lance toute seule");
ok(/Étape 1 sur 13/.test(await page.locator("#tStep").textContent()) && /Bienvenue/.test(await page.locator("#tTitle").textContent()), "étape 1 sur 13 : « Bienvenue dans Mes factures »");
const steps = await walk(page, "pc");
ok(steps.length === 13, "13 étapes parcourues : " + steps.map(s => s.title.replace(/^\d+\. /, "")).join(" · "));
ok(steps.slice(1).every(s => !s.none && s.elInView), "étapes 2 à 13 : l'élément expliqué est trouvé, mis en lumière et visible à l'écran");
ok(steps.every(inside), "la bulle d'explication reste entièrement dans l'écran à chaque étape");
const ov = steps.map(overlap); ok(ov.slice(1).filter(x => x > 0.35).length <= 1, "la bulle ne cache pas l'élément expliqué (recouvrement max " + Math.round(Math.max(...ov) * 100) + " %)");
ok(!(await page.locator("#tour.on").count()) && await page.isVisible("#v-settings") && await page.isVisible("#welcome"), "fin : retour sur « Mon entreprise » pour commencer");
await page.reload(); await page.waitForSelector("#sName", { state: "visible", timeout: 15000 }); await page.waitForTimeout(2200);
ok(!(await page.locator("#tour.on").count()), "connexion suivante : la visite ne se relance pas toute seule");
// guide
await page.click("#btnHelp"); await page.waitForSelector("#guideModal.on");
const nItems = await page.locator("#gList details.g-item").count();
ok(nItems >= 25 && await page.locator("#gList details.g-item[open]").count() === 1, `guide : ${nItems} sujets en 5 rubriques, le premier ouvert`);
if (SHOT) await page.locator("#guideModal .modal").screenshot({ path: `${SHOT}-guide.png` });
await page.fill("#gSearch", "acompte"); await page.waitForTimeout(150);
const vis = await page.$$eval("#gList details.g-item", ds => ds.filter(d => d.style.display !== "none").map(d => d.querySelector("summary").textContent));
ok(vis.length >= 2 && vis.some(t => /acompte/i.test(t)) && vis.length < nItems, "recherche « acompte » : " + vis.length + " sujets trouvés (" + vis.join(", ") + ")");
await page.fill("#gSearch", "Numerotation"); await page.waitForTimeout(150);
ok(await page.locator("#gList details.g-item[open]").filter({ hasText: "Numérotation des factures" }).count() === 1, "recherche sans accent : « Numerotation » trouve « Numérotation des factures »");
await page.fill("#gSearch", "zzzz"); await page.waitForTimeout(150);
ok(await page.isVisible("#gEmpty"), "recherche sans résultat : message d'aide");
await page.click("#gTour"); await page.waitForTimeout(400);
ok(await page.locator("#tour.on").count() === 1 && !(await page.locator("#guideModal.on").count()), "« ▶ Lancer la visite guidée » depuis le guide");
await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
ok(/Étape 3 sur 13/.test(await page.locator("#tStep").textContent()), "flèche → du clavier : étape suivante");
await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(200);
ok(/Étape 2 sur 13/.test(await page.locator("#tStep").textContent()), "flèche ← : étape précédente");
await page.keyboard.press("Escape"); await page.waitForTimeout(200);
ok(!(await page.locator("#tour.on").count()), "Échap : quitte la visite");
// entreprise remplie : la visite revient à l'onglet de départ
await page.fill("#sName", "Atelier Martin"); await page.fill("#sSiret", "732 829 320 00074"); await page.fill("#sAddr", "12 rue de la Paix\n75002 Paris");
await page.uncheck("#sSendPrompt"); await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
await page.waitForTimeout(1200); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater");
await page.click('[data-tab="quotes"]'); await page.click("#btnHelp"); await page.click("#gTour"); await page.waitForTimeout(300);
await page.click("#tSkip"); await page.waitForTimeout(300);
ok(await page.isVisible("#v-quotes"), "« Passer » : retour à l'onglet où l'on était (Devis)");

// ---------- téléphone ----------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: SHOT ? 2 : 1 });
const mob = await ctx.newPage(); mob.on("pageerror", e => errs.push("mobile : " + e.message));
await mob.route(/www\.gstatic\.com\/firebasejs\/13\.3\.0\/(.*)$/, route => route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(FB + route.request().url().split("/").pop()) }));
await signup(mob, "tuto-mobile@ex.fr");
await mob.waitForSelector("#tour.on", { timeout: 5000 }).catch(() => {});
const ms = await walk(mob, "mobile");
ok(ms.length === 13 && ms.slice(1).every(s => !s.none && s.elInView), "téléphone : 13 étapes, chaque élément trouvé et visible");
ok(ms.every(inside), "téléphone : la bulle reste dans l'écran (en bas)");
ok(errs.length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

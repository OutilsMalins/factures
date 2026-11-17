// Sauvegarde dans un dossier : rangement <client>/PDF et <client>/Facture électronique, classés par numéro,
// et déplacement des PDF de l'ancien rangement. Le « dossier » est le système de fichiers privé du navigateur (OPFS),
// qui a la même interface que le dossier choisi par l'utilisateur.
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
}).listen(5059);
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

await page.goto("http://127.0.0.1:5059/");
await page.click('#authSeg button[data-v="signup"]');
await page.fill("#aEmail", "bk@ex.fr"); await page.fill("#aPass", "motdepasse1"); await page.fill("#aPass2", "motdepasse1"); await page.check("#aTerms"); await page.click("#aSubmit");
await page.waitForSelector("#sName", { state: "visible", timeout: 15000 });
await page.fill("#sName", "Atelier Martin"); await page.fill("#sSiret", "732 829 320 00074"); await page.fill("#sAddr", "12 rue de la Paix\n75002 Paris");
await page.uncheck("#sFranchise"); await page.fill("#sTvaNum", "FR44732829320");
await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
await page.waitForTimeout(800); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater");

async function invoice(client, price) {
  await page.click('[data-tab="edit"]'); await page.click("#btnNewSide");
  await page.click('#kindSeg button[data-v="pro"]'); await page.fill("#cName", client); await page.fill("#cSiren", "552100554");
  await page.locator('[data-k="desc"]').first().fill("Prestation"); await page.locator('[data-k="price"]').first().fill(String(price));
  await clearToast(); await page.click("#btnSave"); await page.waitForSelector("#modal.on"); await page.click("#mYes");
  return waitToast(/émise|Échec|Accès/);
}
// 1. facture émise AVANT d'avoir choisi le dossier, puis copie posée à l'ancien endroit (ancien rangement)
await invoice("Dupont SARL", 100);
await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const d = await root.getDirectoryHandle("Dupont SARL", { create: true });
  const w = await (await d.getFileHandle("F-2026-001 - Facture - Dupont SARL.pdf", { create: true })).createWritable(); await w.write("ancien PDF"); await w.close();
});
// 2. on choisit le dossier (le dossier de test du navigateur)
await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); const bk = window.__bk; bk.cfg = { mode: "folder", handle: root, name: "Test" }; bk.perm = true; });
await page.evaluate(() => window.__bk.flush());
let t = await tree();
ok(t.includes("Dupont SARL/PDF/F-2026-001 - Facture - Dupont SARL.pdf") && !t.includes("Dupont SARL/F-2026-001 - Facture - Dupont SARL.pdf"), "ancien PDF déplacé dans « Dupont SARL / PDF » : " + t.join(" | "));
// 3. nouvelles factures : PDF rangé directement dans <client>/PDF
await invoice("Dupont SARL", 200); await invoice("Boulangerie Moreau", 50);
const want = ["Dupont SARL/PDF/F-2026-002 - Facture - Dupont SARL.pdf", "Boulangerie Moreau/PDF/F-2026-003 - Facture - Boulangerie Moreau.pdf"];
for (let k = 0; k < 40; k++) { t = await tree(); if (want.every(f => t.includes(f))) break; await page.waitForTimeout(250); }
ok(t.includes("Dupont SARL/PDF/F-2026-002 - Facture - Dupont SARL.pdf") && t.includes("Boulangerie Moreau/PDF/F-2026-003 - Facture - Boulangerie Moreau.pdf"), "nouvelles factures rangées dans <client>/PDF");
// 4. facture électronique : copie dans <client>/Facture électronique
for (const fmt of ["fx", "ubl"]) {
  await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on"); await clearToast();
  await Promise.all([page.waitForEvent("download"), page.click(`#eiOpts [data-ei="${fmt}"]`)]);
  await waitToast(/Fichier prêt/);
}
ok(/copie rangée dans « Boulangerie Moreau \/ Facture électronique »/.test(await page.locator("#toast").textContent()), "message : copie rangée dans le dossier du client");
t = await tree();
ok(t.includes("Boulangerie Moreau/Facture électronique/F-2026-003 - Factur-X.pdf") && t.includes("Boulangerie Moreau/Facture électronique/F-2026-003 - UBL.xml"), "facture électronique rangée dans <client>/Facture électronique (Factur-X et UBL)");
// 5. « Tout sauvegarder maintenant » ne recrée pas de copie à l'ancien endroit
await page.click('[data-tab="settings"]'); await page.evaluate(() => window.__bk.syncAll()); await page.waitForTimeout(800); t = await tree();
ok(!t.some(f => /^[^/]+\/F-2026/.test(f)), "plus aucun PDF à la racine d'un dossier client");
console.log("       Dossier de test :\n" + t.map(f => "         " + f).join("\n"));
ok(errs.length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

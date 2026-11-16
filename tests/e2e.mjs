// Test de bout en bout : la vraie page index.html, branchée sur l'émulateur (auth + firestore).
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FB = HERE + "/node_modules/firebase13/";   // mêmes fichiers que www.gstatic.com/firebasejs/13.3.0
const SRC = process.env.SRC || path.resolve(HERE, "..");
const PROJECT = "demo-factures";

// copie de test : connexion aux émulateurs
let html = fs.readFileSync(SRC + "/index.html", "utf8");
html = html.replace('signOut, GoogleAuthProvider', 'signOut, connectAuthEmulator, GoogleAuthProvider')
           .replace('updateDoc, deleteField }', 'updateDoc, deleteField, connectFirestoreEmulator }')
           .replace('const db = getFirestore(fbApp);', 'const db = getFirestore(fbApp); connectFirestoreEmulator(db,"127.0.0.1",8080); connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true}); window.__t={db};')
           .replace('projectId: "factures-outilsmalins"', `projectId: "${PROJECT}"`);
const srv = http.createServer((q, r) => {
  const f = q.url.split("?")[0] === "/" ? "/index.html" : q.url.split("?")[0];
  if (f === "/index.html") { r.writeHead(200, { "content-type": "text/html" }); return r.end(html); }
  const p = path.join(SRC, f); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, f.endsWith(".js") ? { "content-type": "application/javascript" } : f.endsWith(".webmanifest") ? { "content-type": "application/manifest+json" } : {}); r.end(fs.readFileSync(p));
}).listen(5055);

// règles testées : celles du dépôt (ou RULES=chemin)
const rulesTxt = fs.readFileSync(process.env.RULES || path.resolve(HERE, "../firestore.rules"), "utf8");
const rr = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: rulesTxt }] } }) });
if (!rr.ok) { console.log("Règles refusées par l'émulateur :", await rr.text()); process.exit(1); }

const docGet = async p => { const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, { headers: { Authorization: "Bearer owner" } }); return r.ok ? (await r.json()).fields : null; };
const val = f => f == null ? undefined : f.stringValue ?? f.integerValue ?? f.booleanValue ?? (f.nullValue === null ? null : undefined) ?? f.mapValue;

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await page.route(/www\.gstatic\.com\/firebasejs\/13\.3\.0\/(.*)$/, (route) => { const f = route.request().url().split("/").pop(); route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(FB + f) }); });
page.on("dialog", d => d.accept());
const toast = async () => (await page.locator("#toast").textContent()) || "";
const clearToast = () => page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
const waitToast = async (re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await toast(); if (re.test(t)) return t; await page.waitForTimeout(150); } return await toast(); };

await page.goto("http://127.0.0.1:5055/");
// création du compte
await page.click('#authSeg button[data-v="signup"]');
await page.fill("#aEmail", "tani@ex.fr"); await page.fill("#aPass", "motdepasse1"); await page.fill("#aPass2", "motdepasse1");
await page.check("#aTerms"); await page.click("#aSubmit");
await page.waitForSelector("#sName", { state: "visible", timeout: 15000 });
const uid = await page.evaluate(async () => { for (let i = 0; i < 50; i++) { const u = (await import("https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js")).getAuth().currentUser; if (u) return u.uid; await new Promise(r => setTimeout(r, 100)); } });
ok(!!uid, "compte créé et connecté");

// réglages
await page.fill("#sName", "Atelier Test"); await page.fill("#sSiret", "12345678900012"); await page.fill("#sAddr", "1 rue de la Paix\n75000 Paris");
if (await page.locator("#sMediator").count()) await page.fill("#sMediator", "Médiateur Test – www.mediateur.example");
await page.click("#btnSettingsSave"); ok(/enregistr/i.test(await waitToast(/enregistr/i)), "réglages enregistrés (avec médiateur)");
const prof0 = await docGet(`users/${uid}`); await page.waitForTimeout(800); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater");
ok(prof0 && val(prof0.mediator) === "Médiateur Test – www.mediateur.example", "médiateur enregistré dans la fiche");

async function newInvoice({ client, kind = "pro", desc, price, date }) {
  await page.click('[data-tab="edit"]');
  await page.click("#btnNewF").catch(() => {});
  await page.click(`#kindSeg button[data-v="${kind}"]`);
  await page.fill("#cName", client);
  await page.locator('[data-k="desc"]').first().fill(desc);
  await page.locator('[data-k="price"]').first().fill(String(price));
  if (date) { await page.fill("#issueDate", date); await page.locator("#issueDate").dispatchEvent("change"); }
}
async function issue() { await page.click("#btnSave"); await page.waitForSelector("#modal.on", { timeout: 5000 }); await page.click("#mYes"); }

// facture 1 : client pro, émise
await newInvoice({ client: "Client Pro SARL", desc: "Réparation", price: 100 });
await issue();
let t1 = await waitToast(/émise|Échec|refus|date/i);
ok(/F-\d{4}-001 émise et PDF archivé/.test(t1), "facture 1 émise avec PDF : « " + t1 + " »");
const invs = async () => { const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}/invoices`, { headers: { Authorization: "Bearer owner" } }); return ((await r.json()).documents || []).map(d => d.fields); };
let list = await invs(); let f1 = list.find(d => val(d.number) && /-001$/.test(val(d.number)));
ok(f1 && val(f1.seq) === "1" && val(f1.seqKey) === "facture" && f1.pdf && val(f1.status) === "envoyee" && val(f1.issuedAt), "facture 1 : seq=1, seqKey, pdf, statut émise");
let prof = await docGet(`users/${uid}`);
ok(prof.counters.mapValue.fields.facture.integerValue === "2" && prof.lastIssue.mapValue.fields.facture.stringValue === val(f1.issueDate) && val(prof.lastIssuedId), "fiche : compteur=2, lastIssue, lastIssuedId");
const pdf1 = await docGet(`users/${uid}/pdfs/${(await (async () => { const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}/invoices`, { headers: { Authorization: "Bearer owner" } }); return (await r.json()).documents.find(d => d.fields.seq).name.split("/").pop(); })())}`);
ok(pdf1 && pdf1.locked.booleanValue === true && (pdf1.b64.stringValue || "").length > 1000, "PDF archivé et verrouillé");

// facture 2 avec une date antérieure : refusée
await newInvoice({ client: "Autre Pro", desc: "Pose", price: 50, date: "2026-01-02" });
await page.click("#btnSave");
let t2 = await waitToast(/date d'émission/i);
ok(/date d'émission doit être/i.test(t2), "date antérieure refusée : « " + t2 + " »");
await page.click("#mNo").catch(() => {});

// facture 2 en date du jour : numéro 002
await page.fill("#issueDate", await page.evaluate(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }));
await page.locator("#issueDate").dispatchEvent("change");
await issue();
let t3 = await waitToast(/-002 émise/);
ok(/-002 émise/.test(t3), "facture 2 émise : « " + t3 + " »");

// paiement de la facture pro (liste)
await page.click('[data-tab="list"]'); await page.waitForTimeout(500);
const paidBtn = page.locator("[data-paid]").first();
if (await paidBtn.count()) { await paidBtn.click(); await page.click("#payYes"); ok(/paiement enregistré/.test(await waitToast(/paiement enregistré|Accès refusé|Échec/)), "paiement enregistré (client pro)"); }
else ok(false, "bouton payé introuvable");

// brouillon : enregistré sans numéro
await newInvoice({ client: "Mme Dupont", kind: "particulier", desc: "Coupe", price: 30 });
await page.click("#btnDraft");
ok(/Brouillon enregistré/.test(await waitToast(/Brouillon|Échec|refus/)), "brouillon enregistré");

// devis : numéroté au premier enregistrement puis modifié
await page.click('[data-tab="edit"]'); await page.click("#btnNewD").catch(async () => { await page.click("#btnNewSideD"); });
await page.click('#kindSeg button[data-v="particulier"]'); await page.fill("#cName", "M. Martin");
await page.locator('[data-k="desc"]').first().fill("Travaux"); await page.locator('[data-k="price"]').first().fill("500");
await clearToast(); await page.click("#btnSave");
let t4 = await waitToast(/enregistré|Échec|refus/); ok(/D-\d{4}-001 enregistré/.test(t4), "devis numéroté : « " + t4 + " »");
await page.locator('[data-k="price"]').first().fill("550"); await clearToast(); await page.click("#btnSave");
let t5 = await waitToast(/mis à jour|Échec|refus/); ok(/Devis mis à jour/.test(t5), "devis modifié : « " + t5 + " »");

// mention du médiateur dans l'aperçu du devis (client particulier)
ok(/médiateur de la consommation : Médiateur Test/i.test(await page.locator(".sh-cond").first().textContent()), "médiateur affiché sur le devis (particulier)");

ok(errs.filter(e => !/favicon|ERR_|net::/.test(e)).length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

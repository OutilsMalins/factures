// Envoi au client : réglage « Proposer d'envoyer… », fenêtre ouverte après l'émission (adresse, objet, message),
// PDF téléchargé + email préparé (mailto), partage du PDF (téléphone), adresse enregistrée dans la fiche client.
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
}).listen(5065);
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.resolve(HERE, "../firestore.rules"), "utf8") }] } }) });

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
// LANG UTF-8 : sans lui, Chromium sous Linux ne sait pas créer de dossier au nom accentué (« Facture électronique »)
const browser = await chromium.launch({ env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.addInitScript(() => { window.__noTour = true; });   // visite guidée testée à part (tutoriel.mjs)
await page.addInitScript(() => {   // partage (téléphone) et ouverture de la messagerie simulés
  window.__shared = []; window.__urls = []; window.__openUrl = u => window.__urls.push(u);
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
  Object.defineProperty(navigator, "share", { value: async d => { window.__shared.push({ name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title, text: d.text }); }, configurable: true });
});
await page.route(/www\.gstatic\.com\/firebasejs\/13\.3\.0\/(.*)$/, route => route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(FB + route.request().url().split("/").pop()) }));
const clearToast = () => page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
const waitToast = async (re, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await page.locator("#toast").textContent()) || ""; if (re.test(t)) return t; await page.waitForTimeout(150); } return (await page.locator("#toast").textContent()) || ""; };
const tree = () => page.evaluate(async () => {   // liste de tous les fichiers du dossier de test
  const out = []; async function walk(d, pre) { for await (const [n, h] of d.entries()) { if (h.kind === "directory") await walk(h, pre + n + "/"); else out.push(pre + n); } }
  await walk(await navigator.storage.getDirectory(), ""); return out.sort();
});

await page.goto("http://127.0.0.1:5065/");
await page.click('#authSeg button[data-v="signup"]');
await page.fill("#aEmail", "env@ex.fr"); await page.fill("#aPass", "motdepasse1"); await page.fill("#aPass2", "motdepasse1"); await page.check("#aTerms"); await page.click("#aSubmit");
await page.waitForSelector("#sName", { state: "visible", timeout: 15000 });
ok(await page.isChecked("#sSendPrompt"), "réglage « Proposer d'envoyer le document au client » coché par défaut");
await page.fill("#sName", "Atelier Martin"); await page.fill("#sSiret", "732 829 320 00074"); await page.fill("#sAddr", "12 rue de la Paix\n75002 Paris"); await page.fill("#sPhone", "06 12 34 56 78").catch(() => {});
await page.uncheck("#sFranchise"); await page.fill("#sTvaNum", "FR44732829320");
await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
await page.waitForTimeout(1200); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater");

async function fillDoc(kind, client, email, price, devis) {
  await page.click('[data-tab="edit"]'); await page.click(devis ? "#btnNewSideD" : "#btnNewSide");
  await page.click(`#kindSeg button[data-v="${kind}"]`); await page.fill("#cName", client); if (kind === "pro") await page.fill("#cSiren", "552100554");
  await page.fill("#cEmail", email);
  await page.locator('[data-k="desc"]').first().fill("Prestation"); await page.locator('[data-k="price"]').first().fill(String(price));
}
// 1. facture émise : la fenêtre d'envoi s'ouvre, tout est pré-rempli
await fillDoc("pro", "Dupont SARL", "compta@dupont.fr", 300);
ok(!(await page.isVisible("#btnSend")), "brouillon : pas de bouton « Envoyer au client »");
await page.click("#btnSave"); await page.waitForSelector("#modal.on"); await page.click("#mYes");
await page.waitForSelector("#sendModal.on", { timeout: 8000 }).catch(() => {});
ok(await page.locator("#sendModal.on").count() === 1, "après l'émission : la fenêtre « Envoyer au client » s'ouvre");
const subj = await page.inputValue("#sendSubj"), bodyTxt = await page.inputValue("#sendBody");
ok((await page.inputValue("#sendTo")) === "compta@dupont.fr" && subj === "Facture n° F-2026-001 — Atelier Martin", "adresse du client et objet pré-remplis");
ok(/facture n° F-2026-001 du \d\d\/\d\d\/2026, d'un montant de 360,00 €, à régler au plus tard le/.test(bodyTxt) && /Cordialement,\nAtelier Martin/.test(bodyTxt), "message : numéro, date, montant TTC, échéance, signature");
ok(/1er septembre 2027/.test(await page.locator("#sendHint").textContent()), "client pro : rappel de la facture électronique obligatoire au 01/09/2027");
// 2. « Ouvrir ma messagerie » : PDF téléchargé + email prêt (adresse corrigée → fiche client mise à jour)
await page.fill("#sendTo", "factures@dupont.fr");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#sendMail")]);
await page.waitForTimeout(800);
const urls = await page.evaluate(() => window.__urls);
ok(dl.suggestedFilename() === "F-2026-001 - Facture - Dupont SARL.pdf", "PDF téléchargé : « F-2026-001 - Facture - Dupont SARL.pdf »");
ok(urls.length === 1 && urls[0].startsWith("mailto:factures%40dupont.fr?subject=Facture%20n%C2%B0%20F-2026-001") && urls[0].includes("body=Bonjour"), "messagerie ouverte : adresse, objet et message remplis");
await page.click("#btnSend"); await page.waitForSelector("#sendModal.on");
ok((await page.inputValue("#sendTo")) === "factures@dupont.fr", "adresse corrigée enregistrée dans la fiche du client");
// 3. « Partager le PDF » (téléphone) : PDF joint
await page.click("#sendShare"); await page.waitForTimeout(600);
const sh = await page.evaluate(() => window.__shared);
ok(sh.length === 1 && sh[0].name === "F-2026-001 - Facture - Dupont SARL.pdf" && sh[0].type === "application/pdf" && sh[0].size > 1000 && /^Bonjour/.test(sh[0].text), "partage : PDF joint avec le message");
ok(!(await page.locator("#sendModal.on").count()), "fenêtre fermée après le partage");
// 4. devis pour un particulier
await fillDoc("particulier", "Mme Durand", "durand@ex.fr", 1000, true);
await page.click("#btnSave"); await page.waitForSelector("#sendModal.on", { timeout: 8000 }).catch(() => {});
const qb = await page.inputValue("#sendBody");
ok(/devis n° D-2026-001 du .*d'un montant total de 1 200,00 €, valable jusqu'au/.test(qb.replace(/ | /g, " ")), "devis : message avec montant et date de validité");
ok(!/2027/.test(await page.locator("#sendHint").textContent()), "devis / particulier : pas de rappel facture électronique");
await page.click("#sendNo");
// 5. réglage décoché : plus de fenêtre après l'émission, bouton toujours disponible
await page.click('[data-tab="settings"]'); await page.uncheck("#sSendPrompt"); await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
await fillDoc("pro", "Dupont SARL", "factures@dupont.fr", 50);
await page.click("#btnSave"); await page.waitForSelector("#modal.on"); await page.click("#mYes"); await waitToast(/émise/); await page.waitForTimeout(1500);
ok(!(await page.locator("#sendModal.on").count()) && await page.isVisible("#btnSend"), "réglage décoché : pas de fenêtre automatique, bouton « 📧 Envoyer au client » disponible");
ok(errs.length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

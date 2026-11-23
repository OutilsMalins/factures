// Période de prestation (du … au …) : saisie, contrôle, aperçu / PDF, facture électronique (BG-14 : BT-73 / BT-74),
// et alerte « action irréversible » avant l'émission.
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
}).listen(5063);
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

const OUT = path.join(HERE, "einvoice-out"); fs.mkdirSync(OUT, { recursive: true });
await page.goto("http://127.0.0.1:5063/");
await page.click('#authSeg button[data-v="signup"]');
await page.fill("#aEmail", "per@ex.fr"); await page.fill("#aPass", "motdepasse1"); await page.fill("#aPass2", "motdepasse1"); await page.check("#aTerms"); await page.click("#aSubmit");
await page.waitForSelector("#sName", { state: "visible", timeout: 15000 });
await page.fill("#sName", "Atelier Martin"); await page.fill("#sSiret", "732 829 320 00074"); await page.fill("#sAddr", "12 rue de la Paix\n75002 Paris");
await page.uncheck("#sFranchise"); await page.fill("#sTvaNum", "FR44732829320");
await page.uncheck("#sSendPrompt"); await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
await page.waitForTimeout(1200); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater");

await page.click('[data-tab="edit"]'); await page.click("#btnNewSide");
await page.click('#kindSeg button[data-v="pro"]'); await page.fill("#cName", "Dupont SARL"); await page.fill("#cSiren", "552100554"); await page.fill("#cAddr", "3 rue Neuve\n69001 Lyon");
await page.locator('[data-k="desc"]').first().fill("Entretien mensuel"); await page.locator('[data-k="price"]').first().fill("300");
ok(!(await page.isVisible("#serviceEnd")), "par défaut : une seule date de prestation");
await page.check("#hasPeriod");
ok(await page.isVisible("#serviceEnd"), "case « Sur une période » : champ de fin de période affiché");
await page.fill("#serviceDate", "2026-10-01"); await page.fill("#serviceEnd", "2026-09-15");
await clearToast(); await page.click("#btnSave");
ok(/fin de la période/.test(await waitToast(/période/)) && !(await page.locator("#modal.on").count()), "fin avant le début : émission refusée avec un message clair");
await page.fill("#serviceEnd", "2026-10-31");
if (process.env.SHOT) await page.locator("#edCards .card").first().screenshot({ path: process.env.SHOT + "-champ.png" });
const meta = await page.locator(".sh-meta").textContent();
ok(/Prestation du/i.test(meta) && meta.includes("01/10 au 31/10/2026"), "aperçu : « Prestation du 01/10 au 31/10/2026 »");
await page.click("#btnSave"); await page.waitForSelector("#modal.on");
if (process.env.SHOT) await page.locator("#modal .modal").screenshot({ path: process.env.SHOT + "-emettre.png" });
ok(await page.isVisible("#mWarn") && /irréversible/.test(await page.locator("#mWarn").textContent()), "confirmation d'émission : alerte « Action irréversible » bien visible");
ok((await page.locator("#mYes").textContent()) === "Oui, émettre définitivement", "bouton « Oui, émettre définitivement »");
await clearToast(); await page.click("#mYes"); await waitToast(/émise/);
ok(await page.isDisabled("#hasPeriod") && await page.isDisabled("#serviceEnd"), "facture émise : la période est verrouillée");
// facture électronique : période de facturation (BT-73 / BT-74) au lieu d'une date de livraison
// virement sans IBAN : export refusé avec une explication (règles EN 16931 BR-61 / CII-SR-470)
await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on");
ok(/indique ton IBAN/.test(await page.locator("#eiPb").textContent()), "virement sans IBAN : export refusé, IBAN demandé");
await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelector("#eiModal").classList.remove("on"));
await page.click('[data-tab="settings"]'); await page.fill("#sIban", "FR76 3000 6000 0112 3456 7890 189"); await page.fill("#sBic", "AGRIFRPP");
await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i); await page.click('[data-tab="edit"]'); await page.waitForTimeout(300);
const files = [];
for (const [fmt, ext] of [["fx", "pdf"], ["cii", "xml"], ["ubl", "xml"]]) {
  await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(`#eiOpts [data-ei="${fmt}"]`)]);
  const f = path.join(OUT, `periode-${fmt}.${ext}`); await dl.saveAs(f); files.push(f); await page.waitForTimeout(300);
}
const cii = fs.readFileSync(files[1], "utf8"), ubl = fs.readFileSync(files[2], "utf8");
ok(/<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">20261001<\/udt:DateTimeString><\/ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">20261031</.test(cii) && !/ActualDeliverySupplyChainEvent/.test(cii), "CII : période du 01/10 au 31/10/2026 (BillingSpecifiedPeriod)");
ok(/<cac:InvoicePeriod><cbc:StartDate>2026-10-01<\/cbc:StartDate><cbc:EndDate>2026-10-31<\/cbc:EndDate><\/cac:InvoicePeriod>/.test(ubl) && !/ActualDeliveryDate/.test(ubl), "UBL : période du 01/10 au 31/10/2026 (InvoicePeriod)");
if (process.env.PYTHON) {
  let out = "", good = true; try { out = execFileSync(process.env.PYTHON, [path.join(HERE, "validate_einvoice.py"), ...files], { encoding: "utf8", env: process.env }); } catch (e) { good = false; out = (e.stdout || "") + (e.stderr || ""); }
  ok(good, "Factur-X, CII et UBL avec période : valides (XSD, EN 16931, règles françaises" + (process.env.VERAPDF_CP ? ", veraPDF" : "") + ")" + (good ? "" : "\n" + out.slice(-1500)));
} else console.log("  (validateurs officiels non lancés : variable PYTHON absente)");
// copie d'une facture : la période est à ressaisir
await page.click("#btnDup"); await page.waitForTimeout(300);
ok(!(await page.isChecked("#hasPeriod")) && !(await page.isVisible("#serviceEnd")), "copie d'une facture : période à ressaisir");
ok(errs.length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

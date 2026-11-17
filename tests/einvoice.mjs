// Facture électronique : crée de vraies factures dans l'appli (émulateur), les exporte en Factur-X / CII / UBL
// et les fait vérifier par les validateurs officiels (validate_einvoice.py : XSD + EN 16931 + règles françaises BR-FR + veraPDF).
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FB = HERE + "/node_modules/firebase13/";
const SRC = process.env.SRC || path.resolve(HERE, "..");
const OUT = process.env.OUT || path.join(HERE, "einvoice-out");
const PY = process.env.PYTHON || "python3";
const PROJECT = "demo-factures";
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

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
}).listen(5056);
const rulesTxt = fs.readFileSync(path.resolve(HERE, "../firestore.rules"), "utf8");
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: rulesTxt }] } }) });

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, deviceScaleFactor: process.env.SHOT ? 2 : 1 });
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await page.route(/www\.gstatic\.com\/firebasejs\/13\.3\.0\/(.*)$/, route => route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(FB + route.request().url().split("/").pop()) }));
const clearToast = () => page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
const waitToast = async (re, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await page.locator("#toast").textContent()) || ""; if (re.test(t)) return t; await page.waitForTimeout(150); } return (await page.locator("#toast").textContent()) || ""; };
const closeBackup = async () => { await page.waitForTimeout(700); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater"); };

async function signup(email) {
  await page.goto("http://127.0.0.1:5056/");
  await page.click('#authSeg button[data-v="signup"]');
  await page.fill("#aEmail", email); await page.fill("#aPass", "motdepasse1"); await page.fill("#aPass2", "motdepasse1");
  await page.check("#aTerms"); await page.click("#aSubmit");
  await page.waitForSelector("#sName", { state: "visible", timeout: 15000 });
}
async function settings({ franchise }) {
  await page.click('[data-tab="settings"]');
  await page.fill("#sName", "Atelier Martin & Fils"); await page.fill("#sSiret", "732 829 320 00074");
  await page.fill("#sAddr", "12 rue de la Paix\n75002 Paris"); await page.fill("#sEmail", "contact@atelier.example"); await page.fill("#sPhone", "01 23 45 67 89");
  if (franchise) await page.check("#sFranchise"); else { await page.uncheck("#sFranchise"); await page.fill("#sTvaNum", "FR44732829320"); }
  await page.fill("#sIban", "FR76 3000 6000 0112 3456 7890 189"); await page.fill("#sBic", "AGRIFRPP");
  await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i); await closeBackup();
}
async function newDoc({ kind = "pro", client = "Dupont SARL", siren = "552 100 554", tva = "", addr = "5 avenue Victor Hugo\n69002 Lyon", lines, nature = "services", autoliq = false, type = "facture" }) {
  await page.click('[data-tab="edit"]');
  await page.click(type === "devis" ? "#btnNewSideD" : "#btnNewSide");
  await page.click(`#kindSeg button[data-v="${kind}"]`);
  await page.fill("#cName", client); await page.fill("#cAddr", addr);
  if (kind === "pro") { await page.fill("#cSiren", siren); if (tva) await page.fill("#cTva", tva); }
  await page.click(`#natureSeg button[data-v="${nature}"]`);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.click("#btnAddLine");
    const l = lines[i], row = k => page.locator(`[data-k="${k}"]`).nth(i);
    await row("desc").fill(l.desc); await row("qty").fill(String(l.qty)); await row("unit").fill(l.unit || "u"); await row("price").fill(String(l.price));
    if (l.tva != null && await row("tva").count()) await row("tva").selectOption(String(l.tva));
  }
  if (autoliq) await page.check("#autoliq");
}
async function issue() { await clearToast(); await page.click("#btnSave"); await page.waitForSelector("#modal.on"); await page.click("#mYes"); return waitToast(/émis|Échec|refus|Accès/); }
async function exportAll(tag) {
  const files = [];
  for (const [fmt, ext] of [["fx", "pdf"], ["cii", "xml"], ["ubl", "xml"]]) {
    await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on");
    if (process.env.SHOT && tag.startsWith("1-") && fmt === "fx") { await page.click("#eiModal summary"); await page.locator("#eiModal .modal").screenshot({ path: process.env.SHOT }); await page.click("#eiModal summary"); }
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(`#eiOpts [data-ei="${fmt}"]`)]);
    const f = path.join(OUT, `${tag}-${fmt}.${ext}`); await dl.saveAs(f); files.push(f);
  }
  return files;
}

const all = [];
console.log("Entreprise à la TVA");
await signup("tva@ex.fr"); await settings({ franchise: false });
await newDoc({ lines: [{ desc: "Pose de carrelage", qty: 12.5, unit: "m²", price: 42, tva: 20 }, { desc: "Déplacement", qty: 1, unit: "forfait", price: 35, tva: 10 }, { desc: "Main-d'œuvre", qty: 3, unit: "h", price: 48.5, tva: 20 }], nature: "mixte" });
let t = await issue(); ok(/émise/.test(t), "facture TVA émise : " + t);
ok(await page.locator("#btnEInv").isVisible(), "bouton « Facture électronique » visible sur une facture émise");
all.push(...await exportAll("1-facture-tva"));
await page.click("#btnMakeAvoir"); await page.locator('[data-k="price"]').nth(0).fill("10"); t = await issue(); ok(/émis/.test(t), "avoir émis : " + t);
all.push(...await exportAll("2-avoir"));
await newDoc({ client: "Bâti Pro SAS", siren: "40483304800022", tva: "FR83404833048", lines: [{ desc: "Sous-traitance maçonnerie", qty: 1, unit: "forfait", price: 1800 }], autoliq: true });
t = await issue(); ok(/émise/.test(t), "facture autoliquidation émise : " + t);
all.push(...await exportAll("3-autoliquidation"));
// devis → acompte → facture finale (cadre S4)
await newDoc({ type: "devis", lines: [{ desc: "Rénovation salle de bain", qty: 1, unit: "forfait", price: 5000, tva: 10 }] });
await clearToast(); await page.click("#btnSave"); await waitToast(/enregistré/);
await page.click("#btnAcompte"); await page.waitForSelector("#acModal.on"); await page.fill("#acVal", "30"); await page.click("#acYes");
t = await issue(); ok(/émise/.test(t), "facture d'acompte émise : " + t);
all.push(...await exportAll("4-acompte"));
await page.click('[data-tab="quotes"]'); await page.waitForTimeout(400);
await page.locator("#qList tr.click").first().click();
await page.waitForTimeout(400);
if (await page.locator("#btnToInvoice").isVisible()) { await page.click("#btnToInvoice"); t = await issue(); ok(/émise/.test(t), "facture finale (acompte déduit) émise : " + t); all.push(...await exportAll("5-facture-finale")); }
else ok(false, "devis introuvable pour la facture finale");
// client particulier : export refusé avec explication
await newDoc({ kind: "particulier", client: "Mme Petit", lines: [{ desc: "Coupe", qty: 1, unit: "u", price: 30, tva: 20 }] });
t = await issue(); await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on");
ok(/clients professionnels/.test(await page.locator("#eiPb").textContent()) && await page.locator('#eiOpts [data-ei="fx"]').isDisabled(), "client particulier : export désactivé avec explication");
await page.click("#eiClose");
// client pro sans SIREN : explication
await newDoc({ client: "Sans Siren SARL", siren: "", lines: [{ desc: "Conseil", qty: 1, unit: "h", price: 80, tva: 20 }] });
await issue(); await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on");
ok(/SIREN du client/.test(await page.locator("#eiPb").textContent()), "client pro sans SIREN : on demande le SIREN");
await page.click("#eiClose");

console.log("Entreprise en franchise de TVA");
await page.click("#btnLogout"); await page.waitForTimeout(500); if (await page.locator("#modal.on").count()) await page.click("#mYes");
await page.waitForSelector("#aEmail", { state: "visible", timeout: 15000 });
await signup("franchise@ex.fr"); await settings({ franchise: true });
await newDoc({ client: "Boulangerie Moreau", siren: "123456782", lines: [{ desc: "Création d'un site vitrine", qty: 1, unit: "forfait", price: 900 }, { desc: "Formation", qty: 2, unit: "h", price: 45 }] });
t = await issue(); ok(/émise/.test(t), "facture en franchise émise : " + t);
all.push(...await exportAll("6-franchise"));

console.log("Validation officielle (XSD + EN 16931 + BR-FR" + (process.env.VERAPDF_CP ? " + veraPDF PDF/A-3b" : "") + ")");
let out = "";
try { out = execFileSync(PY, [path.join(HERE, "validate_einvoice.py"), ...all], { encoding: "utf8", env: process.env }); ok(true, "les " + all.length + " fichiers sont valides"); }
catch (e) { out = (e.stdout || "") + (e.stderr || ""); ok(false, "fichiers invalides"); }
console.log(out.split("\n").map(l => "       " + l).join("\n"));
ok(errs.filter(e => !/favicon|ERR_|net::/.test(e)).length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

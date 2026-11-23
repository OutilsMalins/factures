// E-reporting : crée de vraies factures à des dates choisies et vérifie le récapitulatif (flux 10.3 / 10.4)
// au centime près, pour la franchise de TVA, le réel simplifié et le réel normal mensuel (décades).
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
}).listen(5057);
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.resolve(HERE, "../firestore.rules"), "utf8") }] } }) });

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, deviceScaleFactor: process.env.SHOT ? 2 : 1 });
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await page.route(/www\.gstatic\.com\/firebasejs\/13\.3\.0\/(.*)$/, route => route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(FB + route.request().url().split("/").pop()) }));
const clearToast = () => page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
const waitToast = async (re, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = (await page.locator("#toast").textContent()) || ""; if (re.test(t)) return t; await page.waitForTimeout(150); } return (await page.locator("#toast").textContent()) || ""; };
const closeBackup = async () => { await page.waitForTimeout(700); if (await page.locator("#bkModal.on").count()) await page.click("#bkLater"); };

async function signup(email) {
  await page.goto("http://127.0.0.1:5057/");
  await page.click('#authSeg button[data-v="signup"]');
  await page.fill("#aEmail", email); await page.fill("#aPass", "motdepasse1"); await page.fill("#aPass2", "motdepasse1");
  await page.check("#aTerms"); await page.click("#aSubmit");
  await page.waitForSelector("#sName", { state: "visible", timeout: 15000 });
}
async function settings({ franchise, regime, debits = false }) {
  await page.click('[data-tab="settings"]');
  await page.fill("#sName", "Atelier Martin"); await page.fill("#sSiret", "732 829 320 00074"); await page.fill("#sAddr", "12 rue de la Paix\n75002 Paris"); await page.fill("#sIban", "FR76 3000 6000 0112 3456 7890 189");
  if (franchise) await page.check("#sFranchise"); else { await page.uncheck("#sFranchise"); await page.fill("#sTvaNum", "FR44732829320"); await page.selectOption("#sRegime", regime); if (debits) await page.check("#sDebits"); }
  await page.uncheck("#sSendPrompt"); await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i); await closeBackup();
}
async function invoice({ kind = "particulier", client = "Mme Petit", nature = "services", date, lines, rg }) {
  await page.click('[data-tab="edit"]'); await page.click("#btnNewSide");
  await page.click(`#kindSeg button[data-v="${kind}"]`); await page.fill("#cName", client);
  if (kind === "pro") await page.fill("#cSiren", "552100554");
  await page.click(`#natureSeg button[data-v="${nature}"]`);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.click("#btnAddLine");
    const l = lines[i], row = k => page.locator(`[data-k="${k}"]`).nth(i);
    await row("desc").fill(l.desc); await row("qty").fill(String(l.qty || 1)); await row("price").fill(String(l.price));
    if (l.tva != null && await row("tva").count()) await row("tva").selectOption(String(l.tva));
  }
  if (rg) { await page.check("#rgOn"); await page.fill("#rgRate", String(rg)); await page.locator("#rgRate").dispatchEvent("change"); }
  await page.fill("#issueDate", date); await page.locator("#issueDate").dispatchEvent("change");
  await clearToast(); await page.click("#btnSave"); await page.waitForSelector("#modal.on"); await page.click("#mYes");
  return waitToast(/émis|Échec|refus|Accès|date/);
}
async function avoirOfCurrent(date, price) {
  await page.click("#btnMakeAvoir"); await page.locator('[data-k="price"]').nth(0).fill(String(price));
  await page.fill("#issueDate", date); await page.locator("#issueDate").dispatchEvent("change");
  await clearToast(); await page.click("#btnSave"); await page.waitForSelector("#modal.on"); await page.click("#mYes"); return waitToast(/émis|Échec|refus/);
}
async function payFirst(number, date) {   // « Payée » depuis la liste des factures
  await page.click('[data-tab="list"]'); await page.waitForTimeout(400);
  const row = page.locator("#invList tr").filter({ hasText: number }).first();
  await row.locator("[data-paid]").click(); await page.fill("#payDate", date); await clearToast(); await page.click("#payYes");
  return waitToast(/paiement enregistré|Accès|Échec/);
}
async function openER(label) {
  await page.click('[data-tab="list"]'); await page.click("#btnEReport"); await page.waitForSelector("#erModal.on");
  if (label) { const v = await page.locator("#erPeriod option").evaluateAll((os, l) => (os.find(o => o.textContent.startsWith(l)) || {}).value, label); await page.selectOption("#erPeriod", v); }
  return (await page.locator("#erBody").textContent()).replace(/\s+/g, " ").replace(/ /g, " ");
}
async function csvOf() { const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#erCsv")]); return fs.readFileSync(await dl.path(), "utf8"); }
const has = (txt, ...parts) => parts.every(p => txt.includes(p));

console.log("Franchise de TVA (bimestre septembre-octobre 2026)");
await signup("er-franchise@ex.fr"); await settings({ franchise: true });
await invoice({ date: "2026-09-15", lines: [{ desc: "Coupe", price: 30 }] });
await invoice({ date: "2026-10-05", lines: [{ desc: "Coupe + couleur", price: 65 }] });
await invoice({ date: "2026-10-05", client: "M. Durand", lines: [{ desc: "Coupe", price: 25 }] });
await invoice({ date: "2026-10-05", nature: "biens", client: "M. Durand", lines: [{ desc: "Shampoing", qty: 2, price: 12.5 }] });
let t = await invoice({ date: "2026-10-20", lines: [{ desc: "Brushing", price: 40 }] });
ok(/émise/.test(t), "factures de septembre-octobre émises");
t = await avoirOfCurrent("2026-10-25", 10); ok(/émis/.test(t), "avoir partiel émis le 25/10");
await invoice({ date: "2026-11-02", lines: [{ desc: "Coupe", price: 30 }] });   // hors période
ok(/Payée|paiement/.test(await payFirst("F-2026-002", "2026-10-06")), "paiement de F-2026-002 indiqué le 06/10");
await payFirst("F-2026-004", "2026-10-07");   // vente de biens : pas d'encaissement à déclarer
let er = await openER("septembre-octobre 2026");
ok(has(er, "Franchise en base de TVA", "30/11/2026"), "régime et date limite (fin du mois suivant le bimestre) : " + er.slice(0, 120));
ok(has(er, "05/10/2026", "Prestations de services (TPS1)", "90,00 €"), "05/10 : 2 prestations de services = 90,00 € HT");
ok(has(er, "Ventes de biens (TLB1)", "25,00 €"), "05/10 : vente de biens 25,00 € HT (catégorie TLB1)");
ok(has(er, "15/09/2026", "20/10/2026", "25/10/2026", "-10,00 €"), "15/09, 20/10 et avoir du 25/10 (-10,00 €)");
ok(has(er, "Total de la période", "175,00 €") && !er.includes("02/11/2026"), "total 175,00 € HT (30 + 90 + 25 + 40 − 10), la vente de novembre est exclue");
ok(has(er, "06/10/2026", "65,00 €", "Total encaissé") && !er.includes("07/10/2026"), "encaissement services du 06/10 (65,00 €), pas la vente de biens");
let csv = await csvOf();
ok(csv.includes("Ventes aux particuliers (flux 10.3);05/10/2026;TPS1;2;0;90,00;0,00;") && csv.includes("Encaissements services particuliers (flux 10.4);06/10/2026;;;0;;;65,00"), "fichier CSV : lignes 10.3 et 10.4 correctes");
if (process.env.SHOT) await page.locator("#erModal .modal").screenshot({ path: process.env.SHOT });
await page.click("#erClose");
// facture électronique d'une entreprise en franchise sans n° de TVA → catégorie Z (règle G1.47)
await invoice({ kind: "pro", client: "Boulangerie Moreau", date: "2026-11-05", lines: [{ desc: "Site vitrine", price: 900 }] });
await page.click("#btnEInv"); await page.waitForSelector("#eiModal.on");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click('#eiOpts [data-ei="cii"]')]);
const xml = fs.readFileSync(await dl.path(), "utf8");
ok(xml.includes("<ram:CategoryCode>Z</ram:CategoryCode>") && !xml.includes("VATEX-FR-FRANCHISE") && xml.includes('schemeID="FC"'), "facture électronique en franchise sans n° de TVA : catégorie Z (règle G1.47)");
fs.mkdirSync(path.join(HERE, "einvoice-out"), { recursive: true }); fs.writeFileSync(path.join(HERE, "einvoice-out", "7-franchise-Z-cii.xml"), xml);

// retenue de garantie : seul le montant réellement encaissé est compté
await invoice({ date: "2026-11-06", client: "M. Bernard", lines: [{ desc: "Rénovation salle de bain", price: 2000 }], rg: 5 });
await payFirst("F-2026-008", "2026-11-07");
er = await openER("novembre-décembre 2026");
ok(has(er, "07/11/2026", "1 900,00 €", "retenue de garantie (100,00 €) n'est pas encore reçue"), "encaissement avec retenue de garantie : 1 900,00 € comptés, retenue signalée");
await page.click("#erClose");
await page.click('[data-tab="list"]'); await page.waitForTimeout(300);
await page.locator("#invList tr").filter({ hasText: "F-2026-008" }).first().locator("[data-rg]").click();
await page.fill("#rgDate", "2026-12-15"); await clearToast(); await page.click("#rgYes"); await waitToast(/retenue/);
er = await openER("novembre-décembre 2026");
ok(has(er, "15/12/2026", "100,00 €") && !er.includes("pas encore reçue"), "retenue reçue le 15/12 : 100,00 € encaissés à cette date");
await page.click("#erClose");

console.log("Réel simplifié (mois d'octobre 2026)");
await page.click("#btnLogout"); await page.waitForTimeout(500); if (await page.locator("#modal.on").count()) await page.click("#mYes");
await page.waitForSelector("#aEmail", { state: "visible", timeout: 15000 });
await signup("er-simplifie@ex.fr"); await settings({ franchise: false, regime: "simplifie" });
await invoice({ date: "2026-10-03", nature: "mixte", lines: [{ desc: "Pose", qty: 2, price: 50, tva: 10 }, { desc: "Fournitures", price: 33.33, tva: 20 }] });
await invoice({ date: "2026-10-03", kind: "pro", client: "Dupont SARL", lines: [{ desc: "Maintenance", price: 200, tva: 20 }] });
await payFirst("F-2026-002", "2026-10-15");
er = await openER("octobre 2026");
ok(has(er, "Réel simplifié", "30/11/2026"), "réel simplifié : période mensuelle, date limite fin du mois suivant");
ok(has(er, "03/10/2026", "10 %", "100,00 €", "10,00 €", "20 %", "33,33 €", "6,67 €"), "TVA par taux : 100,00 € à 10 % (10,00 €) et 33,33 € à 20 % (6,67 €)");
ok(!er.includes("Dupont") || has(er, "Clients professionnels"), "la facture pro n'est pas dans les ventes aux particuliers");
ok(has(er, "loi anti-fraude"), "encaissements particuliers : explication loi anti-fraude (pas de suivi dans l'appli)");
ok(has(er, "Clients professionnels", "F-2026-002", "Dupont SARL", "15/10/2026", "240,00 €"), "rappel : facture pro payée → statut « Encaissée » sur la plateforme");
ok(has(er, "biens et services mélangés"), "facture mixte signalée (comptée en services)");
await page.click("#erClose");

console.log("Réel normal mensuel (décades)");
await page.click('[data-tab="settings"]'); await page.selectOption("#sRegime", "normal_m"); await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
er = await openER("1-10 octobre 2026");
ok(has(er, "Réel normal (déclaration mensuelle)", "20/10/2026", "03/10/2026") && has(er, "10/11/2026"), "décade du 1 au 10 : date limite le 20, paiements du mois au 10 du mois suivant");
const opts = await page.locator("#erPeriod option").allTextContents();
ok(opts.some(o => o.startsWith("11-20 octobre 2026")) && opts.some(o => o.startsWith("21-31 octobre 2026")), "les 3 décades d'octobre sont proposées");
await page.click("#erClose");
await page.click('[data-tab="settings"]'); await page.check("#sDebits"); await clearToast(); await page.click("#btnSettingsSave"); await waitToast(/enregistr/i);
er = await openER("1-10 octobre 2026");
ok(has(er, "TVA sur les débits", "pas de données de paiement"), "option débits : pas de données de paiement");

ok(errs.filter(e => !/favicon|ERR_|net::/.test(e)).length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
console.log(`\n${pass} ok, ${fail} échec(s)`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);

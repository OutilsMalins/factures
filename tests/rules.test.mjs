// Tests des règles Firestore (firestore.rules) contre l'émulateur. Voir tests/README.md.
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, runTransaction } from "firebase/firestore";
import fs from "node:fs";

const RULES = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId: "demo-factures", firestore: { rules: RULES, host: "127.0.0.1", port: 8080 } });

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.message || e).split("\n")[0]); }
}
const A = "alice", B = "bob", C = "carol", X = "mallory";
const ctx = (uid, email) => env.authenticatedContext(uid, { email: email || uid + "@ex.fr", email_verified: true }).firestore();
const P = id => `users/${A}` + (id ? "/" + id : "");

async function seed(extra = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, P()), { name: "Atelier", franchise: false, counters: { facture: 5, avoir: 1, devis: 3 }, nextNumber: 5, lastIssue: { facture: "2026-11-10" }, ...extra });
    await setDoc(doc(db, P("members/" + B)), { email: "bob@ex.fr", perms: {} });                       // droits par défaut
    await setDoc(doc(db, P("members/" + C)), { email: "carol@ex.fr", perms: { invoices: false, quotes: true } });
    await setDoc(doc(db, P("invoices/old4")), { type: "facture", number: "F-2026-004", seq: 4, seqKey: "facture", issueDate: "2026-11-10", status: "envoyee", franchise: false, client: { kind: "pro" }, lines: [] });
    await setDoc(doc(db, P("invoices/legacyB2C")), { type: "facture", number: "F-2026-003", issueDate: "2026-11-01", status: "envoyee", client: { kind: "particulier" }, lines: [] });   // ancienne : pas de champ franchise
    await setDoc(doc(db, P("invoices/b2c")), { type: "facture", number: "F-2026-002", issueDate: "2026-11-01", status: "envoyee", franchise: false, client: { kind: "particulier" }, lines: [] });
    await setDoc(doc(db, P("invoices/draft1")), { type: "facture", number: null, status: "brouillon", issueDate: "2026-11-16", client: { kind: "pro" }, lines: [] });
    await setDoc(doc(db, P("invoices/q1")), { type: "devis", number: "D-2026-002", seq: 2, seqKey: "devis", status: "envoye", client: { kind: "pro" }, lines: [] });
  });
}
// émission comme le fait l'appli : compteur + document (+ PDF) dans la même opération
function issueBatch(db, id, { seq = 5, key = "facture", type = "facture", date = "2026-11-16", number, counter, lastIssue, pdf = true, status = "envoyee", client = { kind: "pro" }, base = {} } = {}) {
  const b = writeBatch(db);
  const prof = { counters: { [key]: counter ?? seq + 1 }, lastIssuedId: id };
  if (key === "facture") prof.nextNumber = (counter ?? seq + 1);
  if (type !== "devis") prof.lastIssue = { [type]: lastIssue ?? date };
  b.set(doc(db, P()), prof, { merge: true });
  b.set(doc(db, P("invoices/" + id)), { ...base, type, number: number ?? `${type === "devis" ? "D" : type === "avoir" ? "A" : "F"}-2026-${String(seq).padStart(3, "0")}`, seq, seqKey: key, issueDate: date, status, franchise: false, client, lines: [] });
  if (pdf) b.set(doc(db, P("pdfs/" + id)), { b64: "x", size: 1, number: "n", locked: type !== "devis" });
  return b.commit();
}

console.log("Émission");
await seed();
await t("propriétaire émet une facture (brouillon existant)", () => assertSucceeds(issueBatch(ctx(A), "draft1")));
await seed();
await t("propriétaire émet une facture neuve", () => assertSucceeds(issueBatch(ctx(A), "n1")));
await seed();
await t("membre émet une facture", () => assertSucceeds(issueBatch(ctx(B), "n1")));
await seed();
await t("membre émet en sautant un numéro déjà pris (seq > compteur)", () => assertSucceeds(issueBatch(ctx(B), "n1", { seq: 7 })));
await seed();
await t("REFUS numéro en arrière (seq < compteur)", () => assertFails(issueBatch(ctx(A), "n1", { seq: 4 })));
await t("REFUS compteur pas avancé correctement", () => assertFails(issueBatch(ctx(A), "n1", { counter: 9 })));
await t("REFUS numéro qui ne correspond pas à seq", () => assertFails(issueBatch(ctx(A), "n1", { number: "F-2026-099" })));
await t("REFUS date antérieure à la dernière émise", () => assertFails(issueBatch(ctx(A), "n1", { date: "2026-11-01" })));
await t("REFUS lastIssue pas mis à jour", () => assertFails(issueBatch(ctx(A), "n1", { lastIssue: "2026-12-31" })));
await t("REFUS émission sans le compteur dans la même opération", () => assertFails(setDoc(doc(ctx(A), P("invoices/n1")), { type: "facture", number: "F-2026-005", seq: 5, seqKey: "facture", issueDate: "2026-11-16", status: "envoyee", client: { kind: "pro" }, lines: [] })));
await t("REFUS membre sans droit factures (carol)", () => assertFails(issueBatch(ctx(C), "n1")));
await t("REFUS émise directement « payée » pour un particulier (assujetti)", () => assertFails(issueBatch(ctx(A), "n1", { status: "payee", client: { kind: "particulier" } })));
await t("émise directement « payée » pour un pro", () => assertSucceeds(issueBatch(ctx(A), "n1", { status: "payee" })));
await seed({ counters: { "facture:2026": 2 }, numReset: true });
await t("numérotation remise à zéro chaque année (clé facture:2026)", () => assertSucceeds(issueBatch(ctx(A), "n1", { seq: 2, key: "facture:2026" })));
await seed({ counters: {}, nextNumber: 8 });
await t("ancien compteur nextNumber repris", () => assertSucceeds(issueBatch(ctx(A), "n1", { seq: 8 })));
await seed({ counters: {}, nextNumber: 8 });
await t("REFUS en dessous de l'ancien nextNumber", () => assertFails(issueBatch(ctx(A), "n1", { seq: 7 })));
await seed();
await t("avoir émis (série séparée, sans date antérieure)", () => assertSucceeds(issueBatch(ctx(A), "a1", { type: "avoir", key: "avoir", seq: 1 })));
await env.clearFirestore();
await t("première facture alors que la fiche entreprise n'existe pas encore", () => assertSucceeds(issueBatch(ctx(A), "n1", { seq: 1 })));

console.log("Compteurs");
await seed();
await t("REFUS membre change le compteur seul", () => assertFails(setDoc(doc(ctx(B), P()), { counters: { facture: 2 } }, { merge: true })));
await t("REFUS membre rejoue une ancienne facture pour reculer le compteur", () => assertFails(setDoc(doc(ctx(B), P()), { counters: { facture: 5 }, lastIssuedId: "old4" }, { merge: true })));
await t("REFUS membre touche lastIssue d'un autre type en émettant", async () => {
  const db = ctx(B), b = writeBatch(db);
  b.set(doc(db, P()), { counters: { facture: 6 }, nextNumber: 6, lastIssuedId: "n1", lastIssue: { facture: "2026-11-16", avoir: "2000-01-01" } }, { merge: true });
  b.set(doc(db, P("invoices/n1")), { type: "facture", number: "F-2026-005", seq: 5, seqKey: "facture", issueDate: "2026-11-16", status: "envoyee", franchise: false, client: { kind: "pro" }, lines: [] });
  await assertFails(b.commit());
});
await t("propriétaire change le prochain numéro dans les réglages", () => assertSucceeds(setDoc(doc(ctx(A), P()), { counters: { facture: 20 }, nextNumber: 20 }, { merge: true })));
await t("REFUS membre sans droit « entreprise » change le nom", () => assertFails(setDoc(doc(ctx(B), P()), { name: "Pirate" }, { merge: true })));

console.log("Devis");
await seed();
await t("devis numéroté à son premier enregistrement", () => assertSucceeds(issueBatch(ctx(A), "q2", { type: "devis", key: "devis", seq: 3, pdf: true })));
await seed();
await t("devis modifié (numéro inchangé)", () => assertSucceeds(updateDoc(doc(ctx(A), P("invoices/q1")), { notes: "x" })));
await t("REFUS numéro de devis modifié", () => assertFails(updateDoc(doc(ctx(A), P("invoices/q1")), { number: "D-2026-099" })));
await t("REFUS devis transformé en facture (changement de type)", () => assertFails(updateDoc(doc(ctx(A), P("invoices/q1")), { type: "facture" })));
await t("devis « transformé » par un membre qui n'a que le droit factures", async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), P("members/" + C)), { email: "carol@ex.fr", perms: { invoices: true, quotes: false } }));
  await assertSucceeds(updateDoc(doc(ctx(C), P("invoices/q1")), { status: "accepte", convertedTo: { id: "f", number: "F" } }));
});

console.log("Brouillons et documents émis");
await seed();
await t("brouillon enregistré par un membre", () => assertSucceeds(setDoc(doc(ctx(B), P("invoices/d2")), { type: "facture", number: null, status: "brouillon", client: { kind: "pro" }, lines: [] })));
await t("brouillon modifié", () => assertSucceeds(updateDoc(doc(ctx(A), P("invoices/draft1")), { notes: "x" })));
await t("brouillon supprimé", () => assertSucceeds(deleteDoc(doc(ctx(A), P("invoices/draft1")))));
await t("REFUS facture émise modifiée", () => assertFails(updateDoc(doc(ctx(A), P("invoices/old4")), { lines: [{ desc: "x" }] })));
await t("REFUS facture émise supprimée", () => assertFails(deleteDoc(doc(ctx(A), P("invoices/old4")))));
await t("PDF ajouté après coup à une facture émise (une fois)", () => assertSucceeds(updateDoc(doc(ctx(A), P("invoices/old4")), { pdf: { size: 1, at: 1 } })));
await t("REFUS PDF remplacé une 2e fois", () => assertFails(updateDoc(doc(ctx(A), P("invoices/old4")), { pdf: { size: 2, at: 2 } })));
await t("REFUS autre personne (non membre) lit les factures", () => assertFails(getDoc(doc(ctx(X), P("invoices/old4")))));

console.log("Paiements (loi anti-fraude)");
await seed();
await t("facture pro marquée payée", () => assertSucceeds(updateDoc(doc(ctx(B), P("invoices/old4")), { status: "payee", paidAt: "2026-11-16", paidMethod: "virement", updatedAt: 1 })));
await t("REFUS particulier, entreprise assujettie", () => assertFails(updateDoc(doc(ctx(A), P("invoices/b2c")), { status: "payee", paidAt: "2026-11-16", paidMethod: "cheque", updatedAt: 1 })));
await t("REFUS ancienne facture particulier sans champ franchise, entreprise assujettie", () => assertFails(updateDoc(doc(ctx(A), P("invoices/legacyB2C")), { status: "payee", paidAt: "2026-11-16", paidMethod: "cheque", updatedAt: 1 })));
await seed({ franchise: true });
await t("ancienne facture particulier sans champ franchise, entreprise en franchise", () => assertSucceeds(updateDoc(doc(ctx(A), P("invoices/legacyB2C")), { status: "payee", paidAt: "2026-11-16", paidMethod: "cheque", updatedAt: 1 })));
await t("REFUS facture figée « assujettie » même si l'entreprise est passée en franchise", () => assertFails(updateDoc(doc(ctx(A), P("invoices/b2c")), { status: "payee", paidAt: "2026-11-16", paidMethod: "cheque", updatedAt: 1 })));

console.log("Retenue de garantie (V5)");
await seed();
await env.withSecurityRulesDisabled(async c => { const db = c.firestore();
  await setDoc(doc(db, P("invoices/rgPro")), { type: "facture", number: "F-2026-010", issueDate: "2026-11-10", status: "payee", paidAt: "2026-11-12", rg: 5, franchise: false, client: { kind: "pro" }, lines: [] });
  await setDoc(doc(db, P("invoices/rgB2C")), { type: "facture", number: "F-2026-011", issueDate: "2026-11-10", status: "envoyee", rg: 5, franchise: false, client: { kind: "particulier" }, lines: [] }); });
await t("date de versement de la retenue enregistrée (membre avec droit paiements)", () => assertSucceeds(updateDoc(doc(ctx(B), P("invoices/rgPro")), { rgPaidAt: "2027-11-15", updatedAt: 1 })));
await t("REFUS retenue sur une facture sans retenue", () => assertFails(updateDoc(doc(ctx(A), P("invoices/old4")), { rgPaidAt: "2027-11-15", updatedAt: 1 })));
await t("REFUS retenue d'un particulier (entreprise assujettie, loi anti-fraude)", () => assertFails(updateDoc(doc(ctx(A), P("invoices/rgB2C")), { rgPaidAt: "2027-11-15", updatedAt: 1 })));
await t("REFUS en profiter pour changer le montant de la retenue", () => assertFails(updateDoc(doc(ctx(A), P("invoices/rgPro")), { rgPaidAt: "2027-11-16", rg: 2, updatedAt: 2 })));
await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), P("members/" + C)), { email: "carol@ex.fr", perms: { payments: false } }));
await t("REFUS membre sans droit paiements", () => assertFails(updateDoc(doc(ctx(C), P("invoices/rgPro")), { rgPaidAt: "2027-11-17", updatedAt: 3 })));

console.log("Suppression du compte");
await seed();
await env.withSecurityRulesDisabled(async c => { const db = c.firestore(); for (let i = 0; i < 30; i++) await setDoc(doc(db, P("invoices/L" + i)), { type: "facture", number: "F-" + i, status: "envoyee", lines: [] }); });
await t("REFUS sans fermeture en cours", () => assertFails(deleteDoc(doc(ctx(A), P("invoices/L0")))));
await setDoc(doc(ctx(A), P()), { closing: Date.now() }, { merge: true });
await t("lot de 10 documents émis supprimé pendant la fermeture", async () => { const db = ctx(A), b = writeBatch(db); for (let i = 0; i < 10; i++) b.delete(doc(db, P("invoices/L" + i))); await assertSucceeds(b.commit()); });
await t("(info) lot de 20 documents émis", async () => { const db = ctx(A), b = writeBatch(db); for (let i = 10; i < 30; i++) b.delete(doc(db, P("invoices/L" + i))); await assertSucceeds(b.commit()); });
await t("REFUS un membre ne peut pas lancer la fermeture", () => assertFails(setDoc(doc(ctx(B), P()), { closing: Date.now() }, { merge: true })));

console.log("Équipe");
await env.clearFirestore();
await setDoc(doc(ctx(A), "invites/dan@ex.fr"), { owner: A, ownerName: "Atelier", email: "dan@ex.fr", at: 1, perms: { company: false } });
await t("invitation acceptée (email vérifié, mêmes droits)", () => assertSucceeds(setDoc(doc(ctx("dan", "dan@ex.fr"), `users/${A}/members/dan`), { email: "dan@ex.fr", joinedAt: 1, perms: { company: false } })));
await setDoc(doc(ctx(A), "invites/eve@ex.fr"), { owner: A, ownerName: "Atelier", email: "eve@ex.fr", at: 1, perms: { company: false } });
await t("REFUS invitation acceptée en s'ajoutant des droits", () => assertFails(setDoc(doc(ctx("eve", "eve@ex.fr"), `users/${A}/members/eve`), { email: "eve@ex.fr", joinedAt: 1, perms: { company: true } })));

console.log(`\n${pass} ok, ${fail} échec(s)`);
await env.cleanup();
process.exit(fail ? 1 : 0);

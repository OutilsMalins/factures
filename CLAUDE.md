# Mes factures — contexte du projet (à lire avant toute modification)

Appli web de facturation de Tani LANNOY (« Outils Malins »), d'abord pour un ami artisan, puis ouverte à toute entreprise via des comptes.
Site : https://outilsmalins.github.io/factures/ — dépôt `OutilsMalins/factures` (GitHub Pages, branche `main`).
Tani n'est pas développeur : réponses en français, simples, tutoiement ; il valide en relisant puis en cliquant sur « Merge ».

## Architecture
- **Un seul fichier `index.html`** (~760 Ko) : HTML + CSS + `<script type="module">`.
  - Firebase JS SDK **13.3.0** importé depuis `www.gstatic.com` (auth + firestore). Projet Firebase `factures-outilsmalins`, Firestore région **europe-west9 (Paris)**, offre **Spark (gratuite)**, **pas de Storage** (payant depuis février 2026).
  - **jsPDF 2.5.1 et JSZip 3.10.1 intégrés dans la page** (pas de fichier séparé : le téléchargement de `.js` est bloqué chez Tani, et c'est voulu pour le RGPD).
  - Polices **Manrope** et **Bricolage Grotesque** intégrées en base64 (`@font-face`). **Aucun appel à Google Fonts ni à un CDN** : seul Firebase est autorisé (RGPD, déclaré dans les mentions légales). Ne pas réintroduire de ressource externe.
- `mentions-legales.html` : mentions légales + politique de confidentialité + CGU + clause de sous-traitance art. 28 RGPD (version du 15/11/2026, polices intégrées aussi).
- `sw.js` (cache `factures-v3`, réseau d'abord, requêtes en `cache: "no-cache"` pour toujours avoir la dernière version) + `manifest.webmanifest` + icônes : appli installable (PWA).
- **Mise à jour automatique** (fin de `index.html`, objet `Upd`) : au chargement, l'appli note l'ETag de `index.html` ; elle revérifie au retour sur l'appli et toutes les 30 min. Nouvelle version → rechargement automatique si personne ne saisit (pas de fenêtre ouverte, pas l'onglet « Mon entreprise », pas de champ actif, document de l'éditeur identique à son état chargé/enregistré), sinon bandeau « Mettre à jour » puis rechargement au prochain clic sans saisie en cours.
- Les PDF émis sont archivés **en base64 dans Firestore** (`pdfs/{id}`), logo compressé < 300 Ko (attention à la limite de 1 Mo par document).

## Modèle de données (Firestore)
- `users/{uid}` = fiche entreprise (profil) : nom, forme, SIRET, adresse, contacts, logo, signature, `franchise` (TVA), n° TVA, taux par défaut, `tvaDebits`, délai, moyens de paiement, IBAN/BIC, pénalités, numérotation (`counters` map, `nextNumber` ancien, préfixes, chiffres, année, `numReset`), validité devis, assurance, `mediator` (médiateur de la consommation), pied de page, `accent`, `lastIssue` (map type → dernière date d'émission), `lastIssuedId`, `memberOf` (espaces rejoints), `closing` (suppression de compte en cours).
- Sous-collections : `invoices`, `clients`, `pdfs`, `catalog`, `members`. Collection racine : `invites/{email}`.
- Document `invoices` : `type` (`facture`|`devis`|`avoir`), `number` (**null = brouillon**), `seq` (numéro du compteur) + `seqKey` (clé du compteur, ex. `facture` ou `facture:2026`), `status`, `kind:"acompte"`, `fromDevis{id,number,date}`, `acomptes[]`, `ref{id,number,date}` (avoir → facture), `convertedTo`, `autoliq`, `franchise` (figé à l'émission), `issuedAt`, `issuedBy`, `paidAt`, `paidMethod`, `totals{ht,tva,ttc}`, `lines[{desc,qty,unit,price,tva,ded}]`, `client{name,kind,address,siren,tva,email}`, `clientId`, dates, `nature`, livraison, `notes`, `pdf{size,at}`.

## Fonctions en place (toutes testées et vérifiées en ligne le 15/11/2026)
- Factures, devis, avoirs ; mentions obligatoires ; franchise 293 B ; pénalités + 40 € pour les pros.
- **Brouillon sans numéro → « Émettre » → numéro définitif → document verrouillé** (UI + règles). Correction uniquement par avoir.
  - Depuis le 16/11/2026 (règles V4) : compteur + document + PDF écrits dans **une seule transaction** (plus de numéro perdu en cas de coupure). Le serveur vérifie : `seq` ≥ compteur (jamais en arrière), compteur après = `seq` + 1, numéro qui finit par `seq`, date d'émission ≥ `lastIssue` du type (ordre chronologique), pas d'émission directement « payée » pour un particulier si assujetti. Un membre ne peut faire avancer le compteur qu'en émettant dans la même opération. Numéro de devis non modifiable une fois attribué.
  - Réglages : avertissement si on augmente le « Prochain numéro » alors que des factures / avoirs sont déjà émis (trou dans la numérotation).
- **Avoirs** : facture « Annulée par avoir » quand la somme des avoirs ≥ son TTC (calculé, pas de champ stocké) ; avoir partiel → « reste dû » ; avoir supérieur au reste refusé ; filtre « Annulées ».
- **Factures d'acompte** (depuis un devis, en % ou en montant, même série que les factures) ; la facture finale déduit les acomptes (lignes négatives `ded:true`) → « Reste à payer ».
- **Autoliquidation** sous-traitance BTP (HT, mention « art. 283-2 nonies du CGI »).
- **Loi anti-fraude TVA** : si l'entreprise n'est pas en franchise ET le client n'est pas `pro`, **aucun suivi de paiement** (pas de « Payée », pas de relance, exclu des stats) — bloqué aussi par les règles (`b2cTaxed`). Les anciens paiements déjà enregistrés restent affichés.
- **Équipe** : invitation par email (`invites/{email}`), email vérifié obligatoire, droits par membre `perms {invoices, quotes, payments, clients, company}` (par défaut tout sauf `company`), seul le propriétaire gère l'équipe, changement d'espace de travail.
- **Sauvegarde** (par appareil, IndexedDB) : dossier au choix (File System Access : Chrome/Edge ordinateur, Chrome Android 132+), rangé **un dossier par client**, fichiers « `numéro - type - client.pdf` » + JSON de toutes les données ; ou téléchargement automatique ; ou « seulement dans l'appli » avec avertissement pro + confirmation. iPhone/iPad : bouton « 📲 Enregistrer dans Fichiers » (Web Share).
- **Médiateur de la consommation** (onglet « Mon entreprise », cadre F) : case « Indiquer mon médiateur… » (`mediatorOnDocs`, cochée par défaut) + bouton « ⓘ Est-ce obligatoire ? » qui explique : adhésion et information des clients particuliers obligatoires (C. conso. L612-1, R616-1), mais pas une mention obligatoire de la facture (site, CGV, devis ou factures). Case cochée : champ visible, médiateur imprimé sur les factures et devis des particuliers ; s'il est vide → alerte dans l'éditeur + rappel à l'émission (non bloquant). Case décochée : ni champ, ni impression, ni alerte. Tani n'utilise pas l'appli lui-même : le champ est rempli par chaque entreprise utilisatrice.
- **Facture électronique — export** (bouton « ⚡ Facture électronique » sur une facture / un avoir émis, client **pro** uniquement) : **Factur-X** (PDF/A-3b + `factur-x.xml` CII, profil EN 16931), **CII** (XML) et **UBL** (XML, `Invoice` ou `CreditNote`). Code : objet `EI` dans `index.html` (`EI.model` → `EI.cii` / `EI.ubl` / `EI.facturxPdf`). L'utilisateur **dépose lui-même** le fichier sur sa plateforme agréée (pas d'envoi automatique, pas de serveur).
  - Données : BT-23 cadre `B1/S1/M1` (nature), `x4` pour une facture finale après acompte ; type 380 / 386 (acompte) / 381 (avoir, avec BT-25/26) ; notes PMD, PMT, AAB, BAR=B2B, TXD (293 B, autoliquidation ou option débits) ; vendeur SIRET (0009) + SIREN (0002) + adresse électronique SIREN (0225) ; acheteur SIREN obligatoire ; catégories TVA S/Z, E + `VATEX-FR-FRANCHISE`, AE + `VATEX-FR-AE` ; lignes à prix négatif (déduction d'acompte) converties en quantité négative (règle BR-27) ; unités converties en codes UN/ECE (`u`→C62, `h`→HUR, `forfait`→LS, `m²`→MTK…).
  - **Franchise sans n° de TVA** : SIREN mis en BT-32 (schéma `FC`) pour la règle BR-E-02. Choix fondé sur une citation de la norme AFNOR XP Z12-012 relevée dans une discussion publique (OCA/l10n-france#758) ; norme elle-même non lue (site inaccessible) → **à confirmer**. D'autres logiciels mettent le SIRET.
  - Refus expliqués dans la fenêtre : client particulier (seul message affiché), SIREN client (clé de Luhn vérifiée) / SIRET / n° TVA manquants, numéro avec caractères interdits (règle BR-FR-02 : lettres, chiffres, `+ - _ /`, 35 max), taux de TVA non français.
  - PDF Factur-X : police intégrée « FacturesSans » (sous-ensemble renommé de Liberation Sans, OFL 1.1, mêmes dimensions qu'Helvetica), profil couleur sRGB, XMP, pièce jointe `/AFRelationship /Data`, ajoutés par mise à jour incrémentale du PDF de jsPDF (`buildPdf(inv,p,{pdfa:true})`).
- **SIREN / SIRET du client** (éditeur et onglet Clients ; champs visibles seulement pour un client « Professionnel », avec une astuce « Choisis Professionnel… » sous le choix quand « Particulier » est sélectionné) : message si vide (mention obligatoire, nécessaire à la facture électronique) ou si la clé de contrôle (Luhn, exception La Poste) est fausse ; avertissement dans la confirmation d'émission (non bloquant). Une facture émise sans SIREN ne peut plus être exportée en facture électronique → avoir puis nouvelle facture.
- Catalogue de prestations, fiche clients, export CSV comptable, archives PDF + ZIP, logo (fond détecté et retiré, posé sur le bandeau), signature, couleur, export JSON, suppression de compte (efface aussi les documents verrouillés via `closing` < 1 h, par lots de 10 à cause des limites de lectures des règles).

## Décisions prises (ne pas revenir dessus sans demander)
- **Pas de Google Drive** (refusé par Tani).
- **Les règles Firestore actives sont dans la console Firebase.** `firestore.rules` dans le dépôt n'est qu'une **copie de référence** (version V4) ; toute modification doit être **collée dans Firebase → Firestore → Règles → Publier**. En général, publier **avant** de merger un `index.html` qui en dépend — **sauf V4** : l'ancien `index.html` ne peut plus émettre avec les règles V4 (testé), alors que le nouveau fonctionne avec V3. Pour V4 : merger d'abord, attendre la mise à jour du site, puis publier les règles.
- Format de numéro libre (préfixe / année / nombre de chiffres réglables), compteurs séparés facture / devis / avoir.
- Ton : tutoiement dans l'appli, avertissements au ton professionnel.
- Contact RGPD : tani.lannoy73@gmail.com. Registre des traitements tenu à part (document Claude « Registre des traitements RGPD – Mes factures »).

## Reste à faire / limites connues
- **Facture électronique : export fait (Factur-X, CII, UBL), le reste non.** Réception obligatoire pour toutes les entreprises depuis le 01/09/2026 ; émission + e-reporting obligatoires pour PME et micro-entreprises au 01/09/2027. Reste à faire :
  - **Pas testé sur une vraie plateforme agréée** : les fichiers passent les validateurs officiels, mais l'acceptation par une plateforme n'est pas vérifiée.
  - **Envoi automatique** à une plateforme : non (il faudrait un serveur → offre Firebase Blaze / Cloud Functions, et un accord avec une plateforme).
  - **E-reporting** (ventes aux particuliers résumées par jour et par taux ; encaissements des prestations de services) : rien n'est fait. Attention : l'appli ne suit volontairement pas les paiements des particuliers pour les assujettis (loi anti-fraude), alors que l'e-reporting des paiements les demande → à voir avec la plateforme agréée.
  - Statuts de cycle de vie (déposée, rejetée, encaissée…) : gérés par la plateforme, pas par l'appli.
- Pas testé sur de vrais appareils : invitation acceptée avec un vrai email vérifié, dossier sur Android, « Enregistrer dans Fichiers » sur iPhone.
- Quotas de l'offre Spark : OK pour quelques entreprises, à surveiller si beaucoup d'utilisateurs.
- Suppression des comptes inactifs après 3 ans : annoncée dans la politique, non automatisée.
- La permission du dossier de sauvegarde doit parfois être redonnée après redémarrage du navigateur (bandeau « Reconnecter »).
- Tests automatiques dans `tests/` (émulateur Firebase) : `npm run test:rules` (47 cas) et `npm run test:e2e` (32 étapes, vraie page dans Chromium), `npm run test:einvoice` (22 étapes, dont 18 fichiers Factur-X / CII / UBL vérifiés par les validateurs officiels + veraPDF). Voir `tests/README.md`.
- Le propriétaire (et un membre avec le droit « entreprise ») peut toujours changer les compteurs dans les réglages : le serveur ne l'empêche pas de les baisser (l'appli refuse seulement un numéro déjà utilisé).
- Contrôles faits seulement dans l'appli : avoir ≤ reste dû sur la facture.
- Pas de mentions pour l'international : prestations à une entreprise de l'UE (autoliquidation art. 283-2 / 259-1 du CGI), livraisons intracommunautaires (art. 262 ter I), export (art. 262 I). L'autoliquidation proposée est seulement celle de la sous-traitance BTP.
- Devis réglementés par secteur (ex. dépannage / travaux chez les particuliers : devis gratuit ou payant, frais de déplacement) : seulement via le texte libre.
- Relecture par un comptable / juriste conseillée avant ouverture commerciale.

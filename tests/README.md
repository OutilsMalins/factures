# Tests automatiques

Ils tournent sur l'**émulateur Firebase** (une copie locale de Firebase) : aucune donnée réelle n'est touchée.
Il faut Node.js, Java et Playwright (navigateur Chromium) sur la machine.

```bash
cd tests
npm install
npm run test:rules   # règles Firestore (firestore.rules) : émission, numérotation, membres, paiements, suppression
npm run test:e2e     # la vraie page index.html dans un navigateur, branchée sur l'émulateur
```

`SRC=/chemin/vers/un/autre/dossier npm run test:e2e` teste une autre version de `index.html`.

## Factures électroniques (Factur-X, CII, UBL)

`npm run test:einvoice` crée de vraies factures dans l'appli (TVA, avoir, autoliquidation, acompte, facture finale,
franchise), les exporte dans les 3 formats, puis les fait vérifier par les **validateurs officiels** :
schéma XSD + règles européennes EN 16931 + règles françaises BR-FR (fournis par la bibliothèque `factur-x`),
et **veraPDF** pour la norme PDF/A-3b des PDF Factur-X.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd verapdf && mvn -q dependency:copy-dependencies -DoutputDirectory=lib)
PYTHON=.venv/bin/python VERAPDF_CP="verapdf/lib/*" npm run test:einvoice
```

`PREFIX=XX` change le préfixe des numéros (FX-2026-001…) : utile pour déposer les fichiers sur une plateforme agréée, qui refuse les numéros déjà déposés.

Sans `VERAPDF_CP`, le contrôle PDF/A est sauté (les XML sont quand même vérifiés). Les fichiers produits restent dans `einvoice-out/`.
`python validate_einvoice.py fichier.pdf fichier.xml …` vérifie n'importe quel fichier.

## E-reporting

`npm run test:ereporting` crée des factures à des dates choisies (franchise, réel simplifié, réel normal mensuel)
et vérifie le récapitulatif e-reporting au centime près (ventes aux particuliers, encaissements, rappel des factures pro
payées, périodes et dates limites), ainsi que le fichier CSV.

## Sauvegarde dans un dossier

`npm run test:sauvegarde` vérifie le rangement du dossier de sauvegarde : `<client>/PDF/numéro - type - client.pdf`,
`<client>/Facture électronique/numéro - Factur-X.pdf | UBL.xml` (copie faite à l'export), et le déplacement des PDF
de l'ancien rangement (directement dans `<client>/`) vers `PDF/`. Le dossier choisi par l'utilisateur est remplacé par
le stockage privé du navigateur (OPFS), qui a la même interface. Chromium est lancé avec `LANG=C.UTF-8` : sans locale
UTF-8, il ne sait pas créer un dossier au nom accentué sous Linux (sur un vrai ordinateur, la locale est toujours UTF-8).

## Période de prestation et confirmation d'émission

`npm run test:periode` crée une facture « sur une période » (du 01/10 au 31/10/2026) : contrôle fin ≥ début, case
« Prestation du … au … » dans l'aperçu, encadré « Action irréversible » et bouton « Oui, émettre définitivement »
à l'émission, refus de l'export électronique sans IBAN (paiement par virement), puis période de facturation
dans le CII (`BillingSpecifiedPeriod`) et l'UBL (`InvoicePeriod`). Avec `PYTHON` (et `VERAPDF_CP`), les trois fichiers
sont aussi passés aux validateurs officiels. `SHOT=chemin` enregistre des captures du champ et de la confirmation.

## Envoi au client

`npm run test:envoi` vérifie le bouton « 📧 Envoyer au client » : fenêtre ouverte après l'émission (réglage coché par
défaut), adresse / objet / message pré-remplis, « Ouvrir ma messagerie » (PDF téléchargé + lien `mailto:` capturé par
le crochet `window.__openUrl`), « Partager le PDF » (partage du navigateur simulé), adresse corrigée enregistrée dans la
fiche client, et plus de fenêtre automatique quand le réglage est décoché.

## Aide et tutoriel

`npm run test:tutoriel` vérifie la visite guidée : lancement automatique à la première connexion (une seule fois),
les 13 étapes (élément trouvé et visible, bulle dans l'écran et sans cacher l'élément), clavier (← → Échap), « Passer »
qui ramène à l'onglet de départ, et la même chose sur un téléphone (390 × 844). Il vérifie aussi le guide : sujets,
recherche (sans accents), message sans résultat et lancement de la visite. `SHOT=chemin` enregistre des captures.
Les autres tests désactivent la visite avec `window.__noTour = true` (script d'initialisation de la page).

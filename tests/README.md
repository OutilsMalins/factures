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

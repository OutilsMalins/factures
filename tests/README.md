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

# Mes factures — Outils Malins

Application web gratuite pour créer des factures, gérer ses clients et archiver ses PDF.

- Application : https://outilsmalins.github.io/factures/
- Hébergement : GitHub Pages
- Comptes et données : Firebase (Authentication + Cloud Firestore, région Paris)

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | L'application complète |
| `mentions-legales.html` | Mentions légales, confidentialité, conditions d'utilisation |
| `firestore.rules` | Copie de référence des règles de sécurité (la version active se colle dans Firebase → Firestore → Règles) |
| `CLAUDE.md` | Contexte du projet pour Claude |
| `tests/` | Tests automatiques sur l'émulateur Firebase (voir `tests/README.md`) |

# BeRail

**Le BeReal de ta classe.** Un moment lancé par le prof, deux photos (arrière + avant),
un fil privé, et **chaque BeRail se partage avec un code à 6 caractères**.

Conçu pour les iPads en classe : pas de compte, pas d'e-mail, pas d'installation.
Les élèves entrent un prénom et le code de la classe, et c'est parti.

![Fil de la classe](docs/screens/fil.png)

| Profil de l'organisateur | Un BeRail ouvert par son code |
|---|---|
| ![Profil](docs/screens/profil.png) | ![Partage](docs/screens/partage.png) |

## Lancer

```bash
npm start
```

ou double-clic sur `demarrer.cmd` (Windows). Node 18+ suffit, **aucune dépendance**.

Le serveur écoute sur :

- `http://localhost:3000` — pour tester sur l'ordinateur
- `https://<IP-du-PC>:3443` — **l'adresse à ouvrir sur les iPads** (la caméra Safari exige HTTPS)

L'IP locale est affichée au démarrage. La première fois, génère le certificat :

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 825 \
  -subj "/CN=berail.local" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.187"
```

(remplace l'IP par celle du PC ; `certs/` n'est jamais commité)

## Sur iPad

1. Mettre l'iPad sur le **même Wi-Fi** que l'ordinateur.
2. Safari → `https://192.168.1.187:3443`
3. Avertissement du certificat auto-signé : **Afficher les détails → visiter ce site**.
4. Autoriser la caméra.
5. Optionnel : **Partager → Sur l'écran d'accueil** pour l'avoir comme une app.

> Si le certificat bloque, l'app bascule automatiquement sur l'appareil photo de l'iPad
> (deux photos à choisir). Tout le reste fonctionne à l'identique.

## Utilisation

| Qui | Quoi |
|---|---|
| Le prof | Crée la classe avec un code (ex. `4B-2026`), puis **Profil → Lancer le moment** |
| Les élèves | Entrent leur prénom + le code de la classe |
| Tout le monde | Gros bouton : photo arrière, photo avant, légende, publier |
| Partage | Bouton **Code** sur un post → code à 6 caractères + lien `/?p=CODE` |

- Publier dans les **2 minutes** après le moment = à l'heure, ensuite le post porte **⚠️ En retard**.
- Réactions emoji, commentaires, mémoires, fil de la classe.

**Classe de démo** : code `DEMO` (3 BeRail d'exemple). `npm run seed` pour la régénérer.

## Déployer

GitHub héberge le code, pas un serveur Node : l'app a besoin d'un hôte qui exécute `node server.js`
(les iPads doivent pouvoir joindre la même adresse).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/louskyfly/berail)

Le fichier `render.yaml` est prêt. Deux points à savoir :

- **HTTPS** : Render (comme Railway, Fly.io, un reverse proxy…) fournit un certificat valide,
  donc la caméra fonctionne sans bricolage. Le serveur ne démarre HTTPS que si `certs/` existe.
- **Stockage** : `data/` est sur le disque de la machine. Sur un plan gratuit, un redéploiement
  efface les posts. Branche un disque persistant (`DATA_DIR=/var/data`) ou remplace le stockage
  fichier par une base pour un usage durable.

## API

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/join` | Rejoindre/créer une classe (`name`, `code`, `create`) |
| `GET` | `/api/me?token=` | Profil + classe |
| `GET` | `/api/feed?token=` | Fil de la classe |
| `GET` | `/api/state?token=` | Moment en cours, nombre de posts (polling 15 s) |
| `POST` | `/api/moment` | Lancer le moment (organisateur uniquement) |
| `POST` | `/api/post` | Publier un BeRail (photo composite data-URL) |
| `POST` | `/api/react` | Réagir (bascule un emoji) |
| `POST` | `/api/comment` | Commenter |
| `GET` | `/api/p/:code` | Un BeRail par son code, **sans compte** |

## Structure

```
server.js            HTTP + HTTPS, API JSON, stockage fichier
public/index.html    interface
public/app.js        logique client (vanilla)
public/styles.css    thème sombre façon BeReal
seed.js              données de démo (classe DEMO)
gen-icons.js         icônes PWA
data/db.json         comptes, classes, posts (non commité)
data/media/          photos (non commité)
certs/               certificat auto-signé (non commité)
```

## Limites de la V1

- Les **notifications** ne sont pas de vraies push : l'app ouverte vérifie toutes les 15 s.
- Pas encore de **suppression ni de modération**, ni de verrou « un seul post par moment ».
- Les photos sont stockées en clair sur le disque du serveur : c'est un outil de classe, pas un
  service public. Un code de classe = accès au fil.
- `?as=Prénom&code=CODE` permet de pré-remplir la connexion (pratique pour une démo/kiosque).

## Licence

MIT — voir [LICENSE](LICENSE).

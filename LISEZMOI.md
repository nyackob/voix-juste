# Voix Juste

Ta voix tracée en direct par-dessus les notes à chanter, pour travailler la justesse.

## Lancer l'app sur ton PC (Ubuntu)

Le navigateur n'autorise le micro que sur une adresse sûre, donc l'app ne s'ouvre pas en double-cliquant sur `index.html`. Il faut la servir en local, ce que fait le petit script fourni.

1. Dézippe le dossier où tu veux, par exemple dans `~/Musique/voix-juste`.
2. Ouvre un terminal dans ce dossier et lance `./lancer.sh` (ou `bash lancer.sh`).
3. Le navigateur s'ouvre sur `http://localhost:8765`. Autorise le micro quand il le demande.
4. Pour l'avoir comme une vraie application, clique sur l'icône d'installation dans la barre d'adresse de Chrome ou Chromium. Firefox ne propose pas l'installation mais l'app y marche.

Le terminal doit rester ouvert pendant que tu utilises l'app. Sur le PC Windows du labo, c'est `lancer.bat` (Python doit être installé).

## L'avoir aussi sur l'iPad

L'iPad a besoin d'une adresse https. Le plus simple et gratuit est GitHub Pages.

1. Crée un dépôt public sur GitHub, par exemple `voix-juste`.
2. Glisse tout le contenu du dossier dans la page du dépôt (« Add file », puis « Upload files »), puis valide.
3. Dans « Settings », puis « Pages », choisis la branche `main` et le dossier racine, puis enregistre.
4. Au bout d'une minute, l'app est en ligne sur `https://<ton-pseudo>.github.io/voix-juste/`. Sur l'iPad, ouvre-la dans Safari puis « Partager », « Sur l'écran d'accueil ».

Les données ne se synchronisent pas toutes seules entre appareils. Utilise « Exporter une sauvegarde » puis « Importer une sauvegarde » dans Profil.

## Mettre tes partitions

- **Depuis MuseScore** (gratuit, et ce que je conseille pour tes PDF) : recopie la ligne de chant, puis « Fichier », « Exporter », format MusicXML. Importe le fichier avec « Importer MusicXML ou MIDI ». Si la partie est écrite en clé de sol octaviée, vérifie l'étendue affichée et choisis −1 octave si elle te paraît trop haute.
- **Un fichier MIDI** : l'app garde la piste choisie et, si plusieurs notes sonnent ensemble, la plus haute.
- **À la main** : « Nouvelle partition », clavier à l'écran ou notation texte (`do3:1/Com- mi3:2/me`). L'aide est en bas de l'éditeur.

## Un tour rapide

- **Pratique** : lance, attends le décompte, chante. La trace est verte à ±25 cents, orange jusqu'à ±50, rouge au-delà. Choisis les mesures, la boucle, le tempo et le guide sonore.
- **Caler sur ma voix** : chante la première note là où elle te va, l'app transpose toute la mélodie à partir d'elle. **Tonalité conseillée** cherche la transposition qui garde le plus de notes dans ta zone confortable.
- **Enregistrer** : la prise garde le son et la courbe, tu peux la réécouter avec la trace qui défile.
- **Bilan** : écart moyen, tendance haute ou basse, stabilité, temps d'attaque, et les erreurs qui reviennent (demi-ton chanté comme un ton, montées trop courtes...).
- **Progrès** : courbe des scores, points récurrents sur les dix dernières prises, notes les plus difficiles, export CSV.
- **Profil** : ta tessiture (déjà remplie avec ce que tu m'as donné), un test de tessiture en direct, et « Vérifier le micro » qui contrôle que ton micro lit bien les graves.

Mets un casque quand tu utilises le guide sonore, sinon le micro l'entend aussi.

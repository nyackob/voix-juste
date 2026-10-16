// Exercices et mélodies du domaine public fournis avec l'app.
// Écrits en notation texte (voir l'aide de l'éditeur), placés dans le grave pour une voix d'homme grave.
import { parseText } from './music.js';

const B = [
  {
    id: 'b-tenues', title: 'Notes tenues', tags: ['exercice', 'stabilité'], tempo: 60, beatsPerBar: 4,
    text: 'la2:4 -:2 do3:4 -:2 ré3:4 -:2 sol2:4 -:2 mi3:4 -:2 la2:4',
    about: 'Six notes de quatre temps. Pose la note tout de suite puis garde-la parfaitement droite.',
  },
  {
    id: 'b-cinq', title: 'Cinq notes, montée et descente', tags: ['exercice', 'échauffement'], tempo: 72, beatsPerBar: 4,
    text: 'sol2:1 la2 si2 do3 ré3 do3 si2 la2 sol2:4',
    about: "Le motif de l'échauffement. Transpose d'un demi-ton à chaque passage pour monter ou descendre.",
  },
  {
    id: 'b-demi-ton', title: 'Demi-ton ou ton', tags: ['exercice', 'intervalles'], tempo: 66, beatsPerBar: 4,
    text: 'la2:2 la#2 la2 -:2 la2:2 si2 la2 -:2 do3:2 do#3 do3 -:2 do3:2 ré3 do3 -:2 mi3:2 fa3 mi3 -:2 mi3:2 fa#3 mi3 -:2 si2:2 do3 si2 -:2 si2:2 do#3 si2',
    about: "Alterne un demi-ton et un ton à partir de la même note. C'est la confusion repérée dans ton test de justesse.",
  },
  {
    id: 'b-gamme', title: 'Gamme majeure de la2', tags: ['exercice', 'gamme'], tempo: 72, beatsPerBar: 4,
    text: 'la2:1 si2 do#3 ré3 mi3 fa#3 sol#3 la3:2 sol#3:1 fa#3 mi3 ré3 do#3 si2 la2:4',
    about: 'Une octave complète. Les demi-tons sont entre la 3e et la 4e note, puis entre la 7e et la 8e.',
  },
  {
    id: 'b-arpege', title: 'Arpège majeur', tags: ['exercice', 'intervalles'], tempo: 72, beatsPerBar: 4,
    text: 'la2:1 do#3 mi3 la3:2 mi3:1 do#3 la2:4 -:2 do3:1 mi3 sol3 do4:2 sol3:1 mi3 do3:4',
    about: "Tierce, quinte, octave. Entends la note du dessus avant d'y aller.",
  },
  {
    id: 'b-sauts', title: 'Sauts depuis la2', tags: ['exercice', 'intervalles'], tempo: 66, beatsPerBar: 4,
    text: 'la2:1 si2 la2 do3 la2 do#3 la2 ré3 la2 mi3 la2 fa#3 la2 la3 la2:4',
    about: 'On revient toujours au la2 et on saute de plus en plus loin, de la seconde jusqu\'à l\'octave.',
  },
  {
    id: 'b-justesse', title: 'Test de justesse', tags: ['test'], tempo: 60, beatsPerBar: 4,
    text: 'la2:2 -:2 ré3:2 -:2 sol2:2 -:2 do3:2 -:2 fa2:2 -:2 si2:2 -:2 mi3:2 -:2 la2:2 -:2 sol2:1 la2 si2 do3 ré3:2 -:2 la2:1 si2 do#3 ré3 mi3:2 -:2 do3:1 si2 la2 sol2 fa2:2',
    about: 'Les mêmes notes que le test audio. Fais-le sans guide pour te mesurer, avec guide pour travailler.',
  },
  {
    id: 'b-clair-lune', title: 'Au clair de la lune', tags: ['chanson', 'domaine public'], tempo: 92, beatsPerBar: 4,
    text: 'do3:1/Au do3/clair do3/de ré3/la mi3:2/lu- ré3/ne | do3:1/mon mi3/a- ré3/mi ré3/Pier- do3:4/rot | do3:1/Prê- do3/te- do3/moi ré3/ta mi3:2/plu- ré3/me | do3:1/pour mi3/é- ré3/crire ré3/un do3:4/mot | ré3:1/Ma ré3/chan- ré3/del- ré3/l\'est la2:2/mor- la2/te | ré3:1/je do3/n\'ai si2/plus la2/de sol2:4/feu | do3:1/Ou- do3/vre- do3/moi ré3/ta mi3:2/por- ré3/te | do3:1/pour mi3/l\'a- ré3/mour ré3/de do3:4/Dieu',
    about: 'Chanson traditionnelle. Peu de notes, beaucoup de tons et un saut de quinte au milieu.',
  },
  {
    id: 'b-frere-jacques', title: 'Frère Jacques', tags: ['chanson', 'domaine public'], tempo: 96, beatsPerBar: 4,
    text: 'do3:1/Frè- ré3/re mi3/Jac- do3/ques | do3/frè- ré3/re mi3/Jac- do3/ques | mi3/dor- fa3/mez sol3:2/vous | mi3:1/dor- fa3/mez sol3:2/vous | sol3:0.5/Son- la3/nez sol3/les fa3/ma- mi3:1/ti- do3/nes | sol3:0.5/son- la3/nez sol3/les fa3/ma- mi3:1/ti- do3/nes | do3:1/Ding sol2/daing do3:2/dong | do3:1/ding sol2/daing do3:2/dong',
    about: 'Chanson traditionnelle. Le demi-ton mi-fa revient souvent : bon test pour ta justesse fine.',
  },
  {
    id: 'b-ah-vous-dirai-je', title: 'Ah ! vous dirai-je, maman', tags: ['chanson', 'domaine public'], tempo: 92, beatsPerBar: 4,
    text: 'do3:1/Ah do3/vous sol3/di- sol3/rai- la3/je la3/ma- sol3:2/man | fa3:1/ce fa3/qui mi3/cau- mi3/se ré3/mon ré3/tour- do3:2/ment | sol3:1/Pa- sol3/pa fa3/veut fa3/que mi3/je mi3/rai- ré3:2/sonne | sol3:1/Comme sol3/u- fa3/ne fa3/gran- mi3/de mi3/per- ré3:2/sonne | do3:1/Moi do3/je sol3/dis sol3/que la3/les la3/bon- sol3:2/bons | fa3:1/va- fa3/lent mi3/mieux mi3/que ré3/la ré3/rai- do3:2/son',
    about: 'Air traditionnel. Les descentes par degrés sont idéales pour travailler les tons justes.',
  },
];

export function builtinScores() {
  return B.map((s, i) => {
    const { notes } = parseText(s.text);
    return { id: s.id, title: s.title, tags: s.tags, tempo: s.tempo, beatsPerBar: s.beatsPerBar, notes, about: s.about, builtin: true, order: i, transpose: 0 };
  });
}

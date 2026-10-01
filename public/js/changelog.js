"use strict";

/* Host-facing changelog for the "What's new" panel on the sign-in screen
   (public/host.html, #whatsNew). Newest entry first.
   Convention (also in CLAUDE.md): whenever a user-facing feature, fix, or
   enhancement ships, add an entry here (or an item to today's entry if one
   already exists for this date). Keep items short and host-facing, no
   internal implementation detail, no file names.
   Each item is either a plain English string or an object keyed by
   language code ({ en, fr, de, es, el, pt, ro }); the panel shows the
   host's own language and falls back to English for anything missing. */
const CHANGELOG = [
  {
    date: "2026-10-01",
    items: [
      {
        en: "CX Quiz now speaks French, German, Spanish, Greek, Portuguese and Romanian. Use the language button in the bottom-left corner of any screen.",
        fr: "CX Quiz parle maintenant français, allemand, espagnol, grec, portugais et roumain. Utilisez le bouton de langue en bas à gauche de chaque écran.",
        de: "CX Quiz spricht jetzt Französisch, Deutsch, Spanisch, Griechisch, Portugiesisch und Rumänisch. Nutze die Sprachauswahl unten links auf jedem Bildschirm.",
        es: "CX Quiz ya habla francés, alemán, español, griego, portugués y rumano. Usa el botón de idioma en la esquina inferior izquierda de cualquier pantalla.",
        el: "Το CX Quiz μιλάει πλέον γαλλικά, γερμανικά, ισπανικά, ελληνικά, πορτογαλικά και ρουμανικά. Χρησιμοποίησε το κουμπί γλώσσας κάτω αριστερά σε κάθε οθόνη.",
        pt: "O CX Quiz já fala francês, alemão, espanhol, grego, português e romeno. Use o botão de idioma no canto inferior esquerdo de qualquer ecrã.",
        ro: "CX Quiz vorbește acum franceză, germană, spaniolă, greacă, portugheză și română. Folosește butonul de limbă din colțul din stânga jos al oricărui ecran."
      },
      {
        en: "Every phone picks its own language, so players who read different languages can join the same game. Your questions are shown exactly as you wrote them.",
        fr: "Chaque téléphone choisit sa propre langue : des joueurs qui lisent des langues différentes peuvent rejoindre la même partie. Vos questions s'affichent exactement comme vous les avez écrites.",
        de: "Jedes Handy wählt seine eigene Sprache, so können Spieler mit verschiedenen Sprachen am selben Spiel teilnehmen. Deine Fragen erscheinen genau so, wie du sie geschrieben hast.",
        es: "Cada móvil elige su propio idioma, así que jugadores que leen idiomas distintos pueden unirse a la misma partida. Tus preguntas se muestran tal como las escribiste.",
        el: "Κάθε κινητό διαλέγει τη δική του γλώσσα, ώστε παίκτες που διαβάζουν διαφορετικές γλώσσες να παίζουν στο ίδιο παιχνίδι. Οι ερωτήσεις σου εμφανίζονται ακριβώς όπως τις έγραψες.",
        pt: "Cada telemóvel escolhe o seu idioma, por isso jogadores que leem idiomas diferentes podem entrar no mesmo jogo. As suas perguntas aparecem exatamente como as escreveu.",
        ro: "Fiecare telefon își alege propria limbă, așa că jucători care citesc limbi diferite pot intra în același joc. Întrebările tale apar exact cum le-ai scris."
      },
      {
        en: "Downloaded results (CSV) use the language your console is set to.",
        fr: "Les résultats téléchargés (CSV) utilisent la langue de votre console.",
        de: "Heruntergeladene Ergebnisse (CSV) verwenden die Sprache deiner Konsole.",
        es: "Los resultados descargados (CSV) usan el idioma de tu consola.",
        el: "Τα αποτελέσματα που κατεβάζεις (CSV) είναι στη γλώσσα της κονσόλας σου.",
        pt: "Os resultados transferidos (CSV) usam o idioma da sua consola.",
        ro: "Rezultatele descărcate (CSV) folosesc limba consolei tale."
      },
      {
        en: "Fixed a problem where a malformed message from one device could end every game in progress.",
        fr: "Correction d'un problème où un message mal formé envoyé par un appareil pouvait interrompre toutes les parties en cours.",
        de: "Behoben: Eine fehlerhafte Nachricht von einem Gerät konnte alle laufenden Spiele beenden.",
        es: "Corregido un problema por el que un mensaje mal formado de un dispositivo podía cortar todas las partidas en curso.",
        el: "Διορθώθηκε πρόβλημα όπου ένα λανθασμένο μήνυμα από μία συσκευή μπορούσε να τερματίσει όλα τα παιχνίδια σε εξέλιξη.",
        pt: "Corrigido um problema em que uma mensagem malformada de um dispositivo podia terminar todos os jogos a decorrer.",
        ro: "Am rezolvat o problemă prin care un mesaj greșit de pe un dispozitiv putea opri toate jocurile în desfășurare."
      }
    ]
  },
  {
    date: "2026-09-18",
    items: [
      {
        en: "Pictures and GIFs on a question now show on every player's phone, not just the host screen.",
        fr: "Les images et GIF d'une question s'affichent maintenant sur le téléphone de chaque joueur, pas seulement sur l'écran de l'animateur.",
        de: "Bilder und GIFs einer Frage erscheinen jetzt auf jedem Spielerhandy, nicht nur auf dem Moderationsbildschirm.",
        es: "Las imágenes y GIF de una pregunta ahora se ven en el móvil de cada jugador, no solo en la pantalla del presentador.",
        el: "Οι εικόνες και τα GIF μιας ερώτησης εμφανίζονται πλέον στο κινητό κάθε παίκτη, όχι μόνο στην οθόνη του παρουσιαστή.",
        pt: "As imagens e GIF de uma pergunta aparecem agora no telemóvel de cada jogador, não só no ecrã do anfitrião.",
        ro: "Imaginile și GIF-urile unei întrebări apar acum pe telefonul fiecărui jucător, nu doar pe ecranul gazdei."
      },
      {
        en: "GIFs stay animated instead of freezing into a still image when added to a question.",
        fr: "Les GIF restent animés au lieu de se figer en image fixe quand on les ajoute à une question.",
        de: "GIFs bleiben animiert, statt beim Hinzufügen zu einem Standbild zu erstarren.",
        es: "Los GIF siguen animados en lugar de quedarse congelados al añadirlos a una pregunta.",
        el: "Τα GIF παραμένουν κινούμενα αντί να παγώνουν σε στατική εικόνα όταν τα προσθέτεις σε ερώτηση.",
        pt: "Os GIF continuam animados em vez de ficarem congelados quando são adicionados a uma pergunta.",
        ro: "GIF-urile rămân animate în loc să înghețe într-o imagine statică atunci când le adaugi la o întrebare."
      },
      {
        en: "Search and add GIFs from Giphy right in the question editor.",
        fr: "Recherchez et ajoutez des GIF Giphy directement dans l'éditeur de questions.",
        de: "GIFs von Giphy direkt im Frageneditor suchen und hinzufügen.",
        es: "Busca y añade GIF de Giphy directamente en el editor de preguntas.",
        el: "Αναζήτηση και προσθήκη GIF από το Giphy απευθείας στον επεξεργαστή ερωτήσεων.",
        pt: "Pesquise e adicione GIF do Giphy diretamente no editor de perguntas.",
        ro: "Caută și adaugă GIF-uri de pe Giphy direct din editorul de întrebări."
      },
      {
        en: "The host screen calls out the fastest correct answer after each question.",
        fr: "L'écran de l'animateur annonce la bonne réponse la plus rapide après chaque question.",
        de: "Der Moderationsbildschirm zeigt nach jeder Frage die schnellste richtige Antwort.",
        es: "La pantalla del presentador destaca el acierto más rápido después de cada pregunta.",
        el: "Η οθόνη του παρουσιαστή αναδεικνύει την ταχύτερη σωστή απάντηση μετά από κάθε ερώτηση.",
        pt: "O ecrã do anfitrião destaca a resposta certa mais rápida depois de cada pergunta.",
        ro: "Ecranul gazdei anunță cel mai rapid răspuns corect după fiecare întrebare."
      },
      {
        en: "Added sound: a countdown tick, a reveal chime, and a podium fanfare on the host screen, plus correct/incorrect sounds in self-paced quizzes.",
        fr: "Nouveaux sons : tic-tac du compte à rebours, carillon de révélation et fanfare du podium sur l'écran de l'animateur, plus des sons bonne/mauvaise réponse dans les quiz en autonomie.",
        de: "Neue Sounds: Countdown-Ticken, Auflösungs-Gong und Siegerfanfare auf dem Moderationsbildschirm, dazu Richtig/Falsch-Töne in Tests im eigenen Tempo.",
        es: "Nuevos sonidos: tictac de cuenta atrás, campanilla al revelar y fanfarria del podio en la pantalla del presentador, además de sonidos de acierto/fallo en los quizzes a tu ritmo.",
        el: "Νέοι ήχοι: χτύπος αντίστροφης μέτρησης, ήχος αποκάλυψης και φανφάρα βάθρου στην οθόνη του παρουσιαστή, καθώς και ήχοι σωστού/λάθους στα κουίζ με δικό σου ρυθμό.",
        pt: "Novos sons: tique-taque da contagem decrescente, toque de revelação e fanfarra do pódio no ecrã do anfitrião, além de sons de certo/errado nos quizzes ao seu ritmo.",
        ro: "Sunete noi: ticăitul numărătorii inverse, un clinchet la dezvăluire și o fanfară la podium pe ecranul gazdei, plus sunete pentru corect/greșit în quizurile în ritmul tău."
      },
      {
        en: "Players get a small confetti moment when they're on a correct-answer streak.",
        fr: "Les joueurs ont droit à quelques confettis quand ils enchaînent les bonnes réponses.",
        de: "Spieler bekommen ein bisschen Konfetti, wenn sie eine Serie richtiger Antworten haben.",
        es: "Los jugadores reciben un poco de confeti cuando encadenan aciertos.",
        el: "Οι παίκτες παίρνουν λίγο κομφετί όταν έχουν σερί σωστών απαντήσεων.",
        pt: "Os jogadores recebem um pouco de confetti quando estão numa série de respostas certas.",
        ro: "Jucătorii primesc puține confetti când au o serie de răspunsuri corecte."
      }
    ]
  }
];

/* Shown on the sign-in screen only, capped to the most recent releases so
   it never grows into a wall of text a host has to scroll past to sign in. */
const MAX_RELEASES_SHOWN = 3;

function renderChangelog() {
  const wrap = document.getElementById("whatsNew");
  const list = document.getElementById("whatsNewList");
  if (!wrap || !list || !CHANGELOG.length) return;
  const lang = window.I18N?.lang || "en";
  const textOf = item => (typeof item === "string" ? item : item[lang] || item.en);

  list.innerHTML = "";
  CHANGELOG.slice(0, MAX_RELEASES_SHOWN).forEach(release => {
    const block = document.createElement("div");
    block.className = "whatsnew-release";
    const date = document.createElement("p");
    date.className = "whatsnew-date";
    date.textContent = release.date;
    block.appendChild(date);
    const ul = document.createElement("ul");
    release.items.forEach(item => {
      const li = document.createElement("li");
      li.textContent = textOf(item);
      ul.appendChild(li);
    });
    block.appendChild(ul);
    list.appendChild(block);
  });
  wrap.hidden = false;
}

document.addEventListener("DOMContentLoaded", renderChangelog);
document.addEventListener("langchange", renderChangelog);

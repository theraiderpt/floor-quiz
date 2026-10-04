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
    date: "2026-10-04",
    items: [
      {
        en: "Signing in from a shared office network no longer locks colleagues out: only wrong passwords count against the limit.",
        fr: "Se connecter depuis un réseau de bureau partagé ne bloque plus les collègues : seuls les mots de passe erronés comptent dans la limite.",
        de: "Die Anmeldung aus einem gemeinsamen Büronetzwerk sperrt Kolleginnen und Kollegen nicht mehr aus: nur falsche Passwörter zählen zum Limit.",
        es: "Iniciar sesión desde una red de oficina compartida ya no bloquea a los compañeros: solo las contraseñas incorrectas cuentan para el límite.",
        el: "Η σύνδεση από κοινό δίκτυο γραφείου δεν κλειδώνει πια τους συναδέλφους: μόνο οι λανθασμένοι κωδικοί προσμετρούν στο όριο.",
        pt: "Iniciar sessão numa rede de escritório partilhada já não bloqueia os colegas: só as palavras-passe erradas contam para o limite.",
        ro: "Autentificarea dintr-o rețea de birou comună nu mai blochează colegii: doar parolele greșite contează pentru limită."
      },
      {
        en: "Security tightening: a password reset now signs out older sessions, a disabled host's self-paced links stop working, and very busy self-paced quizzes ask people to retry instead of slowing everything down.",
        fr: "Sécurité renforcée : une réinitialisation de mot de passe déconnecte les anciennes sessions, les liens en autonomie d'un hôte désactivé cessent de fonctionner, et les quiz en autonomie très sollicités demandent de réessayer au lieu de tout ralentir.",
        de: "Mehr Sicherheit: Ein Passwort-Reset beendet ältere Sitzungen, selbstgesteuerte Links eines deaktivierten Hosts funktionieren nicht mehr, und stark ausgelastete selbstgesteuerte Quizze bitten um einen neuen Versuch, statt alles zu verlangsamen.",
        es: "Más seguridad: restablecer la contraseña cierra las sesiones anteriores, los enlaces a ritmo propio de un anfitrión desactivado dejan de funcionar y los cuestionarios a ritmo propio muy concurridos piden reintentar en lugar de ralentizarlo todo.",
        el: "Πιο ασφαλές: η επαναφορά κωδικού αποσυνδέει παλαιότερες συνεδρίες, οι σύνδεσμοι με δικό σου ρυθμό ενός απενεργοποιημένου διοργανωτή παύουν να λειτουργούν και τα πολυσύχναστα κουίζ ζητούν νέα προσπάθεια αντί να επιβραδύνουν τα πάντα.",
        pt: "Mais segurança: repor a palavra-passe termina as sessões anteriores, as ligações ao próprio ritmo de um anfitrião desativado deixam de funcionar e os questionários ao próprio ritmo muito concorridos pedem nova tentativa em vez de abrandar tudo.",
        ro: "Securitate sporită: resetarea parolei închide sesiunile mai vechi, linkurile în ritm propriu ale unui gazdă dezactivat nu mai funcționează, iar chestionarele foarte aglomerate cer o nouă încercare în loc să încetinească totul."
      }
    ]
  },
  {
    date: "2026-10-02",
    items: [
      {
        en: "Self-paced quizzes now work for a whole class on one office network: trainees no longer get blocked part-way through.",
        fr: "Les quiz en autonomie fonctionnent désormais pour toute une classe sur le même réseau de bureau : les stagiaires ne sont plus bloqués en cours de route.",
        de: "Selbstgesteuerte Quizze funktionieren jetzt für eine ganze Gruppe im selben Büronetzwerk: Teilnehmende werden nicht mehr mittendrin gesperrt.",
        es: "Los cuestionarios a ritmo propio ya funcionan para toda una clase en la misma red de oficina: los alumnos ya no se bloquean a mitad del cuestionario.",
        el: "Τα κουίζ με δικό σου ρυθμό λειτουργούν πλέον για μια ολόκληρη τάξη στο ίδιο δίκτυο γραφείου: οι εκπαιδευόμενοι δεν μπλοκάρονται πια στη μέση.",
        pt: "Os questionários ao próprio ritmo já funcionam para uma turma inteira na mesma rede de escritório: os formandos já não ficam bloqueados a meio.",
        ro: "Chestionarele în ritm propriu funcționează acum pentru o clasă întreagă din aceeași rețea de birou: cursanții nu mai sunt blocați pe parcurs."
      },
      {
        en: "Security tightening: repeated wrong game PINs are now throttled, a disabled host can no longer be re-enabled through an old invite link, and unused uploaded pictures are cleaned up automatically.",
        fr: "Sécurité renforcée : les PIN erronés répétés sont limités, un hôte désactivé ne peut plus être réactivé via une ancienne invitation, et les images téléversées inutilisées sont nettoyées automatiquement.",
        de: "Mehr Sicherheit: Wiederholte falsche Spiel-PINs werden gebremst, ein deaktivierter Host lässt sich nicht mehr über einen alten Einladungslink reaktivieren, und ungenutzte hochgeladene Bilder werden automatisch entfernt.",
        es: "Más seguridad: los PIN erróneos repetidos se limitan, un anfitrión desactivado ya no puede reactivarse con una invitación antigua y las imágenes subidas sin usar se eliminan automáticamente.",
        el: "Πιο ασφαλές: τα επαναλαμβανόμενα λάθος PIN περιορίζονται, ένας απενεργοποιημένος διοργανωτής δεν μπορεί πια να ενεργοποιηθεί ξανά με παλιά πρόσκληση και οι αχρησιμοποίητες εικόνες καθαρίζονται αυτόματα.",
        pt: "Mais segurança: PINs errados repetidos são limitados, um anfitrião desativado já não pode ser reativado por um convite antigo e as imagens carregadas sem uso são removidas automaticamente.",
        ro: "Securitate sporită: PIN-urile greșite repetate sunt limitate, o gazdă dezactivată nu mai poate fi reactivată printr-o invitație veche, iar imaginile încărcate și nefolosite sunt șterse automat."
      }
    ]
  },
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
      },
      {
        en: "If the host screen loses its connection or is reloaded mid-game, it picks up exactly where the room is, instead of freezing.",
        fr: "Si l'écran de l'animateur perd la connexion ou est rechargé en pleine partie, il reprend exactement là où en est la salle, au lieu de se figer.",
        de: "Verliert der Moderationsbildschirm mitten im Spiel die Verbindung oder wird neu geladen, macht er genau dort weiter, wo der Raum gerade ist, statt einzufrieren.",
        es: "Si la pantalla del presentador pierde la conexión o se recarga en mitad de la partida, continúa justo donde está la sala, en lugar de quedarse congelada.",
        el: "Αν η οθόνη του παρουσιαστή χάσει τη σύνδεση ή ανανεωθεί στη μέση του παιχνιδιού, συνεχίζει ακριβώς από εκεί που βρίσκεται η αίθουσα, αντί να παγώνει.",
        pt: "Se o ecrã do anfitrião perder a ligação ou for recarregado a meio do jogo, retoma exatamente onde a sala está, em vez de ficar parado.",
        ro: "Dacă ecranul gazdei pierde conexiunea sau este reîncărcat în timpul jocului, continuă exact de unde a rămas sala, în loc să înghețe."
      },
      {
        en: "Cancelling a lobby no longer counts as a played game in your history and dashboard, and players are told the game was cancelled.",
        fr: "Annuler une salle ne compte plus comme une partie jouée dans l'historique et le tableau de bord, et les joueurs sont prévenus de l'annulation.",
        de: "Eine abgebrochene Lobby zählt nicht mehr als gespieltes Spiel in Verlauf und Dashboard, und die Spieler erfahren, dass abgebrochen wurde.",
        es: "Cancelar una sala ya no cuenta como partida jugada en el historial ni en el panel, y los jugadores reciben aviso de la cancelación.",
        el: "Η ακύρωση αίθουσας δεν μετράει πλέον ως παιχνίδι στο ιστορικό και στον πίνακα, και οι παίκτες ενημερώνονται για την ακύρωση.",
        pt: "Cancelar uma sala já não conta como jogo realizado no histórico e no painel, e os jogadores são avisados do cancelamento.",
        ro: "Anularea unei săli nu mai apare ca joc jucat în istoric și în panou, iar jucătorii află că jocul a fost anulat."
      },
      {
        en: "Players who reload their phone after answering see their answer locked in, instead of being asked again.",
        fr: "Les joueurs qui rechargent leur téléphone après avoir répondu voient leur réponse validée, au lieu d'être interrogés à nouveau.",
        de: "Spieler, die ihr Handy nach dem Antworten neu laden, sehen ihre Antwort als gespeichert, statt erneut gefragt zu werden.",
        es: "Los jugadores que recargan el móvil después de responder ven su respuesta registrada, en lugar de volver a preguntarles.",
        el: "Οι παίκτες που ανανεώνουν το κινητό τους αφού απαντήσουν βλέπουν την απάντησή τους καταγεγραμμένη, αντί να ερωτηθούν ξανά.",
        pt: "Os jogadores que recarregam o telemóvel depois de responder veem a resposta registada, em vez de voltarem a ser questionados.",
        ro: "Jucătorii care își reîncarcă telefonul după ce au răspuns își văd răspunsul înregistrat, în loc să fie întrebați din nou."
      },
      {
        en: "In self-paced tests, an answer that fails to send can simply be tried again.",
        fr: "Dans les tests en autonomie, une réponse qui n'a pas pu être envoyée peut simplement être renvoyée.",
        de: "In Tests im eigenen Tempo lässt sich eine Antwort, die nicht gesendet werden konnte, einfach erneut abschicken.",
        es: "En los tests a tu ritmo, una respuesta que no se pudo enviar se puede volver a intentar sin más.",
        el: "Στα τεστ με δικό σου ρυθμό, μια απάντηση που δεν στάλθηκε μπορεί απλώς να ξανασταλεί.",
        pt: "Nos testes ao seu ritmo, uma resposta que não foi enviada pode simplesmente ser reenviada.",
        ro: "În testele în ritmul tău, un răspuns care nu a putut fi trimis poate fi pur și simplu retrimis."
      },
      {
        en: "Importing a quiz you exported keeps every question type, picture and setting.",
        fr: "Importer un quiz que vous avez exporté conserve tous les types de questions, les images et les réglages.",
        de: "Beim Import eines exportierten Quiz bleiben alle Fragetypen, Bilder und Einstellungen erhalten.",
        es: "Al importar un quiz que exportaste se conservan todos los tipos de pregunta, imágenes y ajustes.",
        el: "Η εισαγωγή ενός κουίζ που εξήγαγες διατηρεί όλους τους τύπους ερωτήσεων, τις εικόνες και τις ρυθμίσεις.",
        pt: "Importar um quiz que exportou mantém todos os tipos de pergunta, imagens e definições.",
        ro: "Importarea unui quiz exportat păstrează toate tipurile de întrebări, imaginile și setările."
      },
      {
        en: "Downloaded results are safe to open in Excel, even when a player's name starts with = or +.",
        fr: "Les résultats téléchargés s'ouvrent sans risque dans Excel, même si le nom d'un joueur commence par = ou +.",
        de: "Heruntergeladene Ergebnisse lassen sich gefahrlos in Excel öffnen, auch wenn ein Spielername mit = oder + beginnt.",
        es: "Los resultados descargados se abren sin riesgo en Excel, aunque el nombre de un jugador empiece por = o +.",
        el: "Τα αποτελέσματα που κατεβάζεις ανοίγουν με ασφάλεια στο Excel, ακόμα κι αν το όνομα ενός παίκτη ξεκινά με = ή +.",
        pt: "Os resultados transferidos abrem em segurança no Excel, mesmo que o nome de um jogador comece por = ou +.",
        ro: "Rezultatele descărcate se deschid în siguranță în Excel, chiar dacă numele unui jucător începe cu = sau +."
      },
      {
        en: "Layout fixes: buttons are centred where they should be, and the countdown on phones is a slim bar again.",
        fr: "Corrections de mise en page : les boutons sont centrés comme prévu et le compte à rebours sur téléphone redevient une barre fine.",
        de: "Layout-Korrekturen: Schaltflächen sind wieder zentriert, und der Countdown auf dem Handy ist wieder ein schmaler Balken.",
        es: "Arreglos de diseño: los botones vuelven a estar centrados y la cuenta atrás en el móvil vuelve a ser una barra fina.",
        el: "Διορθώσεις διάταξης: τα κουμπιά είναι κεντραρισμένα όπου πρέπει και η αντίστροφη μέτρηση στο κινητό είναι ξανά μια λεπτή μπάρα.",
        pt: "Correções de layout: os botões voltam a estar centrados e a contagem decrescente no telemóvel volta a ser uma barra fina.",
        ro: "Corecturi de aspect: butoanele sunt centrate unde trebuie, iar numărătoarea inversă de pe telefon este din nou o bară subțire."
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

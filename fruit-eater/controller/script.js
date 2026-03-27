// =============================================================================
// PIRATE CONTROLLER — script.js (téléphone du joueur)
// =============================================================================

const ws = new WebSocket(`ws://${location.host}`);

function send(type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

// =============================================================================
// REFERENCES HTML
// =============================================================================
const screenJoin = document.getElementById("screen-join");
const screenController = document.getElementById("screen-controller");
const screenSelect = document.getElementById("screen-select");
const pseudoInput = document.getElementById("pseudo");

// Référence au bouton image (div) de connexion
const btnJoinGraphical = document.getElementById("btn-join");

// Phase de chargement initiale
btnJoinGraphical.classList.add("loading"); // On grise le bouton graphiquement

ws.addEventListener("open", () => {
  console.log("Connecté au serveur");
  btnJoinGraphical.classList.remove("loading"); // On active le bouton
  // --- CORRECTION : ON NE MET PLUS DE TEXTE ICI ---
  // btnJoinGraphical.textContent = "S'engager !"; // SUPPRIMÉ
});

ws.addEventListener("close", () => {
  console.log("Déconnecté du serveur");
  btnJoinGraphical.classList.add("loading"); // On grise le bouton
  // --- CORRECTION : ON NE MET PLUS DE TEXTE ICI ---
  // btnJoinGraphical.textContent = "Déconnecté"; // SUPPRIMÉ
});

// HUD PARCHEMINS
const playerPseudo = document.getElementById("player-pseudo");
const playerTeam = document.getElementById("player-team");
const ctrlOpponentDeathsScore = document.getElementById("ctrl-opponent-deaths-score");
const ctrlTimer = document.getElementById("ctrl-timer");

// K.O. et Abordage
const screenInactive = document.getElementById("screen-inactive");
const inactiveCountdown = document.getElementById("inactive-countdown");

// Bouton Dash (Petit Crâne)
const btnDashSkull = document.getElementById("btn-dash");
const btnDashCooldownText = document.getElementById("btn-dash-cooldown-text");
const btnTaperPoing = document.getElementById("btn-taper");

let myId = null;
let myTeam = null;
let myPseudo = null;

// =============================================================================
// REJOINDRE LA PARTIE
// =============================================================================
// Le clic doit se faire sur le gros bouton image
btnJoinGraphical.addEventListener("click", () => {
  // Si le serveur n'est pas prêt, on ignore le clic
  if (ws.readyState !== WebSocket.OPEN) return;

  const pseudo = pseudoInput.value.trim();
  if (!pseudo) {
    pseudoInput.style.borderColor = "#ff0000";
    pseudoInput.focus();
    return;
  }
  pseudoInput.style.borderColor = "#ccc";
  send("join", { pseudo });
});

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// =============================================================================
// RÉCEPTION DES MESSAGES DU SERVEUR
// =============================================================================
ws.addEventListener("message", (event) => {
  const { type, data } = JSON.parse(event.data);

  // Étape 1 : Le serveur nous a attribué une team → Afficher sélection de skin
  if (type === "teamAssigned") {
    screenJoin.classList.add("hidden");
    screenSelect.classList.remove("hidden");

    myId = data.id;
    myTeam = data.team;
    myPseudo = data.pseudo;

    // Mettre à jour le badge de team
    const badge = document.getElementById("select-team-badge");
    badge.textContent = "TEAM " + data.team.toUpperCase();
    badge.className = "select-team-badge " + data.team;

    // Construire la grille de personnages
    const grid = document.getElementById("select-grid");
    grid.innerHTML = "";

    const teamFolder = data.team === "pirate" ? "team1" : "team2";
    const takenSet = new Set(data.takenSkins || []);

    data.skins.forEach((skinId, index) => {
      const card = document.createElement("div");
      card.className = "skin-card";
      card.dataset.skinId = skinId;
      card.style.animationDelay = (index * 0.06) + "s";

      if (takenSet.has(skinId)) {
        card.classList.add("taken");
      }

      const img = document.createElement("img");
      img.className = "skin-card-img";
      img.src = `/game-assets/${teamFolder}/${skinId}-Stat.png`;
      img.alt = skinId;
      img.draggable = false;

      card.appendChild(img);

      // Clic pour sélectionner
      card.addEventListener("click", () => {
        if (card.classList.contains("taken")) return;

        // Envoyer la sélection au serveur
        send("selectSkin", { skinId: skinId });

        // Visual feedback immédiat
        grid.querySelectorAll(".skin-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
      });

      grid.appendChild(card);
    });
  }

  // Mise à jour en temps réel des skins pris
  if (type === "skinTaken") {
    const grid = document.getElementById("select-grid");
    const takenSet = new Set(data.takenSkins || []);

    grid.querySelectorAll(".skin-card").forEach(card => {
      const skinId = card.dataset.skinId;
      if (takenSet.has(skinId) && !card.classList.contains("selected")) {
        card.classList.add("taken");
      } else if (!takenSet.has(skinId)) {
        card.classList.remove("taken");
      }
    });
  }

  // Étape 2 : Le serveur a validé notre skin → Aller à la manette
  if (type === "joined") {
    screenSelect.classList.add("hidden");
    screenJoin.classList.add("hidden");
    screenController.classList.remove("hidden");

    myId = data.id;
    playerPseudo.textContent = data.pseudo;
    // TEAM PIRATE / TEAM MONSTRE
    playerTeam.textContent = "TEAM " + data.team.toUpperCase();
    playerTeam.className = "badge " + data.team;
  }

  if (type === "state") {
    // MISE À JOUR HUD PARCHEMINS
    if (data.deaths && myId && data.players[myId]) {
      const myTeam = data.players[myId].team;
      const myTeamDeaths = data.deaths[myTeam] || 0;
      ctrlOpponentDeathsScore.textContent = myTeamDeaths;
    }
    ctrlTimer.textContent = formatTime(data.timeLeft || 0);

    if (myId && data.players[myId]) {
      const me = data.players[myId];
      const isInactive = me.inactiveUntil && me.inactiveUntil > Date.now();
      screenInactive.classList.toggle("hidden", !isInactive);
      if (isInactive) {
        inactiveCountdown.textContent = Math.ceil((me.inactiveUntil - Date.now()) / 1000);
      }
    }
  }
});

// =============================================================================
// JOYSTICK 360° (FLUIDE & PRÉCIS)
// =============================================================================
const joystickBase = document.getElementById("joystick-base");
const joystickKnob = document.getElementById("joystick-knob");

const MAX_KNOB_DIST = 45;
const DEAD_ZONE = 10;

let joystickInterval = null;
let currentDirX = 0;
let currentDirY = 0;

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > MAX_KNOB_DIST) {
    dx = (dx / dist) * MAX_KNOB_DIST;
    dy = (dy / dist) * MAX_KNOB_DIST;
  }
  // Le knob bleu (content_file_6.png) se déplace dans la base bleu clair
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

  if (dist > DEAD_ZONE) {
    currentDirX = dx / MAX_KNOB_DIST;
    currentDirY = dy / MAX_KNOB_DIST;
  } else {
    currentDirX = 0;
    currentDirY = 0;
  }
}

function resetJoystick() {
  joystickKnob.style.transform = "translate(0px, 0px)";
  currentDirX = 0;
  currentDirY = 0;
  clearInterval(joystickInterval);
  joystickInterval = null;
}

function startJoystick(clientX, clientY) {
  updateJoystick(clientX, clientY);
  if (!joystickInterval) {
    joystickInterval = setInterval(() => {
      if (currentDirX !== 0 || currentDirY !== 0) {
        send("move", { x: currentDirX, y: currentDirY });
      }
    }, 80);
  }
}

joystickBase.addEventListener("touchstart", (e) => { e.preventDefault(); startJoystick(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
joystickBase.addEventListener("touchmove", (e) => { e.preventDefault(); updateJoystick(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
joystickBase.addEventListener("touchend", (e) => { e.preventDefault(); resetJoystick(); }, { passive: false });
joystickBase.addEventListener("touchcancel", (e) => { e.preventDefault(); resetJoystick(); }, { passive: false });

joystickBase.addEventListener("mousedown", (e) => {
  startJoystick(e.clientX, e.clientY);
  const onMove = (e) => updateJoystick(e.clientX, e.clientY);
  const onUp = () => {
    resetJoystick();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

// ==========================================================
// GESTION DU BOUTON DASH (Petit Crâne)
// ==========================================================
if (btnDashSkull) {
  function fireDash(e) {
    e.preventDefault();
    if (btnDashSkull.disabled) return;

    send("dash", null);

    btnDashSkull.disabled = true; // Griser le crâne
    let secondsLeft = 10;
    btnDashCooldownText.textContent = secondsLeft; // Texte sur le crâne
    btnDashCooldownText.classList.remove("hidden"); // Afficher le chrono

    const cooldownInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        btnDashCooldownText.textContent = secondsLeft;
      } else {
        clearInterval(cooldownInterval);
        btnDashSkull.disabled = false;
        btnDashCooldownText.classList.add("hidden");
      }
    }, 1000);
  }

  btnDashSkull.addEventListener("touchstart", fireDash, { passive: false });
  btnDashSkull.addEventListener("mousedown", fireDash);
}
// ==========================================================
// GESTION DU BOUTON TAPER (Grand Poing)
// ==========================================================
if (btnTaperPoing) {
  function fireTaper(e) {
    e.preventDefault();
    if (btnTaperPoing.disabled) return;

    // On envoie l'ordre d'attaquer au serveur
    send("taper", null);

    // Animation de clic sur le bouton
    btnTaperPoing.style.transform = "scale(0.85)";
    setTimeout(() => { btnTaperPoing.style.transform = "scale(1)"; }, 100);

    // Si le joystick est bloqué (interval mort), on le redémarre
    if (!joystickInterval && (currentDirX !== 0 || currentDirY !== 0)) {
      joystickInterval = setInterval(() => {
        if (currentDirX !== 0 || currentDirY !== 0) {
          send("move", { x: currentDirX, y: currentDirY });
        }
      }, 80);
    }
  }

  btnTaperPoing.addEventListener("touchstart", fireTaper, { passive: false });
  btnTaperPoing.addEventListener("mousedown", fireTaper);
}
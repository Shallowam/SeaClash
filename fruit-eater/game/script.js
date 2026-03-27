// =============================================================================
// ECRAN DE JEU — script.js (Pirates vs Monstres)
// =============================================================================

const ws = new WebSocket(`ws://${location.host}`);
// =============================================================================
// PRÉCHARGEMENT DES IMAGES ET SONS (Anti-Lag)
// =============================================================================
const audioMortPirate = new Audio("sons-jeu/mort-pirates.mp3");
const audioMortMonstre = new Audio("sons-jeu/mort-monstres.mp3");

const audioBgmGenerale = new Audio("sons-jeu/musique-generale.mp3");
audioBgmGenerale.loop = true;
const audioBgmAbordage = new Audio("sons-jeu/musique-abordage.mp3");
audioBgmAbordage.loop = true;

let audioUnlocked = false;

// Créer un overlay visuel pour obliger le clic
const audioOverlay = document.createElement("div");
audioOverlay.innerHTML = "🔊 CLIQUEZ POUR ACTIVER LE SON";
audioOverlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);color:white;display:flex;align-items:center;justify-content:center;font-size:3rem;z-index:9999;cursor:pointer;font-family:sans-serif;text-align:center;";
document.body.appendChild(audioOverlay);

// Activer le son dès le clic sur l'overlay
document.addEventListener("click", () => {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audioOverlay.style.display = "none";

  // Lance la musique en cours (ou la générale par défaut)
  const bgmToPlay = currentBgm || audioBgmGenerale;
  if (!currentBgm) currentBgm = audioBgmGenerale;
  bgmToPlay.volume = 0.5;
  bgmToPlay.play().catch(e => console.warn("Audio:", e));
}, { once: true });

let currentBgm = null;
let bgmFadeInterval = null;

function playBgm(newBgm) {
  if (currentBgm === newBgm) return;
  
  if (!audioUnlocked) {
    currentBgm = newBgm;
    return;
  }
  
  if (!currentBgm) {
    newBgm.volume = 0.5;
    newBgm.play().catch(e => console.warn("Audio bloqué:", e));
    currentBgm = newBgm;
    return;
  }
  
  if (bgmFadeInterval) clearInterval(bgmFadeInterval);
  
  const oldBgm = currentBgm;
  currentBgm = newBgm;
  currentBgm.volume = 0;
  currentBgm.play().catch(e => console.warn("Audio bloqué:", e));
  
  let steps = 20;
  let currentStep = 0;
  bgmFadeInterval = setInterval(() => {
    currentStep++;
    oldBgm.volume = Math.max(0, (1 - currentStep / steps) * 0.5);
    currentBgm.volume = Math.min(0.5, (currentStep / steps) * 0.5);
    if (currentStep >= steps) {
      clearInterval(bgmFadeInterval);
      oldBgm.pause();
    }
  }, 50);
}

function stopBgm() {
  if (currentBgm) {
    currentBgm.pause();
    currentBgm.currentTime = 0;
    currentBgm = null;
  }
  if (bgmFadeInterval) {
    clearInterval(bgmFadeInterval);
    bgmFadeInterval = null;
  }
}

const imagesToPreload = [];
const pirateSkins = ["Perso1", "Perso2", "Perso3", "Perso4", "Perso5", "Perso6", "Perso7", "Perso8", "Perso9", "Perso10"];
const monstreSkins = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"];
const states = ["Stat", "move1", "move2", "rush1", "rush2", "KO"];

pirateSkins.forEach(skin => {
  states.forEach(state => imagesToPreload.push(`assets/team1/${skin}-${state}.png`));
});
monstreSkins.forEach(skin => {
  states.forEach(state => imagesToPreload.push(`assets/team2/${skin}-${state}.png`));
});

imagesToPreload.forEach(src => {
  const img = new Image();
  img.src = src;
});

// =============================================================================
// QR CODE
// =============================================================================
(function generateQRCode() {
  const controllerURL = `http://${location.host}/controller`;
  const qr = qrcode(0, "L");
  qr.addData(controllerURL);
  qr.make();
  document.getElementById("qr-code").innerHTML = qr.createImgTag(4, 0);
  // Aussi dans l'écran d'attente (plus grand)
  const waitingQr = document.getElementById("waiting-qr");
  if (waitingQr) waitingQr.innerHTML = qr.createImgTag(6, 0);
})();

// =============================================================================
// REFERENCES AUX ELEMENTS HTML
// =============================================================================
document.getElementById("btn-force-end").addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "forceEnd" }));
});

const arena = document.getElementById("arena");
const arenaWrapper = document.getElementById("arena-wrapper");
const waiting = document.getElementById("waiting");

// ON UTILISE LES BONS IDS (pirate / monstre)
const deathsPirate = document.getElementById("deaths-pirate");
const deathsMonstre = document.getElementById("deaths-monstre");
const timerEl = document.getElementById("timer");

const screenGameover = document.getElementById("screen-gameover");
const gameoverTitle = document.getElementById("gameover-title");
const finalPirate = document.getElementById("final-pirate");
const finalMonstre = document.getElementById("final-monstre");
const restartCountdown = document.getElementById("restart-countdown");

const abordageBanner = document.getElementById("abordage-banner");
const abordageCountdown = document.getElementById("abordage-countdown");
const passerelleTop = document.getElementById("passerelle-top");
const passerelleBottom = document.getElementById("passerelle-bottom");

// =============================================================================
// RESPONSIVE : ADAPTER L'ARENE A L'ECRAN
// =============================================================================
function fitArena() {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  const scale = Math.min(maxW / 1200, maxH / 675);
  arena.style.transform = `scale(${scale})`;
}
fitArena();
window.addEventListener("resize", fitArena);

// Dictionnaires d'éléments
const playerElements = {};
const gemElements = {};
const trapElements = {};
const bombElements = {};

let timeLeft = 0;
let latestState = null;   // dernier état reçu du serveur
let rafPending = false;   // est-ce qu'un RAF est déjà en attente ?

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// =============================================================================
// RECEPTION DES MESSAGES DU SERVEUR
// =============================================================================
ws.addEventListener("message", (event) => {
  const { type, data } = JSON.parse(event.data);

  // ETAT GLOBAL DU JEU — on stocke et on demande un rendu au prochain frame
  if (type === "state") {
    latestState = data;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(renderState);
    }
    return;
  }
}); // fin du premier handler (state seulement)

let previousAbordageActive = false;
let previousPhase = "waiting";
let abordageBannerTimeout = null;

// =============================================================================
// RENDU DOM — appelé via requestAnimationFrame
// =============================================================================
function renderState() {
  rafPending = false;
  if (!latestState) return;
  const data = latestState;
  const { players, fruits, traps, deaths, abordageActive, abordageTimeLeft, phase, countdown } = data;
  timeLeft = data.timeLeft || 0;

  const countdownOverlay = document.getElementById("countdown-overlay");
  const countdownImage = document.getElementById("countdown-image");

  if (phase === "countdown") {
    screenGameover.classList.add("hidden");
    countdownOverlay.classList.remove("hidden");

    let newSrc = "";
    if (countdown === 3) newSrc = "assets/3.png";
    else if (countdown === 2) newSrc = "assets/2.png";
    else if (countdown === 1) newSrc = "assets/1.png";
    else if (countdown === 0) newSrc = "assets/feu-a-volonte.png";

    if (newSrc && !countdownImage.src.endsWith(newSrc)) {
      countdownImage.src = newSrc;
      countdownImage.style.animation = 'none';
      void countdownImage.offsetHeight;
      countdownImage.style.animation = null;
    }
  } else {
    countdownOverlay.classList.add("hidden");
    if (phase === "playing") {
      screenGameover.classList.add("hidden");
    }
  }

  const ids = Object.keys(players);
  const waitingEl = document.getElementById("waiting");
  const waitingCounter = document.getElementById("waiting-counter");
  const playerCount = data.playerCount || 0;

  if (phase === "waiting") {
    waitingEl.style.display = "flex";
    if (waitingCounter) waitingCounter.textContent = playerCount + " / 2";
  } else {
    waitingEl.style.display = "none";
  }

  timerEl.textContent = formatTime(timeLeft);
  timerEl.classList.toggle("urgent", timeLeft < 30000 && timeLeft > 0);

  if (abordageActive) {
    playBgm(audioBgmAbordage);
  } else {
    playBgm(audioBgmGenerale);
  }
  previousPhase = phase;

  if (abordageActive && !previousAbordageActive) {
    abordageBanner.classList.remove("hidden");

    const img = abordageBanner.querySelector(".abordage-popup-img");
    if (img) {
      img.style.animation = 'none';
      void img.offsetHeight;
      img.style.animation = null;
    }

    if (abordageBannerTimeout) clearTimeout(abordageBannerTimeout);
    abordageBannerTimeout = setTimeout(() => {
      abordageBanner.classList.add("hidden");
    }, 3000);
  } else if (!abordageActive && previousAbordageActive) {
    abordageBanner.classList.add("hidden");
  }
  previousAbordageActive = abordageActive;

  passerelleTop.classList.toggle("hidden", !abordageActive);
  passerelleBottom.classList.toggle("hidden", !abordageActive);

  const abordageTimer = document.getElementById("abordage-timer");
  const abordageCountdownSpan = document.getElementById("abordage-countdown");
  if (abordageTimer) {
    abordageTimer.classList.toggle("hidden", !abordageActive);
  }
  if (abordageActive && abordageCountdownSpan) {
    abordageCountdownSpan.textContent = abordageTimeLeft;
  }

  if (deaths) {
    if (deathsPirate) deathsPirate.textContent = deaths.monstre || 0;
    if (deathsMonstre) deathsMonstre.textContent = deaths.pirate || 0;
  }

  const FRAME_RATE = 100;
  const TOTAL_MOVE_FRAMES = 2;

  // -- GESTION DES JOUEURS --
  ids.forEach((id) => {
    const p = players[id];
    const teamFolder = p.team === 'pirate' ? 'team1' : 'team2';
    const persoName = p.skinId || (p.team === 'pirate' ? 'Perso1' : 'M1');

    if (!playerElements[id]) {
      const el = document.createElement("div");
      el.className = "player";
      const idleSrc = `assets/${teamFolder}/${persoName}-Stat.png`;

      el.innerHTML = `
          <div class="ko-effects" style="display: none;">
            <img src="assets/stars.png" class="ko-star ko-star-1" alt="star1">
            <img src="assets/stars.png" class="ko-star ko-star-2" alt="star2">
          </div>
          <img class="player-sprite" src="${idleSrc}" style="width: 52px; height: 68px; display: block; pointer-events: none;">
          <span class="player-name">${p.pseudo}</span>
        `;
      arena.appendChild(el);
      playerElements[id] = el;

      el.dataset.lastX = p.x;
      el.dataset.lastY = p.y;
      el.dataset.currentFrame = 0;
      el.dataset.lastAnimTime = Date.now();
      el.dataset.state = "idle";
    }

    const el = playerElements[id];
    const sprite = el.querySelector('.player-sprite');
    const koEffects = el.querySelector('.ko-effects');

    const lastX = parseFloat(el.dataset.lastX || p.x);
    const lastY = parseFloat(el.dataset.lastY || p.y);

    if (Math.abs(p.x - lastX) > 0.5 || Math.abs(p.y - lastY) > 0.5) {
      el.dataset.lastMoveTime = Date.now();
      if (p.x > lastX + 0.5) sprite.style.transform = "scaleX(1)";
      else if (p.x < lastX - 1) sprite.style.transform = "scaleX(-1)";
    }

    const lastMoveTime = parseInt(el.dataset.lastMoveTime || 0);
    const isMoving = (Date.now() - lastMoveTime) < 150;

    const isAttacking = p.attackEndsAt && Date.now() < p.attackEndsAt;
    const isKO = p.inactiveUntil && p.inactiveUntil > Date.now();

    if (isKO) {
      if (el.dataset.state !== "ko") {
        // Jouer le son de mort selon l'équipe
        if (p.team === "pirate") {
          let sound = audioMortPirate.cloneNode();
          sound.play().catch(e => console.warn("Audio bloqué:", e));
        } else {
          let sound = audioMortMonstre.cloneNode();
          sound.play().catch(e => console.warn("Audio bloqué:", e));
        }

        clearInterval(el.attackInterval);
        sprite.src = `assets/${teamFolder}/${persoName}-KO.png`;
        sprite.style.width = "66px";
        sprite.style.height = "52px";
        sprite.style.opacity = "0.6";
        koEffects.style.display = "block";
        el.dataset.state = "ko";
      }
    }
    else if (isAttacking) {
      if (el.dataset.state !== "attack") {
        el.dataset.state = "attack";
        koEffects.style.display = "none";
        sprite.style.width = "52px";
        sprite.style.height = "68px";
        sprite.style.opacity = "1";

        let frame = 1;
        sprite.src = `assets/${teamFolder}/${persoName}-rush${frame}.png`;

        clearInterval(el.attackInterval);
        el.attackInterval = setInterval(() => {
          frame = frame === 1 ? 2 : 1;
          sprite.src = `assets/${teamFolder}/${persoName}-rush${frame}.png`;
        }, 100);
      }
    }
    else {
      if (el.dataset.state === "ko" || el.dataset.state === "attack") {
        clearInterval(el.attackInterval);
        sprite.src = `assets/${teamFolder}/${persoName}-Stat.png`;
        sprite.style.width = "52px";
        sprite.style.height = "68px";
        sprite.style.opacity = "1";
        koEffects.style.display = "none";
        el.dataset.state = "idle";
        el.dataset.lastAnimTime = Date.now();
      }

      if (isMoving) {
        const now = Date.now();
        const lastAnimTime = parseInt(el.dataset.lastAnimTime);

        if (now - lastAnimTime > FRAME_RATE) {
          let frame = parseInt(el.dataset.currentFrame || 0);
          frame = (frame + 1) % TOTAL_MOVE_FRAMES;
          sprite.src = `assets/${teamFolder}/${persoName}-move${frame + 1}.png`;
          el.dataset.currentFrame = frame;
          el.dataset.lastAnimTime = now;
          el.dataset.state = "move";
        }
      } else {
        if (el.dataset.state !== "idle") {
          sprite.src = `assets/${teamFolder}/${persoName}-Stat.png`;
          el.dataset.currentFrame = 0;
          el.dataset.state = "idle";
        }
      }
    }

    // Clignotement (invincibilité PvP)
    if (p.invincibleUntil && p.invincibleUntil > Date.now()) {
      el.classList.add("blinking");
    } else {
      el.classList.remove("blinking");
    }

    // Positionnement via transform (GPU — pas de reflow !)
    el.dataset.lastX = p.x;
    el.dataset.lastY = p.y;
    el.style.transform = `translate(${p.x - 42}px, ${p.y - 55}px)`;
  });

  Object.keys(playerElements).forEach((id) => {
    if (!players[id]) {
      playerElements[id].remove();
      delete playerElements[id];
    }
  });

  // -- GESTION DES GEMMES --
  const gemsData = fruits || {};
  Object.keys(gemsData).forEach((id) => {
    const g = gemsData[id];
    const isWarning = g.activeAt && g.activeAt > Date.now();

    if (!gemElements[id]) {
      const container = document.createElement("div");
      container.style.left = g.x + "px";
      container.style.top = g.y + "px";
      arena.appendChild(container);

      const halo = document.createElement("div");
      if (g.color === "verte") halo.className = "gem-halo halo-bombe";
      else if (g.color === "rouge") halo.className = "gem-halo halo-rouge";
      else halo.className = "gem-halo halo-corde";
      container.appendChild(halo);

      const gemImg = document.createElement("img");
      gemImg.className = "gem-image";
      if (g.color === "bombe") gemImg.src = "assets/bombe.png";
      else if (g.color === "rouge") gemImg.src = "assets/shark-icone.png";
      else gemImg.src = "assets/corde.png";
      container.appendChild(gemImg);

      gemElements[id] = container;
    }
    gemElements[id].className = isWarning ? "gem-container gem-warning" : "gem-container gem-active";
  });

  Object.keys(gemElements).forEach((id) => {
    if (!gemsData[id]) {
      const el = gemElements[id];
      el.className = "gem-container gem-burst";
      delete gemElements[id];
      setTimeout(() => { el.remove(); }, 400);
    }
  });

  // -- GESTION DES BOMBES LANCÉES --
  if (data.launchedBombs) {
    Object.keys(data.launchedBombs).forEach((bombId) => {
      const b = data.launchedBombs[bombId];

      if (b.state === "traveling") {
        if (!bombElements[bombId]) {
          const el = document.createElement("div");
          el.className = "bombe-splash";
          el.style.backgroundImage = "url('assets/bombe.png')";
          el.style.left = b.startX + "px";
          el.style.top = b.startY + "px";
          arena.appendChild(el);
          bombElements[bombId] = el;

          el.getBoundingClientRect();
          el.style.left = b.targetX + "px";
          el.style.top = b.targetY + "px";
        }
      }
      else if (b.state === "landed") {
        if (bombElements[bombId]) {
          const el = bombElements[bombId];
          el.style.left = b.currentX + "px";
          el.style.top = b.currentY + "px";
          el.classList.add("warning");
        }
      }
      else if (b.state === "exploded") {
        if (bombElements[bombId] && !bombElements[bombId].classList.contains("explosion")) {
          const el = bombElements[bombId];
          el.className = "explosion";
          el.style.backgroundImage = "url('assets/explosion.png')";
          setTimeout(() => {
            if (el.parentNode) el.remove();
            delete bombElements[bombId];
          }, 1000);
        }
      }
    });

    Object.keys(bombElements).forEach((bombId) => {
      if (!data.launchedBombs[bombId]) {
        if (bombElements[bombId].className === "bombe-splash") {
          bombElements[bombId].remove();
          delete bombElements[bombId];
        }
      }
    });
  }

  // -- GESTION DES PIEGES --
  if (traps) {
    Object.values(traps).forEach((trap) => {
      if (!trapElements[trap.id]) {
        const el = document.createElement("div");
        el.className = "trap";
        arena.appendChild(el);
        trapElements[trap.id] = el;
      }

      const el = trapElements[trap.id];
      const now = Date.now();

      if (trap.type === "line") {
        el.style.display = "none";
        return;
      }

      if (trap.type === "shark") {
        if (!el.dataset.started) {
          el.className = "trap shark";
          el.style.left = (trap.startX - 250) + "px";
          el.style.top = (trap.y - 150) + "px";

          if (trap.startX < trap.endX) {
            el.style.transform = "translateY(0) scaleX(-1)";
          } else {
            el.style.transform = "translateY(0) scaleX(1)";
          }

          void el.offsetHeight;
          el.style.left = (trap.endX - 250) + "px";
          el.dataset.started = "true";
        }
        return;
      }

      if (trap.sprite === 'pirate') el.classList.add('pirate');
      else el.classList.add('monstre');

      el.style.width = trap.radius * 2 + "px";
      el.style.height = trap.radius + "px";
      el.style.left = trap.x - trap.radius + "px";
      el.style.top = trap.y - (trap.radius / 2) + "px";

      el.classList.remove("warning");

      if (now < trap.activeAt) {
        el.classList.add("warning");
      }
      else if (now >= (trap.expireAt - 1500)) {
        el.classList.add("warning");
      }
    });

    Object.keys(trapElements).forEach((id) => {
      if (!traps[id]) {
        trapElements[id].remove();
        delete trapElements[id];
      }
    });
  }
} // fin renderState


// =============================================================================
// RECEPTION DES MESSAGES DU SERVEUR (gameOver)
// =============================================================================
ws.addEventListener("message", (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === "state") return; // géré par renderState/RAF

  // -------------------------------------------------------------------------
  // FIN DE PARTIE
  // -------------------------------------------------------------------------
  if (type === "gameOver") {
    const { deaths: finalDeaths, winner, restartIn } = data;

    screenGameover.classList.remove("hidden");

    if (finalPirate) finalPirate.textContent = (finalDeaths?.monstre ?? 0);
    if (finalMonstre) finalMonstre.textContent = (finalDeaths?.pirate ?? 0);

    const titleImg = document.getElementById("gameover-title-img");
    if (titleImg) {
      if (winner === "egalite") {
        titleImg.style.display = "none";
      } else {
        titleImg.style.display = "block";
        titleImg.src = winner === "pirate" ? "assets/win-pirate.png" : "assets/win-monstres.png";
      }
    }

    const ribbonPirate = document.getElementById("ribbon-pirate");
    const ribbonMonstre = document.getElementById("ribbon-monstre");

    if (ribbonPirate) {
      ribbonPirate.classList.remove("winner");
      if (winner === "pirate") ribbonPirate.classList.add("winner");
    }
    if (ribbonMonstre) {
      ribbonMonstre.classList.remove("winner");
      if (winner === "monstre") ribbonMonstre.classList.add("winner");
    }

    let remaining = Math.ceil(restartIn / 1000);
    restartCountdown.textContent = remaining;
    const countdownIntervalGO = setInterval(() => {
      remaining--;
      if (restartCountdown) restartCountdown.textContent = Math.max(0, remaining);
      if (remaining <= 0) clearInterval(countdownIntervalGO);
    }, 1000);
  }
});

// =============================================================================
// DEBUG VISUEL DES ZONES (Touche "d")
// =============================================================================

const DEBUG_ZONES = {
  pirate: [
    { x1: 310, y1: 150, x2: 500, y2: 205 },
    { x1: 76, y1: 205, x2: 500, y2: 500 },
    { x1: 360, y1: 440, x2: 550, y2: 580 },
    { x1: 385, y1: 580, x2: 550, y2: 605 },
    { x1: 220, y1: 420, x2: 530, y2: 540 },
    { x1: 220, y1: 205, x2: 530, y2: 330 },
  ],
  monstre: [
    { x1: 700, y1: 170, x2: 940, y2: 540 },
    { x1: 685, y1: 200, x2: 940, y2: 340 },
    { x1: 695, y1: 220, x2: 1100, y2: 560 },
    { x1: 1100, y1: 380, x2: 1145, y2: 550 },
    { x1: 1130, y1: 400, x2: 1160, y2: 570 },
    { x1: 670, y1: 440, x2: 965, y2: 570 },
    { x1: 680, y1: 440, x2: 965, y2: 590 }
  ]
};

let debugMode = false;
const debugEls = [];

function toggleDebug() {
  debugMode = !debugMode;
  if (debugMode) {
    const colors = { pirate: "rgba(233,69,96,0.35)", monstre: "rgba(78,168,222,0.35)" };
    const borders = { pirate: "#e94560", monstre: "#4ea8de" };
    for (const [team, rects] of Object.entries(DEBUG_ZONES)) {
      rects.forEach((r, i) => {
        const el = document.createElement("div");
        el.style.cssText = `
          position:absolute;
          left:${r.x1}px; top:${r.y1}px;
          width:${r.x2 - r.x1}px; height:${r.y2 - r.y1}px;
          background:${colors[team]};
          border:2px dashed ${borders[team]};
          z-index:4; pointer-events:none;
          box-sizing:border-box;
        `;
        const label = document.createElement("span");
        label.textContent = `${team} #${i}`;
        label.style.cssText = "color:white;font-size:12px;font-weight:bold;padding:2px 4px;";
        el.appendChild(label);
        document.getElementById("arena").appendChild(el);
        debugEls.push(el);
      });
    }
  } else {
    debugEls.forEach(el => el.remove());
    debugEls.length = 0;
  }
}

document.addEventListener("keydown", e => {
  if (e.key === "d") toggleDebug();
});
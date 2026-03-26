// =============================================================================
// ECRAN DE JEU — script.js (Pirates vs Monstres)
// =============================================================================

const ws = new WebSocket(`ws://${location.host}`);
// =============================================================================
// PRÉCHARGEMENT DES IMAGES (Anti-Lag)
// =============================================================================
const imagesToPreload = [
  "assets/team1/Perso1-Stat.png", "assets/team1/Perso1-move1.png", "assets/team1/Perso1-move2.png",
  "assets/team1/Perso1-rush1.png", "assets/team1/Perso1-rush2.png", "assets/team1/Perso1-KO.png",
  "assets/team2/M1-Stat.png", "assets/team2/M1-move1.png", "assets/team2/M1-move2.png",
  "assets/team2/M1-rush1.png", "assets/team2/M1-rush2.png", "assets/team2/M1-KO.png"
];
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
})();

// =============================================================================
// REFERENCES AUX ELEMENTS HTML
// =============================================================================
document.getElementById("btn-restart").addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "restart" }));
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

  // -------------------------------------------------------------------------
  // ETAT GLOBAL DU JEU
  // -------------------------------------------------------------------------
  if (type === "state") {
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
        void countdownImage.offsetHeight; /* trigger CSS reflow */
        countdownImage.style.animation = null; 
      }
    } else {
      countdownOverlay.classList.add("hidden");
      if (phase === "playing") {
        screenGameover.classList.add("hidden");
      }
    }

    const ids = Object.keys(players);
    waiting.style.display = ids.length === 0 && phase === "waiting" ? "flex" : "none";

    timerEl.textContent = formatTime(timeLeft);
    timerEl.classList.toggle("urgent", timeLeft < 30000 && timeLeft > 0);

    abordageBanner.classList.toggle("hidden", !abordageActive);
    passerelleTop.classList.toggle("hidden", !abordageActive);
    passerelleBottom.classList.toggle("hidden", !abordageActive);
    if (abordageActive) abordageCountdown.textContent = abordageTimeLeft + "s";

    if (deaths) {
      if (deathsPirate) deathsPirate.textContent = deaths.pirate || 0;
      if (deathsMonstre) deathsMonstre.textContent = deaths.monstre || 0;
    }

    const FRAME_RATE = 100; 
    const TOTAL_MOVE_FRAMES = 2; 

    // -- GESTION DES JOUEURS --
    ids.forEach((id) => {
      const p = players[id];
      const teamFolder = p.team === 'pirate' ? 'team1' : 'team2';
      const persoName = p.team === 'pirate' ? 'Perso1' : 'M1';
      
      // On initialise le joueur s'il n'existe pas
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
      
      // ====================================================================
      // 1. LE CORRECTIF ANTI-LAG (Mémoire de mouvement)
      // ====================================================================
      // Si le joueur a bougé, on met à jour son chronomètre de mouvement
      if (Math.abs(p.x - lastX) > 0.5 || Math.abs(p.y - lastY) > 0.5) {
          el.dataset.lastMoveTime = Date.now();
          
          // On gère son orientation (Gauche/Droite) EN DEHORS des animations !
          if (p.x > lastX + 0.5) sprite.style.transform = "scaleX(1)"; 
          else if (p.x < lastX - 1) sprite.style.transform = "scaleX(-1)"; 
      }
      
      // On considère qu'il "marche" s'il a bougé dans les 150 dernières millisecondes.
      // Ça empêche le serveur de couper l'animation s'il y a un petit lag réseau !
      const lastMoveTime = parseInt(el.dataset.lastMoveTime || 0);
      const isMoving = (Date.now() - lastMoveTime) < 150;

      const isAttacking = p.attackEndsAt && Date.now() < p.attackEndsAt;
      const isKO = p.inactiveUntil && p.inactiveUntil > Date.now();

      // ====================================================================
      // 2. GESTION DU MODE KO
      // ====================================================================
      if (isKO) {
          if (el.dataset.state !== "ko") {
              clearInterval(el.attackInterval); // On stoppe l'attaque
              sprite.src = `assets/${teamFolder}/${persoName}-KO.png`; 
              sprite.style.width = "66px"; 
              sprite.style.height = "52px";
              sprite.style.opacity = "0.6"; 
              koEffects.style.display = "block"; 
              el.dataset.state = "ko";
          }
      } 
      // ====================================================================
      // 3. GESTION DE L'ATTAQUE (Animation locale 100% fluide)
      // ====================================================================
      else if (isAttacking) {
          if (el.dataset.state !== "attack") {
              el.dataset.state = "attack";
              koEffects.style.display = "none";
              sprite.style.width = "52px";
              sprite.style.height = "68px";
              sprite.style.opacity = "1";
              
              // On affiche la frame 1 immédiatement
              let frame = 1;
              sprite.src = `assets/${teamFolder}/${persoName}-rush${frame}.png`;
              
              // Le navigateur gère le clignotement de l'attaque TOUT SEUL en boucle !
              clearInterval(el.attackInterval);
              el.attackInterval = setInterval(() => {
                  frame = frame === 1 ? 2 : 1; // Alterne entre 1 et 2
                  sprite.src = `assets/${teamFolder}/${persoName}-rush${frame}.png`;
              }, 100); // Change d'image toutes les 100ms
          }
      }
      // ====================================================================
      // 4. GESTION NORMALE (Marche / Immobilité)
      // ====================================================================
      else {
          // S'il sortait du mode KO ou Attaque
          if (el.dataset.state === "ko" || el.dataset.state === "attack") {
              clearInterval(el.attackInterval); // On stoppe le sabre
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
              
              // Fait défiler move1 et move2
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

      // On applique enfin les coordonnées
      el.dataset.lastX = p.x;
      el.dataset.lastY = p.y;
      el.style.left = p.x - 42 + "px";
      el.style.top  = p.y - 55 + "px";
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
            el.style.top  = b.startY + "px";
            arena.appendChild(el);
            bombElements[bombId] = el;

            el.getBoundingClientRect(); 
            el.style.left = b.targetX + "px";
            el.style.top  = b.targetY + "px";
          }
        }
        else if (b.state === "landed") {
          if (bombElements[bombId]) {
            const el = bombElements[bombId];
            el.style.left = b.currentX + "px";
            el.style.top  = b.currentY + "px";
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

    // -- GESTION DES PIEGES (Sables mouvants) --
    if (traps) {
      Object.values(traps).forEach((trap) => {
        // 1. Création de l'élément s'il n'existe pas
        if (!trapElements[trap.id]) {
          const el = document.createElement("div");
          el.className = "trap";
          arena.appendChild(el);
          trapElements[trap.id] = el;
        }
        
        const el = trapElements[trap.id];
        const now = Date.now();
        
        // Ignorer les lasers (line)
        if (trap.type === "line") {
          el.style.display = "none";
          return;
        }
        
        // --- MANAGE SHARK TRAPS ---
        if (trap.type === "shark") {
          if (!el.dataset.started) {
            el.className = "trap shark";
            el.style.left = (trap.startX - 250) + "px"; // Centré horizontalement (largeur 500 => -250)
            el.style.top = (trap.y - 150) + "px"; // Centré verticalement (hauteur 300 => -150)
            
            // Inverser l'image s'il va vers la droite car le fichier pointe vers la gauche
            if (trap.startX < trap.endX) {
              el.style.transform = "translateY(0) scaleX(-1)";
            } else {
              el.style.transform = "translateY(0) scaleX(1)";
            }
            
            // Forcer le reflow DOM pour que la transition CSS s'active
            void el.offsetHeight;
            
            // Définir la cible
            el.style.left = (trap.endX - 250) + "px";
            el.dataset.started = "true";
          }
          return; // Ignore logic intended for stationary quicksand traps
        }

        // 2. Attribution de la bonne équipe (pour le sprite de base)
        if (trap.sprite === 'pirate') el.classList.add('pirate');
        else el.classList.add('monstre');
        
        // 3. Positionnement et taille (TRAP_RADIUS, mais écrasé)
        el.style.width = trap.radius * 2 + "px";
        el.style.height = trap.radius + "px"; // Hauteur divisée par 2 ("écrasé")
        el.style.left = trap.x - trap.radius + "px";
        el.style.top  = trap.y - (trap.radius / 2) + "px"; // Centrage vertical ajusté
        
        // ===========================================================
        // 4. GESTION DES CLIGNOTEMENTS (Warning 1.5s)
        // ===========================================================
        el.classList.remove("warning"); // On nettoie par défaut
        
        // Avertissement avant apparition (pendant les 1.5 premières secondes)
        if (now < trap.activeAt) {
          el.classList.add("warning");
        } 
        // Avertissement avant disparition (pendant les 1.5 dernières secondes)
        else if (now >= (trap.expireAt - 1500)) {
          el.classList.add("warning");
        }
        
        // (Le serveur supprimera le piège de la liste quand now >= trap.expireAt)
      });

      // 5. Nettoyage des pièges supprimés par le serveur
      Object.keys(trapElements).forEach((id) => {
        if (!traps[id]) {
          trapElements[id].remove();
          delete trapElements[id];
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. FIN DE PARTIE
  // -------------------------------------------------------------------------
  if (type === "gameOver") {
    const { deaths: finalDeaths, winner, restartIn } = data;

    screenGameover.classList.remove("hidden");

    if (finalPirate) finalPirate.textContent = "💀 " + (finalDeaths?.pirate ?? 0);
    if (finalMonstre) finalMonstre.textContent  = "💀 " + (finalDeaths?.monstre  ?? 0);

    if (winner === "egalite") {
      gameoverTitle.textContent = "Egalite !";
    } else {
      gameoverTitle.textContent = winner === "pirate" ? "Les Pirates gagnent !" : "Les Monstres gagnent !";
    }

    document.querySelectorAll(".gameover-team").forEach((el) => {
      el.classList.remove("winner");
      if (el.classList.contains(winner)) {
        el.classList.add("winner");
      }
    });

    let remaining = Math.ceil(restartIn / 1000); 
    restartCountdown.textContent = remaining;
    const countdownInterval = setInterval(() => {
      remaining--;
      if (restartCountdown) restartCountdown.textContent = Math.max(0, remaining);
      if (remaining <= 0) clearInterval(countdownInterval); 
    }, 1000);
  }
});
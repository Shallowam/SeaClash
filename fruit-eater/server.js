// =============================================================================
// SERVEUR DE JEU — server.js (Sea Clash : Pirates vs Monstres)
// =============================================================================

const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const os = require("os");

const app = express();
const http = createServer(app);
const wss = new WebSocketServer({ server: http });

const PORT = 3000;

app.use("/controller", express.static(path.join(__dirname, "controller")));
app.use("/game", express.static(path.join(__dirname, "game")));
// Servir les assets du jeu pour que le controller puisse afficher les sprites
app.use("/game-assets", express.static(path.join(__dirname, "game", "Assets")));

app.get("/", (req, res) => {
  res.redirect("/controller");
});

// =============================================================================
// CONFIGURATION DU JEU
// =============================================================================

const ARENA = { width: 1200, height: 675 };
const ADVANCED_ZONES = {
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

function isInZone(x, y, team) {
  const rects = ADVANCED_ZONES[team];
  if (!rects) return false;
  return rects.some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2);
}

function getRandomPositionInZone(team) {
  const rects = ADVANCED_ZONES[team];
  const totalArea = rects.reduce((sum, r) => sum + ((r.x2 - r.x1) * (r.y2 - r.y1)), 0);
  let randomArea = Math.random() * totalArea;
  let pickedRect = rects[rects.length - 1];
  for (const r of rects) {
    const area = (r.x2 - r.x1) * (r.y2 - r.y1);
    if (randomArea < area) { pickedRect = r; break; }
    randomArea -= area;
  }
  return {
    x: Math.floor(Math.random() * (pickedRect.x2 - pickedRect.x1)) + pickedRect.x1,
    y: Math.floor(Math.random() * (pickedRect.y2 - pickedRect.y1)) + pickedRect.y1
  };
}

function isInPasserelleRect(x, y) {
  if (x >= 450 && x <= 750) {
    return PASSERELLES.some(p => y >= p.y - p.height / 2 && y <= p.y + p.height / 2);
  }
  return false;
}

function isPosValid(x, y, player) {
  const inAppleZone = player.appleReturn && Date.now() < player.appleReturn;
  const activeZoneKey = inAppleZone ? (player.team === "pirate" ? "monstre" : "pirate") : player.team;
  if (!abordageActive || inAppleZone) return isInZone(x, y, activeZoneKey);
  return isInZone(x, y, "pirate") || isInZone(x, y, "monstre") || isInPasserelleRect(x, y);
}

const SKINS = {
  pirate: ["Perso1", "Perso2", "Perso3", "Perso4", "Perso5", "Perso6", "Perso7", "Perso8", "Perso9", "Perso10"],
  monstre: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"]
};

const SPEED = 18;
const GAME_DURATION = 10 * 60 * 1000;
const RESTART_DELAY = 30 * 1000;
const MAX_GEMS = 5;
const PICKUP_DISTANCE = 80;

const TRAP_COUNT = 1; // 1 sable mouvant par zone
const TRAP_RADIUS = 50;
const INACTIVE_DURATION = 2 * 1000; // 2 secondes
const RED_TRAP_ACTIVE_DURATION = 15 * 1000; // 15 secondes visibles
const RED_TRAP_HIDDEN_DURATION = 5 * 1000;  // 5 secondes cachées (plus aucune zone)

const ABORDAGE_WINDOWS = [
  { start: 2 * 60 * 1000, end: 2 * 60 * 1000 + 45 * 1000 },
  { start: 5 * 60 * 1000, end: 5 * 60 * 1000 + 45 * 1000 },
  { start: 8 * 60 * 1000, end: 8 * 60 * 1000 + 45 * 1000 },
];
const PUSH_DISTANCE = 80;
const APPLE_TELEPORT_DURATION = 15 * 1000;
const LINE_TRAP_DURATION = 3 * 1000;
const LINE_TRAP_TOLERANCE = 40;
const PASSERELLES = [
  { y: 240, height: 120 },
  { y: 440, height: 120 },
];

// =============================================================================
// ETAT DU JEU
// =============================================================================

let players = {};
let pendingPlayers = {}; // Joueurs en cours de sélection de skin (pas encore en jeu)
let takenSkins = { pirate: new Set(), monstre: new Set() }; // Skins pris par team
let fruits = {};
let traps = {};
let launchedBombs = {};
// LES TEAMS SONT MAINTENANT PIRATE ET MONSTRE
let scores = { pirate: 0, monstre: 0 };
let deaths = { pirate: 0, monstre: 0 };

let gamePhase = "waiting";

let gameEndTime = 0;
let restartTime = 0;
let nextId = 1;
let nextFruitId = 1;
let gameInterval = null;
let countdownInterval = null;
let restartTimeout = null;
let abordageActive = false;
let abordageTimeLeft = 0;
let redTrapsActive = false;
let nextRedTrapChange = 0;
let currentCountdown = 0;
let needsBroadcast = false; // flag pour la game loop d'envoi

// =============================================================================
// GAME LOOP D'ENVOI — 20 FPS fixe (50ms), indépendant des inputs
// =============================================================================
const BROADCAST_INTERVAL = 50; // ms  →  20 fps

function buildStateMsg() {
  return JSON.stringify({
    type: "state",
    data: {
      players,
      fruits,
      traps,
      scores,
      launchedBombs,
      deaths,
      abordageActive,
      abordageTimeLeft,
      arena: ARENA,
      phase: gamePhase,
      timeLeft: gamePhase === "playing" ? Math.max(0, gameEndTime - Date.now()) : 0,
      countdown: currentCountdown,
      playerCount: Object.keys(players).length
    }
  });
}

setInterval(() => {
  if (!needsBroadcast) return;
  needsBroadcast = false;
  const msg = buildStateMsg(); // sérialisation unique
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) client.send(msg);
  });
}, BROADCAST_INTERVAL);

// =============================================================================
// GESTION DES GEMMES (Pouvoirs)
// =============================================================================

const GEM_COLORS = ["bombe", "rouge", "corde"];

function spawnFruit() {
  const id = String(nextFruitId++);

  // La "corde" ne peut apparaître qu'une seule fois à la fois sur la map
  const cordeExists = Object.values(fruits).some(f => f.color === "corde");
  const availableColors = cordeExists
    ? ["bombe", "rouge"]
    : GEM_COLORS;

  const color = availableColors[Math.floor(Math.random() * availableColors.length)];

  const side = Math.random() < 0.5 ? "pirate" : "monstre";
  const { x, y } = getRandomPositionInZone(side);

  const now = Date.now();
  fruits[id] = {
    id,
    color: color,
    x: x,
    y: y,
    activeAt: now + 2000,
    expiresAt: now + 12000
  };
  return id;
}

function fillFruits() {
  const currentCount = Object.keys(fruits).length;
  for (let i = currentCount; i < MAX_GEMS; i++) {
    spawnFruit();
  }
}

function checkPickup(player) {
  for (const [id, fruit] of Object.entries(fruits)) {
    if (fruit.activeAt && Date.now() < fruit.activeAt) continue;

    const dx = player.x - fruit.x;
    const dy = player.y - fruit.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < PICKUP_DISTANCE) {
      const { color, y: fruitY } = fruit;
      delete fruits[id];

      setTimeout(() => {
        if (gamePhase === "playing" && !abordageActive) fillFruits();
      }, 3000);

      const opponentTeam = player.team === "pirate" ? "monstre" : "pirate";

      if (color === "corde") {
        // On vérifie si le joueur est actuellement dans son camp
        const isHome = (player.team === "pirate" && player.x < ARENA.width / 2) ||
          (player.team === "monstre" && player.x >= ARENA.width / 2);

        if (isHome) {
          // 1. IL EST CHEZ LUI : On l'envoie à l'abordage chez l'ennemi !
          const destTeam = player.team === "pirate" ? "monstre" : "pirate";
          const destPos = getRandomPositionInZone(destTeam);
          player.x = destPos.x;
          player.y = destPos.y;

          player.appleReturn = Date.now() + APPLE_TELEPORT_DURATION; // On lance le chrono de retour automatique (15s)
          console.log(`🪢 ${player.pseudo} a pris une Corde -> TÉLÉPORTÉ CHEZ L'ENNEMI !`);
        } else {
          // 2. IL EST DÉJÀ CHEZ L'ENNEMI : Billet de retour anticipé !
          const homePos = getRandomPositionInZone(player.team);
          player.x = homePos.x;
          player.y = homePos.y;

          delete player.appleReturn; // On annule le chrono puisqu'il est rentré tout seul !
          console.log(`🪢 ${player.pseudo} a pris une Corde -> RETOUR À LA BASE !`);
        }
      }
      else if (color === "rouge") {
        const sharkId = "shark_" + Date.now();
        const startX = player.team === "pirate" ? -300 : ARENA.width + 300;
        const endX = player.team === "pirate" ? ARENA.width + 300 : -300;

        traps[sharkId] = {
          id: sharkId,
          type: "shark",
          y: fruitY,
          startX: startX,
          endX: endX,
          targetTeam: opponentTeam,
          duration: 5000,
          startTime: Date.now(),
          deactivateAt: Date.now() + 5000,
          inactiveDuration: 5 * 1000
        };
        scores[player.team]++;
        console.log(`${player.pseudo} a invoqué un Requin Géant !`);
      }
      else {
        const potentialTargets = Object.values(players).filter(p => p.team === opponentTeam);
        if (potentialTargets.length > 0) {
          const target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
          const bombId = "b_" + Date.now();
          const targetX = target.x;
          const targetY = target.y;

          launchedBombs[bombId] = {
            id: bombId, startX: fruit.x, startY: fruitY, targetX: targetX, targetY: targetY, state: "traveling"
          };
          broadcastState();

          setTimeout(() => {
            if (launchedBombs[bombId]) {
              launchedBombs[bombId].state = "landed";
              broadcastState();
            }
          }, 1500);

          setTimeout(() => {
            if (launchedBombs[bombId]) {
              launchedBombs[bombId].state = "exploded";
              const EXPLOSION_RADIUS = 100;
              Object.values(players).forEach(p => {
                const dx = p.x - targetX;
                const dy = p.y - targetY;
                if (Math.sqrt(dx * dx + dy * dy) < EXPLOSION_RADIUS) {
                  p.inactiveUntil = Date.now() + INACTIVE_DURATION;
                  p.invincibleUntil = Date.now() + INACTIVE_DURATION + 2000;
                  deaths[p.team]++;
                  console.log(`💥 ${p.pseudo} touché par la bombe !`);
                }
              });
              broadcastState();

              setTimeout(() => { delete launchedBombs[bombId]; }, 1000);
            }
          }, 3000);

        } else {
          scores[player.team]++;
        }
      }
      return true;
    }
  }
  return false;
}

// =============================================================================
// GESTION DES PIÈGES & COLLISIONS
// =============================================================================

function respawnRedTrapsForSide(side) {
  for (let i = 0; i < TRAP_COUNT; i++) {
    const id = "s" + side + i;

    const now = Date.now();
    const { x, y } = getRandomPositionInZone(side);

    traps[id] = {
      id,
      type: "sable",
      sprite: side,
      x: x,
      y: y,
      radius: TRAP_RADIUS,
      inactiveDuration: INACTIVE_DURATION,

      // GESTION DU TEMPS (Clignotements)
      // Il devient mortel 1.5s après sa création (pendant l'avertissement)
      activeAt: now + 1500,
      // Il disparaît 10s après être devenu actif (durée totale 11.5s)
      expireAt: now + 11500
    };
  }
}

function spawnTraps() {
  respawnRedTrapsForSide("pirate");
  respawnRedTrapsForSide("monstre");
}

function isInPasserelle(y) {
  return PASSERELLES.some(p => y >= p.y - p.height / 2 && y <= p.y + p.height / 2);
}

function checkTrap(player) {
  if (player.respawnProtected) {
    const inRedTrap = Object.values(traps).some(t => {
      if (t.type !== "rouge") return false;
      const dx = player.x - t.x;
      const dy = player.y - t.y;
      return Math.sqrt(dx * dx + (dy * 2) * (dy * 2)) < t.radius;
    });
    if (inRedTrap) return;
    delete player.respawnProtected;
  }

  if (player.inactiveUntil && Date.now() < player.inactiveUntil) return;
  if (player.invincibleUntil && Date.now() < player.invincibleUntil) return;
  for (const trap of Object.values(traps)) {
    if (trap.activeAt && Date.now() < trap.activeAt) continue;
    if (trap.activeAt && Date.now() < trap.activeAt) continue;
    if (trap.deactivateAt && Date.now() >= trap.deactivateAt) continue;

    let hit = false;
    if (trap.type === "line") {
      hit = player.team === trap.targetTeam && Math.abs(player.y - trap.y) < trap.tolerance;
    } else if (trap.type === "shark") {
      if (player.team === trap.targetTeam && Date.now() >= trap.startTime) {
        const elapsed = Date.now() - trap.startTime;
        const progress = Math.min(1, elapsed / trap.duration);
        const currentX = trap.startX + (trap.endX - trap.startX) * progress;
        // Hitbox rectangulaire réduite (le sprite fait 320x190)
        if (Math.abs(player.x - currentX) < 130 && Math.abs(player.y - trap.y) < 75) {
          hit = true;
        }
      }
    } else {
      const dx = player.x - trap.x;
      const dy = player.y - trap.y;
      // Collision elliptique pour correspondre à l'affichage "écrasé"
      hit = Math.sqrt(dx * dx + (dy * 2) * (dy * 2)) < trap.radius;
    }

    if (hit) {
      // Si le joueur est déjà inactif, on ne réinitialise pas son timer
      if (player.inactiveUntil && Date.now() < player.inactiveUntil) break;

      player.inactiveUntil = Date.now() + trap.inactiveDuration;
      player.invincibleUntil = Date.now() + trap.inactiveDuration + 2000;
      player.respawnProtected = true;
      deaths[player.team]++;

      const SCATTER = 120; // Distance max de respawn autour du point de mort
      let safeX, safeY, onTrap, attempts = 0;
      do {
        // Offset aléatoire proche du point de mort
        safeX = player.x + (Math.random() * SCATTER * 2 - SCATTER);
        safeY = player.y + (Math.random() * SCATTER * 2 - SCATTER);
        safeX = Math.floor(safeX);
        safeY = Math.floor(safeY);

        onTrap = Object.values(traps).some(t => {
          if (t.type === "line") return Math.abs(safeY - t.y) < t.tolerance;
          if (t.type === "shark") return Math.abs(safeY - t.y) < 75;
          return Math.sqrt((safeX - t.x) ** 2 + ((safeY - t.y) * 2) ** 2) < t.radius;
        });
        attempts++;
        // Fallback après 20 tentatives : position aléatoire dans la zone
        if (attempts > 20 || !isInZone(safeX, safeY, player.team)) {
          if (attempts > 30) {
            const pos = getRandomPositionInZone(player.team);
            safeX = pos.x;
            safeY = pos.y;
            break;
          }
          onTrap = true; // Force retry if out of bounds
        }
      } while (onTrap);
      player.x = safeX;
      player.y = safeY;
      console.log(`${player.pseudo} est inactif !`);
      break;
    }
  }
}

function checkPush(player) {
  // Désactivé : les collisions corps à corps sont retirées.
  // Seul le sabre peut infliger des dégâts.
}

// =============================================================================
// GESTION DE LA PARTIE
// =============================================================================

function startGame() {
  scores = { pirate: 0, monstre: 0 };
  deaths = { pirate: 0, monstre: 0 };

  fruits = {};
  fillFruits();
  traps = {};
  launchedBombs = {};
  spawnTraps();
  redTrapsActive = true;

  for (const player of Object.values(players)) {
    const pos = getRandomPositionInZone(player.team);
    player.x = pos.x;
    player.y = pos.y;
    player.hitCount = 0;
    player.invincibleUntil = 0;
    delete player.inactiveUntil;
  }

  // --- PHASE DE COMPTE À REBOURS ---
  gamePhase = "countdown";
  currentCountdown = 3;
  console.log("--- Compte à Rebours ---");
  broadcastState();

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    currentCountdown--;
    if (currentCountdown >= 0) {
      broadcastState();
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;

      // Lancement réel de la partie
      gamePhase = "playing";
      gameEndTime = Date.now() + GAME_DURATION;
      nextRedTrapChange = Date.now() + RED_TRAP_ACTIVE_DURATION;
      console.log("--- Partie lancee ! ---");
      broadcastState();

      gameInterval = setInterval(() => {
        if (Date.now() >= gameEndTime) {
          endGame();
        } else {
          const elapsed = GAME_DURATION - Math.max(0, gameEndTime - Date.now());
          const activeWindow = ABORDAGE_WINDOWS.find(w => elapsed >= w.start && elapsed < w.end);
          const wasAbordage = abordageActive;
          abordageActive = !!activeWindow;
          abordageTimeLeft = activeWindow ? Math.ceil((activeWindow.end - elapsed) / 1000) : 0;

          if (!wasAbordage && abordageActive) {
            fruits = {};
          }

          if (wasAbordage && !abordageActive) {
            for (const player of Object.values(players)) {
              if (!isInZone(player.x, player.y, player.team)) {
                const pos = getRandomPositionInZone(player.team);
                player.x = pos.x;
                player.y = pos.y;
              }
            }
            fillFruits();
          }

          for (const [id, trap] of Object.entries(traps)) {
            if ((trap.type === "line" || trap.type === "shark") && Date.now() >= trap.deactivateAt) delete traps[id];
          }
          // =======================================================
          // NOUVEAU : NETTOYAGE DES OBJETS PÉRIMÉS (10 secondes)
          // =======================================================
          let needsNewFruits = false;
          for (const [id, fruit] of Object.entries(fruits)) {
            if (fruit.expiresAt && Date.now() >= fruit.expiresAt) {
              delete fruits[id]; // On supprime l'objet
              needsNewFruits = true;
            }
          }
          // On remplace les objets disparus (sauf si on est en phase d'abordage)
          if (needsNewFruits && !abordageActive) {
            fillFruits();
          }
          // =======================================================
          // NOUVEAU : CYCLE DES ZONES ROUGES (Apparition / Disparition)
          // =======================================================
          if (Date.now() >= nextRedTrapChange) {
            if (redTrapsActive) {
              // 1. Il est temps de les cacher !
              // On supprime uniquement les pièges "rouge" (pour ne pas effacer les lasers)
              for (const id in traps) {
                if (traps[id].type === "rouge") {
                  delete traps[id];
                }
              }
              redTrapsActive = false;
              nextRedTrapChange = Date.now() + RED_TRAP_HIDDEN_DURATION;
              console.log("Les zones rouges disparaissent !");
            } else {
              // 2. Il est temps de les faire réapparaître à un NOUVEL endroit !
              spawnTraps();
              redTrapsActive = true;
              nextRedTrapChange = Date.now() + RED_TRAP_ACTIVE_DURATION;
              console.log("Nouvelles zones rouges !");
            }
          }
          // =======================================================
          // =======================================================
          for (const player of Object.values(players)) {
            if (player.appleReturn && Date.now() >= player.appleReturn) {
              delete player.appleReturn;
              const pos = getRandomPositionInZone(player.team);
              player.x = pos.x;
              player.y = pos.y;
            }
          }
          for (const player of Object.values(players)) {
            checkTrap(player);
          }
          broadcastState();
        }
      }, 1000);
    }
  }, 1000);
}

function endGame() {
  clearInterval(gameInterval);
  gameInterval = null;

  gamePhase = "ended";
  restartTime = Date.now() + RESTART_DELAY;

  const winner = deaths.pirate < deaths.monstre ? "pirate" : deaths.monstre < deaths.pirate ? "monstre" : "egalite";

  console.log(`--- Partie terminee ! Gagnant: ${winner} ---`);

  broadcast("gameOver", { scores, deaths, winner, restartIn: RESTART_DELAY });

  restartTimeout = setTimeout(() => { startGame(); }, RESTART_DELAY);
}

function send(ws, type, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, data }));
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(msg);
  });
}

function broadcastState() {
  needsBroadcast = true;
}

wss.on("connection", (ws) => {
  const id = String(nextId++);
  ws._playerId = id;
  console.log(`Connexion: ${id}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, data } = msg;

    if (type === "join") {
      // Étape 1 : Attribuer une team et proposer les skins
      const countPirate = Object.values(players).filter(p => p.team === "pirate").length
        + Object.values(pendingPlayers).filter(p => p.team === "pirate").length;
      const countMonstre = Object.values(players).filter(p => p.team === "monstre").length
        + Object.values(pendingPlayers).filter(p => p.team === "monstre").length;
      const assignedTeam = countPirate <= countMonstre ? "pirate" : "monstre";

      // Stocker le joueur en attente de sélection de skin
      pendingPlayers[id] = {
        id,
        pseudo: data.pseudo || "Anonyme",
        team: assignedTeam
      };

      // Envoyer la team et les skins disponibles
      const allSkins = SKINS[assignedTeam];
      const taken = Array.from(takenSkins[assignedTeam]);
      send(ws, "teamAssigned", {
        id,
        team: assignedTeam,
        pseudo: data.pseudo || "Anonyme",
        skins: allSkins,
        takenSkins: taken
      });
      console.log(`${data.pseudo || "Anonyme"} → Team ${assignedTeam} (choix du skin en cours)`);
    }

    if (type === "selectSkin") {
      // Étape 2 : Le joueur a choisi son skin
      const pending = pendingPlayers[id];
      if (!pending) return;

      const chosenSkin = data.skinId;
      const team = pending.team;

      // Vérifier que le skin est valide et pas déjà pris
      if (!SKINS[team].includes(chosenSkin) || takenSkins[team].has(chosenSkin)) {
        // Le skin n'est plus dispo, renvoyer la liste mise à jour
        send(ws, "skinTaken", {
          takenSkins: Array.from(takenSkins[team])
        });
        return;
      }

      // Marquer le skin comme pris
      takenSkins[team].add(chosenSkin);

      const pos = getRandomPositionInZone(team);
      players[id] = {
        id,
        pseudo: pending.pseudo,
        team: team,
        skinId: chosenSkin,
        x: pos.x,
        y: pos.y,
        hitCount: 0,
        invincibleUntil: 0
      };

      delete pendingPlayers[id];

      console.log(`${players[id].pseudo} (${players[id].team}) a choisi ${chosenSkin} et rejoint la partie`);
      send(ws, "joined", players[id]);

      // Notifier les autres joueurs en sélection que ce skin est pris
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN && client._playerId !== id && pendingPlayers[client._playerId]) {
          const pendingTeam = pendingPlayers[client._playerId].team;
          if (pendingTeam === team) {
            send(client, "skinTaken", { takenSkins: Array.from(takenSkins[team]) });
          }
        }
      });

      if (gamePhase === "waiting" && Object.keys(players).length >= 2) {
        startGame();
      } else {
        broadcastState();
      }
    }

    if (type === "restart") {
      if (restartTimeout) clearTimeout(restartTimeout);
      if (gameInterval) clearInterval(gameInterval);
      if (countdownInterval) clearInterval(countdownInterval);
      gameInterval = null;
      countdownInterval = null;
      startGame();
    }

    if (type === "forceEnd") {
      if (gamePhase === "playing" || gamePhase === "countdown") {
        endGame();
      }
    }

    if (type === "move" && gamePhase === "playing") {
      const player = players[id];
      if (!player) return;
      if (player.inactiveUntil && Date.now() < player.inactiveUntil) return;
      // Throttle : max 25 inputs/s par joueur
      const now = Date.now();
      if (player.lastMoveAt && now - player.lastMoveAt < 40) return;
      player.lastMoveAt = now;

      const inAppleZone = player.appleReturn && Date.now() < player.appleReturn;
      const oldX = player.x;
      const oldY = player.y;
      let newX = oldX;
      let newY = oldY;

      if (data && typeof data.x === 'number' && typeof data.y === 'number') {
        newX += data.x * SPEED;
        newY += data.y * SPEED;
        player.lastDirX = data.x;
        player.lastDirY = data.y;
      } else if (typeof data === 'string') {
        switch (data) {
          case "up": newY -= SPEED; player.lastDirX = 0; player.lastDirY = -1; break;
          case "down": newY += SPEED; player.lastDirX = 0; player.lastDirY = 1; break;
          case "left": newX -= SPEED; player.lastDirX = -1; player.lastDirY = 0; break;
          case "right": newX += SPEED; player.lastDirX = 1; player.lastDirY = 0; break;
        }
      }

      if (isPosValid(newX, oldY, player)) {
        player.x = newX;
      }
      if (isPosValid(player.x, newY, player)) {
        player.y = newY;
      }

      checkTrap(player);
      checkPush(player);
      if (!player.inactiveUntil || Date.now() >= player.inactiveUntil) {
        checkPickup(player);
      }
      needsBroadcast = true;
    }

    if (type === "dash" && gamePhase === "playing") {
      const player = players[id];
      if (!player) return;
      if (player.inactiveUntil && Date.now() < player.inactiveUntil) return;

      if (player.dashCooldown && Date.now() < player.dashCooldown) return;

      const dashForce = 150;
      const dirX = player.lastDirX || 0;
      const dirY = player.lastDirY || 0;

      if (dirX === 0 && dirY === 0) return;

      const oldX = player.x;
      const oldY = player.y;

      let newX = oldX + dirX * dashForce;
      let newY = oldY + dirY * dashForce;

      if (isPosValid(newX, oldY, player)) {
        player.x = newX;
      }
      if (isPosValid(player.x, newY, player)) {
        player.y = newY;
      }

      player.dashCooldown = Date.now() + 10000;

      checkTrap(player);
      checkPush(player);
      needsBroadcast = true;
    }
    // ==========================================================
    // 3. BLOC ATTAQUE AU CORPS-À-CORPS (SABRE)
    // ==========================================================
    if (type === "taper" && gamePhase === "playing") {
      const player = players[id];
      if (!player) return;
      if (player.inactiveUntil && Date.now() < player.inactiveUntil) return;

      if (player.taperCooldown && Date.now() < player.taperCooldown) return;
      player.taperCooldown = Date.now() + 1500;

      // LIGNE AJOUTÉE ICI : Indique le temps de l'animation d'attaque (300ms)
      player.attackEndsAt = Date.now() + 500;

      // 1. Calculer où le sabre frappe
      const dirX = player.lastDirX || 1;
      const dirY = player.lastDirY || 0;
      const length = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
      const nx = dirX / length;
      const ny = dirY / length;

      const swordX = player.x + nx * 50;
      const swordY = player.y + ny * 50;
      const SWORD_RADIUS = 50;

      // 2. Vérifier si un adversaire est touché
      const opponentTeam = player.team === "pirate" ? "monstre" : "pirate";

      Object.values(players).forEach(other => {
        if (other.team === opponentTeam && (!other.inactiveUntil || Date.now() >= other.inactiveUntil) && (!other.invincibleUntil || Date.now() >= other.invincibleUntil)) {
          const dx = other.x - swordX;
          const dy = other.y - swordY;
          if (Math.sqrt(dx * dx + dy * dy) < SWORD_RADIUS) {
            other.inactiveUntil = Date.now() + INACTIVE_DURATION;
            other.invincibleUntil = Date.now() + INACTIVE_DURATION + 2000;
            other.respawnProtected = true;
            deaths[other.team]++;
            const respawnPos = getRandomPositionInZone(other.team);
            other.x = respawnPos.x;
            other.y = respawnPos.y;
            console.log(`⚔️ ${player.pseudo} a tranché ${other.pseudo} !`);
          }
        }
      });

      // Met à jour l'écran géant
      needsBroadcast = true;
    }
  }); // Fin de ws.on("message")
  ws.on("close", () => {
    // Libérer le skin si le joueur était en jeu
    if (players[id]) {
      const team = players[id].team;
      const skinId = players[id].skinId;
      takenSkins[team].delete(skinId);
      console.log(`${players[id].pseudo} a quitte la partie (skin ${skinId} libéré)`);
      delete players[id];
      needsBroadcast = true;

      // Notifier les joueurs en sélection
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN && pendingPlayers[client._playerId]) {
          const pendingTeam = pendingPlayers[client._playerId].team;
          if (pendingTeam === team) {
            send(client, "skinTaken", { takenSkins: Array.from(takenSkins[team]) });
          }
        }
      });
    }
    // Nettoyer les joueurs en attente de sélection
    if (pendingPlayers[id]) {
      console.log(`${pendingPlayers[id].pseudo} a quitté avant de choisir un skin`);
      delete pendingPlayers[id];
    }
  });
});

http.listen(PORT, () => {
  const nets = os.networkInterfaces();
  let localIP = "localhost";
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log(`\n===========================================`);
  console.log(`  SERVEUR DEMARRE (Pirates vs Monstres) !`);
  console.log(`===========================================\n`);
  console.log(`  Ecran de jeu : http://${localIP}:${PORT}/game`);
  console.log(`  Controller   : http://${localIP}:${PORT}/controller\n`);
});
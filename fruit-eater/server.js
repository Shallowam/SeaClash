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

app.get("/", (req, res) => {
  res.redirect("/controller");
});

// =============================================================================
// CONFIGURATION DU JEU
// =============================================================================

const ARENA = { width: 1200, height: 800 }; 
const SPEED = 18; 
const GAME_DURATION = 10 * 60 * 1000; 
const RESTART_DELAY = 30 * 1000; 
const MAX_GEMS = 8; 
const PICKUP_DISTANCE = 80; 

const TRAP_COUNT = 3;              
const TRAP_RADIUS = 50;            
const INACTIVE_DURATION = 5 * 1000; 
const RED_TRAP_ACTIVE_DURATION = 15 * 1000; // 15 secondes visibles
const RED_TRAP_HIDDEN_DURATION = 5 * 1000;  // 5 secondes cachées (plus aucune zone)

const ABORDAGE_WINDOWS = [
  { start: 2 * 60 * 1000, end: 2 * 60 * 1000 + 45 * 1000 },
  { start: 5 * 60 * 1000, end: 5 * 60 * 1000 + 45 * 1000 },
  { start: 8 * 60 * 1000, end: 8 * 60 * 1000 + 45 * 1000 },
];
const PUSH_DISTANCE            = 40;          
const APPLE_TELEPORT_DURATION  = 15 * 1000;   
const LINE_TRAP_DURATION       = 3 * 1000;    
const LINE_TRAP_TOLERANCE      = 40;          
const PASSERELLES = [
  { y: 133, height: 120 }, 
  { y: 667, height: 120 }, 
];

// =============================================================================
// ETAT DU JEU
// =============================================================================

let players = {}; 
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
let restartTimeout = null; 
let abordageActive = false;  
let abordageTimeLeft = 0;    
let redTrapsActive = false;
let nextRedTrapChange = 0;

// =============================================================================
// GESTION DES GEMMES (Pouvoirs)
// =============================================================================

const GEM_COLORS = ["bombe", "rouge", "corde"];

function spawnFruit() {
  const id = String(nextFruitId++);
  const color = GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)];
  
  const now = Date.now();
  fruits[id] = {
    id,
    color: color,
    x: Math.floor(Math.random() * (ARENA.width - 80)) + 40,
    y: Math.floor(Math.random() * (ARENA.height - 80)) + 40,
    activeAt: now + 2000,        // Clignote pendant 2 secondes (Alerte)
    expiresAt: now + 12000       // NOUVEAU : Disparaît au bout de 12s (2s alerte + 10s actif)
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
          player.x = player.team === "pirate"
            ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30 // Pirate va à droite
            : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30;                  // Monstre va à gauche
          
          player.appleReturn = Date.now() + APPLE_TELEPORT_DURATION; // On lance le chrono de retour automatique (15s)
          console.log(`🪢 ${player.pseudo} a pris une Corde -> TÉLÉPORTÉ CHEZ L'ENNEMI !`);
        } else {
          // 2. IL EST DÉJÀ CHEZ L'ENNEMI : Billet de retour anticipé !
          player.x = player.team === "pirate"
            ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30                   // Pirate rentre à gauche
            : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30;// Monstre rentre à droite
          
          delete player.appleReturn; // On annule le chrono puisqu'il est rentré tout seul !
          console.log(`🪢 ${player.pseudo} a pris une Corde -> RETOUR À LA BASE !`);
        }
        
        // On lui donne une position Y aléatoire dans tous les cas
        player.y = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
      }
      else if (color === "rouge") {
        const lineId = "line_" + Date.now();
        traps[lineId] = {
          id: lineId,
          type: "line",
          y: fruitY,
          targetTeam: opponentTeam,
          tolerance: LINE_TRAP_TOLERANCE,
          inactiveDuration: 5 * 1000,
          deactivateAt: Date.now() + LINE_TRAP_DURATION,
        };
        scores[player.team]++;
        console.log(`${player.pseudo} a pris un Laser !`);
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
              const EXPLOSION_RADIUS = 200;
              Object.values(players).forEach(p => {
                const dx = p.x - targetX; 
                const dy = p.y - targetY;
                if (Math.sqrt(dx * dx + dy * dy) < EXPLOSION_RADIUS) {
                  p.inactiveUntil = Date.now() + 5000;
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
  const xBase = side === "pirate" ? 0 : ARENA.width / 2;
  for (let i = 0; i < TRAP_COUNT; i++) {
    const id = "s" + side + i; // ID unique (ex: spirate1, smonstre1)
    
    // On définit le moment d'apparition
    const now = Date.now();
    
    traps[id] = {
      id,
      type: "sable", // On change le type pour "sable"
      sprite: side,  // Définit si c'est 'pirate' ou 'monstre'
      x: Math.floor(Math.random() * (ARENA.width / 2 - 100)) + xBase + 50,
      y: Math.floor(Math.random() * (ARENA.height - 100)) + 50,
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
  for (const trap of Object.values(traps)) {
    if (trap.activeAt && Date.now() < trap.activeAt) continue;
    if (trap.activeAt && Date.now() < trap.activeAt) continue; 
    if (trap.deactivateAt && Date.now() >= trap.deactivateAt) continue; 

    let hit = false;
    if (trap.type === "line") {
      hit = player.team === trap.targetTeam && Math.abs(player.y - trap.y) < trap.tolerance;
    } else {
      const dx = player.x - trap.x;
      const dy = player.y - trap.y;
      // Collision elliptique pour correspondre à l'affichage "écrasé"
      hit = Math.sqrt(dx * dx + (dy * 2) * (dy * 2)) < trap.radius;
    }

    if (hit) {
      player.inactiveUntil = Date.now() + trap.inactiveDuration;
      player.respawnProtected = true;
      deaths[player.team]++;
      let safeX, safeY, onTrap;
      do {
        safeX = player.team === "pirate"
          ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30
          : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30;
        safeY = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
        onTrap = Object.values(traps).some(t => {
          if (t.type === "line") return Math.abs(safeY - t.y) < t.tolerance;
          return Math.sqrt((safeX - t.x) ** 2 + ((safeY - t.y) * 2) ** 2) < t.radius;
        });
      } while (onTrap);
      player.x = safeX;
      player.y = safeY;
      console.log(`${player.pseudo} est inactif !`);
      break;
    }
  }
}

function checkPush(player) {
  if (!abordageActive) return;
  const inOpponentZone = (player.team === "pirate" && player.x > ARENA.width / 2) ||
                         (player.team === "monstre"  && player.x < ARENA.width / 2);
  if (!inOpponentZone) return;
  for (const other of Object.values(players)) {
    if (other.id === player.id || other.team === player.team) continue;
    if (other.inactiveUntil && Date.now() < other.inactiveUntil) continue;
    const dx = player.x - other.x;
    const dy = player.y - other.y;
    if (Math.sqrt(dx * dx + dy * dy) < PUSH_DISTANCE) {
      other.inactiveUntil = Date.now() + INACTIVE_DURATION;
      deaths[other.team]++;
      let sx, sy, safe;
      do {
        sx = other.team === "pirate"
          ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30
          : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30;
        sy = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
        safe = !Object.values(traps).some(t => Math.sqrt((sx - t.x) ** 2 + ((sy - t.y) * 2) ** 2) < t.radius);
      } while (!safe);
      other.x = sx;
      other.y = sy;
      console.log(`${player.pseudo} a pousse ${other.pseudo} !`);
      break;
    }
  }
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
  // Initialisation du cycle des zones rouges
  spawnTraps(); 
  redTrapsActive = true;
  nextRedTrapChange = Date.now() + RED_TRAP_ACTIVE_DURATION;

  gamePhase = "playing";
  gameEndTime = Date.now() + GAME_DURATION; 

  for (const player of Object.values(players)) {
    player.x = player.team === "pirate"
      ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30
      : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30;
    player.y = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
    delete player.inactiveUntil;
  }

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
          const xMin = player.team === "pirate" ? 0 : ARENA.width / 2;
          const xMax = player.team === "pirate" ? ARENA.width / 2 : ARENA.width;
          player.x = Math.min(xMax, Math.max(xMin, player.x));
        }
        fillFruits();
      }
      
      for (const [id, trap] of Object.entries(traps)) {
        if (trap.type === "line" && Date.now() >= trap.deactivateAt) delete traps[id];
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
          player.x = player.team === "pirate"
            ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30
            : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30;
          player.y = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
        }
      }
      for (const player of Object.values(players)) {
        checkTrap(player);
      }
      broadcastState();
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
  broadcast("state", {
    players, fruits, traps, scores, launchedBombs, deaths, abordageActive, abordageTimeLeft,
    arena: ARENA, phase: gamePhase,
    timeLeft: gamePhase === "playing" ? Math.max(0, gameEndTime - Date.now()) : 0,
  });
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
      const countPirate = Object.values(players).filter(p => p.team === "pirate").length;
      const countMonstre  = Object.values(players).filter(p => p.team === "monstre").length;
      const assignedTeam = countPirate <= countMonstre ? "pirate" : "monstre";

      players[id] = {
        id, pseudo: data.pseudo || "Anonyme", team: assignedTeam,
        x: assignedTeam === "pirate"
          ? Math.floor(Math.random() * (ARENA.width / 2 - 60)) + 30
          : Math.floor(Math.random() * (ARENA.width / 2 - 60)) + ARENA.width / 2 + 30,
        y: Math.floor(Math.random() * (ARENA.height - 100)) + 50,
      };

      console.log(`${players[id].pseudo} (${players[id].team}) a rejoint la partie`);
      send(ws, "joined", players[id]);

      if (gamePhase === "waiting" && Object.keys(players).length >= 1) {
        startGame();
      } else {
        broadcastState();
      }
    }

    if (type === "restart") {
      if (restartTimeout) clearTimeout(restartTimeout);
      if (gameInterval) clearInterval(gameInterval);
      gameInterval = null;
      startGame();
    }

    if (type === "move" && gamePhase === "playing") {
      const player = players[id];
      if (!player) return; 
      if (player.inactiveUntil && Date.now() < player.inactiveUntil) return; 

      const inAppleZone = player.appleReturn && Date.now() < player.appleReturn;
      const xMin = inAppleZone
        ? (player.team === "pirate" ? ARENA.width / 2 : 0)
        : (player.team === "pirate" ? 0 : ARENA.width / 2);
      const xMax = inAppleZone
        ? (player.team === "pirate" ? ARENA.width : ARENA.width / 2)
        : (player.team === "pirate" ? ARENA.width / 2 : ARENA.width);
      const oldX = player.x;

      if (data && typeof data.x === 'number' && typeof data.y === 'number') {
        player.x += data.x * SPEED;
        player.y += data.y * SPEED;
        player.lastDirX = data.x;
        player.lastDirY = data.y;
      } else if (typeof data === 'string') {
        switch (data) {
          case "up":    player.y -= SPEED; player.lastDirX = 0; player.lastDirY = -1; break;
          case "down":  player.y += SPEED; player.lastDirX = 0; player.lastDirY = 1; break;
          case "left":  player.x -= SPEED; player.lastDirX = -1; player.lastDirY = 0; break;
          case "right": player.x += SPEED; player.lastDirX = 1; player.lastDirY = 0; break;
        }
      }

      if (!abordageActive || inAppleZone) {
        player.x = Math.min(xMax, Math.max(xMin, player.x));
      } else {
        const crossedMediane = (oldX < ARENA.width / 2) !== (player.x < ARENA.width / 2);
        if (crossedMediane && !isInPasserelle(player.y)) {
          player.x = oldX; 
        }
        player.x = Math.min(ARENA.width, Math.max(0, player.x));
      }
      player.y = Math.min(ARENA.height - 30, Math.max(30, player.y)); 

      checkTrap(player);
      checkPush(player);
      if (!player.inactiveUntil || Date.now() >= player.inactiveUntil) {
        checkPickup(player);
      }
      broadcastState();
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
      player.x += dirX * dashForce;
      player.y += dirY * dashForce;

      const inAppleZone = player.appleReturn && Date.now() < player.appleReturn;
      const xMin = inAppleZone ? (player.team === "pirate" ? ARENA.width / 2 : 0) : (player.team === "pirate" ? 0 : ARENA.width / 2);
      const xMax = inAppleZone ? (player.team === "pirate" ? ARENA.width : ARENA.width / 2) : (player.team === "pirate" ? ARENA.width / 2 : ARENA.width);
      
      if (!abordageActive || inAppleZone) {
        player.x = Math.min(xMax, Math.max(xMin, player.x));
      } else {
        const crossedMediane = (oldX < ARENA.width / 2) !== (player.x < ARENA.width / 2);
        if (crossedMediane && !isInPasserelle(player.y)) player.x = oldX; 
        player.x = Math.min(ARENA.width, Math.max(0, player.x));
      }
      player.y = Math.min(ARENA.height - 30, Math.max(30, player.y));
      
      player.dashCooldown = Date.now() + 10000;
      
      checkTrap(player);
      checkPush(player);
      broadcastState();
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
        if (other.team === opponentTeam && (!other.inactiveUntil || Date.now() >= other.inactiveUntil)) {
          const dx = other.x - swordX;
          const dy = other.y - swordY;
          if (Math.sqrt(dx * dx + dy * dy) < SWORD_RADIUS) {
             other.inactiveUntil = Date.now() + 4000; 
             deaths[other.team]++;
             other.x = other.team === "pirate" ? 100 : ARENA.width - 100;
             other.y = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
             console.log(`⚔️ ${player.pseudo} a tranché ${other.pseudo} !`);
          }
        }
      });

      // LIGNE AJOUTÉE ICI : Met à jour l'écran géant
      broadcastState();
    }
  }); // Fin de ws.on("message")
  ws.on("close", () => {
    if (players[id]) {
      console.log(`${players[id].pseudo} a quitte la partie`);
      delete players[id]; 
      broadcastState(); 
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
// ITMS Simulation Engine
// Implements a 4-way intersection simulation with client-side fuzzy logic

class Vehicle {
    constructor(lane, isEmergency = false) {
        this.lane = lane; // 'N', 'E', 'S', 'W'
        this.isEmergency = isEmergency;
        this.id = Math.random().toString(36).substr(2, 9);
        
        // Vehicle Types
        if (this.isEmergency) {
            this.type = 'ambulance';
            this.width = 22;
            this.length = 45;
            this.maxSpeed = 6;
            this.color = '#ff003c';
        } else {
            let rnd = Math.random();
            if (rnd < 0.1) {
                this.type = 'bike';
                this.width = 10;
                this.length = 20;
                this.maxSpeed = 4.5;
                this.color = '#00f0ff';
            } else if (rnd < 0.25) {
                this.type = 'bus';
                this.width = 24;
                this.length = 65;
                this.maxSpeed = 2.5;
                this.color = '#facc15';
            } else if (rnd < 0.4) {
                this.type = 'truck';
                this.width = 24;
                this.length = 55;
                this.maxSpeed = 2.8;
                this.color = '#fb923c';
            } else {
                this.type = 'car';
                this.width = 18;
                this.length = 35;
                this.maxSpeed = 3 + Math.random() * 1.5;
                this.color = Math.random() > 0.5 ? '#a855f7' : '#3b82f6';
            }
        }
        
        this.speed = 0;
        this.acceleration = this.type === 'bus' || this.type === 'truck' ? 0.05 : 0.15;
        this.braking = 0.3;
        this.waitingTime = 0;
        this.state = 'cruising'; // cruising, braking, waiting, intersecting, exiting
        
        // India LHT (Left Hand Traffic) specific geometry positions
        this.subLane = Math.random() > 0.5 ? 0 : 1; 
        
        if (lane === 'N') { // North coming south (LEFT side of road = East side mathematically = x>400)
            this.x = 420 + (this.subLane * 40) - this.width / 2;
            this.y = -60 - (Math.random() * 50);
            this.vx = 0;
            this.vy = 1;
        } else if (lane === 'S') { // South coming north (LEFT side = West side = x<400)
            this.x = 340 + (this.subLane * 40) - this.width / 2;
            this.y = 660 + (Math.random() * 50);
            this.vx = 0;
            this.vy = -1;
        } else if (lane === 'E') { // East coming west (LEFT side = South side = y>300)
            this.x = 860 + (Math.random() * 50);
            this.y = 320 + (this.subLane * 40) - this.width / 2;
            this.vx = -1;
            this.vy = 0;
        } else if (lane === 'W') { // West coming east (LEFT side = North side = y<300)
            this.x = -60 - (Math.random() * 50);
            this.y = 240 + (this.subLane * 40) - this.width / 2;
            this.vx = 1;
            this.vy = 0;
        }
    }

    update(dt, signals, vehicles) {
        // Find vehicle ahead precisely to prevent overlapping
        let distAhead = Infinity;
        for (let v of vehicles) {
            if (v.lane === this.lane && v.id !== this.id && v.subLane === this.subLane) {
                // Strict Bounding Box Distance
                if (this.lane === 'N' && v.y > this.y) distAhead = Math.min(distAhead, v.y - (this.y + this.length));
                if (this.lane === 'S' && v.y < this.y) distAhead = Math.min(distAhead, this.y - (v.y + v.length));
                if (this.lane === 'E' && v.x < this.x) distAhead = Math.min(distAhead, this.x - (v.x + v.length));
                if (this.lane === 'W' && v.x > this.x) distAhead = Math.min(distAhead, v.x - (this.x + this.length));
            }
        }

        // Distance to intersection stop line (Stop lines geometry holds identical for LHT/RHT)
        let distToLine = Infinity;
        if (this.state !== 'intersecting' && this.state !== 'exiting') {
            if (this.lane === 'N' && this.y <= 220) distToLine = 220 - (this.y + this.length);
            if (this.lane === 'S' && this.y >= 380) distToLine = this.y - 380 - this.length;
            if (this.lane === 'E' && this.x >= 480) distToLine = this.x - 480 - this.length;
            if (this.lane === 'W' && this.x <= 320) distToLine = 320 - (this.x + this.length);
        } else {
            distToLine = -1; // Past line
        }

        let signal = signals[this.lane];
        let targetSpeed = this.maxSpeed;

        if (distToLine > 0 && distToLine < 80) { // Approaching line
            if (signal !== 'GREEN' && (!this.isEmergency || signal !== 'GREEN')) {
                // Emergency vehicles must stop at RED too until they force it green
                targetSpeed = 0;
            }
        }

        // Smooth physics + Anti-Overlap
        let safeDist = this.speed * 12 + 15; 
        if (distAhead <= 8) { // Immediate stop trigger
            targetSpeed = 0;
            this.speed = 0;
        } else if (distAhead < safeDist) {
            targetSpeed = 0;
        } else if (distAhead < safeDist * 2) {
            targetSpeed = this.maxSpeed * ((distAhead - safeDist) / safeDist);
        }

        // State update
        if (targetSpeed > this.speed) {
            this.speed += this.acceleration;
            if (this.speed > targetSpeed) this.speed = targetSpeed;
            this.state = 'cruising';
        } else if (targetSpeed < this.speed) {
            this.speed -= this.braking;
            if (this.speed < targetSpeed) this.speed = targetSpeed;
            if (this.speed < 0) this.speed = 0;
            this.state = 'braking';
        }

        if (this.speed === 0) {
            this.state = 'waiting';
            this.waitingTime += dt / 1000;
        }

        // Move
        this.x += this.vx * this.speed;
        this.y += this.vy * this.speed;

        // Check intersection crossing
        if (this.lane === 'N' && this.y > 220) this.state = 'intersecting';
        if (this.lane === 'S' && this.y < 380) this.state = 'intersecting';
        if (this.lane === 'E' && this.x < 480) this.state = 'intersecting';
        if (this.lane === 'W' && this.x > 320) this.state = 'intersecting';

        if (this.lane === 'N' && this.y > 380) this.state = 'exiting';
        if (this.lane === 'S' && this.y < 220) this.state = 'exiting';
        if (this.lane === 'E' && this.x < 320) this.state = 'exiting';
        if (this.lane === 'W' && this.x > 480) this.state = 'exiting';
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + (this.vx === 0 ? this.width/2 : this.length/2), 
                      this.y + (this.vy === 0 ? this.width/2 : this.length/2));
        
        let angle = 0;
        if (this.lane === 'N') angle = Math.PI/2;
        if (this.lane === 'S') angle = -Math.PI/2;
        if (this.lane === 'E') angle = Math.PI;
        
        ctx.rotate(angle);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.shadowBlur = this.speed > 0 || this.isEmergency ? 12 : 0;
        ctx.shadowColor = this.color;
        
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.roundRect(-this.length/2, -this.width/2, this.length, this.width, 3);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0; 

        // Visual detailing based on Type
        if (this.type === 'ambulance') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-this.length/4, -this.width/2 + 2, this.length/2, this.width - 4);
            if (Date.now() % 300 < 150) {
                ctx.fillStyle = '#00f0ff';
                ctx.shadowColor = '#00f0ff';
            } else {
                ctx.fillStyle = '#ff003c';
                ctx.shadowColor = '#ff003c';
            }
            ctx.shadowBlur = 10;
            ctx.fillRect(0, -this.width/2 - 2, 4, this.width + 4);
        } else if (this.type === 'bus') {
            ctx.fillStyle = '#111';
            ctx.fillRect(-this.length/2 + 5, -this.width/2 + 2, this.length - 10, this.width - 4);
            ctx.fillStyle = '#050505';
            ctx.fillRect(-this.length/4, -this.width/2, 4, this.width);
            ctx.fillRect(this.length/4, -this.width/2, 4, this.width);
        } else if (this.type === 'bike') {
            ctx.fillStyle = '#ccc'; 
            ctx.beginPath();
            ctx.arc(-2, 0, 4, 0, Math.PI*2);
            ctx.fill();
        } else if (this.type === 'truck') {
            ctx.fillStyle = '#111';
            ctx.fillRect(this.length/2 - 12, -this.width/2 + 1, 10, this.width - 2);
            ctx.strokeStyle = '#222';
            ctx.strokeRect(-this.length/2 + 1, -this.width/2 + 1, this.length - 14, this.width - 2);
        } else { 
            ctx.fillStyle = '#050505';
            ctx.fillRect(this.length/4 - 2, -this.width/2 + 2, 6, this.width - 4);
            ctx.fillRect(-this.length/4 - 4, -this.width/2 + 3, 5, this.width - 6);
        }

        // Head/Tail lights
        if (this.speed > 0 || this.isEmergency) {
            ctx.fillStyle = '#ffffe0';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffffe0';
            ctx.beginPath();
            ctx.arc(this.length/2, -this.width/2 + 3, 2, 0, Math.PI*2);
            ctx.arc(this.length/2, this.width/2 - 3, 2, 0, Math.PI*2);
            ctx.fill();
            ctx.shadowBlur = 0;
            
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(-this.length/2, -this.width/2 + 3, 2, 0, Math.PI*2);
            ctx.arc(-this.length/2, this.width/2 - 3, 2, 0, Math.PI*2);
            ctx.fill();
        }

        ctx.restore();
    }
}

class SimulationEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.vehicles = [];
        this.lastTime = performance.now();
        
        // Setup RR sequence
        this.lanes = ['N', 'E', 'S', 'W'];
        this.signals = { N: 'GREEN', E: 'RED', S: 'RED', W: 'RED' };
        this.activePhaseIdx = 0;
        this.phaseTimer = 5; 
        this.phaseState = 'GREEN'; 
        
        // Emergency tracking
        this.emergencyMode = false;
        this.emergencyLane = null;
        this.savedPhaseTimer = 0;
        
        this.telemetry = {
            N: { count: 0, wait: 0 },
            E: { count: 0, wait: 0 },
            S: { count: 0, wait: 0 },
            W: { count: 0, wait: 0 }
        };
        
        this.updateUI();
        this.loop();
    }

    spawnVehicle(lane, isEmergency = false) {
        this.vehicles.push(new Vehicle(lane, isEmergency));
        if (isEmergency) {
            this.handleEmergency(lane);
        }
    }

    handleEmergency(lane) {
        this.emergencyMode = true;
        this.emergencyLane = lane;
        this.savedPhaseTimer = this.phaseTimer; // PAUSE exactly as user requested 
        
        if (this.lanes[this.activePhaseIdx] !== lane) {
            this.phaseState = 'YELLOW';
            this.signals[this.lanes[this.activePhaseIdx]] = 'YELLOW';
            this.phaseTimer = 1.0; 
        } else {
            this.phaseState = 'GREEN';
            this.signals[lane] = 'GREEN';
            this.phaseTimer = 999; // Indefinite suspension until vehicle clears
        }
        
        document.getElementById('emergency-overlay').classList.remove('hidden');
    }

    clearEmergency() {
        this.emergencyMode = false;
        this.emergencyLane = null;
        document.getElementById('emergency-overlay').classList.add('hidden');
        
        // RESUME exact timer precisely as user requested
        this.phaseTimer = Math.max(3, this.savedPhaseTimer); 
        document.getElementById('fuzzy-reasoning').innerText = "Emergency cleared. Resumed previous signal timing constraints.";
    }

    fuzzyLogicDecision() {
        if (this.emergencyMode && this.emergencyLane) {
            let eLaneIdx = this.lanes.indexOf(this.emergencyLane);
            this.activePhaseIdx = eLaneIdx;
            this.phaseTimer = 999; // Keep green halted for emergency
            return `EMERGENCY STOP FOR 1 MINUTE: Prioritizing ${this.emergencyLane} until clear.`;
        }

        let bestScore = -1;
        let nextIdx = (this.activePhaseIdx + 1) % 4; // default RR sequence
        let duration = 5; 
        let reasoning = "";

        let scores = [];
        for (let i = 0; i < 4; i++) {
            if (i === this.activePhaseIdx) {
                scores.push(-1);
                continue;
            }
            let l = this.lanes[i];
            let count = this.telemetry[l].count;
            let wait = this.telemetry[l].wait;
            
            let densityScore = Math.min(count / 8, 1.0); 
            let waitScore = Math.min(wait / 30, 1.0); 
            
            let totalScore = (densityScore * 0.7) + (waitScore * 0.3);
            scores.push(totalScore);

            if (totalScore > bestScore) {
                bestScore = totalScore;
                nextIdx = i;
            }
        }

        let targetLane = this.lanes[nextIdx];
        let tCount = this.telemetry[targetLane].count;
        let tWait = this.telemetry[targetLane].wait;
        
        if (tCount === 0) {
            duration = 4; // Min time
            reasoning = `${targetLane} Selected (Round Robin). Empty lane, allocating min 4s pulse.`;
        } else if (tCount < 4) {
            duration = 5 + tCount * 1.5; 
            reasoning = `${targetLane} Selected. Mod density (${tCount} veh). Allocating ${duration.toFixed(1)}s.`;
        } else {
            duration = 8 + tCount * 0.8;
            if (tWait > 15) duration += 3;
            reasoning = `${targetLane} Selected. High congestion (${tCount} veh). Max Wait penalty added. Green: ${duration.toFixed(1)}s.`;
        }

        if (duration > 15) duration = 15; 
        
        this.activePhaseIdx = nextIdx;
        this.phaseTimer = duration;
        
        return reasoning;
    }

    updateLogic(dt) {
        this.phaseTimer -= dt / 1000;
        
        // Force phase changes only if NOT halted infinitely due to emergency
        // We use Math.floor to ensure 999 stays large indefinitely if logic resets
        if (this.phaseTimer <= 0 && (!this.emergencyMode || this.phaseState !== 'GREEN')) {
            if (this.phaseState === 'GREEN') {
                this.phaseState = 'YELLOW';
                this.signals[this.lanes[this.activePhaseIdx]] = 'YELLOW';
                this.phaseTimer = 2; // 2 sec yellow
            } else if (this.phaseState === 'YELLOW') {
                let prevLane = this.lanes[this.activePhaseIdx];
                this.signals[prevLane] = 'RED';
                
                let reasoningText = this.fuzzyLogicDecision();
                document.getElementById('fuzzy-reasoning').innerText = reasoningText;
                
                this.phaseState = 'GREEN';
                this.signals[this.lanes[this.activePhaseIdx]] = 'GREEN';
            }
        }

        // Emergency Resolution Poller
        if (this.emergencyMode) {
            let emergencyVehicles = this.vehicles.filter(v => v.isEmergency && v.state !== 'exiting');
            if (emergencyVehicles.length === 0 && this.signals[this.emergencyLane] === 'GREEN') {
                this.clearEmergency();
            }
        }

        this.lanes.forEach(l => {
            this.telemetry[l].count = 0;
            this.telemetry[l].wait = 0;
        });

        this.vehicles = this.vehicles.filter(v => {
            if (v.x < -100 || v.x > 900 || v.y < -100 || v.y > 700) return false;
            
            if (v.state === 'waiting' || v.state === 'braking' || (v.state === 'cruising' && v.speed > 0)) {
                let isAppr = false;
                if (v.lane === 'N' && v.y < 220) isAppr = true;
                if (v.lane === 'S' && v.y > 380) isAppr = true;
                if (v.lane === 'E' && v.x > 480) isAppr = true;
                if (v.lane === 'W' && v.x < 320) isAppr = true;
                
                if (isAppr) {
                    this.telemetry[v.lane].count++;
                    if (v.waitingTime > this.telemetry[v.lane].wait) {
                        this.telemetry[v.lane].wait = v.waitingTime;
                    }
                }
            }
            return true;
        });

        this.updateUI();
    }

    updateUI() {
        this.lanes.forEach((l) => {
            let id = l.toLowerCase();
            let sigEl = document.getElementById(`stat-${id}-sig`);
            let countEl = document.getElementById(`stat-${id}-count`);
            let waitEl = document.getElementById(`stat-${id}-wait`);
            let barEl = document.getElementById(`bar-${id}`);
            let bgEl = document.getElementById(`active-bg-${id}`);
            
            let sig = this.signals[l];
            sigEl.innerText = sig;
            if (sig === 'GREEN') {
                sigEl.className = 'font-bold text-emerald-400 drop-shadow-[0_0_8px_#34d399]';
                if (bgEl) bgEl.classList.remove('hidden');
            } else if (sig === 'YELLOW') {
                sigEl.className = 'font-bold text-yellow-400 drop-shadow-[0_0_8px_#facc15]';
                if (bgEl) bgEl.classList.remove('hidden');
            } else {
                sigEl.className = 'font-bold text-alert-red';
                if (bgEl) bgEl.classList.add('hidden');
            }
            
            countEl.innerText = this.telemetry[l].count;
            waitEl.innerText = `${this.telemetry[l].wait.toFixed(0)}s`;
            
            let pct = Math.min((this.telemetry[l].count / 15) * 100, 100);
            barEl.style.width = `${pct}%`;
            if (pct > 75) barEl.className = 'h-full bg-alert-red transition-all duration-300 shadow-[0_0_10px_#ff003c]';
            else if (pct > 40) barEl.className = 'h-full bg-yellow-400 transition-all duration-300';
            else barEl.className = 'h-full bg-neon-cyan transition-all duration-300';
        });

        document.getElementById('sys-phase').innerText = `${this.activePhaseIdx + 1}_${this.lanes[this.activePhaseIdx]}_${this.phaseState}`;
        document.getElementById('sys-timer').innerText = this.emergencyMode ? 'PAUSED' : `${Math.max(0, this.phaseTimer).toFixed(1)}s`;
        if (this.emergencyMode) {
            document.getElementById('sys-phase').classList.replace('text-yellow-400', 'text-alert-red');
            document.getElementById('sys-phase').classList.add('animate-pulse');
            document.getElementById('sys-timer').classList.replace('text-emerald-400', 'text-alert-red');
        } else {
            document.getElementById('sys-phase').classList.replace('text-alert-red', 'text-yellow-400');
            document.getElementById('sys-phase').classList.remove('animate-pulse');
            document.getElementById('sys-timer').classList.replace('text-alert-red', 'text-emerald-400');
        }
    }

    drawEnvironment() {
        let ctx = this.ctx;
        ctx.clearRect(0, 0, 800, 600);

        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, 800, 600);

        // Asphalt Textures
        ctx.fillStyle = '#141414';
        ctx.fillRect(320, 0, 160, 600);
        ctx.fillRect(0, 220, 800, 160);
        
        // Intersection Center
        ctx.fillStyle = '#1c1c1c';
        ctx.fillRect(320, 220, 160, 160);

        // Edges (Curbs)
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#444';
        ctx.setLineDash([]);
        ctx.beginPath();
        // Corners
        ctx.moveTo(320, 0); ctx.lineTo(320, 220); ctx.lineTo(0, 220);
        ctx.moveTo(480, 0); ctx.lineTo(480, 220); ctx.lineTo(800, 220);
        ctx.moveTo(0, 380); ctx.lineTo(320, 380); ctx.lineTo(320, 600);
        ctx.moveTo(800, 380); ctx.lineTo(480, 380); ctx.lineTo(480, 600);
        ctx.stroke();

        // Crosswalks (Zebra crossings) LHT Positioning
        const drawCW = (x, y, w, h, vertical) => {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            if (vertical) {
                for (let yy = y + 5; yy < y + h; yy += 15) ctx.fillRect(x, yy, w, 10);
            } else {
                for (let xx = x + 5; xx < x + w; xx += 15) ctx.fillRect(xx, y, 10, h);
            }
        };
        drawCW(400, 205, 80, 15, false); // N 
        drawCW(320, 380, 80, 15, false); // S 
        drawCW(480, 300, 15, 80, true);  // E 
        drawCW(305, 220, 15, 80, true);  // W 

        // Center double yellow lines (Dividers)
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(398, 0); ctx.lineTo(398, 205); ctx.moveTo(402, 0); ctx.lineTo(402, 205); // N div
        ctx.moveTo(398, 395); ctx.lineTo(398, 600); ctx.moveTo(402, 395); ctx.lineTo(402, 600); // S div
        ctx.moveTo(0, 298); ctx.lineTo(305, 298); ctx.moveTo(0, 302); ctx.lineTo(305, 302); // W div
        ctx.moveTo(495, 298); ctx.lineTo(800, 298); ctx.moveTo(495, 302); ctx.lineTo(800, 302); // E div
        ctx.stroke();

        // LHT Lane dividers (white dashed inside the directional paths)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash([15, 15]);
        ctx.beginPath();
        ctx.moveTo(440, 0); ctx.lineTo(440, 205); // N App
        ctx.moveTo(360, 0); ctx.lineTo(360, 205); // N Ex
        ctx.moveTo(360, 395); ctx.lineTo(360, 600); // S App
        ctx.moveTo(440, 395); ctx.lineTo(440, 600); // S Ex
        
        ctx.moveTo(495, 340); ctx.lineTo(800, 340); // E App
        ctx.moveTo(495, 260); ctx.lineTo(800, 260); // E Ex
        ctx.moveTo(0, 260); ctx.lineTo(305, 260); // W App
        ctx.moveTo(0, 340); ctx.lineTo(305, 340); // W Ex
        ctx.stroke();

        // Stop Lines (Thick white prior to zebra crossing in LHT)
        ctx.setLineDash([]);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(400, 205); ctx.lineTo(480, 205); // N app stop
        ctx.moveTo(320, 395); ctx.lineTo(400, 395); // S app stop
        ctx.moveTo(495, 300); ctx.lineTo(495, 380); // E app stop
        ctx.moveTo(305, 220); ctx.lineTo(305, 300); // W app stop
        ctx.stroke();

        // Dynamic Position for LHT Signal Boxes - Symmetrically anchored to intersection corners (15px padding)
        this.drawLight(ctx, 507, 173, this.signals['N'], 'N'); // Top-Right corner (N approach LHT)
        this.drawLight(ctx, 293, 441, this.signals['S'], 'S'); // Bottom-Left corner (S approach LHT)
        this.drawLight(ctx, 507, 441, this.signals['E'], 'E'); // Bottom-Right corner (E approach LHT)
        this.drawLight(ctx, 293, 173, this.signals['W'], 'W'); // Top-Left corner (W approach LHT)
    }

    drawLight(ctx, x, y, signal, laneName) {
        ctx.save();
        ctx.translate(x, y);

        // Core Housing
        ctx.fillStyle = '#1a1a1a';
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.fillRect(-12, -32, 24, 64);
        ctx.strokeRect(-12, -32, 24, 64);

        // Visual Countdown Timer HUD directly attached to the signal
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(-12, -46, 24, 14);
        ctx.strokeRect(-12, -46, 24, 14);
        
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        if (this.emergencyMode) {
            ctx.fillStyle = '#ff003c';
            ctx.fillText("PAUSE", 0, -38);
        } else {
            if (laneName === this.lanes[this.activePhaseIdx]) {
                // Active phase displays current phase seconds in its specific color
                ctx.fillStyle = signal === 'GREEN' ? '#00f0ff' : (signal === 'YELLOW' ? '#facc15' : '#ff003c');
                ctx.fillText(Math.ceil(this.phaseTimer).toString(), 0, -38);
            } else {
                // RED phase estimate! Calculate approx how many phases away * avg cycle (10s)
                let activeIdx = this.activePhaseIdx;
                let thisIdx = this.lanes.indexOf(laneName);
                let dist = (thisIdx - activeIdx + 4) % 4; // Phase distance mapping
                let estimatedWait = Math.ceil(this.phaseTimer) + ((dist - 1) * 10);
                if (estimatedWait < 0) estimatedWait = 0;
                
                ctx.fillStyle = '#ff003c';
                ctx.fillText(estimatedWait.toString(), 0, -38);
            }
        }

        let rColor = signal === 'RED' ? '#ff003c' : '#330000';
        let yColor = signal === 'YELLOW' ? '#facc15' : '#333300';
        let gColor = signal === 'GREEN' ? '#00f0ff' : '#003333';

        ctx.beginPath(); ctx.arc(0, -20, 6, 0, Math.PI * 2); 
        ctx.fillStyle = rColor; ctx.fill(); 
        if(signal==='RED'){ ctx.shadowBlur = 15; ctx.shadowColor = rColor; ctx.fill(); }

        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); 
        ctx.fillStyle = yColor; ctx.fill();
        if(signal==='YELLOW'){ ctx.shadowBlur = 15; ctx.shadowColor = yColor; ctx.fill(); }

        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(0, 20, 6, 0, Math.PI * 2); 
        ctx.fillStyle = gColor; ctx.fill();
        if(signal==='GREEN'){ ctx.shadowBlur = 15; ctx.shadowColor = gColor; ctx.fill(); }

        ctx.restore();
    }

    loop() {
        let now = performance.now();
        let dt = now - this.lastTime;
        this.lastTime = now;

        this.updateLogic(dt);
        
        for (let v of this.vehicles) {
            v.update(dt, this.signals, this.vehicles);
        }

        this.drawEnvironment();
        
        for (let v of this.vehicles) {
            v.draw(this.ctx);
        }

        requestAnimationFrame(() => this.loop());
    }
}

// Attach UI events
document.addEventListener('DOMContentLoaded', () => {
    const sim = new SimulationEngine('sim-canvas');

    document.getElementById('btn-spawn-north').addEventListener('click', () => sim.spawnVehicle('N'));
    document.getElementById('btn-spawn-east').addEventListener('click', () => sim.spawnVehicle('E'));
    document.getElementById('btn-spawn-south').addEventListener('click', () => sim.spawnVehicle('S'));
    document.getElementById('btn-spawn-west').addEventListener('click', () => sim.spawnVehicle('W'));

    document.getElementById('btn-em-n').addEventListener('click', () => sim.spawnVehicle('N', true));
    document.getElementById('btn-em-e').addEventListener('click', () => sim.spawnVehicle('E', true));
    document.getElementById('btn-em-s').addEventListener('click', () => sim.spawnVehicle('S', true));
    document.getElementById('btn-em-w').addEventListener('click', () => sim.spawnVehicle('W', true));

    const directions = ['N', 'E', 'S', 'W'];
    for(let i=0; i<15; i++) {
        setTimeout(() => sim.spawnVehicle(directions[Math.floor(Math.random()*4)]), i * 150);
    }

    setInterval(() => {
        if(Math.random() > 0.3 && sim.vehicles.length < 50) {
            let l = directions[Math.floor(Math.random() * 4)];
            sim.spawnVehicle(l);
        }
    }, 600);
});

/**
 * TNT Tommy — the head-up display.
 *
 * Plain DOM over the canvas, not geometry in the scene. Drawing it in 3D would
 * be more unified and much worse: the HUD has to stay crisp at any window size,
 * must not be touched by the vignette or the bloom, and the fuse bar in
 * particular has to be legible at a glance while the screen is shaking. All of
 * those are free in CSS and awkward in a shader.
 *
 * Everything here reads the run once per frame. The one exception is floating
 * score text, which is event-driven — it belongs to the moment it happened, not
 * to the current state.
 */
(function (TNT) {
    'use strict';

    const { C, Util } = TNT;
    const EV = TNT.EV;

    function Hud(run, root) {
        this.run = run;
        this.root = root;
        this.el = {
            fuse: root.querySelector('#fuse-fill'),
            fuseWrap: root.querySelector('#fuse'),
            tnt: root.querySelector('#tnt-count'),
            tntTotal: root.querySelector('#tnt-total'),
            held: root.querySelector('#tnt-held'),
            lives: root.querySelector('#lives'),
            score: root.querySelector('#score'),
            mine: root.querySelector('#mine-name'),
            room: root.querySelector('#room-name'),
            toast: root.querySelector('#toast'),
            floats: root.querySelector('#floats'),
            kit: root.querySelector('#kit'),
            medals: root.querySelector('#medal-count'),
            medalTotal: root.querySelector('#medal-total'),
            escape: root.querySelector('#escape'),
            escapeTime: root.querySelector('#escape-time'),
            minimap: root.querySelector('#minimap'),
            cogs: root.querySelector('#cogs'),
            cogCount: root.querySelector('#cog-count'),
            cogTotal: root.querySelector('#cog-total'),
            governor: root.querySelector('#governor'),
            valves: root.querySelector('#governor-valves')
        };
        this._lastCogs = -1;
        this._pips = [];
        this._bossFor = null;
        this._roomShown = 0;
        this._toastT = 0;
        this._lastLives = -1;
        this._lastMedals = -1;
        /** Room index → its cell in the minimap. Rebuilt when a mine starts. */
        this._cells = [];
        this._listen();
    }

    /**
     * Lay out the minimap as the mine's 3x3 grid.
     *
     * The point of it is not navigation — nine rooms is memorable — it is
     * *bookkeeping*: which rooms still owe you a nugget, and which are done.
     * Dynamite Dan had one and it is most of why its rooms felt like places
     * rather than corridors.
     */
    Hud.prototype._buildMap = function (mine) {
        const map = this.el.minimap;
        if (!map) return;
        map.innerHTML = '';
        this._cells = [];

        for (let cy = 0; cy < C.MINE_ROWS; cy++) {
            for (let cx = 0; cx < C.MINE_COLS; cx++) {
                const room = mine.roomAt(cx, cy);
                const cell = document.createElement('i');
                cell.className = 'minimap__cell';
                if (!room) cell.classList.add('is-void');
                map.appendChild(cell);
                if (room) this._cells[room.index] = cell;
            }
        }
    };

    Hud.prototype._listen = function () {
        const bus = this.run.bus;
        const self = this;

        bus.on(EV.ROOM_CHANGED, function (e) {
            self.el.room.textContent = e.room.name;
            self._roomShown = 2.4;
            // The first time into a vault, say what the fight is.
            const set = self.run.ents();
            if (set && set.boss && !set.boss.defeated() && !set._introduced) {
                set._introduced = true;
                self.toast('STOMP THE GOVERNOR\'S VALVES WHILE THEY VENT', 'bad');
            }
        });

        bus.on(EV.MINE_STARTED, function (e) {
            self.el.mine.textContent = e.mine.name;
            self.el.tntTotal.textContent = e.mine.tntTotal;
            self.el.medalTotal.textContent = e.mine.rooms.filter(function (r) {
                return r.oreCount > 0;
            }).length;
            self._buildMap(e.mine);
            self._lastMedals = -1;
        });

        bus.on(EV.ESCAPE_STARTED, function () {
            self.el.escape.classList.add('is-shown');
            self.toast('THE SEAM IS COMING DOWN — GET TO THE PLUNGER', 'bad');
        });

        bus.on(EV.ALL_MEDALS, function () {
            self.toast('EVERY SEAM STRIPPED  +' + C.SCORE_ALL_MEDALS, 'good');
        });

        bus.on(EV.PICKUP, function (e) {
            if (e.value > 0) self.float('+' + e.value, e.x, e.y, 'gold');
        });

        bus.on(EV.ROOM_CLEARED, function (e) {
            self.toast('MEDAL — ' + e.room.name + '  +' + C.SCORE_MEDAL, 'good');
        });

        bus.on(EV.ALL_TNT, function () {
            self.toast('ALL TWELVE — GET TO THE VAULT', 'good');
        });

        bus.on(EV.DETONATOR_DENIED, function (e) {
            if (e.needed > 0) {
                self.toast('NEED ' + e.needed + ' MORE STICK' + (e.needed === 1 ? '' : 'S'), 'bad');
            } else {
                self.toast('THE GOVERNOR STILL RUNS — BREAK ITS VALVES', 'bad');
            }
            self.float('NO', e.x, e.y - 20, 'bad');
        });

        bus.on(EV.SECRET_FOUND, function () {
            self.toast('THE DOG HAS FOUND SOMETHING', 'good');
        });

        bus.on(EV.LEVER_THROWN, function () {
            self.toast('A GATE WINDS OPEN', 'good');
        });

        bus.on(EV.VALVE_OPENED, function (e) {
            self.float('NOW!', e.x, e.y - 26, 'gold');
        });

        bus.on(EV.BOSS_HURT, function (e) {
            self.float('+' + C.SCORE_VALVE, e.x, e.y - 14, 'gold');
            if (e.left > 0) self.toast('VALVE BROKEN — ' + e.left + ' TO GO', 'good');
        });

        bus.on(EV.BOSS_DEFEATED, function () {
            self.toast('THE GOVERNOR IS DOWN — THE PLUNGER IS LIVE', 'good');
        });

        bus.on(EV.PLAYER_HURT, function (e) {
            self.float('-' + Math.round(e.amount), e.x, e.y - 18, 'bad');
            self.root.classList.add('is-hurt');
            window.setTimeout(function () { self.root.classList.remove('is-hurt'); }, 220);
        });

        bus.on(EV.BLAST, function (e) {
            if (e.killed > 0) self.float('+' + (e.killed * C.SCORE_ENEMY), e.x, e.y, 'gold');
        });

        bus.on(EV.ENEMY_STOMPED, function (e) {
            const chain = e.chain > 1 ? '  x' + e.chain : '';
            self.float('+' + e.points + chain, e.x, e.y - 10, 'gold');
        });
    };

    /**
     * A number that rises and fades where the thing happened.
     *
     * Positioned as a percentage of the room rather than in pixels, so it lands
     * in the right place at any window size without the HUD needing to know
     * anything about the camera.
     */
    Hud.prototype.float = function (text, gx, gy, tone) {
        const el = document.createElement('span');
        el.className = 'float float--' + (tone || 'gold');
        el.textContent = text;
        el.style.left = (gx / C.ROOM_W * 100) + '%';
        el.style.top = (gy / C.ROOM_H * 100) + '%';
        this.el.floats.appendChild(el);
        window.setTimeout(function () { el.remove(); }, 1100);
    };

    Hud.prototype.toast = function (text, tone) {
        this.el.toast.textContent = text;
        this.el.toast.className = 'toast is-shown toast--' + (tone || 'good');
        this._toastT = 2.6;
    };

    Hud.prototype.update = function (dt) {
        const run = this.run;

        const pct = Util.clamp(run.energy / C.ENERGY_MAX, 0, 1);
        this.el.fuse.style.width = (pct * 100).toFixed(1) + '%';
        this.el.fuseWrap.classList.toggle('is-danger', run.danger);

        this.el.tnt.textContent = run.tntFound;
        this.el.held.textContent = run.tntHeld;
        this.el.score.textContent = Util.formatScore(run.score);

        if (run.lives !== this._lastLives) {
            this._lastLives = run.lives;
            this.el.lives.innerHTML = '';
            for (let i = 0; i < run.lives; i++) {
                const helm = document.createElement('i');
                helm.className = 'helmet';
                this.el.lives.appendChild(helm);
            }
        }

        this.el.kit.classList.toggle('is-on', run.player.hasOxygen);

        if (run.cogsFound !== this._lastCogs) {
            if (this._lastCogs >= 0 && run.cogsFound > this._lastCogs) {
                const el = this.el.cogs;
                el.classList.remove('is-bumped');
                void el.offsetWidth;                 // restart the animation
                el.classList.add('is-bumped');
            }
            this._lastCogs = run.cogsFound;
            this.el.cogCount.textContent = run.cogsFound;
            this.el.cogTotal.textContent = C.COGS_PER_MINE;
        }

        // The Governor's valves, while you are in its vault.
        const set = run.entities[run.roomIndex];
        const boss = set && set.boss;
        const showBoss = !!boss && run.state !== 'title' && boss.state !== 'dead';
        this.el.governor.classList.toggle('is-shown', showBoss);
        if (boss && boss !== this._bossFor) {
            this._bossFor = boss;
            this.el.valves.innerHTML = '';
            this._pips = boss.valves.map(function () {
                const pip = document.createElement('i');
                return pip;
            });
            for (const pip of this._pips) this.el.valves.appendChild(pip);
        }
        if (boss) {
            for (let i = 0; i < this._pips.length; i++) {
                const v = boss.valves[i];
                this._pips[i].classList.toggle('is-broken', v.state === 'broken');
                this._pips[i].classList.toggle('is-open', v.state === 'open');
            }
        }

        if (run.medals !== this._lastMedals) {
            this._lastMedals = run.medals;
            this.el.medals.textContent = run.medals;
        }

        // The minimap. Where you are, and which rooms still owe you a nugget.
        for (let i = 0; i < this._cells.length; i++) {
            const cell = this._cells[i];
            if (!cell) continue;
            cell.classList.toggle('is-here', i === run.roomIndex);
            const set = run.entities[i];
            cell.classList.toggle('is-medalled', !!(set && set.medal));
            cell.classList.toggle('is-visited', !!(set && set.seen));
        }

        // The run out. A hard countdown replacing the fuse as the thing that
        // will kill you, so it gets the loudest element on the screen.
        if (run.escape > 0) {
            this.el.escape.classList.add('is-shown');
            this.el.escape.classList.toggle('is-critical', run.escape <= C.ESCAPE_WARN);
            this.el.escapeTime.textContent = Util.formatTime(run.escape);
        } else {
            this.el.escape.classList.remove('is-shown', 'is-critical');
        }

        if (this._roomShown > 0) {
            this._roomShown -= dt;
            this.el.room.classList.add('is-shown');
        } else {
            this.el.room.classList.remove('is-shown');
        }

        if (this._toastT > 0) {
            this._toastT -= dt;
            if (this._toastT <= 0) this.el.toast.classList.remove('is-shown');
        }
    };

    TNT.Hud = Hud;
})(window.TNT = window.TNT || {});

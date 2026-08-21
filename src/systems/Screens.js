/**
 * TNT Tommy — title, game over and victory overlays.
 *
 * Driven entirely by `EV.STATE_CHANGED`, so the shell can never disagree with
 * the simulation about what is happening. Nothing here decides anything; it
 * shows the state and forwards a confirm.
 */
(function (TNT) {
    'use strict';

    const { Util } = TNT;
    const EV = TNT.EV;

    const SCREEN_FOR = {
        title: 'screen-title',
        gameover: 'screen-over',
        victory: 'screen-win'
    };

    function Screens(run, root) {
        this.run = run;
        this.root = root;
        this.current = null;
        this._listen();
        this.show('title');
    }

    Screens.prototype._listen = function () {
        const self = this;
        this.run.bus.on(EV.STATE_CHANGED, function (e) {
            self.show(SCREEN_FOR[e.to] ? e.to : null);
        });

        this.root.addEventListener('click', function (ev) {
            const btn = ev.target.closest('[data-confirm]');
            if (!btn) return;
            ev.preventDefault();
            self.run.confirm();
        });
    };

    Screens.prototype.show = function (state) {
        for (const key in SCREEN_FOR) {
            const el = document.getElementById(SCREEN_FOR[key]);
            if (el) el.classList.toggle('is-active', key === state);
        }
        document.body.dataset.screen = state || 'playing';
        this.current = state || null;

        if (state === 'gameover' || state === 'victory') this._fillSummary(state);
    };

    Screens.prototype._fillSummary = function (state) {
        const run = this.run;
        const id = state === 'victory' ? 'win' : 'over';

        set(id + '-score', Util.formatScore(run.score));
        set(id + '-best', Util.formatScore(run.best));
        set(id + '-time', Util.formatTime(run.elapsed));
        set(id + '-mine', run.mine.name);
        set(id + '-tnt', run.tntFound + ' / ' + run.mine.tntTotal);

        const line = document.getElementById(id + '-line');
        if (!line) return;
        if (state === 'victory') {
            line.textContent = 'All three seams brought down. Nothing left of the workings but the sky.';
        } else if (run.mineIndex === 0) {
            line.textContent = 'Copperlode keeps its powder. The fuse does not wait for anybody.';
        } else {
            line.textContent = 'You got as far as ' + run.mine.name + '. The rest of it is still down there.';
        }
    };

    function set(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    TNT.Screens = Screens;
})(window.TNT = window.TNT || {});

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
        victory: 'screen-win',
        workshop: 'screen-workshop'
    };

    function Screens(run, root) {
        this.run = run;
        this.root = root;
        this.current = null;
        /** The selected card in the workshop; the last one is "go on". */
        this.shopIndex = 0;
        this._listen();
        this.show('title');
    }

    Screens.prototype._listen = function () {
        const self = this;
        this.run.bus.on(EV.STATE_CHANGED, function (e) {
            self.show(SCREEN_FOR[e.to] ? e.to : null);
        });

        this.root.addEventListener('click', function (ev) {
            const buy = ev.target.closest('[data-buy]');
            if (buy) {
                ev.preventDefault();
                self._activate(Number(buy.dataset.index));
                return;
            }
            const btn = ev.target.closest('[data-confirm]');
            if (!btn) return;
            ev.preventDefault();
            self.run.confirm();
        });

        this.run.bus.on(EV.UPGRADE_BOUGHT, function () {
            if (self.current === 'workshop') self._renderShop();
        });
    };

    /* ------------------------------------------------------------------ *
     * The workshop
     * ------------------------------------------------------------------ */

    /**
     * Driven from the game's own input, not from focus and native buttons:
     * the input layer swallows arrows, Enter and Space so they never scroll
     * the page, which also stops them reaching a focused button. So the shop
     * keeps its own selection and reads the same actions the game does.
     */
    Screens.prototype.workshopInput = function (input) {
        if (this.current !== 'workshop') return;
        const count = TNT.Upgrades.CATALOGUE.length + 1;
        const before = this.shopIndex;
        if (input.justPressed('left') || input.justPressed('up')) this.shopIndex = (this.shopIndex + count - 1) % count;
        if (input.justPressed('right') || input.justPressed('down')) this.shopIndex = (this.shopIndex + 1) % count;
        if (this.shopIndex !== before) this._renderShop();
        if (input.justPressed('confirm')) this._activate(this.shopIndex);
    };

    Screens.prototype._activate = function (index) {
        const items = TNT.Upgrades.CATALOGUE;
        this.shopIndex = index;
        if (index >= items.length) {
            this.run.leaveWorkshop();
            return;
        }
        if (this.run.buy(items[index].id)) {
            const el = this.root.querySelector('[data-index="' + index + '"]');
            if (el) el.classList.add('is-bought');
        } else {
            this._renderShop();
        }
    };

    Screens.prototype._renderShop = function () {
        const run = this.run;
        const shop = document.getElementById('shop');
        if (!shop) return;
        set('shop-cogs', run.cogs);
        set('shop-coins', run.coins);
        set('shop-eyebrow', run.mine.name + ' is down');

        const items = TNT.Upgrades.CATALOGUE;
        shop.innerHTML = '';
        for (let i = 0; i <= items.length; i++) {
            const card = document.createElement('button');
            card.className = 'shop__item';
            card.dataset.buy = '1';
            card.dataset.index = String(i);
            card.setAttribute('role', 'listitem');
            if (i === this.shopIndex) card.classList.add('is-selected');

            if (i === items.length) {
                const next = run.mines[run.mineIndex + 1];
                card.classList.add('is-go');
                card.innerHTML = '<span class="shop__name">Down the shaft ▸</span>' +
                    '<span class="shop__blurb">' + (next ? next.name : '') + '</span>';
            } else {
                const item = items[i];
                const level = run.upgrades[item.id];
                const owned = level >= item.max;
                if (owned) card.classList.add('is-owned');
                else if (!run.canBuy(item.id)) card.classList.add('is-poor');
                const pips = (item.coins ? '<i class="coin__icon"></i>' + item.coins + ' ' : '') +
                    '<i class="cogs__icon"></i>'.repeat(item.cogs);
                const tail = owned ? 'OWNED' : (item.max > 1 ? level + ' / ' + item.max : '');
                card.innerHTML = '<span class="shop__name">' + item.name + '</span>' +
                    '<span class="shop__blurb">' + item.blurb + '</span>' +
                    '<span class="shop__cost">' + (owned ? '' : pips) + ' ' + tail + '</span>';
            }
            shop.appendChild(card);
        }
    };

    Screens.prototype.show = function (state) {
        for (const key in SCREEN_FOR) {
            const el = document.getElementById(SCREEN_FOR[key]);
            if (el) el.classList.toggle('is-active', key === state);
        }
        document.body.dataset.screen = state || 'playing';
        this.current = state || null;

        if (state === 'gameover' || state === 'victory') this._fillSummary(state);
        if (state === 'workshop') {
            this.shopIndex = TNT.Upgrades.CATALOGUE.length;
            // Start on the first thing you can actually buy, if there is one.
            const items = TNT.Upgrades.CATALOGUE;
            for (let i = 0; i < items.length; i++) {
                if (this.run.canBuy(items[i].id)) { this.shopIndex = i; break; }
            }
            this._renderShop();
        }
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

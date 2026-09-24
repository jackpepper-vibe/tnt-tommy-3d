/**
 * TNT Tommy — the workshop's catalogue, and what each purchase changes.
 *
 * Two currencies, spent between mines at the workshop on kit that lasts the
 * rest of the run. **Coins** are the everyday money — a mine holds about 110 —
 * and buy the everyday kit. **Brass cogs** are rare, three to a mine and found
 * by the dog, and are what the special kit costs on top. Six items, most of
 * them one-offs, none of which touch the jump.
 *
 * **Nothing here changes how high Tommy jumps or how far he can reach.** Every
 * one of the twenty-seven rooms is authored against the three-row rule, and an
 * upgrade that bent it would quietly make rooms trivial. What the kit changes
 * is how *forgiving* a mine is — more fuse, more lives, cheaper mistakes —
 * which is exactly what a player who has earned cogs by exploring should get.
 *
 * Pure data and pure functions: `Run` owns the levels bought, and asks `mods`
 * for the numbers whenever it needs one.
 */
(function (TNT) {
    'use strict';

    const { C } = TNT;

    const CATALOGUE = [
        {
            id: 'fuse', name: 'Slow Fuse', coins: 60, cogs: 0, max: 2,
            blurb: 'The fuse burns a fifth slower. Buy it twice for more.'
        },
        {
            id: 'helmet', name: 'Spare Helmet', coins: 40, cogs: 0, max: 3,
            blurb: 'One more life, straight away.'
        },
        {
            id: 'charge', name: 'Bigger Charge', coins: 50, cogs: 1, max: 1,
            blurb: 'Blasts reach half as far again, and clear shots out of the air.'
        },
        {
            id: 'boots', name: 'Hobnail Boots', coins: 50, cogs: 1, max: 1,
            blurb: 'Long drops cost nothing, and spikes bite half as hard.'
        },
        {
            id: 'lunch', name: 'Bigger Lunch Tin', coins: 30, cogs: 0, max: 1,
            blurb: 'Every meal puts half as much fuse back again.'
        },
        {
            id: 'tank', name: 'Air Tank', coins: 0, cogs: 2, max: 1,
            blurb: 'Start every mine already carrying the oxygen tank.'
        }
    ];

    const Upgrades = {
        CATALOGUE: CATALOGUE,

        /** Levels bought, all zero. */
        fresh: function () {
            const levels = {};
            for (const item of CATALOGUE) levels[item.id] = 0;
            return levels;
        },

        item: function (id) {
            return CATALOGUE.find(function (i) { return i.id === id; }) || null;
        },

        /**
         * The numbers the rules read, for a set of levels.
         *
         * Everything is expressed as a multiplier or a replacement for a
         * constant in `C`, so the run's code reads `mods.x * C.Y` and the
         * constants stay the single source of the base values.
         */
        mods: function (levels) {
            const l = levels || {};
            return {
                fuseMul: 1 + 0.25 * (l.fuse || 0),
                blastMul: l.charge ? 1.5 : 1,
                fallSafe: l.boots ? C.MAX_FALL + 1 : C.FALL_SAFE,
                spikeMul: l.boots ? 0.5 : 1,
                foodMul: l.lunch ? 1.5 : 1,
                startTank: !!l.tank
            };
        }
    };

    TNT.Upgrades = Upgrades;
})(window.TNT = window.TNT || {});

/**
 * CINDERDEEP — the last mine. Nine rooms, and the seam is already burning.
 *
 *     THE OVERLOOK   —  ASH GALLERY    —  THE LAST VAULT
 *            |                                  |
 *     CINDER DRIFT   —  THE FURNACE    —  THE CHIMNEY
 *            |                 |                |
 *     THE MOUTH      —  SLAG WORKS     —  MAGMA CUT
 *
 * The route inverts Copperlode's: you come in at the bottom left and the plunger
 * is top right, but every vertical link is on a different column from the first
 * mine, so the map has to be learned rather than remembered.
 *
 * What this mine is: **lava instead of spikes**, two flooding seams rather than
 * one, guardians in most rooms, and the tightest fuse of the three. It is also
 * where the trampolines stop being generous — several of them fire into
 * ceilings you would rather not meet, so the room is asking whether you know
 * how high a bounce goes.
 *
 * Twelve sticks. The plunger is in the Last Vault, and by the time you reach it
 * the escape run is the whole game.
 */
(function (TNT) {
    'use strict';

    TNT.Rooms = TNT.Rooms || {};
    TNT.Rooms.MINES = TNT.Rooms.MINES || [];

    TNT.Rooms.MINES[2] = [

        /* ============================================================== *
         * Bottom band
         * ============================================================== */

        {
            id: 'theMouth',
            name: 'THE MOUTH',
            blurb: 'Warm already',
            cell: [0, 2],
            exits: { right: true, up: true },
            works: 'furnace',
            /**
             * The entrance, and the last room in the game that is entirely safe
             * to stand still in. Everything here is a jump; the lava starts next
             * door.
             */
            build: function (g) {
                g.deck(20, [2, 8], [13, 9], [26, 9]);
                g.deck(17, [6, 8], [18, 8], [30, 8]);
                g.deck(14, [2, 9], [15, 9], [28, 9]);
                g.deck(11, [8, 9], [22, 9], [34, 5]);
                g.deck(8, [3, 9], [17, 9], [30, 8]);
                g.deck(5, [9, 10], [24, 9]);

                g.spawn(4, 22);
                g.food(9, 22);
                g.ore(14, 22, 2, 2);
                g.walker(31, 22);

                g.ore(3, 19, 2, 2);
                g.ore(28, 19, 2, 2);
                g.ore(4, 13, 2, 2);
                g.food(30, 13);
                g.tnt(24, 10);
                g.ore(19, 7, 2, 2);
                g.ore(32, 7, 2, 2);

                g.spikes(17, 22, 4);
                g.bat(19, 12);
                g.crawler(35, 10);
                g.dog(24, 22);
                g.spider(30, 1);
                g.guardian(12, 6);
                g.orb(33, 16);

                g.ladder(6, 8, 13);
            }
        },

        {
            id: 'slagWorks',
            name: 'SLAG WORKS',
            blurb: 'Tipping floor',
            cell: [1, 2],
            exits: { left: true, right: true, up: true },
            works: 'furnace',
            /**
             * A molten floor with three pools in it, and belts on the decks
             * above running toward the drops. Standing still on a conveyor here
             * is how you end up in the lava, which is the room's whole lesson.
             *
             * The middle of the floor is left solid on purpose: the shaft up to
             * the Furnace comes down here, and arriving from above into a pool
             * is a death the player had no way to see coming.
             */
            build: function (g) {
                g.lava(4, 23, 9, 1);
                g.lava(24, 23, 6, 1);
                g.lava(32, 23, 6, 1);

                g.deck(20, [2, 8], [14, 7], [27, 10]);
                g.belt(5, 17, 12, 1);
                g.belt(22, 17, 13, -1);
                g.deck(14, [3, 8], [16, 9], [29, 8]);
                g.deck(11, [7, 10], [21, 9], [33, 6]);
                g.deck(8, [2, 9], [15, 10], [28, 9]);
                g.deck(5, [10, 9], [24, 10]);

                g.food(15, 22);
                g.ore(27, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(29, 19, 2, 2);
                g.tnt(26, 16);
                g.ore(4, 13, 2, 2);
                g.ore(30, 13, 2, 2);
                g.food(23, 10);
                g.ore(17, 7, 2, 2);
                g.ore(30, 7, 2, 2);
                g.tnt(12, 4);

                g.walker(17, 19);
                g.spider(24, 1);
                g.spider(11, 1);
                g.guardian(14, 12);
                g.crawler(35, 10);
                g.orb(19, 10);
                g.bat(30, 15);


                g.rail(16, 14, 9);
            }
        },

        {
            id: 'magmaCut',
            name: 'MAGMA CUT',
            blurb: 'It is rising',
            cell: [2, 2],
            exits: { left: true, up: true },
            works: 'furnace',
            /** A blackout: no lamps. The helmet, and whatever glows, is all there is. */
            dark: true,
            flooding: true,
            /**
             * The second flooding seam, and unlike Fire Damp it is not a dead
             * end — it is on the way to the Chimney. So the rise is a toll on a
             * route rather than a decision, and lingering to strip the ore out
             * of it costs you the way through.
             */
            build: function (g) {

                g.lava(2, 23, 38, 1);

                g.deck(20, [3, 8], [15, 7], [27, 9]);
                g.deck(17, [7, 9], [20, 9], [32, 6]);
                g.deck(14, [3, 9], [17, 8], [29, 9]);
                g.deck(11, [8, 10], [23, 9]);
                g.deck(8, [4, 9], [18, 9], [31, 7]);
                g.deck(5, [11, 9], [25, 10]);

                g.ore(4, 19, 2, 2);
                g.ore(28, 19, 2, 2);
                g.tnt(9, 16);
                g.ore(4, 13, 2, 2);
                g.food(31, 13);
                g.ore(19, 7, 2, 2);
                g.tnt(33, 7);

                g.orb(14, 16);
                g.orb(30, 10);
                g.bat(26, 12);
                g.guardian(18, 9);
                g.spider(22, 1);
                g.crawler(12, 19);
                g.walker(34, 19);

                g.ladder(6, 5, 7);

                // A cog on the high shelf at the top of the ladder.
                g.cog(4, 7);
            }
        },

        /* ============================================================== *
         * Middle band
         * ============================================================== */

        {
            id: 'cinderDrift',
            name: 'CINDER DRIFT',
            blurb: 'Ash underfoot',
            cell: [0, 1],
            exits: { right: true, up: true, down: true },
            works: 'stores',
            /**
             * A long haulage drift, mostly intact, and the mine's junction on
             * the left. The fissure in the back wall hides the spare helmet —
             * the only one in Cinderdeep, and worth a stick.
             */
            build: function (g) {
                g.rock(1, 18, 6, 1);
                g.cracked(5, 19, 2, 4);
                g.heart(2, 22);
                g.ore(3, 22, 1);

                g.deck(20, [8, 9], [20, 8], [31, 8]);
                g.deck(17, [7, 8], [19, 9], [32, 6]);
                g.deck(14, [9, 9], [22, 9], [34, 5]);
                g.deck(11, [7, 8], [19, 10], [32, 6]);
                g.deck(8, [10, 10], [25, 9]);
                g.deck(5, [8, 9], [22, 10]);

                g.food(10, 22);
                g.ore(14, 22, 2, 2);
                g.walker(28, 22);

                g.ore(9, 19, 2, 2);
                g.ore(32, 19, 2, 2);
                g.tnt(22, 16);
                g.ore(10, 13, 2, 2);
                g.ore(24, 13, 2, 2);
                g.food(24, 10);
                g.ore(12, 7, 2, 2);
                g.ore(27, 7, 2, 2);

                g.bat(17, 12);
                g.dog(19, 22);
                g.guardian(28, 9);
                g.spider(25, 1);
                g.orb(16, 16);
                g.crawler(34, 13);


                g.hook(18, 1);
            }
        },

        {
            id: 'theFurnace',
            name: 'THE FURNACE',
            blurb: 'Do not stop',
            cell: [1, 1],
            exits: { left: true, right: true, down: true },
            works: 'furnace',
            /**
             * The hardest room in the game and the one it is named for. A lava
             * floor with no islands, crumbling decks over it, pistons on two of
             * them, and a trampoline that is the only way back up if the boards
             * go while you are standing on them.
             */
            build: function (g) {
                g.lava(2, 23, 38, 1);
                g.crusher(12, 16);
                g.crusher(27, 16);

                g.deck(20, [2, 6], [34, 6]);
                g.crumble(10, 20, 7);
                g.crumble(23, 20, 8);
                g.tramp(18, 20, 3);
                g.deck(17, [5, 8], [20, 7], [31, 7]);
                g.deck(14, [2, 7], [14, 9], [28, 9]);
                g.crumble(23, 14, 4);
                g.deck(11, [8, 9], [22, 10]);
                g.deck(8, [3, 8], [16, 9], [30, 8]);
                g.deck(5, [10, 10], [25, 9]);

                g.ore(3, 19, 2, 2);
                g.ore(35, 19, 2, 2);
                g.tnt(33, 16);
                g.ore(3, 13, 2, 2);
                g.food(17, 13);
                g.ore(30, 13, 2, 2);
                g.tnt(18, 7);
                g.ore(31, 7, 2, 2);

                g.orb(8, 18);
                g.orb(31, 18);
                g.guardian(17, 9);
                g.guardian(26, 6);
                g.bat(24, 12);
                g.spider(14, 1);
                g.spider(29, 1);


                // A fan up the left side, and a live rail across the upper right.
                g.fan(6, 19);
                g.rail(22, 11, 10);
            }
        },

        {
            id: 'theChimney',
            name: 'THE CHIMNEY',
            blurb: 'Straight up',
            cell: [2, 1],
            exits: { left: true, up: true, down: true },
            works: 'fans',
            /**
             * A vertical room: narrow decks alternating left and right the whole
             * way up, with the cage running the full height on the right for
             * anyone who would rather not climb it. The warp pads short-cut the
             * bottom half on the way back down.
             */
            build: function (g) {

                g.rock(31, 4, 1, 16);
                g.rock(31, 3, 7, 1);
                g.rock(36, 20, 1, 2);
                g.rock(36, 17, 1, 2);
                g.rock(36, 14, 1, 2);
                g.rock(36, 11, 1, 2);
                g.rock(36, 8, 1, 2);
                g.rock(36, 5, 1, 2);
                g.liftRunV(32, 22, 4);

                g.warp(3, 22);
                g.warp(28, 4);

                g.deck(20, [6, 9], [20, 8]);
                g.deck(17, [2, 8], [17, 9]);
                g.deck(14, [8, 9], [22, 8]);
                g.deck(11, [3, 8], [18, 10]);
                g.deck(8, [9, 9], [23, 7]);
                g.deck(5, [4, 9], [19, 10]);

                g.food(8, 22);
                g.ore(12, 22, 2, 2);
                g.walker(22, 22);

                g.ore(7, 19, 2, 2);
                g.ore(21, 19, 2, 2);
                g.tnt(23, 16);
                g.ore(9, 13, 2, 2);
                g.ore(24, 13, 2, 2);
                g.food(24, 10);
                g.ore(10, 7, 2, 2);
                g.ore(24, 7, 2, 2);
                g.tnt(6, 4);

                g.spikes(15, 22, 4);
                g.bat(15, 15);
                g.spider(13, 1);
                g.guardian(16, 9);
                g.orb(11, 16);
                g.crawler(25, 13);
                g.dog(9, 22);


                // A cog at the top of the cage run in the stack.
                g.cog(33, 4);
            }
        },

        /* ============================================================== *
         * Top band
         * ============================================================== */

        {
            id: 'theOverlook',
            name: 'THE OVERLOOK',
            blurb: 'You can see the whole seam',
            cell: [0, 0],
            exits: { right: true, down: true },
            works: 'winding',
            /**
             * Open and high, with two rope lines strung the width of it. After
             * the Furnace this is deliberately a breather — the danger here is
             * the drop, and the drop no longer hurts.
             */
            build: function (g) {

                g.deck(20, [2, 9], [16, 8], [29, 9]);
                g.deck(17, [7, 8], [22, 9]);
                g.rope(5, 32, 15);
                g.deck(14, [2, 8], [15, 9], [30, 8]);
                g.deck(11, [9, 9], [24, 9]);
                g.rope(7, 30, 9);
                g.deck(8, [3, 8], [17, 9], [31, 7]);
                g.deck(5, [10, 10], [25, 9]);

                g.food(5, 22);
                g.ore(10, 22, 2, 2);
                g.walker(30, 22);

                g.ore(3, 19, 2, 2);
                g.ore(30, 19, 2, 2);
                g.tnt(24, 16);
                g.ore(3, 13, 2, 2);
                g.ore(31, 13, 2, 2);
                g.food(26, 10);
                g.ore(18, 7, 2, 2);
                g.ore(32, 7, 2, 2);

                g.spikes(20, 22, 4);
                g.bat(17, 6);
                g.orb(13, 18);
                g.crawler(34, 13);
                g.spider(27, 1);
                g.guardian(24, 12);
                g.dog(8, 22);

                g.vine(6, 5, 7);
                g.vine(28, 5, 7);

                // A cog under the low line, taken hand over hand.
                g.cog(10, 16);

                g.hook(22, 1);
            }
        },

        {
            id: 'ashGallery',
            name: 'ASH GALLERY',
            blurb: 'Everything burnt through',
            cell: [1, 0],
            exits: { left: true, right: true },
            works: 'flywheel',
            /**
             * Almost every board in here is rotten, and the two trampolines are
             * the only reliable way back up once they go. The ceiling above the
             * left one is spiked, so it is the room that asks whether you were
             * paying attention in the Fan House.
             */
            build: function (g) {

                g.spikes(8, 4, 5);

                g.deck(20, [2, 6], [32, 8]);
                g.crumble(9, 20, 9);
                g.crumble(21, 20, 8);
                g.tramp(9, 22, 2);
                g.tramp(27, 22, 2);
                g.deck(17, [4, 8], [18, 8], [31, 7]);
                g.crumble(13, 17, 4);
                g.deck(14, [2, 8], [16, 9], [29, 9]);
                g.crumble(11, 14, 4);
                g.deck(11, [7, 9], [21, 10]);
                g.deck(8, [3, 9], [17, 9], [30, 8]);
                g.deck(5, [14, 9], [26, 10]);

                g.food(4, 22);
                g.ore(14, 22, 2, 2);
                g.ore(31, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(33, 19, 2, 2);
                g.tnt(20, 16);
                g.ore(3, 13, 2, 2);
                g.ore(31, 13, 2, 2);
                g.food(24, 10);
                g.ore(18, 7, 2, 2);
                g.ore(31, 7, 2, 2);

                g.walker(24, 19);
                g.spider(24, 1);
                g.spider(11, 1);
                g.guardian(12, 9);
                g.guardian(30, 6);
                g.crawler(34, 16);
                g.orb(19, 16);

                /*
                 * The door on to the Last Vault is shuttered; the lever is on the high
                 * deck. The vault can still be reached up the Chimney.
                 */
                g.gate(40, 19, 4);
                g.lever(33, 4);

                g.hook(16, 6);
            }
        },

        {
            id: 'lastVault',
            name: 'THE LAST VAULT',
            blurb: 'The plunger',
            cell: [2, 0],
            exits: { left: true, down: true },
            /** The last Governor: the fastest, with every attack it has. */
            boss: { at: [21, 3] },
            /**
             * The end of the game. Two pistons and a guardian between the door
             * and the plunger, and a trampoline that gets you over both if you
             * time it — which on the escape run you will need to.
             */
            build: function (g) {
                g.detonator(35, 22);
                g.crusher(26, 19);
                g.crusher(31, 19);
                g.tramp(20, 22, 2);
                g.valve(9, 7);
                g.valve(35, 13);
                g.valve(12, 16);

                g.deck(20, [2, 8], [13, 6], [24, 9]);
                g.deck(17, [6, 9], [19, 8], [30, 8]);
                g.deck(14, [2, 8], [15, 9], [28, 9]);
                g.deck(11, [8, 9], [22, 10]);
                g.deck(8, [3, 9], [17, 9], [31, 7]);
                g.deck(5, [10, 10], [25, 9]);

                g.food(5, 22);
                g.ore(9, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(25, 19, 2, 2);
                g.ore(3, 13, 2, 2);
                g.ore(29, 13, 2, 2);
                g.food(24, 10);
                g.ore(18, 7, 2, 2);
                g.ore(33, 7, 1);

                g.spikes(14, 22, 4);
                g.bat(22, 15);
                g.walker(17, 19);
                g.spider(29, 1);
                g.spider(12, 1);

                g.ladder(6, 8, 13);
            }
        }
    ];
})(window.TNT = window.TNT || {});

/**
 * COPPERLODE — the first mine. Nine rooms on a 3x3 flick-screen grid.
 *
 *     THE LAMP ROOM  —  CRYSTAL GALLERY  —  THE VAULT
 *                              |                |
 *     THE LONG DRIFT —  THE PUMP HOUSE  —  CAGE SHAFT
 *            |                                  |
 *     MINER'S REST   —  POWDER STORE    —  THE DEEP CUT
 *
 * Horizontal neighbours join at floor level through the doorways `World` cuts;
 * verticals join through the ladder shaft in the middle columns. Only the links
 * drawn above exist, so reaching the Vault means working out a route rather than
 * walking diagonally to it.
 *
 * HOW A ROOM IS BUILT
 * -------------------
 * Six decks on the three-row grid, two to four platform runs on each, and gaps
 * between the runs so there is somewhere to fall and something to choose. A jump
 * reaches the next deck up; a ladder is only laid where the climb is longer than
 * that, or where it carries a room link.
 *
 * Copperlode's job is to teach the vocabulary without ever killing you for it.
 * The first four rooms introduce, in order: the deck grid, the drop-through, the
 * rope, and the trampoline. Nothing here is lethal on contact except the lava in
 * the Long Drift, and that is fenced.
 */
(function (TNT) {
    'use strict';

    TNT.Rooms = TNT.Rooms || {};
    TNT.Rooms.MINES = TNT.Rooms.MINES || [];

    TNT.Rooms.MINES[0] = [

        /* ============================================================== *
         * Bottom band
         * ============================================================== */

        {
            id: 'minersRest',
            name: "MINER'S REST",
            blurb: 'Where the shift starts',
            cell: [0, 2],
            exits: { right: true, up: true },
            /**
             * The opening room: a climbing frame with the shaft up the middle.
             *
             * It teaches vertical movement, but it is **not** a safe room. The
             * first version was — six decks and nothing that could hurt you —
             * and it set the tone for a mine with no tension in it. There is a
             * patrol on the floor you start beside, spikes under the middle of
             * the frame, and a spider over the shaft, so the lesson is "look
             * before you climb" rather than "climbing is free".
             */
            build: function (g) {
                g.deck(20, [2, 8], [13, 7], [25, 6], [33, 7]);
                g.deck(17, [5, 9], [17, 8], [29, 9]);
                g.deck(14, [2, 8], [14, 7], [26, 10]);
                g.deck(11, [7, 10], [24, 9]);
                g.deck(8, [3, 8], [16, 9], [30, 8]);
                g.deck(5, [10, 8], [24, 9]);

                g.spawn(4, 22);
                g.food(9, 22);
                g.ore(14, 22, 2, 2);
                g.walker(30, 22);

                g.ore(3, 19, 2, 2);
                g.ore(26, 19, 2, 2);
                g.food(33, 16);
                g.ore(4, 13, 2, 2);
                g.ore(28, 13, 2, 2);
                g.ore(18, 7, 2, 2);
                g.ore(32, 7, 2, 2);
                g.tnt(12, 4);

                g.spikes(15, 22, 4);
                // Rotten boards over the spikes, so the shortest way down the
                // middle is also the one that gives way under you.
                g.crumble(16, 20, 5);
                g.crumble(19, 14, 5);
                g.bat(19, 12);
                g.crawler(31, 7);
                g.walker(9, 19);
                g.spider(24, 1);
                g.dog(26, 22);

                // The long climb to the roof, and the link up to the Drift.
                g.ladder(5, 8, 13);
            }
        },

        {
            id: 'powderStore',
            name: 'POWDER STORE',
            blurb: 'Mind the spikes',
            cell: [1, 2],
            exits: { left: true, right: true },
            /**
             * Teaches the drop-through: the quickest way down the middle of this
             * room is to hold Down on each deck in turn, and the spike bed on
             * the floor is what makes you look before you do it.
             */
            build: function (g) {
                g.spikes(16, 22, 10);
                g.deck(20, [3, 9], [14, 14], [30, 8]);
                g.deck(17, [2, 7], [12, 8], [23, 8], [33, 6]);
                g.deck(14, [6, 10], [19, 9], [31, 7]);
                g.deck(11, [3, 8], [15, 10], [28, 9]);
                g.deck(8, [8, 9], [21, 12]);
                g.deck(5, [4, 8], [17, 8], [28, 9]);

                g.food(6, 22);
                g.ore(2, 22, 2, 2);
                g.ore(34, 22, 2, 2);
                g.walker(31, 22);

                g.ore(4, 19, 2, 2);
                g.ore(17, 19, 2, 2);
                g.food(25, 16);
                g.tnt(35, 16);
                g.ore(8, 13, 2, 2);
                g.ore(21, 13, 2, 2);
                g.tnt(23, 7);
                g.ore(10, 7, 2, 2);

                g.crumble(18, 17, 5);
                g.crumble(24, 11, 4);
                g.boulder(26, 1);
                g.crawler(20, 19);
                g.bat(27, 12);
                g.spider(24, 1);
                g.spider(11, 1);
                g.dog(9, 22);
                g.orb(28, 10);

                // The only long climb: floor to the powder shelf.
                g.ladder(12, 11, 16);
            }
        },

        {
            id: 'deepCut',
            name: 'THE DEEP CUT',
            blurb: 'The flooded end',
            cell: [2, 2],
            exits: { left: true, up: true },
            /**
             * The sump. Drowns you without the tank, and the tank is on the
             * shelf above it — so the first visit is a look and the second is
             * the errand. The stick on the bottom is the reason to come back.
             *
             * The pool used to be four rows deep with open air on both sides:
             * water that stopped in mid-air at the same height as the floor
             * beside it, which is neither a tank to look at nor a swim to make.
             * It is eight rows deep now and walled in rock — and the walls have
             * to be real tiles rather than something the renderer draws, or
             * they are a picture of a tank that Tommy walks straight through.
             *
             * The ladder reaches the waterline and stops. It used to run to the
             * bottom, so the whole descent could be climbed and the swim never
             * happened; now it is the way in and the way back out, and the six
             * rows below it are swum.
             */
            build: function (g) {
                g.water(27, 15, 13, 8);
                g.rock(25, 15, 2, 8);
                g.rock(40, 15, 1, 8);

                g.deck(20, [2, 8], [12, 9], [19, 6]);
                g.deck(17, [5, 8], [16, 9]);
                g.deck(14, [2, 9], [14, 8], [27, 5]);
                g.deck(11, [6, 10], [20, 8], [31, 7]);
                g.deck(8, [3, 9], [15, 10], [29, 8]);
                g.deck(5, [9, 9], [23, 10]);

                g.food(4, 22);
                g.ore(8, 22, 2, 2);
                g.tnt(33, 22);
                g.walker(15, 22);

                g.ore(3, 19, 2, 2);
                g.ore(14, 19, 2, 2);
                g.ore(30, 18, 2, 3);
                g.ore(4, 13, 2, 2);
                // Clear of column 28: the ladder below carries a rung a row
                // above its own platform, and it overwrites without complaint.
                g.oxygen(31, 13);
                g.tnt(30, 13);
                g.food(22, 10);
                g.ore(17, 7, 2, 2);
                g.ore(31, 7, 2, 2);

                g.boulder(11, 1);
                g.boulder(19, 1);
                g.boulder(31, 1);
                g.crumble(16, 17, 5);
                g.crumble(22, 11, 4);
                g.bat(24, 12);
                g.crawler(20, 16);
                g.spider(17, 1);
                g.orb(13, 10);
                g.guardian(31, 6);

                // Down to the waterline, and no further.
                g.ladder(28, 14, 16);
            }
        },

        /* ============================================================== *
         * Middle band
         * ============================================================== */

        {
            id: 'longDrift',
            name: 'THE LONG DRIFT',
            blurb: 'Haulage level',
            cell: [0, 1],
            exits: { right: true, down: true },
            /**
             * A haulage drift cut in two by a lava channel, with the tram the
             * only way across it.
             *
             * The channel was here from the start and did nothing, because
             * every deck ran straight over the top of it — and row 20 is a
             * *door row*, so you could enter on the right, walk the upper deck
             * over the lava and leave on the left without ever going near the
             * floor. Lava you can walk over is scenery.
             *
             * So nothing spans columns 11-22 at any level now. The banks are
             * twelve tiles apart against a jump that carries about five, which
             * leaves the tram, and the room's only stick sits on the far side
             * of it. The one exception is the little deck at row 11 over the
             * middle: the down shaft comes up through columns 20-21 and needs
             * something to stand on, and it is joined to the right bank only.
             */
            build: function (g) {
                g.lava(11, 23, 12, 1);
                /*
                 * Moored at each edge, not parked inland.
                 *
                 * The markers set the tram's outer edges, and at 6 and 26 with
                 * a four tile body it came to rest at columns 6-9 and 23-26 —
                 * clear of a channel running 11 to 22, so most of its run was
                 * over solid rock and it read as a truck driving along the
                 * floor. At 9 and 24 it straddles each bank instead: you step
                 * aboard at the lip, and every tile it travels is over lava.
                 */
                g.liftRunH(9, 24, 22);

                g.deck(20, [2, 8], [26, 9]);
                g.deck(17, [6, 5], [23, 5], [30, 8]);
                g.deck(14, [2, 9], [23, 6], [31, 6]);
                g.belt(6, 11, 5, 1);
                g.belt(24, 11, 12, -1);
                g.deck(11, [19, 4]);
                g.deck(8, [4, 7], [23, 7], [31, 6]);
                g.deck(5, [4, 7], [24, 9]);

                g.food(4, 22);
                g.ore(28, 22, 2, 2);
                g.walker(33, 22);

                g.ore(3, 19, 2, 2);
                g.tnt(7, 19);
                g.ore(28, 19, 2, 2);
                g.ore(4, 13, 2, 2);
                g.food(32, 13);
                g.ore(25, 7, 2, 2);
                g.ore(31, 7, 2, 2);

                g.crumble(27, 20, 4);
                g.crumble(24, 14, 4);
                g.bat(16, 12);
                g.crawler(31, 16);
                g.dog(26, 22);
                g.spider(30, 1);
                g.guardian(12, 6);

                g.ladder(9, 8, 13);
            }
        },

        {
            id: 'pumpHouse',
            name: 'THE PUMP HOUSE',
            blurb: 'Machinery, running',
            cell: [1, 1],
            exits: { left: true, right: true, up: true },
            /**
             * Two pistons on the floor and two vents in it. A timing room: every
             * deck is jumpable, so the only thing between you and the top is
             * whether you set off at the right moment.
             */
            build: function (g) {
                g.crusher(9, 19);
                g.crusher(30, 19);
                g.vent(16, 22);
                g.vent(24, 22);

                g.deck(20, [2, 7], [13, 8], [27, 8]);
                g.deck(17, [5, 8], [16, 10], [30, 8]);
                g.deck(14, [2, 8], [13, 9], [26, 10]);
                g.deck(11, [6, 9], [19, 8], [31, 7]);
                g.deck(8, [3, 8], [15, 10], [29, 8]);
                g.deck(5, [9, 10], [23, 9]);

                g.food(4, 22);
                g.ore(35, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(32, 19, 2, 2);
                g.tnt(19, 16);
                g.ore(4, 13, 2, 2);
                g.food(28, 13);
                g.ore(17, 7, 2, 2);
                g.ore(30, 7, 2, 2);

                g.crumble(17, 17, 5);
                g.crumble(23, 11, 4);
                g.walker(19, 13);
                g.crawler(34, 7);
                g.spider(13, 1);
                g.spider(27, 1);
                g.guardian(24, 9);
                g.bat(9, 15);

                g.ladder(6, 8, 13);
            }
        },

        {
            id: 'cageShaft',
            name: 'CAGE SHAFT',
            blurb: 'The winding cage',
            cell: [2, 1],
            exits: { left: true, up: true, down: true },
            /**
             * The spine of the mine: the only room linked both up and down. The
             * cage runs in its own headframe on the left, cut away at each
             * landing — putting it in the link shaft means a rider and a climber
             * collide, and arriving from above drops you into a moving platform.
             */
            build: function (g) {
                // The headframe. The right cheek is cut away at each *standing*
                // row — 19, 16, 13, 10, 7, 4 — and solid everywhere else, so
                // the cage can be stepped off at a landing and the shaft is a
                // wall wherever it should be. The left cheek stops above the
                // doorway rows or the room is sealed from its own entrance.
                g.rock(3, 4, 1, 16);
                g.rock(3, 3, 6, 1);
                g.rock(8, 20, 1, 2);
                g.rock(8, 17, 1, 2);
                g.rock(8, 14, 1, 2);
                g.rock(8, 11, 1, 2);
                g.rock(8, 8, 1, 2);
                g.rock(8, 5, 1, 2);
                g.liftRunV(4, 22, 4);

                g.deck(20, [9, 8], [20, 7], [30, 8]);
                g.deck(17, [9, 7], [18, 9], [31, 7]);
                g.deck(14, [9, 9], [21, 8], [32, 6]);
                g.deck(11, [9, 7], [19, 10], [32, 6]);
                g.deck(8, [9, 8], [20, 9], [32, 6]);
                g.deck(5, [9, 8], [21, 10]);

                g.food(12, 22);
                g.ore(15, 22, 2, 2);
                g.walker(31, 22);

                g.ore(10, 19, 2, 2);
                g.ore(31, 19, 2, 2);
                g.tnt(33, 16);
                g.ore(10, 13, 2, 2);
                g.food(23, 13);
                g.ore(10, 7, 2, 2);
                g.tnt(24, 7);

                g.crumble(11, 17, 4);
                g.crumble(26, 11, 5);
                g.boulder(14, 1);
                g.bat(26, 12);
                g.crawler(34, 10);
                g.dog(24, 22);
                g.guardian(14, 6);
                g.orb(18, 16);

            }
        },

        /* ============================================================== *
         * Top band
         * ============================================================== */

        {
            id: 'lampRoom',
            name: 'THE LAMP ROOM',
            blurb: 'A dead end worth walking',
            cell: [0, 0],
            exits: { right: true },
            /**
             * A dead end and the only room that is a reward rather than an
             * obstacle. The spare helmet is sealed behind a fissure with rock
             * over the top of it, so no amount of steering a fall gets in —
             * this is the room that teaches you what the dynamite is for.
             */
            build: function (g) {
                g.rock(1, 18, 6, 1);
                g.cracked(5, 19, 2, 4);
                g.heart(2, 22);
                g.ore(3, 22, 1);

                g.deck(20, [8, 9], [20, 8], [31, 7]);
                g.deck(17, [7, 8], [18, 10], [31, 7]);
                g.deck(14, [9, 9], [21, 9], [33, 5]);
                g.deck(11, [7, 8], [19, 9], [31, 7]);
                g.deck(8, [10, 10], [24, 9]);
                g.deck(5, [6, 9], [20, 10], [33, 5]);

                g.food(10, 22);
                g.ore(13, 22, 2, 2);
                g.crawler(24, 22);

                g.ore(9, 19, 2, 2);
                g.ore(21, 19, 2, 2);
                g.food(22, 16);
                g.ore(10, 13, 2, 2);
                g.ore(23, 13, 2, 2);
                g.tnt(32, 10);
                g.ore(12, 7, 2, 2);
                g.ore(26, 7, 2, 2);

                g.crumble(20, 17, 5);
                g.crumble(15, 11, 4);
                g.bat(27, 15);
                g.walker(28, 19);
                g.spider(16, 1);
                g.dog(14, 22);
                g.orb(31, 10);

                g.ladder(35, 5, 22);
            }
        },

        {
            id: 'crystalGallery',
            name: 'CRYSTAL GALLERY',
            blurb: 'A natural cavern',
            cell: [1, 0],
            exits: { left: true, right: true, down: true },
            /**
             * A cavern rather than a working, so it is hung with ropes instead
             * of fitted with ladders, and it is where the rope line and the
             * trampoline are introduced together — the trampoline is the only
             * way onto the roof span, and the rope is the only way off it.
             */
            build: function (g) {
                g.spikes(25, 22, 5);
                g.tramp(15, 22, 2);

                g.deck(20, [2, 8], [12, 6], [31, 8]);
                g.deck(17, [5, 8], [22, 9], [33, 6]);
                g.deck(14, [2, 9], [16, 8], [28, 9]);
                g.deck(11, [8, 8], [24, 10]);
                g.deck(8, [3, 9], [18, 9], [31, 7]);
                g.deck(5, [7, 8], [26, 9]);
                g.rope(16, 25, 4);

                g.food(5, 22);
                g.ore(8, 22, 2, 2);
                g.walker(33, 22);

                g.ore(3, 19, 2, 2);
                g.ore(32, 19, 2, 2);
                g.tnt(24, 16);
                g.ore(4, 13, 2, 2);
                g.ore(29, 13, 2, 2);
                g.food(10, 10);
                g.ore(19, 7, 2, 2);
                g.ore(32, 7, 2, 2);
                g.tnt(8, 4);

                g.crumble(18, 14, 5);
                g.crumble(11, 8, 4);
                g.orb(13, 16);
                g.bat(17, 12);
                g.crawler(34, 16);
                g.spider(22, 1);
                g.guardian(28, 6);

                g.vine(6, 5, 7);
                g.vine(28, 5, 7);
            }
        },

        {
            id: 'vault',
            name: 'THE VAULT',
            blurb: 'The plunger',
            cell: [2, 0],
            exits: { left: true, down: true },
            /**
             * The plunger, and a piston in front of it. Reachable two ways —
             * along the top band or straight up the cage — so a player who has
             * lost track of the map still has a route.
             */
            build: function (g) {
                g.detonator(34, 22);
                g.crusher(30, 19);

                g.deck(20, [2, 8], [13, 8], [25, 8]);
                g.deck(17, [5, 9], [17, 9], [29, 8]);
                g.deck(14, [2, 8], [14, 9], [27, 10]);
                g.deck(11, [7, 9], [20, 8], [31, 7]);
                g.deck(8, [3, 9], [16, 10], [30, 8]);
                g.deck(5, [9, 9], [23, 10]);

                g.food(4, 22);
                g.ore(8, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(24, 19, 2, 2);
                g.ore(4, 13, 2, 2);
                g.ore(29, 13, 2, 2);
                g.food(22, 10);
                g.ore(18, 7, 2, 2);
                g.ore(31, 7, 2, 2);

                g.crumble(18, 17, 5);
                g.crumble(24, 11, 4);
                g.boulder(29, 1);
                g.bat(24, 12);
                g.guardian(16, 9);
                g.walker(18, 19);
                g.spider(11, 1);
                g.dog(13, 22);
                g.orb(33, 10);

                g.ladder(6, 8, 13);
            }
        }
    ];
})(window.TNT = window.TNT || {});

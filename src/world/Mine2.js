/**
 * BLACKDAMP — the second mine. Nine rooms, none of them Copperlode's.
 *
 *     THE FAN HOUSE  —  BLACK GALLERY  —  THE STRONGROOM
 *            |                 |                |
 *     SUMP LEVEL     —  THE ENGINE ROOM —  SLANT SHAFT
 *                              |
 *     THE MAIN GATE  —  TIMBER YARD    —  FIRE DAMP
 *
 * A different graph from Copperlode on purpose: the vertical links are on the
 * left, the middle and the right of the *top* band rather than the sides, so the
 * route through it does not rhyme with the first mine even though both are
 * three by three.
 *
 * What this mine adds: **warp pads**, which cut across the map in a way ladders
 * cannot, and **a flooding seam** — Fire Damp's lava rises while you stand in
 * it, so the room is on a clock the fuse knows nothing about. It also leans
 * harder on the machinery: conveyors that fight you, pistons over walkways, and
 * the first guardians that follow through rock.
 *
 * Twelve sticks, as always, and the plunger in the Strongroom.
 */
(function (TNT) {
    'use strict';

    TNT.Rooms = TNT.Rooms || {};
    TNT.Rooms.MINES = TNT.Rooms.MINES || [];

    TNT.Rooms.MINES[1] = [

        /* ============================================================== *
         * Bottom band
         * ============================================================== */

        {
            id: 'mainGate',
            name: 'THE MAIN GATE',
            blurb: 'Down from the surface',
            cell: [0, 2],
            exits: { right: true, up: true },
            /**
             * The way in. Wider decks and a straight shaft, so a player who has
             * just lost a life in the middle of the mine has somewhere legible
             * to restart from.
             */
            build: function (g) {
                g.deck(20, [2, 9], [14, 8], [26, 10]);
                g.deck(17, [6, 8], [18, 9], [31, 7]);
                g.deck(14, [2, 8], [13, 10], [27, 9]);
                g.deck(11, [7, 9], [22, 8], [33, 6]);
                g.deck(8, [3, 9], [16, 9], [29, 8]);
                g.deck(5, [8, 10], [24, 9]);

                g.spawn(4, 22);
                g.food(9, 22);
                g.ore(13, 22, 2, 2);
                g.walker(30, 22);

                g.ore(3, 19, 2, 2);
                g.ore(28, 19, 2, 2);
                g.ore(4, 13, 2, 2);
                g.food(29, 13);
                g.tnt(24, 10);
                g.ore(18, 7, 2, 2);
                g.ore(31, 7, 2, 2);

                g.spikes(17, 22, 4);
                g.bat(18, 12);
                g.crawler(33, 10);
                g.dog(24, 22);
                g.walker(10, 19);
                g.spider(28, 1);
                g.guardian(23, 6);

                g.ladder(6, 8, 13);
            }
        },

        {
            id: 'timberYard',
            name: 'TIMBER YARD',
            blurb: 'Rotten boards',
            cell: [1, 2],
            exits: { left: true, right: true, up: true },
            /**
             * Half this room's decking is rotten. Crumbling planks give way
             * under weight and come back a few seconds later, so the room is
             * about not stopping — and the spike bed underneath is what makes
             * stopping expensive.
             */
            build: function (g) {
                g.spikes(12, 22, 6);
                g.spikes(24, 22, 5);

                g.deck(20, [2, 7], [30, 9]);
                g.crumble(11, 20, 8);
                g.crumble(21, 20, 7);
                g.deck(17, [4, 9], [17, 8], [30, 8]);
                g.crumble(14, 17, 3);
                g.deck(14, [2, 8], [14, 8], [26, 10]);
                g.crumble(11, 14, 3);
                g.deck(11, [6, 10], [20, 9], [32, 6]);
                g.deck(8, [3, 8], [15, 10], [29, 8]);
                g.crumble(12, 8, 3);
                g.deck(5, [8, 9], [22, 10]);

                g.food(6, 22);
                g.ore(2, 22, 2, 2);
                g.ore(34, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(32, 19, 2, 2);
                g.tnt(22, 16);
                g.ore(3, 13, 2, 2);
                g.ore(28, 13, 2, 2);
                g.food(23, 10);
                g.ore(17, 7, 2, 2);
                g.ore(31, 7, 2, 2);
                g.tnt(10, 4);

                g.walker(24, 19);
                g.spider(16, 1);
                g.spider(28, 1);
                g.crawler(34, 13);
                g.bat(19, 15);
                g.dog(6, 19);
                g.orb(9, 10);

                g.ladder(5, 8, 13);
            }
        },

        {
            id: 'fireDamp',
            name: 'FIRE DAMP',
            blurb: 'It is rising',
            cell: [2, 2],
            exits: { left: true },
            flooding: true,
            /**
             * The flooding seam, and a dead end — so entering it is always a
             * decision. The lava climbs while you are in the room and drains
             * when you leave, which makes the two sticks here a question about
             * how many trips you are willing to make.
             *
             * The decks are laid so that the rising surface swallows them from
             * the bottom in order, and the top one is never reached: there is
             * always somewhere to stand, and always less of it.
             */
            build: function (g) {
                g.lava(2, 23, 38, 1);

                g.deck(20, [3, 7], [13, 8], [25, 7], [34, 5]);
                g.deck(17, [7, 8], [19, 8], [30, 8]);
                g.deck(14, [3, 8], [15, 9], [28, 9]);
                g.deck(11, [8, 9], [21, 9], [33, 6]);
                g.deck(8, [4, 9], [17, 10], [31, 7]);
                g.deck(5, [10, 9], [24, 10]);

                g.ore(4, 19, 2, 2);
                g.tnt(15, 19);
                g.ore(26, 19, 2, 2);
                g.food(21, 16);
                g.ore(4, 13, 2, 2);
                g.ore(29, 13, 2, 2);
                g.tnt(33, 10);
                g.ore(18, 7, 2, 2);

                g.orb(14, 16);
                g.orb(27, 10);
                g.bat(26, 15);
                g.guardian(20, 12);
                g.spider(19, 1);
                g.crawler(11, 19);
                g.walker(33, 19);

                g.ladder(37, 5, 19);
            }
        },

        /* ============================================================== *
         * Middle band
         * ============================================================== */

        {
            id: 'sumpLevel',
            name: 'SUMP LEVEL',
            blurb: 'Standing water',
            cell: [0, 1],
            exits: { right: true, up: true, down: true },
            /**
             * Flooded low workings. The tank is down here and so is a stick,
             * and the warp pads either side of the water are the reward for
             * finding out that the long way round is optional.
             */
            build: function (g) {
                g.water(3, 20, 15, 3);
                g.warp(24, 22);
                g.warp(9, 16);

                g.deck(20, [19, 8], [29, 9]);
                g.deck(17, [3, 9], [15, 8], [27, 10]);
                g.deck(14, [7, 9], [20, 9], [33, 6]);
                g.deck(11, [2, 8], [14, 10], [28, 9]);
                g.deck(8, [8, 9], [22, 10]);
                g.deck(5, [3, 9], [17, 8], [29, 8]);

                g.oxygen(6, 22);
                g.tnt(14, 22);
                g.food(28, 22);
                g.ore(30, 22, 2, 2);

                g.ore(20, 19, 2, 2);
                g.ore(31, 19, 2, 2);
                g.ore(8, 13, 2, 2);
                g.food(22, 13);
                g.tnt(30, 10);
                g.ore(10, 7, 2, 2);
                g.ore(24, 7, 2, 2);

                g.spikes(20, 22, 3);
                g.bat(24, 15);
                g.crawler(34, 13);
                g.walker(23, 19);
                g.spider(31, 1);
                g.guardian(26, 6);
                g.orb(12, 10);

                g.ladder(19, 8, 13);
            }
        },

        {
            id: 'engineRoom',
            name: 'THE ENGINE ROOM',
            blurb: 'Belts and pistons',
            cell: [1, 1],
            exits: { left: true, right: true, up: true, down: true },
            /**
             * The junction room — linked on all four sides — and the busiest in
             * the mine. Two conveyor decks running against each other, three
             * pistons over them, and the fastest route through is not the one
             * the belts are pushing you along.
             */
            build: function (g) {
                g.crusher(11, 19);
                g.crusher(24, 19);
                g.crusher(33, 13);

                g.deck(20, [2, 8], [14, 7], [27, 11]);
                g.belt(4, 17, 13, 1);
                g.belt(22, 17, 14, -1);
                g.deck(14, [2, 9], [15, 8], [28, 9]);
                g.belt(7, 11, 11, -1);
                g.belt(24, 11, 12, 1);
                g.deck(8, [3, 9], [16, 9], [29, 8]);
                g.deck(5, [9, 10], [23, 10]);

                g.food(5, 22);
                g.ore(16, 22, 2, 2);
                g.ore(30, 22, 2, 2);

                g.ore(3, 19, 2, 2);
                g.ore(28, 19, 2, 2);
                g.tnt(26, 16);
                g.ore(3, 13, 2, 2);
                g.ore(26, 13, 2, 2);
                g.food(27, 10);
                g.ore(17, 7, 2, 2);
                g.ore(30, 7, 2, 2);

                g.walker(19, 13);
                g.guardian(17, 9);
                g.dog(8, 22);
                g.bat(25, 15);
                g.spider(15, 1);
                g.spider(29, 1);
                g.crawler(6, 19);

                g.ladder(19, 5, 7);
            }
        },

        {
            id: 'slantShaft',
            name: 'SLANT SHAFT',
            blurb: 'The steep way up',
            cell: [2, 1],
            exits: { left: true, up: true },
            /**
             * A staircase room: the decks climb in a diagonal rather than
             * stacking, so the whole room is one long ascent with nowhere to
             * rest. The tram at the top crosses the gap the stairs cannot.
             */
            build: function (g) {
                g.steps(2, 20, 6, 1, 5);
                g.deck(20, [30, 9]);
                g.deck(17, [26, 8]);
                g.deck(14, [22, 8]);
                g.deck(11, [2, 7], [18, 7]);
                g.deck(8, [5, 8]);
                g.liftRunH(14, 30, 4);
                g.deck(5, [10, 5], [33, 6]);

                g.food(4, 22);
                g.ore(8, 22, 2, 2);
                g.walker(26, 22);

                g.ore(3, 19, 2, 2);
                g.ore(31, 19, 2, 2);
                g.tnt(23, 13);
                g.ore(14, 13, 2, 2);
                g.food(6, 7);
                g.tnt(34, 4);

                g.spikes(9, 22, 4);
                g.bat(17, 18);
                g.crawler(33, 16);
                g.spider(24, 1);
                g.guardian(11, 9);
                g.orb(29, 10);
                g.dog(30, 22);

                g.ladder(36, 5, 22);
            }
        },

        /* ============================================================== *
         * Top band
         * ============================================================== */

        {
            id: 'fanHouse',
            name: 'THE FAN HOUSE',
            blurb: 'Ventilation',
            cell: [0, 0],
            exits: { right: true, down: true },
            /**
             * Vents in the floor and the roof beams, and a trampoline in the
             * corner that is the only way onto the top gallery. Overshooting it
             * is safe here — the ceiling is clear — because this is where the
             * player is meant to learn how far a bounce goes.
             */
            build: function (g) {
                g.vent(10, 22);
                g.vent(17, 22);
                g.vent(30, 22);
                g.tramp(4, 22, 2);

                g.deck(20, [8, 9], [21, 8], [33, 6]);
                g.deck(17, [12, 8], [25, 9]);
                g.deck(14, [7, 9], [19, 9], [31, 7]);
                g.deck(11, [3, 8], [15, 10], [29, 8]);
                g.deck(8, [9, 9], [23, 10]);
                g.deck(5, [2, 9], [14, 8], [26, 11]);

                g.food(24, 22);
                g.ore(34, 22, 2, 2);

                g.ore(9, 19, 2, 2);
                g.ore(22, 19, 2, 2);
                g.tnt(27, 16);
                g.ore(8, 13, 2, 2);
                g.ore(32, 13, 2, 2);
                g.food(18, 10);
                g.ore(10, 7, 2, 2);
                g.ore(25, 7, 2, 2);

                g.bat(17, 12);
                g.walker(28, 19);
                g.guardian(14, 6);
                g.spider(26, 1);
                g.crawler(12, 16);
                g.orb(35, 10);

            }
        },

        {
            id: 'blackGallery',
            name: 'BLACK GALLERY',
            blurb: 'No lamps down here',
            cell: [1, 0],
            exits: { left: true, right: true, down: true },
            /**
             * The long rope room. Two lines strung across the width of it, and
             * the decks deliberately broken underneath, so crossing the gallery
             * means committing to a rope rather than picking your way along the
             * boards.
             */
            build: function (g) {
                g.deck(20, [2, 7], [16, 6], [31, 8]);
                g.deck(17, [6, 7], [26, 8]);
                g.rope(9, 30, 15);
                g.deck(14, [2, 8], [19, 7], [32, 6]);
                g.deck(11, [8, 8], [24, 9]);
                g.rope(6, 28, 9);
                g.deck(8, [3, 7], [17, 8], [30, 8]);
                g.deck(5, [10, 9], [25, 9]);

                g.food(5, 22);
                g.ore(10, 22, 2, 2);
                g.ore(26, 22, 2, 2);
                g.walker(33, 22);

                g.ore(3, 19, 2, 2);
                g.ore(32, 19, 2, 2);
                g.tnt(28, 16);
                g.ore(3, 13, 2, 2);
                g.ore(20, 13, 2, 2);
                g.food(26, 10);
                g.ore(18, 7, 2, 2);
                g.ore(31, 7, 2, 2);

                g.spikes(16, 22, 5);
                g.orb(14, 18);
                g.orb(23, 12);
                g.bat(17, 6);
                g.crawler(34, 13);
                g.spider(11, 1);
                g.guardian(29, 9);
                g.dog(31, 22);

                g.vine(7, 8, 10);
                g.vine(30, 5, 7);
            }
        },

        {
            id: 'strongroom',
            name: 'THE STRONGROOM',
            blurb: 'The plunger',
            cell: [2, 0],
            exits: { left: true, down: true },
            /**
             * The plunger, reachable along the top band or straight up the
             * Slant Shaft. Two ways in matters more here than anywhere: this is
             * where the escape run ends, and a single approach would make the
             * whole mine a memory test with a stopwatch on it.
             */
            build: function (g) {
                g.detonator(35, 22);
                // Pads sit on the *standing* row, like a pickup — row 5 is the
                // deck itself, and the deck is painted after this, which quietly
                // ate the pad and left the room with an unpaired one.
                g.warp(3, 22);
                g.warp(30, 4);
                g.crusher(31, 19);
                g.crusher(24, 19);

                g.deck(20, [6, 9], [18, 8], [28, 8]);
                g.deck(17, [3, 8], [16, 9], [29, 8]);
                g.deck(14, [8, 9], [21, 9], [33, 5]);
                g.deck(11, [4, 8], [17, 10], [31, 7]);
                g.deck(8, [9, 10], [24, 9]);
                g.deck(5, [3, 9], [16, 8], [28, 9]);

                g.food(7, 22);
                g.ore(11, 22, 2, 2);

                g.ore(7, 19, 2, 2);
                g.ore(28, 19, 2, 2);
                g.ore(9, 13, 2, 2);
                g.ore(23, 13, 2, 2);
                g.food(17, 10);
                g.ore(11, 7, 2, 2);
                g.ore(26, 7, 2, 2);

                g.spikes(13, 22, 4);
                g.guardian(18, 9);
                g.bat(25, 15);
                g.walker(19, 19);
                g.spider(12, 1);
                g.spider(27, 1);
                g.orb(9, 10);
                g.crawler(33, 16);

                g.ladder(37, 5, 22);
            }
        }
    ];
})(window.TNT = window.TNT || {});

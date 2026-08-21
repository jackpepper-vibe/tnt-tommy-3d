/**
 * TNT Tommy — Copperlode, the first mine. Nine rooms on a 3x3 flick-screen grid.
 *
 *     THE LAMP ROOM  —  CRYSTAL GALLERY  —  THE VAULT
 *                              |                |
 *     THE LONG DRIFT —  THE PUMP HOUSE  —  CAGE SHAFT
 *            |                                  |
 *     MINER'S REST   —  POWDER STORE    —  THE DEEP CUT
 *
 * Horizontal neighbours join at floor level through the doorways `World` cuts;
 * verticals join through the ladder shaft in the middle columns. Only the links
 * drawn above exist — the graph is deliberately not a full lattice, so reaching
 * the Vault means working out a route rather than walking diagonally to it.
 *
 * DESIGNING FOR NO JUMP
 * ---------------------
 * Every room here obeys four rules. `scripts/validate-world.mjs` checks the
 * first three by walking the room the way the player has to.
 *
 *   1. **Up is always earned.** The only ways to gain height are a ladder, a
 *      hanging rope, or a lift. There is no arrangement of platforms that can be
 *      climbed, so a ledge without a ladder to it is scenery.
 *   2. **Every ledge is on the level grid.** Surfaces sit five rows apart, which
 *      is exactly `C.FALL_SAFE`, so stepping off any one of them onto the next
 *      is free. The player never has to judge a drop.
 *   3. **Every rope crosses a ladder.** A rope is boarded by stepping sideways
 *      off a ladder that runs through its row. A rope nothing reaches is a
 *      decoration, and a decoration that looks like a route is a bug.
 *   4. **Nothing is one-way without a way back.** A drop you cannot climb out of
 *      is only allowed where the room below links onward — otherwise the fuse
 *      burns while the player is stranded, which reads as a broken game rather
 *      than a hard one.
 *
 * Twelve sticks of TNT are spread across the nine rooms; the Vault holds none,
 * only the plunger.
 */
(function (TNT) {
    'use strict';

    const ROOMS = [

        /* ============================================================== *
         * Bottom band
         * ============================================================== */

        {
            id: 'minersRest',
            name: "MINER'S REST",
            cell: [0, 2],
            exits: { right: true, up: true },
            tnt: 2,
            /**
             * The opening room, and the one that teaches the whole movement
             * vocabulary without saying anything: a ladder to the mezzanine, a
             * rope boarded off the main shaft, and a first drop that is safe by
             * construction. Nothing here can kill you.
             */
            build: function (g) {
                g.food(15, 22);
                g.ore(8, 22, 3, 2);
                g.walker(31, 22);

                // Mezzanines either side of the shaft.
                g.shelf(3, 10, 18, 23, 4);
                g.shelf(29, 10, 18, 23, 37);

                // Tommy starts clear of the ladder foot, facing the room.
                g.spawn(6, 22);
                g.ore(6, 17, 3, 2);
                g.ore(32, 17, 3, 2);

                // The winding rope over the shed floor. Boarded off the shaft,
                // and both ends land on a mezzanine three rows down.
                g.rope(8, 33, 15);

                // Gallery level, straight off the shaft.
                g.plat(14, 13, 13);
                g.tnt(17, 12);
                g.ore(24, 12, 2, 2);
                g.bat(29, 12);

                // Roof beams.
                g.plat(12, 8, 7);
                g.plat(23, 8, 7);
                g.ladder(16, 8, 12);
                g.ladder(25, 8, 12);
                g.tnt(14, 7);
                g.ore(26, 7, 2, 2);

                g.shaft();
            }
        },

        {
            id: 'powderStore',
            name: 'POWDER STORE',
            cell: [1, 2],
            exits: { left: true, right: true },
            tnt: 2,
            /**
             * A corridor room with a spike bed across the middle of the floor.
             * Two answers: the rope at row 19, which is safe and slow, or the
             * crumbling planks below it, which are quick and give way. Both are
             * boarded from the same ladder, so the choice is made in the open.
             */
            build: function (g) {
                g.spikes(15, 22, 12);
                g.food(8, 22);
                g.ore(2, 22, 2, 2);
                g.ore(37, 22, 2, 2);
                g.walker(33, 22);

                // The two towers that bracket the pit.
                g.plat(9, 18, 6);
                g.plat(27, 18, 6);
                g.ladder(12, 18, 22);
                g.ladder(29, 18, 22);

                // High road and low road across the spikes.
                g.rope(12, 29, 19);
                g.crumble(16, 20, 10);

                // Conveyor deck. Both belts run inward, so the deck gathers you
                // toward the middle staging and the ladder heads at each end are
                // walked *against* the belt — slow going, with the fuse burning.
                g.belt(5, 13, 12, 1);
                g.belt(25, 13, 12, -1);
                g.plat(17, 13, 8);
                // Down to the floor, not to the staging: a ladder whose foot is
                // over thin air can only be climbed *down*, and one that ends
                // level with nothing is just a hole with rungs in it.
                g.ladder(6, 13, 22);
                g.ladder(35, 13, 22);
                g.tnt(20, 12);
                g.ore(9, 12, 3, 2);
                g.ore(29, 12, 3, 2);
                g.crawler(23, 12);

                // Powder shelf under the roof.
                g.plat(14, 8, 14);
                g.ladder(18, 8, 12);
                g.tnt(24, 7);
                g.food(16, 7);
                g.bat(30, 7);
            }
        },

        {
            id: 'deepCut',
            name: 'THE DEEP CUT',
            cell: [2, 2],
            exits: { left: true, up: true },
            tnt: 2,
            /**
             * The flooded end of the mine. The sump on the right drowns you
             * without the tank, and the tank is on the far side of it — so the
             * first visit is a look, and the second is the errand.
             */
            build: function (g) {
                g.water(27, 20, 13, 3);
                g.tnt(33, 22);
                g.food(5, 22);
                g.ore(8, 22, 3, 2);
                g.walker(15, 22);

                // Ceiling droppers over the walk in.
                g.boulder(11, 1);
                g.boulder(17, 1);

                // Dry ledges on the left.
                g.shelf(3, 9, 18, 23, 4);
                g.ore(6, 17, 3, 2);

                // The gantry over the sump. Its ladder goes down into the water,
                // which is the whole errand: the stick is on the bottom.
                g.plat(26, 18, 12);
                g.ladder(28, 18, 22);
                g.crawler(34, 17);

                // The tank is kept dry on the upper shelf, so the sump is a lock
                // and the shelf holds its key — never the other way round.
                g.plat(12, 13, 14);
                g.ladder(14, 13, 22);
                g.oxygen(24, 12);
                g.tnt(22, 12);
                g.ore(17, 12, 3, 2);

                g.rope(9, 26, 15);
                g.bat(19, 16);

                g.shaft();
            }
        },

        /* ============================================================== *
         * Middle band
         * ============================================================== */

        {
            id: 'longDrift',
            name: 'THE LONG DRIFT',
            cell: [0, 1],
            exits: { right: true, down: true },
            tnt: 1,
            /**
             * A haulage drift with a lava channel cut across it. The channel is
             * too wide to walk and has no floor to drop to, so the only way over
             * is the tram — the first room where a lift is the route rather than
             * a shortcut.
             */
            build: function (g) {
                // The channel is cut through the bedrock itself, so the floor
                // either side stays at walking height and the tram can run flush
                // with it. Lava sitting *on* the floor would mean stepping up
                // onto the tram, and there is no step-up in this game.
                g.lava(10, 23, 10, 1);
                g.liftRunH(6, 22, 22);
                g.food(4, 22);
                g.ore(24, 22, 4, 2);
                g.walker(33, 22);

                g.plat(3, 18, 7);
                g.plat(22, 18, 10);
                g.ladder(5, 18, 22);
                g.ladder(24, 18, 22);
                g.ore(26, 17, 3, 2);
                g.bat(15, 17);

                // Upper haulage, with the belts carrying spoil to the shaft.
                g.belt(4, 13, 14, 1);
                g.plat(18, 13, 16);
                g.ladder(31, 13, 17);
                g.tnt(8, 12);
                g.ore(26, 12, 3, 2);
                g.crawler(35, 12);

                g.plat(6, 8, 10);
                g.ladder(9, 8, 12);
                g.food(12, 7);
                g.ore(6, 7, 2, 2);

                g.shaft();
            }
        },

        {
            id: 'pumpHouse',
            name: 'THE PUMP HOUSE',
            cell: [1, 1],
            exits: { left: true, right: true, up: true },
            tnt: 1,
            /**
             * Machinery. Two pistons on the floor and a pair of steam vents that
             * scald rather than lift — nothing in this game gives you height for
             * free. The room is a timing puzzle laid across a straight walk.
             */
            build: function (g) {
                // Pistons hang where they can reach a walkway. A crusher bolted
                // to the roof of a room whose roof is six tiles of open air
                // slams into nothing, forever — the head has to rest within its
                // travel of a surface someone actually walks on.
                g.crusher(9, 19);
                g.crusher(31, 19);
                g.vent(15, 22);
                g.vent(25, 22);
                g.food(4, 22);
                g.ore(35, 22, 3, 2);

                g.plat(3, 18, 8);
                g.plat(30, 18, 9);
                g.ladder(5, 18, 22);
                g.ladder(36, 18, 22);
                g.ore(7, 17, 2, 2);
                g.crawler(33, 17);

                // The boiler deck, reached off the shaft.
                g.plat(12, 13, 17);
                g.ladder(13, 13, 22);
                g.ladder(28, 13, 22);
                g.tnt(24, 12);
                g.ore(15, 12, 3, 2);
                g.walker(21, 12);

                // Roof gantries, joined by a rope over the shaft.
                g.plat(6, 8, 8);
                g.plat(28, 8, 8);
                g.ladder(11, 8, 12);
                g.rope(11, 30, 6);
                g.ladder(30, 8, 12);
                g.food(8, 7);
                g.ore(31, 7, 3, 2);
                g.bat(20, 10);

                g.shaft();
            }
        },

        {
            id: 'cageShaft',
            name: 'CAGE SHAFT',
            cell: [2, 1],
            exits: { left: true, up: true, down: true },
            tnt: 1,
            /**
             * The winding cage, and the spine of the mine: the only room linked
             * both up and down.
             *
             * The cage runs in its own headframe on the left rather than in the
             * link shaft. Putting it in the link shaft was the first idea and it
             * does not work — the cage and the ladder would occupy the same
             * columns, so a rider and a climber collide, and arriving from the
             * room above drops you into a moving platform. Off to one side it is
             * a route you choose, and the ladder still gets you home if you would
             * rather not wait for it.
             */
            build: function (g) {
                g.food(12, 22);
                g.ore(14, 22, 3, 2);
                g.walker(31, 22);

                // The headframe: a capped shaft the width of the cage. The
                // right-hand cheek is cut away at each standing row and nowhere
                // else, so the cage can be stepped off at a landing and the
                // shaft is a wall everywhere it should be.
                // Stops short of the floor: the left doorway arrives at rows 20
                // to 22 and has to reach the cage bay, so the cheek cannot run
                // all the way down or the room is sealed from its own entrance.
                g.rock(3, 7, 1, 13);
                g.rock(3, 6, 6, 1);
                g.rock(8, 8, 1, 4);
                g.rock(8, 13, 1, 4);
                g.rock(8, 18, 1, 4);
                g.liftRunV(4, 22, 7);

                // Left staging, each landing abutting the headframe.
                g.plat(9, 18, 8);
                g.plat(9, 13, 8);
                g.plat(9, 8, 8);
                g.ore(11, 17, 3, 2);
                g.crawler(15, 12);
                g.food(12, 7);

                // Right staging, off ladders from the floor.
                g.plat(24, 18, 9);
                g.plat(24, 13, 10);
                g.plat(24, 8, 10);
                g.ladder(26, 18, 22);
                g.ladder(28, 13, 17);
                g.ladder(30, 8, 12);
                g.ore(29, 17, 2, 2);
                g.tnt(31, 12);
                g.ore(25, 7, 3, 2);
                g.bat(19, 15);

                // The high rope, boarded off the right-hand ladder and landing
                // on the top-left staging — the cage's reward for the wait.
                g.rope(11, 30, 10);

                g.shaft();
            }
        },

        /* ============================================================== *
         * Top band
         * ============================================================== */

        {
            id: 'lampRoom',
            name: 'THE LAMP ROOM',
            cell: [0, 0],
            exits: { right: true },
            tnt: 1,
            /**
             * A dead end, and the only room in the mine that is a reward rather
             * than an obstacle: the spare helmet is here. The fissure in the
             * back wall is what makes it worth the walk twice — the first stick
             * of dynamite you can afford to spend goes here.
             */
            build: function (g) {
                g.food(8, 22);
                g.ore(11, 22, 4, 2);
                g.crawler(22, 22);

                // The sealed pocket, at the dead end of a dead end. Rock over
                // the top of it and a fissure across the front: no amount of
                // steering a fall gets in there, which is the point — this is
                // the room that teaches you what the dynamite is *for*.
                g.rock(1, 19, 5, 1);
                g.cracked(4, 20, 2, 3);
                g.heart(2, 22);

                g.plat(6, 18, 9);
                g.ladder(8, 18, 22);
                g.ore(10, 17, 3, 2);

                g.plat(26, 18, 13);
                g.ladder(34, 18, 22);
                g.ore(29, 17, 3, 2);

                g.plat(14, 13, 17);
                g.ladder(28, 13, 17);
                g.food(20, 12);
                g.bat(24, 12);

                g.plat(8, 8, 15);
                g.ladder(18, 8, 12);
                g.tnt(12, 7);
                g.ore(15, 7, 3, 2);

                // One way down to the west staging, and no way back up it.
                g.rope(10, 28, 15);
            }
        },

        {
            id: 'crystalGallery',
            name: 'CRYSTAL GALLERY',
            cell: [1, 0],
            exits: { left: true, right: true, down: true },
            tnt: 2,
            /**
             * A natural cavern rather than a working, so it is hung with ropes
             * instead of fitted with ladders — slower to climb, and the room is
             * built tall to make you feel it. Two of the twelve sticks are up in
             * the roof.
             */
            build: function (g) {
                g.food(5, 22);
                g.ore(8, 22, 4, 2);
                g.walker(30, 22);
                g.spikes(24, 22, 5);

                g.plat(3, 18, 9);
                g.plat(30, 18, 9);
                g.vine(5, 18, 22);
                g.vine(33, 18, 22);
                g.ore(7, 17, 3, 2);
                g.crawler(35, 17);

                g.plat(9, 13, 10);
                g.plat(24, 13, 10);
                g.vine(11, 13, 17);
                g.vine(31, 13, 17);
                g.tnt(26, 12);
                g.ore(14, 12, 2, 2);

                // The roof span, crossed on a rope strung over the shaft.
                g.plat(6, 8, 9);
                g.plat(28, 8, 9);
                g.vine(13, 8, 12);
                g.vine(29, 8, 12);
                g.rope(13, 29, 6);
                g.tnt(8, 7);
                g.food(31, 7);
                g.bat(19, 10);
                g.orb(16, 17);

                g.shaft();
            }
        },

        {
            id: 'vault',
            name: 'THE VAULT',
            cell: [2, 0],
            exits: { left: true, down: true },
            tnt: 0,
            /**
             * The plunger, and nothing else worth carrying. Reachable two ways —
             * along the top band from the Crystal Gallery, or straight up the
             * cage — so a player who has lost track of the map still has a route.
             */
            build: function (g) {
                g.detonator(33, 22);
                g.food(5, 22);
                g.ore(8, 22, 3, 2);
                // The last thing between you and the plunger.
                g.crusher(30, 19);

                g.plat(3, 18, 10);
                g.ladder(5, 18, 22);
                g.ore(8, 17, 2, 2);

                g.plat(26, 18, 12);
                g.ladder(28, 18, 22);
                g.crawler(34, 17);

                g.plat(9, 13, 24);
                g.ladder(11, 13, 17);
                g.ladder(30, 13, 17);
                g.food(18, 12);
                g.ore(24, 12, 3, 2);

                g.plat(6, 8, 12);
                g.ladder(9, 8, 12);
                g.ore(13, 7, 3, 2);
                g.bat(22, 10);

                g.shaft();
            }
        }
    ];

    TNT.Rooms = { MINE1: ROOMS };
})(window.TNT = window.TNT || {});

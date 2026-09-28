// A small block world in memory for unit tests (spec v0.1.4.6, parts A and H).
//
// Blocks are stored by name only. Positions that were never set are air, or the flat
// ground when `flatGround` was called. Positions outside the loaded region give null,
// like a chunk that is not loaded.
//
// The world has no imports on purpose: tests of pure modules can use it without
// pulling in mineflayer or anything else.
//
// Typical use:
//     const world = createBlockWorld().flatGround(63);
//     const house = world.house({ x: 0, y: 63, z: 0 });
//     scanBuilding(world.getBlockName, house.inside);
//     const bot = { blockAt: (pos) => world.blockAt(pos) };

/** @typedef {{x: number, y: number, z: number}} Pos */

/** Names that count as air. */
export const AIR_NAMES = Object.freeze(['air', 'cave_air', 'void_air']);

function key(x, y, z) {
    return `${x},${y},${z}`;
}

function assertInt(value, label) {
    if (!Number.isInteger(value)) {
        throw new TypeError(`${label} must be a whole number, got ${value}`);
    }
}

/**
 * A position object with the few Vec3 methods that code under test tends to call.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {Pos & {offset: Function, plus: Function, floored: Function, clone: Function, distanceTo: Function, equals: Function}}
 */
export function vec(x, y, z) {
    return {
        x,
        y,
        z,
        offset(dx, dy, dz) {
            return vec(this.x + dx, this.y + dy, this.z + dz);
        },
        plus(other) {
            return vec(this.x + other.x, this.y + other.y, this.z + other.z);
        },
        floored() {
            return vec(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
        },
        clone() {
            return vec(this.x, this.y, this.z);
        },
        distanceTo(other) {
            return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
        },
        equals(other) {
            return !!other && this.x === other.x && this.y === other.y && this.z === other.z;
        },
        toString() {
            return `(${this.x}, ${this.y}, ${this.z})`;
        },
    };
}

/**
 * The block world. Create it with `createBlockWorld()`.
 */
export class BlockWorld {
    /**
     * @param {{loaded?: {min: Pos, max: Pos}|null}} [options]
     *   loaded: only positions inside this box are loaded, all others give null.
     */
    constructor(options = {}) {
        this._blocks = new Map();
        this._properties = new Map();
        this._ground = null;
        this._loaded = options.loaded ?? null;
        /**
         * The name of the block at a position, or null if it is not loaded.
         * Bound to this world, so it can be passed on alone: `scanBuilding(world.getBlockName, ...)`.
         * @type {(x: number, y: number, z: number) => string|null}
         */
        this.getBlockName = (x, y, z) => this.get(x, y, z);
    }

    /**
     * Endless flat ground: `top` at height y, `below` under it. Blocks set later win.
     * @param {number} [y=63]
     * @param {string} [top='grass_block']
     * @param {string} [below='dirt']
     * @returns {BlockWorld} this
     */
    flatGround(y = 63, top = 'grass_block', below = 'dirt') {
        assertInt(y, 'y');
        this._ground = { y, top, below };
        return this;
    }

    /**
     * Sets the loaded region. Outside of it `get` gives null. null loads everything.
     * @param {{min: Pos, max: Pos}|null} box
     * @returns {BlockWorld} this
     */
    setLoaded(box) {
        this._loaded = box ?? null;
        return this;
    }

    /** @returns {boolean} true if the position is loaded */
    isLoaded(x, y, z) {
        const box = this._loaded;
        if (!box) return true;
        return x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y
            && z >= box.min.z && z <= box.max.z;
    }

    /**
     * Sets one block. Coordinates are whole numbers.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {string} name block name, for example 'oak_planks'
     * @param {object|null} [properties] block state, for example { half: 'lower', open: false }
     * @returns {BlockWorld} this
     */
    set(x, y, z, name, properties = null) {
        assertInt(x, 'x');
        assertInt(y, 'y');
        assertInt(z, 'z');
        if (typeof name !== 'string' || name === '') {
            throw new TypeError('A block name must be a non-empty string');
        }
        const k = key(x, y, z);
        this._blocks.set(k, name);
        if (properties) this._properties.set(k, { ...properties });
        else this._properties.delete(k);
        return this;
    }

    /**
     * Fills the box between two corners (in any order, both included) with one block.
     * @returns {BlockWorld} this
     */
    fill(x1, y1, z1, x2, y2, z2, name) {
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
                    this.set(x, y, z, name);
                }
            }
        }
        return this;
    }

    /**
     * Name of the block at a position. Not set: air, or the flat ground. Not loaded: null.
     * Fractional coordinates are floored.
     * @returns {string|null}
     */
    get(x, y, z) {
        x = Math.floor(x);
        y = Math.floor(y);
        z = Math.floor(z);
        if (!this.isLoaded(x, y, z)) return null;
        const name = this._blocks.get(key(x, y, z));
        if (name !== undefined) return name;
        const ground = this._ground;
        if (ground) {
            if (y === ground.y) return ground.top;
            if (y < ground.y) return ground.below;
        }
        return 'air';
    }

    /** @returns {boolean} true if the block at the position is air */
    isAir(x, y, z) {
        return AIR_NAMES.includes(this.get(x, y, z));
    }

    /**
     * The block at a position in the shape of a mineflayer block, or null if not loaded:
     * `{ name, position, _properties, getProperties() }`. `position` is a `vec`.
     * @param {Pos} pos
     * @returns {{name: string, position: object, _properties: object, getProperties: () => object}|null}
     */
    blockAt(pos) {
        const x = Math.floor(pos.x);
        const y = Math.floor(pos.y);
        const z = Math.floor(pos.z);
        const name = this.get(x, y, z);
        if (name === null) return null;
        const properties = { ...(this._properties.get(key(x, y, z)) ?? {}) };
        return {
            name,
            position: vec(x, y, z),
            _properties: properties,
            getProperties: () => ({ ...properties }),
        };
    }

    /**
     * Positions of all blocks that were set explicitly and match.
     * @param {string|((name: string) => boolean)} match a name or a test
     * @returns {Pos[]} sorted by x, then y, then z
     */
    positionsOf(match) {
        const test = typeof match === 'function' ? match : (name) => name === match;
        const found = [];
        for (const [k, name] of this._blocks) {
            if (!test(name)) continue;
            const [x, y, z] = k.split(',').map(Number);
            found.push({ x, y, z });
        }
        return found.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
    }

    /**
     * Copies all explicitly set blocks, for "is everything still there" checks.
     * @returns {Map<string, string>} "x,y,z" to name
     */
    snapshot() {
        return new Map(this._blocks);
    }

    /**
     * Builds a house. The footprint starts at (x, z) and grows to +x and +z.
     *
     * Layout, with y the floor level:
     * - floor of `floor` at y over the whole footprint (null: no floor);
     * - walls of `wall` from y+1 to y+wallHeight, corner posts of `post` (null: wall material);
     * - roof of `roof` at y+wallHeight+1 over the whole footprint (null: no roof);
     * - a two block door in the middle of the `door` side ('south' is +z; null: no door);
     * - windows of `glass` at y+2 in the middle of the two walls beside the door wall;
     * - inside: a bed of two blocks along the north wall at the west end, a chest at the east end.
     *
     * @param {{x: number, y: number, z: number, width?: number, depth?: number, wallHeight?: number,
     *   floor?: string|null, wall?: string, post?: string|null, roof?: string|null,
     *   door?: 'south'|'north'|'east'|'west'|null, doorName?: string, glass?: string|null,
     *   bed?: string|null, chest?: string|null}} options
     * @returns {{min: Pos, max: Pos, door: Pos|null, inside: Pos, bed: Pos[]|null, chest: Pos|null,
     *   windows: Pos[], interior: {min: Pos, max: Pos}}}
     *   min and max enclose every block of the house; door is the lower door block;
     *   inside is a free standing position in the middle of the room.
     */
    house(options) {
        const {
            x, y, z,
            width = 7, depth = 7, wallHeight = 3,
            floor = 'oak_planks', wall = 'oak_planks', post = 'oak_log', roof = 'oak_planks',
            door = 'south', doorName = 'oak_door', glass = 'glass_pane',
            bed = 'red_bed', chest = 'chest',
        } = options;
        assertInt(x, 'x');
        assertInt(y, 'y');
        assertInt(z, 'z');
        if (width < 5 || depth < 5 || wallHeight < 2) {
            throw new RangeError('A house needs width and depth of at least 5 and walls of at least 2');
        }
        const x0 = x;
        const x1 = x + width - 1;
        const z0 = z;
        const z1 = z + depth - 1;
        const top = y + wallHeight;
        const cx = Math.floor((x0 + x1) / 2);
        const cz = Math.floor((z0 + z1) / 2);

        if (floor) this.fill(x0, y, z0, x1, y, z1, floor);
        for (let yy = y + 1; yy <= top; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
                this.set(xx, yy, z0, wall);
                this.set(xx, yy, z1, wall);
            }
            for (let zz = z0; zz <= z1; zz++) {
                this.set(x0, yy, zz, wall);
                this.set(x1, yy, zz, wall);
            }
            this.fill(x0 + 1, yy, z0 + 1, x1 - 1, yy, z1 - 1, 'air');
            if (post) {
                for (const [px, pz] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) this.set(px, yy, pz, post);
            }
        }
        if (roof) this.fill(x0, top + 1, z0, x1, top + 1, z1, roof);

        let doorPos = null;
        const windows = [];
        const doorAt = { south: [cx, z1], north: [cx, z0], east: [x1, cz], west: [x0, cz] };
        if (door) {
            if (!doorAt[door]) throw new TypeError(`Unknown door side ${door}`);
            const [dx, dz] = doorAt[door];
            this.set(dx, y + 1, dz, doorName, { half: 'lower', open: false });
            this.set(dx, y + 2, dz, doorName, { half: 'upper', open: false });
            doorPos = { x: dx, y: y + 1, z: dz };
        }
        if (glass) {
            const sides = door === 'east' || door === 'west' ? [[cx, z0], [cx, z1]] : [[x0, cz], [x1, cz]];
            for (const [wx, wz] of sides) {
                this.set(wx, y + 2, wz, glass);
                windows.push({ x: wx, y: y + 2, z: wz });
            }
        }
        let bedPos = null;
        if (bed) {
            this.set(x0 + 1, y + 1, z0 + 1, bed, { part: 'head' });
            this.set(x0 + 2, y + 1, z0 + 1, bed, { part: 'foot' });
            bedPos = [{ x: x0 + 1, y: y + 1, z: z0 + 1 }, { x: x0 + 2, y: y + 1, z: z0 + 1 }];
        }
        let chestPos = null;
        if (chest) {
            this.set(x1 - 1, y + 1, z0 + 1, chest);
            chestPos = { x: x1 - 1, y: y + 1, z: z0 + 1 };
        }
        return {
            min: { x: x0, y: floor ? y : y + 1, z: z0 },
            max: { x: x1, y: roof ? top + 1 : top, z: z1 },
            door: doorPos,
            inside: { x: cx, y: y + 1, z: cz },
            bed: bedPos,
            chest: chestPos,
            windows,
            interior: { min: { x: x0 + 1, y: y + 1, z: z0 + 1 }, max: { x: x1 - 1, y: top, z: z1 - 1 } },
        };
    }

    /**
     * Builds a tree: `soil` at (x, y, z), a trunk of `log` from y+1 to y+height, and leaves
     * around the top. Leaves never replace a block that is not air.
     * @param {{x: number, y: number, z: number, height?: number, log?: string, leaves?: string, soil?: string}} options
     * @returns {{soil: Pos, trunk: Pos[], top: Pos, leaves: Pos[]}}
     */
    tree(options) {
        const { x, y, z, height = 5, log = 'oak_log', leaves = 'oak_leaves', soil = 'dirt' } = options;
        assertInt(x, 'x');
        assertInt(y, 'y');
        assertInt(z, 'z');
        this.set(x, y, z, soil);
        const trunk = [];
        for (let yy = y + 1; yy <= y + height; yy++) {
            this.set(x, yy, z, log);
            trunk.push({ x, y: yy, z });
        }
        const placed = [];
        const leaf = (lx, ly, lz) => {
            if (!this.isAir(lx, ly, lz)) return;
            this.set(lx, ly, lz, leaves);
            placed.push({ x: lx, y: ly, z: lz });
        };
        const topY = y + height;
        for (const ly of [topY - 1, topY]) {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
                    leaf(x + dx, ly, z + dz);
                }
            }
        }
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) leaf(x + dx, topY + 1, z + dz);
        return { soil: { x, y, z }, trunk, top: { x, y: topY, z }, leaves: placed };
    }

    /**
     * Builds a fenced field. The inner ground runs from (x, z) to (x+width-1, z+depth-1) at
     * height y, with `crop` on it. The fence stands at y+1 on the ring around the ground,
     * only where there is air; the gate replaces whatever is there.
     * @param {{x: number, y: number, z: number, width?: number, depth?: number,
     *   ground?: string, crop?: string|null, fence?: string, gate?: string|null,
     *   gateSide?: 'south'|'north'|'east'|'west', sides?: {north?: string|null, south?: string|null,
     *   east?: string|null, west?: string|null}, gaps?: Pos[]}} options
     *   sides: another block for a whole side (for example 'cobblestone_wall'), null for none.
     *   gaps: fence positions to leave open (air).
     * @returns {{min: Pos, max: Pos, ring: {min: Pos, max: Pos}, gate: Pos|null, inside: Pos}}
     *   min and max are the inner ground; ring encloses the fence; inside is a standing position.
     */
    field(options) {
        const {
            x, y, z, width = 5, depth = 5,
            ground = 'farmland', crop = 'wheat', fence = 'oak_fence', gate = 'oak_fence_gate',
            gateSide = 'south', sides = {}, gaps = [],
        } = options;
        assertInt(x, 'x');
        assertInt(y, 'y');
        assertInt(z, 'z');
        const x0 = x - 1;
        const x1 = x + width;
        const z0 = z - 1;
        const z1 = z + depth;
        const fy = y + 1;
        this.fill(x, y, z, x + width - 1, y, z + depth - 1, ground);
        if (crop) this.fill(x, fy, z, x + width - 1, fy, z + depth - 1, crop);
        const sideBlock = (side) => (Object.prototype.hasOwnProperty.call(sides, side) ? sides[side] : fence);
        // The fence never replaces a block that is not air, so a field can lean against a house.
        const put = (px, pz, side) => {
            const name = sideBlock(side);
            if (name && this.isAir(px, fy, pz)) this.set(px, fy, pz, name);
        };
        for (let xx = x0; xx <= x1; xx++) {
            put(xx, z0, 'north');
            put(xx, z1, 'south');
        }
        for (let zz = z0 + 1; zz <= z1 - 1; zz++) {
            put(x0, zz, 'west');
            put(x1, zz, 'east');
        }
        let gatePos = null;
        if (gate) {
            const cx = x + Math.floor((width - 1) / 2);
            const cz = z + Math.floor((depth - 1) / 2);
            const at = { south: [cx, z1], north: [cx, z0], east: [x1, cz], west: [x0, cz] }[gateSide];
            this.set(at[0], fy, at[1], gate, { open: false });
            gatePos = { x: at[0], y: fy, z: at[1] };
        }
        for (const gap of gaps) this.set(gap.x, gap.y ?? fy, gap.z, 'air');
        return {
            min: { x, y, z },
            max: { x: x + width - 1, y, z: z + depth - 1 },
            ring: { min: { x: x0, y: fy, z: z0 }, max: { x: x1, y: fy, z: z1 } },
            gate: gatePos,
            inside: { x: x + Math.floor((width - 1) / 2), y: fy, z: z + Math.floor((depth - 1) / 2) },
        };
    }
}

/**
 * Creates an empty block world (everything air, everything loaded).
 * @param {{loaded?: {min: Pos, max: Pos}|null}} [options]
 * @returns {BlockWorld}
 */
export function createBlockWorld(options = {}) {
    return new BlockWorld(options);
}

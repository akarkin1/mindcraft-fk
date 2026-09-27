// Shared fakes for the skill tests of v0.1.4.4 (spec K9): the fake endowments of the code
// sandbox (skills, world, a small Vec3 class, log), a fake bot and an inventory counter.
export class FakeVec3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

// A fresh set of endowments per call, so no test sees objects of another test.
export function makeEndowments() {
    return {
        skills: { wait: async () => true },
        world: {},
        Vec3: FakeVec3,
        log: (bot, text) => {
            bot.output += text + '\n';
        },
    };
}

export function makeBot(overrides = {}) {
    return {
        username: 'andy',
        output: '',
        interrupt_code: false,
        entity: { position: { x: 0, y: 64, z: 0 } },
        health: 20,
        food: 20,
        inv: {},
        ...overrides,
    };
}

// getInventoryCounts for the fake bot.
export const inventoryOf = (bot) => ({ ...bot.inv });

// Body lines indented by 4 spaces inside an async function with the given parameters.
export function fnSource(name, bodyLines, params = 'bot') {
    return `async function ${name}(${params}) {\n${bodyLines.map((l) => '    ' + l).join('\n')}\n}\n`;
}

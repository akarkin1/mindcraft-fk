// Command line entry of the reset tool. Moves saved bot data into ./bots/_archive, never deletes it.
// Usage: npm run bot:reset -- <name> [--world <key or label>] [--memory] [--places] [--skills] [--all] [--dry-run]
import { planReset, applyReset } from '../src/utils/bot_reset.js';

const USAGE = 'Usage: npm run bot:reset -- <name> [--world <key or label>] [--memory] [--places] [--skills] [--all] [--dry-run]';

const FLAGS = {
    '--memory': 'memory',
    '--places': 'places',
    '--skills': 'skills',
    '--all': 'all',
    '--dry-run': 'dryRun',
};

function parseArgs(argv) {
    const options = { name: undefined, world: undefined, memory: false, places: false, skills: false, all: false, dryRun: false, help: false };
    const errors = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (Object.hasOwn(FLAGS, arg)) {
            options[FLAGS[arg]] = true;
        } else if (arg === '--world') {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) {
                errors.push('Missing value for --world.');
            } else {
                options.world = value;
                i++;
            }
        } else if (arg.startsWith('--world=')) {
            options.world = arg.slice('--world='.length);
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg.startsWith('-')) {
            errors.push(`Unknown option ${arg}.`);
        } else if (options.name === undefined) {
            options.name = arg;
        } else {
            errors.push(`Unexpected argument "${arg}".`);
        }
    }
    return { options, errors };
}

function main(argv) {
    const { options, errors } = parseArgs(argv);
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    if (errors.length > 0) {
        for (const error of errors) {
            console.error(`Error: ${error}`);
        }
        console.error(USAGE);
        return 1;
    }

    console.log('Stop the bot before you reset its data: a running bot writes its files again.');

    const plan = planReset({
        botsDir: './bots',
        name: options.name,
        memory: options.memory,
        places: options.places,
        skills: options.skills,
        all: options.all,
        world: options.world,
    });
    if (plan.errors.length > 0) {
        for (const error of plan.errors) {
            console.error(`Error: ${error}`);
        }
        console.error(USAGE);
        return 1;
    }
    if (plan.moves.length === 0 && plan.removeWorldKeys.length === 0) {
        console.log('Nothing to move.');
        return 0;
    }

    console.log(`Plan${options.dryRun ? ' (dry run)' : ''}: archive directory ${plan.archiveDir}`);
    for (const move of plan.moves) {
        console.log(`  move ${move.from} -> ${move.to}`);
    }
    for (const key of plan.removeWorldKeys) {
        console.log(`  forget world ${key} in worlds/index.json`);
    }
    if (options.dryRun) {
        console.log('Dry run: nothing was moved.');
        return 0;
    }

    const result = applyReset(plan);
    for (const move of result.moved) {
        console.log(`Moved ${move.from} -> ${move.to}`);
    }
    for (const move of result.failed) {
        console.error(`FAILED ${move.from} -> ${move.to}: ${move.error}`);
    }
    if (result.failed.length > 0) {
        console.error(`${result.failed.length} move(s) failed. Stop the bot, close programs that use these files and run the command again.`);
        return 1;
    }
    console.log(`Done: ${result.moved.length} item(s) moved to ${plan.archiveDir}.`);
    return 0;
}

process.exitCode = main(process.argv.slice(2));

// Module customization hook (registered with node:module register()) for command tests.
//
// src/utils/mcdata.js keeps its minecraft-data object in a module variable that is only set
// when a real bot logs in, so !stats (world.getBiomeName -> mc.getAllBiomes()) cannot run in a
// unit test. This hook appends one test-only export to that module when it is loaded:
//     export function __setMcdataForTests(value)
// The module's own code is not changed.
export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (url.replace(/\\/g, '/').endsWith('/src/utils/mcdata.js') && result.format === 'module' && result.source != null) {
        const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
        return {
            ...result,
            source: `${source}\nexport function __setMcdataForTests(value) { mcdata = value; }\n`,
        };
    }
    return result;
}

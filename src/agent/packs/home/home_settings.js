// Settings of the home pack (spec v0.1.4.6 section 1), read with their defaults. Pure.

/**
 * Default of `home_reflexes` when the key or one of its entries is absent. `hunger` came with
 * v0.1.4.8 (spec section 2).
 */
export const HOME_REFLEX_DEFAULTS = Object.freeze({ door_closing: true, night_shelter: true, creeper_safety: true, hunger: true });

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The home settings with their defaults: `home_pack` false, every reflex true, `creeper_fighting`
 * false. A value of the wrong type counts as the default.
 * @param {object} settings the settings object
 * @returns {{home_pack: boolean, reflexes: {door_closing: boolean, night_shelter: boolean, creeper_safety: boolean, hunger: boolean}, creeper_fighting: boolean}}
 */
export function readHomeSettings(settings) {
    const s = isPlainObject(settings) ? settings : {};
    const given = isPlainObject(s.home_reflexes) ? s.home_reflexes : {};
    const reflexes = {};
    for (const [name, fallback] of Object.entries(HOME_REFLEX_DEFAULTS)) {
        reflexes[name] = typeof given[name] === 'boolean' ? given[name] : fallback;
    }
    return {
        home_pack: s.home_pack === true,
        reflexes,
        creeper_fighting: s.creeper_fighting === true,
    };
}

/**
 * True when `home_pack` is on and the reflex is on. Unknown reflexes are off.
 * @param {object} settings
 * @param {'door_closing'|'night_shelter'|'creeper_safety'|'hunger'} name
 * @returns {boolean}
 */
export function reflexOn(settings, name) {
    const s = readHomeSettings(settings);
    return s.home_pack && Object.prototype.hasOwnProperty.call(s.reflexes, name) && s.reflexes[name] === true;
}

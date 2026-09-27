// Skill learning of one bot: keeps the SkillStore in bots/<name>/skills, loads
// the active skills into the code sandbox as `customSkills`, builds the prompt
// sections and turns a successful code run into a saved skill after a review by
// the model. Everything it needs from the agent (sandbox, endowments, inventory,
// prompter, settings) is passed in; no side effects at import.
import { SkillStore } from './skill_store.js';
import { validateSkill } from './skill_validator.js';
import {
    parseGeneratedCode,
    pickSkillCandidate,
    getDocBlock,
    firstDocLine,
    ensureDocBlock,
    signatureOf,
    instrument,
    isSingleFunction,
} from './skill_source.js';
import { loadSkills } from './skill_loader.js';
import { snapshotState, diffState, buildReviewPrompt, parseReview } from './skill_review.js';
import { buildCodingSection, buildConversingSection } from './skill_prompt.js';

const NO_RESPONSE = '//no response';
const NO_SKILLS = 'No skills are saved yet.';

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function errorText(error) {
    try {
        return String(error);
    } catch {
        return '[unprintable error]';
    }
}

function warningText(error) {
    try {
        return error?.message ?? String(error);
    } catch {
        return '[unprintable error]';
    }
}

function notSaved(reason, name = null, errors = []) {
    return { saved: false, action: null, name, reason, errors, message: '' };
}

function countText(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0';
}

/**
 * Which parts of skill learning are on. All three are false unless
 * settings.skill_learning and settings.allow_insecure_coding are both truthy.
 * Then capture is `skill_capture !== false`, reuse is `skill_reuse !== false` and
 * command is `reuse && skill_command === true`. Never throws.
 * @param {object} settings
 * @returns {{capture: boolean, reuse: boolean, command: boolean}}
 */
export function skillFlags(settings) {
    try {
        if (!isObject(settings) || !settings.skill_learning || !settings.allow_insecure_coding) {
            return { capture: false, reuse: false, command: false };
        }
        const capture = settings.skill_capture !== false;
        const reuse = settings.skill_reuse !== false;
        const command = reuse && settings.skill_command === true;
        return { capture, reuse, command };
    } catch {
        return { capture: false, reuse: false, command: false };
    }
}

/**
 * Skill learning of one bot. The members that the agent, the coder, the prompter and
 * the commands call never throw.
 */
export class SkillManager {
    /**
     * The store lives in `${botsDir}/${name}/skills`. Nothing is read before init().
     * @param {{name: string, botsDir?: string, settings: object, prompter: {promptSkillReview: function(string): Promise<string>},
     *     makeCompartment: function(object): object, endowments: {skills: object, world: object, Vec3: function, log: function},
     *     getInventoryCounts: function(object): object, builtinNames?: string[], reviewTemplate: string, now?: () => Date}} options
     */
    constructor(options) {
        const {
            name,
            botsDir = './bots',
            settings,
            prompter,
            makeCompartment,
            endowments,
            getInventoryCounts,
            builtinNames = [],
            reviewTemplate,
            now,
        } = isObject(options) ? options : {};
        this.name = name;
        this.settings = settings;
        this.prompter = prompter;
        this.makeCompartment = makeCompartment;
        this.endowments = endowments;
        this.getInventoryCounts = getInventoryCounts;
        this.builtinNames = Array.isArray(builtinNames) ? builtinNames : [];
        this.reviewTemplate = reviewTemplate;
        this.flags = skillFlags(settings);
        this.dir = `${botsDir}/${name}/skills`;
        this._emptySkills = Object.freeze({});
        this._customSkills = this._emptySkills;
        this._loaded = [];
        this.store = null;
        try {
            this.store = new SkillStore(this.dir, typeof now === 'function' ? { now } : {});
        } catch (err) {
            console.warn(`Skill store ${this.dir} could not be opened:`, warningText(err));
        }
    }

    /**
     * Loads the store and, with flags.reuse, loads the active skills into the sandbox.
     * Never throws.
     * @returns {number} number of skills loaded into the sandbox, 0 without flags.reuse
     */
    init() {
        try {
            this.store?.load();
        } catch (err) {
            console.warn(`Skill store ${this.dir} could not be loaded:`, warningText(err));
        }
        return this._reload();
    }

    /**
     * The frozen object of loaded skills that code calls as customSkills.<name>(bot, ...).
     * A reload builds a new object; this always returns the current one. Before init()
     * and without flags.reuse it is a frozen empty object.
     * @returns {Object<string, function>}
     */
    get customSkills() {
        return this._customSkills;
    }

    /** @returns {string[]} `customSkills.<name>` for every loaded skill, sorted */
    knownNames() {
        return this._loaded.map(name => 'customSkills.' + name).sort();
    }

    /**
     * Whether a skill is loaded into the sandbox and can be called. Names of
     * Object.prototype such as `toString` are no skills. Never throws.
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return typeof name === 'string' && this._loaded.includes(name);
    }

    /**
     * Entries of the store, each with `doc`, the doc text of its source ('' when it has none).
     * All entries, also disabled skills and skills the loader skipped. Never throws.
     * @returns {object[]}
     */
    skillInfos() {
        return this._entries().map(entry => ({ ...entry, doc: this._docOf(entry.name) }));
    }

    /**
     * The saved skills section for the coding prompt (buildCodingSection). With reuse
     * it offers only skills that are loaded into the sandbox. Never throws.
     * @param {string} task
     * @returns {string} '' when capture and reuse are off
     */
    codingSection(task) {
        if (!this.flags.capture && !this.flags.reuse) {
            return '';
        }
        return buildCodingSection({
            flags: this.flags,
            skills: this.flags.reuse ? this._callableInfos() : [],
            task,
        });
    }

    /**
     * The saved skills section for the conversing prompt (buildConversingSection). It
     * offers only skills that are loaded into the sandbox. Never throws.
     * @returns {string} '' without reuse or without active skills
     */
    conversingSection() {
        if (!this.flags.reuse) {
            return '';
        }
        return buildConversingSection({ flags: this.flags, skills: this._callableInfos() });
    }

    /**
     * State of the bot for the review of a run (snapshotState). Never throws.
     * @param {object} bot
     * @returns {{inventory: object, position: object|null, health: number|null, food: number|null}}
     */
    snapshot(bot) {
        return snapshotState(bot, this.getInventoryCounts);
    }

    /**
     * Saves the function of a successful code run as a skill when the review model
     * agrees that the task was done and the function is reusable. Stops at the first
     * failing step with `reason`: capture_off, interrupted, threw, no_code, the reason of
     * pickSkillCandidate, review_failed, not_achieved, not_reusable, no_description,
     * invalid (with `errors`), unchanged; save_failed when the store throws and error for anything
     * else unexpected. On success the skills are loaded again when flags.reuse.
     * Never throws and never rejects.
     * @param {{code: string, output: string, task: string, before: object, after: object, interrupted: boolean, threw: boolean}} run
     * @returns {Promise<{saved: boolean, action: string|null, name: string|null, reason: string|null, errors: {code: string, message: string}[], message: string}>}
     */
    async captureFromRun(run) {
        try {
            return await this._capture(run);
        } catch (err) {
            console.warn('Skill capture failed:', warningText(err));
            return notSaved('error');
        }
    }

    /**
     * The saved skills as text for the !skills query: every skill of the store. With reuse,
     * an active skill that is not loaded into the sandbox is marked ` [broken]`.
     * @returns {string} `No skills are saved yet.` or `Saved skills:` and one line per skill
     */
    listText() {
        const entries = this._entries();
        if (entries.length === 0) {
            return NO_SKILLS;
        }
        const lines = ['Saved skills:'];
        for (const entry of entries) {
            let line = `- ${this._signatureOf(entry)}: ${typeof entry.description === 'string' ? entry.description : ''}`
                + ` (used ${countText(entry.uses)} times, ${countText(entry.failures)} failed)`;
            if (entry.status === 'disabled') {
                line += ' [disabled]';
            } else if (this.flags.reuse && entry.status === 'active' && !this.has(entry.name)) {
                // without reuse nothing is loaded by design, so nothing is broken
                line += ' [broken]';
            }
            lines.push(line);
        }
        return lines.join('\n');
    }

    /**
     * Removes a skill through the store (its file goes to .history) and reloads. Never throws.
     * @param {string} name
     * @returns {boolean} true if the skill existed
     */
    forget(name) {
        try {
            const removed = this.store?.remove(name) === true;
            if (removed) {
                this._reload();
            }
            return removed;
        } catch (err) {
            console.warn('Could not forget a skill:', warningText(err));
            return false;
        }
    }

    /**
     * Sets the status of a skill through the store and reloads. Never throws.
     * @param {string} name
     * @param {'active'|'disabled'} status
     * @returns {boolean} true on success
     */
    setStatus(name, status) {
        try {
            const changed = this.store?.setStatus(name, status) === true;
            if (changed) {
                this._reload();
            }
            return changed;
        } catch (err) {
            console.warn('Could not change the status of a skill:', warningText(err));
            return false;
        }
    }

    /**
     * Calls a loaded skill with the bot and the arguments. The use is recorded in the store.
     * Never throws.
     * @param {string} name
     * @param {Array} args
     * @param {object} bot
     * @returns {Promise<{ok: boolean, result: *, error: string|null}>} error is 'unknown_skill'
     *     for an unknown or disabled skill, the text of the error when the skill throws.
     */
    async run(name, args, bot) {
        try {
            const lib = this._customSkills;
            if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(lib, name)
                || typeof lib[name] !== 'function' || !this._isActive(name)) {
                return { ok: false, result: null, error: 'unknown_skill' };
            }
            let list = [];
            if (Array.isArray(args)) {
                list = args;
            } else if (args !== undefined && args !== null) {
                list = [args];
            }
            try {
                const result = await lib[name](bot, ...list);
                return { ok: true, result, error: null };
            } catch (err) {
                return { ok: false, result: null, error: errorText(err) };
            }
        } catch (err) {
            return { ok: false, result: null, error: errorText(err) };
        }
    }

    async _capture(run) {
        if (!this.flags.capture) {
            return notSaved('capture_off');
        }
        const data = isObject(run) ? run : {};
        if (data.interrupted) {
            return notSaved('interrupted');
        }
        if (data.threw) {
            return notSaved('threw');
        }
        const code = typeof data.code === 'string' ? data.code : '';
        const trimmed = code.trim();
        if (trimmed === '' || trimmed === NO_RESPONSE) {
            return notSaved('no_code');
        }
        const picked = pickSkillCandidate(parseGeneratedCode(code));
        const candidate = picked?.candidate ?? null;
        if (!candidate) {
            return notSaved(picked?.reason ?? 'no_function');
        }
        const name = candidate.name;

        let review;
        try {
            const text = buildReviewPrompt(this.reviewTemplate, {
                name: this.name,
                task: data.task,
                code,
                output: data.output,
                stateChange: diffState(data.before, data.after).text,
                skillList: this._signatures().join(', '),
            });
            review = parseReview(await this.prompter.promptSkillReview(text));
        } catch (err) {
            console.warn('Skill review failed:', warningText(err));
            return notSaved('review_failed', name);
        }
        if (!review.ok) {
            return notSaved('review_failed', name);
        }
        if (!review.achieved) {
            return notSaved('not_achieved', name);
        }
        if (!review.reusable) {
            return notSaved('not_reusable', name);
        }

        // A skill needs a description (Amendment 1, A4): the first doc line of the function's
        // own doc block unless it is an @ line, otherwise the description of the review.
        const ownDoc = getDocBlock(candidate.source);
        const ownLine = ownDoc ? firstDocLine(ownDoc.text) : '';
        const description = ownLine !== '' && !ownLine.startsWith('@') ? ownLine : review.description;
        if (typeof description !== 'string' || description.trim() === '') {
            return notSaved('no_description', name);
        }

        const params = (Array.isArray(candidate.params) ? candidate.params : [])
            .map((param, i) => (typeof param === 'string' ? param : `arg${i + 1}`));
        const source = ensureDocBlock(candidate.source, { name, params, description: review.description });
        const validation = validateSkill({ name, source, builtinNames: this.builtinNames });
        if (!validation.ok) {
            return notSaved('invalid', name, Array.isArray(validation.errors) ? validation.errors : []);
        }

        let result;
        try {
            result = this.store.save({
                name,
                source,
                description,
                signature: signatureOf(candidate),
                sourceTask: typeof data.task === 'string' ? data.task : '',
            });
        } catch (err) {
            console.warn(`Could not save the skill ${name}:`, warningText(err));
            return notSaved('save_failed', name);
        }
        const action = result?.action;
        if (action === 'unchanged') {
            return notSaved('unchanged', name);
        }
        if (action !== 'created' && action !== 'updated') {
            // 'failed': the source could not be written, the store is unchanged (Amendment 2, B1)
            return notSaved('save_failed', name);
        }
        console.log(`Skill ${action}: customSkills.${name}`);
        this._reload();
        return { saved: true, action, name, reason: null, errors: [], message: this._savedMessage(action, name) };
    }

    // Without reuse a saved skill cannot be called, so the message does not offer it (Amendment 1, A3).
    // With reuse, a skill the reload did not load is not offered either (Amendment 2, B1).
    _savedMessage(action, name) {
        if (!this.flags.reuse) {
            return action === 'created' ? `Saved this code as the skill ${name}.` : `Updated the saved skill ${name}.`;
        }
        if (!this.has(name)) {
            return action === 'created'
                ? `Saved this code as the skill ${name}, but it could not be loaded.`
                : `Updated the saved skill ${name}, but it could not be loaded.`;
        }
        return action === 'created'
            ? `Saved this code as the skill customSkills.${name}. You can call it in later code.`
            : `Updated the saved skill customSkills.${name}.`;
    }

    // The skills the prompts may offer: entries with doc, only those loaded into the sandbox
    // (Amendment 1, A2). A skill the loader skipped cannot be called.
    _callableInfos() {
        return this._entries()
            .filter(entry => this.has(entry.name))
            .map(entry => ({ ...entry, doc: this._docOf(entry.name) }));
    }

    // Loads the active skills into a new frozen customSkills object (flags.reuse only).
    _reload() {
        if (!this.flags.reuse || !this.store) {
            this._customSkills = this._emptySkills;
            this._loaded = [];
            return 0;
        }
        try {
            const store = this.store;
            const { customSkills, loaded, skipped } = loadSkills({
                store,
                makeCompartment: this.makeCompartment,
                endowments: this.endowments,
                instrument,
                onUse: (name, outcome) => store.recordUse(name, outcome),
                check: isSingleFunction, // loading runs no code (Amendment 2, B2)
            });
            for (const skip of skipped) {
                console.warn(`Skill ${skip.name} was not loaded: ${skip.error}`);
            }
            this._customSkills = customSkills;
            this._loaded = loaded.slice();
        } catch (err) {
            console.warn('Could not load the saved skills:', warningText(err));
        }
        return this._loaded.length;
    }

    _entries() {
        try {
            const list = this.store?.list();
            return Array.isArray(list) ? list.filter(isObject) : [];
        } catch (err) {
            console.warn('Could not list the saved skills:', warningText(err));
            return [];
        }
    }

    _signatures() {
        return this._entries().map(entry => this._signatureOf(entry));
    }

    _signatureOf(entry) {
        if (typeof entry.signature === 'string' && entry.signature !== '') {
            return entry.signature;
        }
        return typeof entry.name === 'string' ? entry.name : '';
    }

    _isActive(name) {
        try {
            const entry = this.store?.get(name);
            return isObject(entry) && entry.status === 'active';
        } catch {
            return false;
        }
    }

    _docOf(name) {
        try {
            const source = this.store?.read(name);
            if (typeof source !== 'string') {
                return '';
            }
            const block = getDocBlock(source);
            return block && typeof block.text === 'string' ? block.text : '';
        } catch {
            return '';
        }
    }
}

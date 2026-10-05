// The page of the mindserver (v0.1.4.13): the chat of one bot first, the live voice of the demo beside the input
// (only with voice_ui), and every control of the old page in the drawer of the agents.
// v0.1.4.13 (part N2, spec 4.5): the chat holds the lines of every bot and the supervisor's relayed lines, each with
// its name in front; the dropdown has "everyone"; a line of the owner goes where routeLine says (the chosen bot with
// its name in front, every bot plain); the voice of the mindserver gets the voice of every bot and the supervisor.
/* global io, vad */
import { EVERYONE, chatEntry, routeLine, speakerName, supervisorOf, voiceMap } from './chat_logic.js';

const $ = (id) => document.getElementById(id);
const els = {
    meta: $('meta'), stage: $('stage'), agentSelect: $('agent-select'), menuBtn: $('menu-btn'),
    botDot: $('bot-dot'), botSummary: $('bot-summary'), quickStop: $('quick-stop'), clearChat: $('clear-chat'),
    voiceControls: $('voice-controls'), voice: $('voice'), preview: $('preview'), speed: $('speed'),
    speedOut: $('speed-out'), barge: $('barge'), speak: $('speak'), voiceNote: $('voice-note'),
    log: $('log'), voiceStatus: $('voice-status'), meter: $('meter'), meterFill: $('meter-fill'),
    msg: $('msg'), send: $('send'), talk: $('talk'), talkLabel: $('talk-label'),
    drawer: $('drawer'), drawerBackdrop: $('drawer-backdrop'), drawerClose: $('drawer-close'), agents: $('agents'),
};

const socket = io({ path: window.location.pathname + 'socket.io' });

// ---------- small helpers ----------

const store = {
    get(key, fallback = null) {
        try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
};
const ms = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('data-')) node.setAttribute(k, v);
        else node[k] = v;
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
}

// ---------- state ----------

let settingsSpec = {};
const agentSettings = {}; // name -> settings of the agent (only_chat_with gives the owner's name)
const inventoryOpen = {};
let currentAgents = [];
let selected = store.get('mindcraft-agent');
const chat = []; // the one chat of the page: [{ kind, speaker, text, note }] of every bot, the supervisor and the owner
const CHAT_LIMIT = 300;

// ---------- the chat ----------

// The supervisor as the settings of the bots name it ({ name, voice }), or null.
function supervisor() {
    return supervisorOf(currentAgents, agentSettings);
}

function renderEntry(entry) {
    const div = el('div', { class: `msg ${entry.kind}` });
    // the name in front: a bot's name, or the supervisor's in brackets as it is said in the game
    if (entry.speaker && (entry.kind === 'bot' || entry.kind === 'supervisor'))
        div.append(el('span', { class: 'who', text: entry.kind === 'supervisor' ? `[${entry.speaker}]` : entry.speaker }));
    div.append(el('span', { text: entry.text }));
    if (entry.note) div.append(el('span', { class: 't', text: entry.note }));
    entry.node = div;
    return div;
}

function addLine(entry) {
    if (!entry) return null;
    chat.push(entry);
    if (chat.length > CHAT_LIMIT) chat.splice(0, chat.length - CHAT_LIMIT);
    els.log.querySelector('.hint')?.remove();
    els.log.append(renderEntry(entry));
    while (els.log.children.length > CHAT_LIMIT) els.log.firstChild.remove();
    entry.node.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return entry;
}

function addNote(entry, note) {
    if (!entry) return;
    entry.note = entry.note ? `${entry.note} · ${note}` : note;
    if (entry.node) {
        entry.node.querySelector('.t')?.remove();
        entry.node.append(el('span', { class: 't', text: entry.note }));
    }
}

function renderLog() {
    els.log.innerHTML = '';
    if (!chat.length) {
        const hint = !selected ? 'No bot yet: create one under Agents.'
            : voice.enabled ? 'Write to the bot below, or press Talk / Live and speak. A short pause ends your turn.'
                : 'Write to the bot below.';
        els.log.append(el('p', { class: 'hint', text: hint }));
        return;
    }
    for (const entry of chat) els.log.append(renderEntry(entry));
    els.log.lastChild?.scrollIntoView({ block: 'end' });
}

// The name the page speaks as: the first name of only_chat_with, else the name the owner gave once.
function ownerName(name, { ask = false } = {}) {
    const known = speakerName(agentSettings[name]?.only_chat_with, store.get('mindcraft-owner'));
    if (known || !ask) return known;
    const given = window.prompt('Your name in the game (the bot answers lines from this name):', '');
    if (!given || !given.trim()) return null;
    store.set('mindcraft-owner', given.trim());
    return given.trim();
}

function sendMessage(name, message, { show = true } = {}) {
    if (!name || !message || !message.trim()) return false;
    const from = ownerName(name, { ask: true });
    if (!from) {
        addLine({ kind: 'error', text: 'Your name is not set.' });
        return false;
    }
    socket.emit('send-message', name, { from, message: message.trim() });
    if (show) addLine({ kind: 'user', text: message.trim() });
    sendVoiceSettings();
    return true;
}

// The bots in the game the dropdown stands for: the chosen one, or every one with "everyone".
function chosenBots() {
    if (selected === EVERYONE) return currentAgents.filter((a) => a.in_game).map((a) => a.name);
    return selected ? [selected] : [];
}

// A typed line goes where routeLine says (v0.1.4.13, part N2): the chosen bot with its name in front, every bot
// plain with "everyone", the bot a line names; a line for the supervisor to the chosen bot.
function sendLine(text) {
    const route = routeLine({ selected, text, agents: currentAgents, supervisor: supervisor()?.name ?? '' });
    if (!route.ok) {
        addLine({ kind: 'error', text: route.text });
        return false;
    }
    let sent = false;
    for (const name of route.targets) sent = sendMessage(name, route.message, { show: false }) || sent;
    if (sent) addLine({ kind: 'user', text: route.message });
    return sent;
}

els.msg.addEventListener('input', () => { els.send.disabled = !(els.msg.value.trim() && selected); });
els.msg.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.send.click(); });
els.send.addEventListener('click', () => {
    player.ensure(); // a click unlocks the audio of the page
    if (sendLine(els.msg.value)) {
        els.msg.value = '';
        els.send.disabled = true;
    }
});
els.quickStop.addEventListener('click', () => {
    for (const name of chosenBots()) sendMessage(name, '!stop');
});
els.clearChat.addEventListener('click', () => {
    chat.length = 0;
    if (voice.enabled) { interruptBot(); socket.emit('reset'); }
    renderLog();
});

// Every bot's line and the supervisor's, with the name in front; a note of the system in the middle.
socket.on('bot-output', (agentName, message) => {
    const entry = chatEntry(agentName, message, supervisor()?.name ?? '');
    if (!entry) return;
    addLine({ kind: entry.kind, speaker: entry.speaker, text: entry.text });
});

// ---------- the chosen bot ----------

function agentState(name) {
    return currentAgents.find((a) => a.name === name);
}

function chooseAgent(name) {
    if (name === selected && els.agentSelect.value === name) return;
    selected = name || null;
    store.set('mindcraft-agent', selected);
    if (selected) els.agentSelect.value = selected;
    els.msg.placeholder = selected === EVERYONE ? 'Message to every bot...' : selected ? `Message to ${selected}...` : 'Message to the bot...';
    els.send.disabled = !(els.msg.value.trim() && selected);
    if (voice.enabled) interruptBot();
    renderLog();
    renderBotLine();
    showVoiceOfSelected();
    sendVoiceSettings();
}
els.agentSelect.addEventListener('change', () => chooseAgent(els.agentSelect.value));

function renderAgentSelect() {
    const names = currentAgents.map((a) => a.name);
    els.agentSelect.innerHTML = '';
    for (const a of currentAgents)
        els.agentSelect.append(new Option(`${a.in_game ? '●' : '○'} ${a.name}`, a.name));
    // v0.1.4.13 (N2): with two bots or more, "everyone": a line goes to every bot in the game, without a name
    const everyone = names.length > 1;
    if (everyone) els.agentSelect.append(new Option('everyone', EVERYONE));
    els.agentSelect.hidden = names.length === 0;
    if (!names.includes(selected) && !(everyone && selected === EVERYONE)) {
        const next = currentAgents.find((a) => a.in_game)?.name ?? names[0] ?? null;
        chooseAgent(next);
    } else {
        els.agentSelect.value = selected;
        renderBotLine();
    }
}

function renderBotLine() {
    if (selected === EVERYONE) {
        const inGame = currentAgents.filter((a) => a.in_game).map((a) => a.name);
        els.botDot.className = `dot-status ${inGame.length > 0 ? 'online' : 'offline'}`;
        els.quickStop.disabled = inGame.length === 0;
        els.botSummary.replaceChildren(el('b', { text: 'everyone' }), ` · ${inGame.length > 0 ? `${inGame.join(', ')} in the game` : 'no bot in the game'}`);
        return;
    }
    const a = agentState(selected);
    els.botDot.className = `dot-status ${!a ? 'offline' : a.in_game ? 'online' : a.socket_connected ? 'joining' : 'offline'}`;
    els.quickStop.disabled = !a?.in_game;
    if (!a) {
        els.botSummary.textContent = 'No bot yet.';
        return;
    }
    const st = window.lastStates?.[a.name];
    const gp = st && !st.error ? st.gameplay || {} : {};
    const parts = [a.in_game ? 'in the game' : a.socket_connected ? 'joining...' : 'not connected'];
    if (a.in_game) {
        if (st?.action) parts.push(st.action.current || 'Idle');
        if (typeof gp.health === 'number') parts.push(`health ${gp.health}/${gp.healthMax ?? 20}`);
        if (typeof gp.hunger === 'number') parts.push(`hunger ${gp.hunger}/${gp.hungerMax ?? 20}`);
        if (gp.position) parts.push(`${gp.position.x}, ${gp.position.y}, ${gp.position.z}`);
    }
    els.botSummary.replaceChildren(el('b', { text: a.name }), ` · ${parts.join(' · ')}`);
}

// ---------- the connection ----------

function setOnline(online) {
    if (!voice.enabled) {
        els.meta.textContent = online ? 'MindServer online' : 'MindServer offline';
    }
    refreshStage();
}

socket.on('connect', () => {
    setOnline(true);
    socket.emit('listen-to-agents');
    socket.emit('voice-join');
    // the settings of the agents may have changed while the page was away
    Object.keys(agentSettings).forEach((name) => delete agentSettings[name]);
});
socket.on('disconnect', () => {
    els.meta.textContent = 'MindServer offline';
    setOnline(false);
});
socket.on('connect_error', () => setOnline(false));

// ---------- the drawer of the agents ----------

function openDrawer(open) {
    els.drawer.hidden = !open;
    els.drawerBackdrop.hidden = !open;
}
els.menuBtn.addEventListener('click', () => openDrawer(true));
els.drawerClose.addEventListener('click', () => openDrawer(false));
els.drawerBackdrop.addEventListener('click', () => openDrawer(false));
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.drawer.hidden) openDrawer(false);
});

function renderAgentCard(agent) {
    const cfg = agentSettings[agent.name] || {};
    const showViewer = agent.in_game && cfg.render_bot_view === true;
    const status = agent.in_game ? 'online' : agent.socket_connected ? 'joining' : 'offline';
    const btn = (act, text, opts = {}) => el('button', { class: `${opts.cls || 'ghost'} small`, text, 'data-act': act, disabled: !!opts.disabled, title: opts.title || '' });
    const field = (f, text) => el('div', { class: 'cell', 'data-f': f, text });

    const card = el('div', { class: 'agent-card', 'data-agent': agent.name });
    card.append(el('div', { class: 'card-head' },
        el('span', { class: `dot-status ${status}`, text: '●' }),
        el('b', { text: agent.name }),
        agent.socket_connected && !agent.in_game ? el('span', { class: 'joining', text: 'joining...' }) : null,
        el('span', { class: 'spacer' }),
        btn('chat', 'Chat', { title: 'Talk with this bot' }),
        btn('settings', 'Settings'),
        btn('inventory', 'Inventory'),
    ));
    if (showViewer)
        card.append(el('iframe', { class: 'agent-viewer', src: `http://localhost:${agent.viewerPort}` }));
    card.append(el('div', { class: 'stats' },
        field('action', 'action: -'), field('mode', 'gamemode: -'), field('health', 'health: -'), field('hunger', 'hunger: -'),
        field('pos', 'pos: -'), field('biome', 'biome: -'), field('items', 'inventory slots: -'), field('equipped', 'equipped: -'),
    ));
    const inv = el('div', { class: 'inventory', hidden: inventoryOpen[agent.name] !== true },
        el('h3', { text: 'Inventory' }), field('armor', 'armor: -'), el('div', { class: 'inventory-grid', 'data-f': 'grid' }));
    card.append(inv);
    const off = !agent.in_game;
    card.append(el('div', { class: 'card-actions' },
        btn('stop-action', 'Stop action', { disabled: off, title: 'Sends !stop' }),
        btn('stay', 'Stay still', { disabled: off, title: 'Sends !stay(-1)' }),
        btn('restart', 'Restart', { disabled: off }),
        agent.in_game ? btn('disconnect', 'Disconnect')
            : btn('connect', agent.socket_connected ? 'Connecting...' : 'Connect', { disabled: agent.socket_connected }),
        btn('remove', 'Remove', { cls: 'danger' }),
    ));
    return card;
}

function fillCard(card, st) {
    if (!card || !st || st.error) return;
    const set = (f, text) => { const node = card.querySelector(`[data-f="${f}"]`); if (node) node.textContent = text; };
    const gp = st.gameplay || {};
    if (typeof gp.health === 'number') set('health', `health: ${gp.health}/${typeof gp.healthMax === 'number' ? gp.healthMax : 20}`);
    if (gp.position) set('pos', `x ${gp.position.x}, y ${gp.position.y}, z ${gp.position.z}`);
    if (typeof gp.hunger === 'number') set('hunger', `hunger: ${gp.hunger}/${typeof gp.hungerMax === 'number' ? gp.hungerMax : 20}`);
    if (gp.biome) set('biome', `biome: ${gp.biome}`);
    if (gp.gamemode) set('mode', `gamemode: ${gp.gamemode}`);
    if (st.inventory) set('items', `inventory slots: ${st.inventory.stacksUsed ?? 0}/${st.inventory.totalSlots ?? 0}`);
    const e = st.inventory?.equipment;
    if (e) {
        set('equipped', `equipped: ${e.mainHand || 'none'}`);
        const armor = [];
        if (e.helmet) armor.push(`head: ${e.helmet}`);
        if (e.chestplate) armor.push(`chest: ${e.chestplate}`);
        if (e.leggings) armor.push(`legs: ${e.leggings}`);
        if (e.boots) armor.push(`feet: ${e.boots}`);
        set('armor', `armor: ${armor.length ? armor.join(', ') : 'none'}`);
    }
    if (st.action) set('action', `${st.action.current || 'Idle'}`);
    const grid = card.querySelector('[data-f="grid"]');
    if (grid && st.inventory?.counts) {
        const counts = Object.entries(st.inventory.counts);
        grid.replaceChildren(...(counts.length ? counts.map(([k, v]) => el('div', { class: 'cell', text: `${k}: ${v}` }))
            : [el('div', { class: 'cell', text: '(empty)' })]));
    }
}

function cardOf(name) {
    return [...els.agents.querySelectorAll('.agent-card')].find((c) => c.dataset.agent === name) || null;
}

function renderAgents(agents, changed) {
    els.agents.querySelector('.empty')?.remove();
    if (!agents.length) {
        els.agents.replaceChildren(el('p', { class: 'empty', text: 'No agents connected.' }));
        return;
    }
    for (const agent of agents) {
        const old = cardOf(agent.name);
        if (old && !changed.includes(agent)) continue;
        const card = renderAgentCard(agent);
        if (old) old.replaceWith(card);
        else els.agents.append(card);
        fillCard(card, window.lastStates?.[agent.name]);
    }
    for (const card of [...els.agents.querySelectorAll('.agent-card')]) {
        if (!agents.some((a) => a.name === card.dataset.agent)) {
            delete inventoryOpen[card.dataset.agent];
            card.remove();
        }
    }
}

els.agents.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    const card = e.target.closest('.agent-card');
    if (!button || !card) return;
    const name = card.dataset.agent;
    switch (button.dataset.act) {
    case 'chat': chooseAgent(name); openDrawer(false); break;
    case 'settings': openAgentSettings(name); break;
    case 'inventory': {
        const inv = card.querySelector('.inventory');
        inv.hidden = !inv.hidden;
        inventoryOpen[name] = !inv.hidden;
        break;
    }
    case 'stop-action': sendMessage(name, '!stop'); break;
    case 'stay': sendMessage(name, '!stay(-1)'); break;
    case 'restart': socket.emit('restart-agent', name); break;
    case 'disconnect': socket.emit('stop-agent', name); break;
    case 'connect':
        button.textContent = 'Connecting...';
        button.disabled = true;
        // enabled again after 10 s if the agent did not connect
        setTimeout(() => {
            const a = agentState(name);
            if ((!a || (!a.in_game && !a.socket_connected)) && button.isConnected) {
                button.disabled = false;
                button.textContent = 'Connect';
            }
        }, 10000);
        socket.emit('start-agent', name);
        break;
    case 'remove': socket.emit('destroy-agent', name); break;
    }
});

$('disconnect-all').addEventListener('click', () => socket.emit('stop-all-agents'));
$('shutdown').addEventListener('click', () => {
    if (confirm('Are you sure you want to perform a full shutdown?\nThis will stop all agents and close the server.')) {
        socket.emit('shutdown');
    }
});

function fetchAgentSettings(name) {
    return new Promise((resolve) => {
        if (agentSettings[name]) { resolve(agentSettings[name]); return; }
        socket.emit('get-settings', name, (res) => {
            if (res.settings) {
                agentSettings[name] = res.settings;
                resolve(res.settings);
            } else resolve(null);
        });
    });
}

socket.on('agents-status', async (agents) => {
    const needSettings = agents.filter((a) => !agentSettings[a.name]);
    if (needSettings.length > 0) await Promise.all(needSettings.map((a) => fetchAgentSettings(a.name)));
    const prev = Object.fromEntries(currentAgents.map((a) => [a.name, a]));
    const changed = agents.filter((a) => {
        const p = prev[a.name];
        return !p || p.in_game !== a.in_game || p.viewerPort !== a.viewerPort || p.socket_connected !== a.socket_connected;
    });
    currentAgents = agents;
    window.currentAgents = agents;
    renderAgents(agents, changed);
    renderAgentSelect();
    sendVoiceSettings();
});

socket.on('state-update', (states) => {
    window.lastStates = states;
    for (const name of Object.keys(states || {})) fillCard(cardOf(name), states[name]);
    renderBotLine();
});

// ---------- the settings form (create agent, the settings of an agent) ----------

fetch('settings_spec.json')
    .then((r) => r.json())
    .then((spec) => {
        settingsSpec = spec;
        buildSettingsForm();
    });

function settingInput(key, cfg, value, id) {
    let input;
    switch (cfg.type) {
    case 'boolean':
        input = el('input', { type: 'checkbox', checked: value === true });
        break;
    case 'number':
        input = el('input', { type: 'number', value: value ?? 0 });
        break;
    default:
        input = el('input', { type: 'text', value: typeof value === 'object' && value !== null ? JSON.stringify(value) : (value ?? '') });
    }
    input.title = cfg.description || '';
    input.id = id;
    return input;
}

function readSetting(cfg, input) {
    if (cfg.type === 'boolean') return input.checked;
    if (cfg.type === 'number') return Number(input.value);
    if (cfg.type === 'array' || cfg.type === 'object') {
        try { return JSON.parse(input.value); } catch { return input.value; }
    }
    return input.value;
}

function buildSettingsForm() {
    const form = $('settingsForm');
    form.innerHTML = '';
    for (const key of Object.keys(settingsSpec)) {
        if (key === 'profile') continue; // profile handled via upload
        const cfg = settingsSpec[key];
        const label = el('label', { text: key, title: cfg.description || '' });
        form.append(el('div', { class: 'setting-wrapper' }, label, settingInput(key, cfg, cfg.default, `setting-${key}`)));
    }
}

let profileData = null;
const createModal = $('createAgentModal');
$('openCreateAgentBtn').addEventListener('click', () => {
    buildSettingsForm();
    createModal.style.display = 'flex';
});
const hideCreateAgentModal = () => { createModal.style.display = 'none'; };
$('closeCreateAgentBtn').addEventListener('click', hideCreateAgentModal);
$('uploadProfileBtn').addEventListener('click', () => $('profileFileInput').click());
$('profileFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            profileData = JSON.parse(ev.target.result);
            $('submitCreateAgentBtn').disabled = false;
            $('profileStatus').textContent = `Profile: ${profileData.name || 'Uploaded'}`;
            $('createError').textContent = '';
        } catch (err) {
            $('createError').textContent = 'Invalid profile JSON: ' + err.message;
            profileData = null;
            $('submitCreateAgentBtn').disabled = true;
            $('profileStatus').textContent = 'Profile: Not uploaded';
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});
$('submitCreateAgentBtn').addEventListener('click', () => {
    if (!profileData) return;
    const settings = { profile: profileData };
    for (const key of Object.keys(settingsSpec)) {
        if (key === 'profile') continue;
        const input = $(`setting-${key}`);
        if (input) settings[key] = readSetting(settingsSpec[key], input);
    }
    socket.emit('create-agent', settings, (res) => {
        if (!res.success) {
            $('createError').textContent = res.error || 'Unknown error';
        } else {
            profileData = null;
            $('submitCreateAgentBtn').disabled = true;
            $('profileStatus').textContent = 'Profile: Not uploaded';
            $('createError').textContent = '';
            hideCreateAgentModal();
        }
    });
});

const settingsModal = $('agentSettingsModal');
const settingsForm = $('agentSettingsForm');
const applyBtn = $('applyAgentSettingsBtn');
let currentAgentName = null;
let originalAgentSettings = null;

function buildAgentSettingsForm(settings) {
    settingsForm.innerHTML = '';
    for (const key of Object.keys(settingsSpec)) {
        if (key === 'profile') continue; // profile not edited here
        const cfg = settingsSpec[key];
        const value = cfg.type === 'boolean' ? Boolean(settings[key]) : (settings[key] ?? cfg.default ?? (cfg.type === 'number' ? 0 : ''));
        const input = settingInput(key, cfg, value, `agent-setting-${key}`);
        input.addEventListener('input', onAgentSettingsChanged);
        if (input.type === 'checkbox') input.addEventListener('change', onAgentSettingsChanged);
        settingsForm.append(el('div', { class: 'setting-wrapper' }, el('label', { text: key, title: cfg.description || '' }), input));
    }
    onAgentSettingsChanged();
}

function openAgentSettings(name) {
    currentAgentName = name;
    $('agentSettingsTitle').textContent = `${name} settings`;
    fetchAgentSettings(name).then((settings) => {
        originalAgentSettings = JSON.parse(JSON.stringify(settings || {}));
        buildAgentSettingsForm(settings || {});
        settingsModal.style.display = 'flex';
    });
}

function getEditedAgentSettings() {
    const edited = { profile: (originalAgentSettings && originalAgentSettings.profile) || {} };
    for (const key of Object.keys(settingsSpec)) {
        if (key === 'profile') continue;
        const input = $(`agent-setting-${key}`);
        if (input) edited[key] = readSetting(settingsSpec[key], input);
    }
    return edited;
}

function sameSettings(a, b) {
    if (!a || !b) return false;
    for (const k of Object.keys(settingsSpec).filter((k) => k !== 'profile')) {
        const va = a[k];
        const vb = b[k];
        if (typeof va === 'object' || typeof vb === 'object') {
            if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
        } else if (va !== vb) return false;
    }
    return true;
}

function onAgentSettingsChanged() {
    applyBtn.disabled = !originalAgentSettings || sameSettings(getEditedAgentSettings(), originalAgentSettings);
}

function closeAgentSettings() {
    settingsModal.style.display = 'none';
    currentAgentName = null;
    originalAgentSettings = null;
}

$('discardAgentSettingsBtn').addEventListener('click', () => {
    if (currentAgentName && originalAgentSettings) buildAgentSettingsForm(originalAgentSettings);
});
applyBtn.addEventListener('click', () => {
    if (!currentAgentName) return;
    const edited = getEditedAgentSettings();
    socket.emit('set-agent-settings', currentAgentName, edited);
    agentSettings[currentAgentName] = { ...edited, fetched: true };
    const a = agentState(currentAgentName);
    const card = cardOf(currentAgentName);
    if (a && card) card.replaceWith(renderAgentCard(a)); // the viewer follows render_bot_view
    closeAgentSettings();
    showVoiceOfSelected(); // v0.1.4.13 (N2): voice_voice, supervisor_name and supervisor_voice may have changed
    sendVoiceSettings();
});
$('closeAgentSettingsBtn').addEventListener('click', closeAgentSettings);

// ---------- the live voice (only with voice_ui; the demo's page) ----------

const voice = { enabled: false, scripts: null, sttReady: false, ttsReady: false, hello: false };
const prefs = store.get('voice-demo-prefs', {}) || {};
let micVad = null;
let live = false;
let userSpeaking = false;
let serverStage = 'idle';
let currentTurn = null;
const staleTurns = new Set();
let lastAudioTurn = null;
let heardEntry = null;

function setStage(stage) {
    els.stage.dataset.stage = stage;
    els.stage.textContent = stage;
}
function refreshStage() {
    if (!socket.connected) return setStage('offline');
    if (!voice.enabled) return setStage('online');
    if (userSpeaking) return setStage('listening');
    if (player.isPlaying() && serverStage === 'idle') return setStage('speaking');
    if (serverStage !== 'idle') return setStage(serverStage);
    setStage(live ? 'live' : 'idle');
}

function sayStatus(text) {
    els.voiceStatus.hidden = !voice.enabled || !text;
    els.voiceStatus.textContent = text || '';
}

// v0.1.4.13 (N2): the voice of every bot (the page's choice for it, else its voice_voice) and the supervisor's name
// and voice go to the voice of the mindserver, which speaks every speaker in its own voice; the dropdown "Voice" is
// the voice of the chosen bot.
function sendVoiceSettings() {
    if (!voice.enabled) return;
    const sup = supervisor();
    const first = chosenBots()[0] ?? null;
    socket.emit('settings', {
        voice: els.voice.value || undefined,
        speed: Number(els.speed.value),
        agent: selected,
        from: first ? ownerName(first) : null,
        speak: els.speak.checked,
        voices: voiceMap(currentAgents, agentSettings, prefs.voices || {}),
        supervisor: sup?.name ?? null,
        supervisorVoice: sup?.voice ?? null,
    });
}

// The dropdown "Voice" shows the voice of the chosen bot (nothing changes with "everyone").
function showVoiceOfSelected() {
    if (!voice.hello || !selected || selected === EVERYONE) return;
    const id = voiceMap(currentAgents, agentSettings, prefs.voices || {})[selected];
    if (id && [...els.voice.options].some((o) => o.value === id)) els.voice.value = id;
}

function savePrefs() {
    store.set('voice-demo-prefs', {
        voice: els.voice.value, voices: prefs.voices || {}, speed: Number(els.speed.value), barge: els.barge.checked, speak: els.speak.checked,
    });
}

// The VAD and its ONNX runtime, from node_modules through the mindserver (no CDN), loaded only with the voice on.
function loadVoiceScripts() {
    const load = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`could not load ${src}`));
        document.head.append(s);
    });
    voice.scripts ||= load('/vendor/ort/ort.wasm.min.js').then(() => load('/vendor/vad/bundle.min.js'));
    return voice.scripts;
}

// Audio playback: a gapless queue of PCM chunks.
const player = (() => {
    let ctx = null;
    let gain = null;
    let nextTime = 0;
    const sources = new Set();

    function ensure() {
        if (!voice.enabled) return null;
        if (!ctx) {
            ctx = new AudioContext();
            gain = ctx.createGain();
            gain.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    return {
        ensure,
        play(float32, sampleRate) {
            if (!ensure()) return;
            const buf = ctx.createBuffer(1, float32.length, sampleRate);
            buf.copyToChannel(float32, 0);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(gain);
            nextTime = Math.max(nextTime, ctx.currentTime + 0.03);
            src.start(nextTime);
            nextTime += buf.duration;
            sources.add(src);
            src.onended = () => { sources.delete(src); refreshStage(); };
            refreshStage();
        },
        stop() {
            for (const s of sources) { try { s.stop(); } catch {} }
            sources.clear();
            nextTime = 0;
            this.duck(false);
        },
        duck(on) {
            if (gain) gain.gain.setTargetAtTime(on ? 0.15 : 1, ctx.currentTime, 0.05);
        },
        isPlaying: () => sources.size > 0,
    };
})();

// The browser lets the page play sound only after a click or a key; the first one unlocks it.
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => player.ensure(), { capture: true });

function botIsBusy() {
    return player.isPlaying() || serverStage === 'thinking' || serverStage === 'transcribing';
}

function interruptBot() {
    if (!voice.enabled) return;
    player.stop();
    if (lastAudioTurn !== null) staleTurns.add(lastAudioTurn);
    if (currentTurn !== null) staleTurns.add(currentTurn);
    currentTurn = null;
    socket.emit('interrupt');
}

async function startLive() {
    player.ensure(); // unlock audio output on this user gesture
    if (!selected) throw new Error('No bot is chosen.');
    if (!ownerName(chosenBots()[0] ?? selected, { ask: true })) throw new Error('Your name is not set.');
    sendVoiceSettings();
    if (!micVad) {
        els.talkLabel.textContent = 'Starting mic...';
        await loadVoiceScripts();
        micVad = await vad.MicVAD.new({
            model: 'v5',
            baseAssetPath: '/vendor/vad/',
            onnxWASMBasePath: '/vendor/ort/',
            positiveSpeechThreshold: 0.5,
            negativeSpeechThreshold: 0.35,
            redemptionMs: 700, // pause length that ends your turn
            preSpeechPadMs: 300,
            minSpeechMs: 300,
            startOnLoad: false,
            onFrameProcessed: (p) => {
                els.meterFill.style.width = `${Math.round(p.isSpeech * 100)}%`;
            },
            onSpeechStart: () => {
                // with "Interrupt by voice" off the mic is ignored while the bot speaks (it would hear itself)
                if (!els.barge.checked && player.isPlaying()) return;
                userSpeaking = true;
                if (player.isPlaying()) player.duck(true);
                sayStatus('Listening...');
                refreshStage();
            },
            onVADMisfire: () => {
                userSpeaking = false;
                player.duck(false);
                sayStatus(live ? 'Live: just talk. A short pause ends your turn.' : '');
                refreshStage();
            },
            onSpeechEnd: (audio) => {
                const wasListening = userSpeaking;
                userSpeaking = false;
                if (!wasListening) return refreshStage(); // ignored: the bot was talking and barge-in is off
                if (botIsBusy()) interruptBot();
                socket.emit('utterance', audio.buffer);
                refreshStage();
            },
        });
    }
    await micVad.start();
    live = true;
    els.talk.classList.add('live');
    els.talkLabel.textContent = 'Live: click to stop';
    els.meter.hidden = false;
    sayStatus('Live: just talk. A short pause ends your turn.');
    refreshStage();
}

async function stopLive() {
    await micVad?.pause();
    live = false;
    userSpeaking = false;
    els.meterFill.style.width = '0';
    els.meter.hidden = true;
    els.talk.classList.remove('live');
    els.talkLabel.textContent = 'Talk / Live';
    sayStatus('');
    refreshStage();
}

els.talk.addEventListener('click', async () => {
    els.talk.disabled = true;
    try {
        live ? await stopLive() : await startLive();
    } catch (err) {
        console.error(err);
        addLine({ kind: 'error', text: `Microphone: ${err.message || err}` });
        els.talkLabel.textContent = 'Talk / Live';
    } finally {
        els.talk.disabled = !voice.sttReady;
    }
});

els.voice.addEventListener('change', () => {
    // the voice of the chosen bot on this page (v0.1.4.13, N2); with "everyone" only the voice of a bot without one
    if (selected && selected !== EVERYONE) (prefs.voices ||= {})[selected] = els.voice.value;
    sendVoiceSettings();
    savePrefs();
});
els.speed.addEventListener('input', () => {
    els.speedOut.textContent = `${Number(els.speed.value).toFixed(2)}×`;
    sendVoiceSettings();
    savePrefs();
});
els.barge.addEventListener('change', savePrefs);
els.speak.addEventListener('change', () => {
    if (!els.speak.checked) player.stop();
    sendVoiceSettings();
    savePrefs();
});
els.preview.addEventListener('click', () => {
    player.ensure();
    player.stop();
    socket.emit('preview_voice', { voice: els.voice.value });
});

socket.on('voice-config', (cfg = {}) => {
    const was = voice.enabled;
    voice.enabled = cfg.enabled === true;
    els.voiceControls.hidden = !voice.enabled;
    els.talk.hidden = !voice.enabled;
    if (!voice.enabled) {
        els.voiceNote.hidden = true;
        sayStatus('');
        setOnline(socket.connected);
        if (was) renderLog();
        return;
    }
    voice.sttReady = cfg.stt?.state === 'ready';
    voice.ttsReady = cfg.tts?.state === 'ready';
    els.talk.disabled = !voice.sttReady;
    els.preview.disabled = !voice.ttsReady;
    const problems = [cfg.stt, cfg.tts].filter((p) => p && p.state !== 'ready').map((p) => p.message);
    els.voiceNote.hidden = problems.length === 0;
    els.voiceNote.classList.toggle('ok', [cfg.stt, cfg.tts].every((p) => p?.state !== 'failed'));
    els.voiceNote.textContent = problems.join(' ');
    els.meta.textContent = `Voice: ${[cfg.stt, cfg.tts].map((p) => (p?.state === 'ready' ? p.message : null)).filter(Boolean).join(' · ') || 'starting...'}`;
    loadVoiceScripts().catch((err) => {
        els.voiceNote.hidden = false;
        els.voiceNote.textContent = `The page could not load the voice files: ${err.message}. Run npm install.`;
    });
    if (!was) renderLog();
    refreshStage();
});

socket.on('hello', ({ voices, settings }) => {
    const groups = {};
    for (const v of voices) (groups[`${v.engine} · ${v.group}`] ||= []).push(v);
    els.voice.innerHTML = '';
    for (const [label, list] of Object.entries(groups)) {
        const og = document.createElement('optgroup');
        og.label = label;
        for (const v of list) og.append(new Option(v.grade ? `${v.name}  (${v.grade})` : v.name, v.id));
        els.voice.append(og);
    }
    els.voice.value = voices.some((v) => v.id === prefs.voice) ? prefs.voice : settings.voice;
    els.speed.value = prefs.speed ?? settings.speed;
    els.speedOut.textContent = `${Number(els.speed.value).toFixed(2)}×`;
    els.barge.checked = prefs.barge ?? true;
    els.speak.checked = prefs.speak ?? true;
    voice.hello = true;
    showVoiceOfSelected();
    sendVoiceSettings();
    refreshStage();
});

socket.on('status', ({ stage, note }) => {
    serverStage = stage === 'speaking' ? 'idle' : stage; // "speaking" is driven by the actual playback
    if (stage === 'transcribing') sayStatus('Transcribing...');
    else if (stage === 'thinking') sayStatus(heardEntry ? `Heard: "${heardEntry.text}" Thinking...` : 'Thinking...');
    else if (stage === 'idle') sayStatus(note || (live ? 'Live: just talk. A short pause ends your turn.' : ''));
    refreshStage();
});

socket.on('transcript', ({ turnId, text, sent, sttMs, audioSec }) => {
    currentTurn = turnId;
    // the line as it was sent (v0.1.4.13, N2: with the chosen bot's name in front), else as it was heard
    heardEntry = addLine({ kind: 'user', text: sent || text, note: `spoken, ${audioSec} s · whisper ${ms(sttMs)}` });
    sayStatus(`Heard: "${text}"`);
});

socket.on('audio', ({ turnId, pcm, sampleRate }) => {
    if (staleTurns.has(turnId)) return;
    if (turnId !== 'preview') lastAudioTurn = turnId;
    player.play(new Float32Array(pcm), sampleRate);
});

socket.on('turn_done', ({ turnId, timings = {} }) => {
    serverStage = 'idle';
    if (turnId === currentTurn && heardEntry) {
        addNote(heardEntry, `first line ${ms(timings.firstLineMs)} · first audio ${ms(timings.firstAudioMs)}`);
        heardEntry = null;
    }
    refreshStage();
});

socket.on('error_msg', ({ message }) => {
    addLine({ kind: 'error', text: message });
    serverStage = 'idle';
    sayStatus(live ? 'Live: just talk. A short pause ends your turn.' : '');
    refreshStage();
});

refreshStage();

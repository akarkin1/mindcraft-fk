const settings = {
    "minecraft_version": "auto", // or specific version like "1.21.6"
    "host": "127.0.0.1", // or "localhost", "your.ip.address.here"
    "port": 55916, // set to -1 to automatically scan for open ports
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8080,
    "auto_open_ui": true, // opens UI in browser on startup
    
    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        // "./andy.json",
        // "./profiles/gpt.json",
        "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",
        // "./profiles/mercury.json",
        // "./profiles/andy-4.json", // Supports up to 75 messages!

        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],

    "load_memory": true, // load memory from previous session
    "world_memory": true, // keep memory and saved places separately for each world the bot joins
    "world_id": "", // fixed name for the current world, overrides the automatic world detection. empty to detect automatically
    "resume_goal": "after_crash", // when to resume a goal loaded from memory: "always", "after_crash" or "never"
    "goal_resume_limit": 3, // stop a goal that was resumed this many times within 15 minutes. 0 for no limit
    "init_message": "Respond with hello world and your name", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly

    "speak": true,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "render_bot_view": false, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": true, // allows newAction command and model can write/run code on your computer. enable at own risk
    "sandbox_lockdown": true, // runs the SES lockdown that isolates code written by the model. set false only if a library breaks
    "skill_learning": true, // save code that worked as named skills in bots/<name>/skills, so later code can reuse it. needs allow_insecure_coding
    "skill_capture": true, // with skill_learning: review code that worked and save it as a skill when it is general
    "skill_reuse": true, // with skill_learning: show the saved skills to the model and let its code call them as customSkills.<name>
    "skill_command": true, // with skill_learning and skill_reuse: also offer !useSkill to run a saved skill directly
    "skill_max_count": 100, // with skill_learning: most skills kept, code of a new skill is not saved when the library is full. 0 for no limit
    "skill_disable_after_errors": 3, // with skill_learning: switch a skill off after it threw this many times in a row. 0 for never
    "cost_meter": true, // count the tokens and dollars of every call to the model, print them in the console and answer !cost
    "cost_report_minutes": 10, // with cost_meter: print the cost of the session every this many minutes. 0 for never
    "cost_warn_per_hour": 3, // with cost_meter: warn in chat at this many dollars per hour. 0 for no warning
    "cost_limit_per_hour": 8, // with cost_meter: no goals and no new code at this many dollars per hour, until it drops. 0 for no limit
    "cost_limit_per_session": 10, // with cost_meter: no goals and no new code for the rest of the session at this many dollars. 0 for no limit
    "model_prices": {}, // with cost_meter: dollars per million tokens for other models, e.g. {"my-model": {"input": 1, "output": 5}}
    "max_command_result_chars": 3000, // shorten a command result in the history to this many characters. 0 for no limit
    "protected_areas": true, // never break or place blocks in saved buildings, only plant and harvest in saved farms. needs world_memory
    "player_rules": true, // save lasting rules of the players with !rememberRule and put them into every prompt
    "rules_max": 20, // with player_rules: most rules kept
    "home_pack": true, // commands and reflexes for home: shelter at night, doors, beds, food and creepers
    "home_reflexes": { "door_closing": true, "night_shelter": true, "creeper_safety": true, "hunger": true }, // with home_pack: which reflexes are on
    "creeper_fighting": true, // with home_pack: fight a creeper that was led away from the base instead of running from it
    "storage_pack": true, // store and fetch items with the chests the bot knows: !storeItems, !fetchItem, !chests
    "farming_pack": true, // harvest, plant and fertilize a farm with !farmCycle and more; !collectBlocks on crops harvests and plants again
    "wood_pack": true, // cut real trees, craft tools and supplies: !chopTrees, !getTool, !craftSupplies; !collectBlocks on logs cuts trees
    "mining_pack": true, // mine an ore in a mine with a shaft and a tunnel: !mineOre, !goToMine, !leaveMine
    "mining_max_minutes": 30, // with mining_pack: the longest time of one mining trip
    "keep_items": {}, // items the bot keeps when it stores into chests, e.g. {"wheat_seeds": 32, "iron_ingot": -1}, -1 for all
    "stuck_restart_after": 3, // failed escapes of the unstuck reflex in a row before the process restarts. 0 for never
    "protect_built_blocks": true, // never break blocks that players build with (fences, doors, planks ...), also outside saved areas
    "knowledge_in_prompt": true, // put what the bot knows (chests, areas, mines, places) into the chat prompt
    "knowledge_max_chars": 600, // with knowledge_in_prompt: the longest that block may be
    "repeat_guard": 0, // refuse the Nth try in a row of a command of the model that keeps giving the same result. 0 for off
    "restart_context": true, // after a restart tell the model the last order and why the process ended
    "say_results": true, // when the model answers nothing after a work skill, say the text of the skill in the chat
    "flee_below_health": 0, // below this health the bot does not fight, it retreats. 0 for off
    "log_timestamps": true, // [HH:MM:SS] before each line of the console
    "examples_by_last_request": true, // choose the prompt examples by the last request of the player, not by the whole conversation
    "routes_pack": true, // record the trail and remember the ways the player shows: !rememberRoute, !routes, !forgetRoute; beds and places by a way
    "trail_max_steps": 500, // with routes_pack: the steps of the trail that are kept, 50 or more
    "mine_routes": true, // with mining_pack and routes_pack: the mine of the player: !rememberMine, !rememberTunnel, !collectPassedOre
    "ore_sense_range": 0, // 0: only ore that touches the tunnel or the open air is taken. 3: also ore within 3 blocks of the wall
    "skills_over_code": true, // !newAction writes no code for digging while a command can do it
    "allow_vision": false, // allows vision model to interpret screenshots as inputs
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel", "!restart"] , // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_all_prompts": false, // log ALL prompts to file

}

export default settings;
